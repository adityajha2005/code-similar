import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { promisify } from "util";

import type {
  AnalysisResponse,
  ClusterSummary,
  FileAnalysis,
  FlagSummary,
  MatchingBlock,
  RepositoryInput,
  RepoSimilarity,
  ResavaPreprocessor,
  SimilarityPair,
  SupportedLanguage,
} from "@/lib/types";

const execFileAsync = promisify(execFile);

/** Cap subprocess count for reasonable API latency. */
export const RESAVA_MAX_FILES = 80;

const OUTPUT_LINE = /^"(.+)"\s*:\s*([\d.]+)%\s*$/;

type IndexedDiskFile = {
  id: string;
  repoId: string;
  repoName: string;
  path: string;
  language: SupportedLanguage;
  content: string;
  lineCount: number;
  absPath: string;
};

export function resolveResavaBinary(): string | null {
  const fromEnv = process.env.RESAVA_BIN;
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }
  const unix = join(process.cwd(), "resava", "target", "release", "resava");
  if (existsSync(unix)) {
    return unix;
  }
  const win = join(process.cwd(), "resava", "target", "release", "resava.exe");
  if (existsSync(win)) {
    return win;
  }
  return null;
}

function sanitizePathSegment(segment: string) {
  return segment.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function writeRepositoriesToTemp(repositories: RepositoryInput[]): {
  root: string;
  files: IndexedDiskFile[];
} {
  const root = join(tmpdir(), `resava-scan-${randomUUID()}`);
  const files: IndexedDiskFile[] = [];
  let idCounter = 0;

  for (const repo of repositories) {
    for (const file of repo.files) {
      const relative = join(sanitizePathSegment(repo.id), file.path);
      const dest = join(root, relative);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, file.content, "utf8");
      const absPath = realpathSync(dest);
      const id = `file-${idCounter}`;
      idCounter += 1;
      files.push({
        id,
        repoId: repo.id,
        repoName: repo.name,
        path: file.path,
        language: file.language,
        content: file.content,
        lineCount: file.content.split("\n").length,
        absPath,
      });
    }
  }

  return { root, files };
}

function parseResavaStdout(stdout: string): Map<string, number> {
  const scores = new Map<string, number>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = OUTPUT_LINE.exec(trimmed);
    if (!match) continue;
    const targetPath = match[1];
    const percent = Number.parseFloat(match[2]);
    if (!Number.isFinite(percent)) continue;
    const key = realpathSync(targetPath);
    scores.set(key, percent / 100);
  }
  return scores;
}

async function runResavaOnce(
  binary: string,
  sourcePath: string,
  targetRoot: string,
  minSimilarityPercent: number,
  preprocessor: ResavaPreprocessor,
): Promise<Map<string, number>> {
  const pp =
    preprocessor === "none" ? "none" : preprocessor === "asm" ? "asm" : preprocessor === "c" ? "c" : "text";
  const args = [
    "-p",
    pp,
    "-s",
    String(minSimilarityPercent),
    sourcePath,
    targetRoot,
  ];
  const { stdout, stderr } = await execFileAsync(binary, args, {
    maxBuffer: 32 * 1024 * 1024,
    encoding: "utf8",
  });
  if (stderr && /error|Error/i.test(stderr) && !stdout.trim()) {
    throw new Error(stderr.trim() || "resava failed");
  }
  return parseResavaStdout(stdout);
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function buildClustersFromPairs(
  pairs: SimilarityPair[],
  fileLookup: Map<string, { repoName: string; path: string }>,
): ClusterSummary[] {
  const parent = new Map<string, string>();

  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) {
      parent.set(x, find(parent.get(x)!));
    }
    return parent.get(x)!;
  }

  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const p of pairs) {
    union(p.leftFileId, p.rightFileId);
  }

  const inPair = new Set<string>();
  for (const p of pairs) {
    inPair.add(p.leftFileId);
    inPair.add(p.rightFileId);
  }

  const groups = new Map<string, string[]>();
  for (const id of inPair) {
    const r = find(id);
    const list = groups.get(r) ?? [];
    list.push(id);
    groups.set(r, list);
  }

  const clusters: ClusterSummary[] = [];
  let clusterIndex = 0;
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const relevantPairs = pairs.filter(
      (p) => ids.includes(p.leftFileId) && ids.includes(p.rightFileId),
    );
    const avg =
      relevantPairs.length > 0
        ? relevantPairs.reduce((s, p) => s + p.score, 0) / relevantPairs.length
        : 0;
    clusterIndex += 1;
    clusters.push({
      id: `cluster-${clusterIndex}`,
      label: `Cluster ${clusterIndex}`,
      averageScore: avg,
      files: ids.map((id) => {
        const meta = fileLookup.get(id)!;
        return { id, repoName: meta.repoName, path: meta.path };
      }),
    });
  }

  return clusters;
}

function buildRepoPairs(
  repositories: RepositoryInput[],
  pairs: SimilarityPair[],
  fileLookup: Map<string, { repoId: string; repoName: string }>,
): RepoSimilarity[] {
  const best = new Map<string, { score: number; left: string; right: string }>();

  for (const p of pairs) {
    const left = fileLookup.get(p.leftFileId);
    const right = fileLookup.get(p.rightFileId);
    if (!left || !right || left.repoId === right.repoId) continue;
    const key = pairKey(left.repoId, right.repoId);
    const prev = best.get(key);
    if (!prev || p.score > prev.score) {
      best.set(key, { score: p.score, left: left.repoName, right: right.repoName });
    }
  }

  const out: RepoSimilarity[] = [];
  for (const [key, v] of best) {
    const [a, b] = key.split("::");
    out.push({
      leftRepoId: a,
      rightRepoId: b,
      label: `${v.left} ↔ ${v.right}`,
      score: v.score,
      reason: "Best file-level match between repositories (resava).",
    });
  }
  out.sort((x, y) => y.score - x.score);
  return out;
}

function summarizeResavaFlags(pairs: SimilarityPair[]): FlagSummary[] {
  return pairs
    .filter((p) => p.flagged)
    .map((p, i) => ({
      id: `flag-${i}`,
      title: p.title,
      summary: `Resava similarity ${Math.round(p.score * 100)}% (normalized Levenshtein on preprocessed text).`,
    }));
}

export async function analyzeWithResava(
  repositories: RepositoryInput[],
  options: {
    minSimilarityPercent: number;
    preprocessor: ResavaPreprocessor;
  },
): Promise<AnalysisResponse> {
  const binary = resolveResavaBinary();
  if (!binary) {
    throw new Error(
      "resava binary not found. Build it with: cd resava && cargo build --release --target-dir ./target (or set RESAVA_BIN to the executable path).",
    );
  }

  const flatFileCount = repositories.reduce((n, r) => n + r.files.length, 0);
  if (flatFileCount === 0) {
    throw new Error("No files to analyze.");
  }
  if (flatFileCount > RESAVA_MAX_FILES) {
    throw new Error(
      `Too many files for resava mode (${flatFileCount} > ${RESAVA_MAX_FILES}). Reduce repos or languages.`,
    );
  }

  const { root, files } = writeRepositoriesToTemp(repositories);
  const pathToId = new Map<string, string>();
  for (const f of files) {
    pathToId.set(f.absPath, f.id);
  }

  const pairScores = new Map<string, number>();

  try {
    for (const source of files) {
      const scores = await runResavaOnce(
        binary,
        source.absPath,
        root,
        options.minSimilarityPercent,
        options.preprocessor,
      );
      for (const [targetPath, score] of scores) {
        const targetId = pathToId.get(targetPath);
        if (!targetId || targetId === source.id) continue;
        const key = pairKey(source.id, targetId);
        const prev = pairScores.get(key);
        if (prev === undefined || score > prev) {
          pairScores.set(key, score);
        }
      }
    }
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  const fileById = new Map(files.map((f) => [f.id, f]));
  const pairs: SimilarityPair[] = [];

  for (const [key, score] of pairScores) {
    const [a, b] = key.split("::");
    const left = fileById.get(a);
    const right = fileById.get(b);
    if (!left || !right) continue;

    const [leftFile, rightFile] =
      left.repoName + left.path < right.repoName + right.path ? [left, right] : [right, left];

    const pairId = `${leftFile.id}::${rightFile.id}`;
    const leftLines = leftFile.lineCount;
    const rightLines = rightFile.lineCount;

    const block: MatchingBlock = {
      score,
      left: { startLine: 1, endLine: Math.max(1, leftLines) },
      right: { startLine: 1, endLine: Math.max(1, rightLines) },
    };

    pairs.push({
      id: pairId,
      leftFileId: leftFile.id,
      rightFileId: rightFile.id,
      title: `${leftFile.repoName}/${leftFile.path} ↔ ${rightFile.repoName}/${rightFile.path}`,
      score,
      method: "resava",
      reason: `Resava normalized Levenshtein similarity (preprocessor: ${options.preprocessor}).`,
      flagged: score >= 0.84,
      matchingBlocks: [block],
    });
  }

  pairs.sort((x, y) => y.score - x.score);

  const fileLookupMeta = new Map(
    files.map((f) => [f.id, { repoId: f.repoId, repoName: f.repoName, path: f.path }]),
  );

  const filesOut: FileAnalysis[] = files.map((f) => ({
    id: f.id,
    repoId: f.repoId,
    repoName: f.repoName,
    path: f.path,
    language: f.language,
    content: f.content,
    lineCount: f.lineCount,
    matchingBlocks: pairs.flatMap((p) => {
      if (p.leftFileId === f.id) {
        return p.matchingBlocks.map((block) => ({
          pairId: p.id,
          startLine: block.left.startLine,
          endLine: block.left.endLine,
        }));
      }
      if (p.rightFileId === f.id) {
        return p.matchingBlocks.map((block) => ({
          pairId: p.id,
          startLine: block.right.startLine,
          endLine: block.right.endLine,
        }));
      }
      return [];
    }),
  }));

  const clusters = buildClustersFromPairs(
    pairs,
    new Map(files.map((f) => [f.id, { repoName: f.repoName, path: f.path }])),
  );

  return {
    generatedAt: new Date().toISOString(),
    repositories,
    files: filesOut,
    pairs,
    clusters,
    flags: summarizeResavaFlags(pairs),
    repoPairs: buildRepoPairs(repositories, pairs, fileLookupMeta),
  };
}
