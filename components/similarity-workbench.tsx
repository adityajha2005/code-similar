"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  AnalysisResponse,
  FileAnalysis,
  RepoRecord,
  ScanMethod,
  SupportedLanguage,
} from "@/lib/types";

const languageOptions: SupportedLanguage[] = ["JavaScript", "TypeScript", "Python"];
const methodOptions: { value: ScanMethod; label: string; detail: string }[] = [
  {
    value: "hybrid",
    label: "Hybrid",
    detail: "Blends token, structural, and semantic similarity for the strongest signal.",
  },
  {
    value: "token",
    label: "Token Matching",
    detail: "Fast duplicate detection using normalized token shingles and renamed-variable tolerance.",
  },
  {
    value: "ast",
    label: "Structure",
    detail: "Focuses on code shape, branching patterns, and declaration structure.",
  },
  {
    value: "embedding",
    label: "Semantic",
    detail: "Approximates semantic similarity using identifier and intent vectors.",
  },
];

const seededRepos: RepoRecord[] = [
  {
    id: "seed-checkout",
    name: "checkout-service",
    source: "Seeded workspace",
    fileCount: 4,
    dominantLanguage: "TypeScript",
    lastScan: "Ready to analyze",
    status: "Sample",
  },
  {
    id: "seed-analytics",
    name: "analytics-jobs",
    source: "Seeded workspace",
    fileCount: 3,
    dominantLanguage: "Python",
    lastScan: "Ready to analyze",
    status: "Sample",
  },
];

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatMethod(method: ScanMethod) {
  return method === "ast" ? "Structure" : method[0].toUpperCase() + method.slice(1);
}

function getFileLanguage(file: FileAnalysis) {
  return file.language ?? "Unknown";
}

function getHighlightedLines(file: FileAnalysis, activePairId?: string) {
  if (!activePairId) {
    return new Set<number>();
  }

  const block = file.matchingBlocks.find((entry) => entry.pairId === activePairId);
  if (!block) {
    return new Set<number>();
  }

  const lines = new Set<number>();
  for (let line = block.startLine; line <= block.endLine; line += 1) {
    lines.add(line);
  }

  return lines;
}

function CodePanel({
  title,
  subtitle,
  content,
  highlightedLines,
}: {
  title: string;
  subtitle: string;
  content: string;
  highlightedLines: Set<number>;
}) {
  const lines = content.split("\n");

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
      <header className="border-b border-white/8 px-5 py-4">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
      </header>
      <div className="max-h-[32rem] overflow-auto bg-[#0c0c0c]">
        <div className="min-w-full px-0 py-2 font-mono text-[12px] leading-6 text-zinc-300">
          {lines.map((line, index) => {
            const lineNumber = index + 1;
            const highlighted = highlightedLines.has(lineNumber);
            return (
              <div
                key={`${title}-${lineNumber}`}
                className={clsx(
                  "grid grid-cols-[3.5rem_1fr] px-4 transition-colors",
                  highlighted ? "bg-white/[0.08]" : "hover:bg-white/[0.03]",
                )}
              >
                <span className="select-none pr-4 text-right text-zinc-600">
                  {lineNumber}
                </span>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-zinc-300">
                  {line || " "}
                </pre>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function RepoCard({ repo }: { repo: RepoRecord }) {
  return (
    <article className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.24)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">{repo.source}</p>
          <h3 className="mt-2 text-lg font-semibold text-white">{repo.name}</h3>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-zinc-400">
          {repo.status}
        </span>
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-3 text-sm text-zinc-400">
        <div>
          <dt className="text-zinc-500">Files</dt>
          <dd className="mt-1 text-white">{repo.fileCount}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Language</dt>
          <dd className="mt-1 text-white">{repo.dominantLanguage}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Last scan</dt>
          <dd className="mt-1 text-white">{repo.lastScan}</dd>
        </div>
      </dl>
    </article>
  );
}

export function SimilarityWorkbench() {
  const [repoInput, setRepoInput] = useState(
    "https://github.com/vercel/next.js\nhttps://github.com/facebook/react",
  );
  const [selectedLanguages, setSelectedLanguages] = useState<SupportedLanguage[]>([
    "JavaScript",
    "TypeScript",
    "Python",
  ]);
  const [selectedMethod, setSelectedMethod] = useState<ScanMethod>("hybrid");
  const [includeSeededRepos, setIncludeSeededRepos] = useState(true);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filesByRepo = useMemo(() => {
    if (!analysis) {
      return [];
    }

    return analysis.repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      source: repo.source,
      files: analysis.files.filter((file) => file.repoId === repo.id),
    }));
  }, [analysis]);

  const activePair = useMemo(() => {
    if (!analysis) {
      return null;
    }

    const pair =
      analysis.pairs.find((entry) => entry.id === selectedPairId) ?? analysis.pairs[0] ?? null;

    return pair;
  }, [analysis, selectedPairId]);

  const fileMap = useMemo(() => {
    if (!analysis) {
      return new Map<string, FileAnalysis>();
    }

    return new Map(analysis.files.map((file) => [file.id, file]));
  }, [analysis]);

  const activeLeftFile = activePair ? fileMap.get(activePair.leftFileId) ?? null : null;
  const activeRightFile = activePair ? fileMap.get(activePair.rightFileId) ?? null : null;

  const leftHighlights = activeLeftFile
    ? getHighlightedLines(activeLeftFile, activePair?.id)
    : new Set<number>();
  const rightHighlights = activeRightFile
    ? getHighlightedLines(activeRightFile, activePair?.id)
    : new Set<number>();

  async function runScan() {
    setError(null);

    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch("/api/scan", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              repoUrls: repoInput
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
              languages: selectedLanguages,
              method: selectedMethod,
              includeSeededRepos,
            }),
          });

          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as
              | { error?: string }
              | null;
            throw new Error(payload?.error ?? "Scan failed");
          }

          const payload = (await response.json()) as AnalysisResponse;
          setAnalysis(payload);
          setSelectedPairId(payload.pairs[0]?.id ?? null);
        } catch (scanError) {
          const message =
            scanError instanceof Error ? scanError.message : "Unable to complete the scan.";
          setError(message);
        }
      })();
    });
  }

  function toggleLanguage(language: SupportedLanguage) {
    setSelectedLanguages((current) => {
      if (current.includes(language)) {
        return current.filter((entry) => entry !== language);
      }

      return [...current, language];
    });
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_22%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-8 px-6 py-8 lg:px-10">
        <header className="rounded-[32px] border border-white/10 bg-white/[0.04] px-6 py-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.32em] text-zinc-500">
                Code Similarity Detector
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                Scan repositories, surface duplicate logic, and inspect matching code in one
                grayscale workspace.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">
                Token matching, structure-aware comparison, and semantic scoring for JavaScript,
                TypeScript, and Python. Seeded samples are included so the UI stays explorable
                before your first live scan succeeds.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Similarity modes", value: "4" },
                { label: "Seeded repos", value: "2" },
                { label: "Supported languages", value: "3" },
              ].map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-[24px] border border-white/10 bg-black/40 px-4 py-4"
                >
                  <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                    {metric.label}
                  </p>
                  <p className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white">
                    {metric.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </header>

        <section className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[32px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">Dashboard</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">
                  Repository Overview
                </h2>
              </div>
              <button
                type="button"
                onClick={runScan}
                disabled={isPending || selectedLanguages.length === 0}
                className="rounded-full border border-white/10 bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? "Scanning..." : "New Scan"}
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {seededRepos.map((repo) => (
                <RepoCard key={repo.id} repo={repo} />
              ))}
            </div>
          </div>

          <section className="rounded-[32px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)] backdrop-blur-xl">
            <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">Scan Page</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">
              Configure a Similarity Scan
            </h2>

            <label className="mt-6 block">
              <span className="text-sm font-medium text-zinc-300">GitHub repository URLs</span>
              <textarea
                value={repoInput}
                onChange={(event) => setRepoInput(event.target.value)}
                className="mt-3 min-h-36 w-full rounded-[24px] border border-white/10 bg-black/40 px-4 py-4 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/20 focus:bg-black/55"
                placeholder="https://github.com/org/repo"
              />
            </label>

            <div className="mt-6">
              <p className="text-sm font-medium text-zinc-300">Languages</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {languageOptions.map((language) => {
                  const active = selectedLanguages.includes(language);
                  return (
                    <button
                      key={language}
                      type="button"
                      onClick={() => toggleLanguage(language)}
                      className={clsx(
                        "rounded-full border px-4 py-2 text-sm transition",
                        active
                          ? "border-white/20 bg-white text-black"
                          : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]",
                      )}
                    >
                      {language}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-6">
              <p className="text-sm font-medium text-zinc-300">Similarity method</p>
              <div className="mt-3 grid gap-3">
                {methodOptions.map((option) => {
                  const active = selectedMethod === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSelectedMethod(option.value)}
                      className={clsx(
                        "rounded-[24px] border px-4 py-4 text-left transition",
                        active
                          ? "border-white/20 bg-white/[0.12]"
                          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm font-medium text-white">{option.label}</span>
                        <span className="text-xs text-zinc-500">{formatMethod(option.value)}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-zinc-400">{option.detail}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="mt-6 flex items-center justify-between rounded-[24px] border border-white/10 bg-black/30 px-4 py-4 text-sm text-zinc-300">
              <span>Include seeded sample repositories</span>
              <input
                type="checkbox"
                checked={includeSeededRepos}
                onChange={(event) => setIncludeSeededRepos(event.target.checked)}
                className="h-4 w-4 accent-white"
              />
            </label>

            <div className="mt-6 rounded-[24px] border border-white/10 bg-black/30 px-4 py-4">
              <div className="flex items-center justify-between text-sm text-zinc-400">
                <span>Progress</span>
                <span>{isPending ? "Analyzing repositories" : "Waiting for scan"}</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className={clsx(
                    "h-full rounded-full bg-white transition-all duration-500",
                    isPending ? "w-3/4 animate-pulse" : analysis ? "w-full" : "w-1/6",
                  )}
                />
              </div>
            </div>

            {error ? (
              <p className="mt-4 rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
                {error}
              </p>
            ) : null}
          </section>
        </section>

        <section className="grid gap-8 xl:grid-cols-[0.78fr_1.22fr]">
          <aside className="rounded-[32px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">Results Page</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">
                  File Tree
                </h2>
              </div>
              {analysis ? (
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400">
                  {analysis.files.length} files indexed
                </span>
              ) : null}
            </div>

            {analysis ? (
              <div className="mt-6 space-y-5">
                {filesByRepo.map((repo) => (
                  <div key={repo.id} className="rounded-[24px] border border-white/10 bg-black/30 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-white">{repo.name}</p>
                        <p className="mt-1 text-xs text-zinc-500">{repo.source}</p>
                      </div>
                      <span className="text-xs text-zinc-500">{repo.files.length} files</span>
                    </div>
                    <div className="mt-4 space-y-2">
                      {repo.files.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          onClick={() => {
                            const pair =
                              analysis.pairs.find(
                                (entry) =>
                                  entry.leftFileId === file.id || entry.rightFileId === file.id,
                              ) ?? null;
                            setSelectedPairId(pair?.id ?? null);
                          }}
                          className={clsx(
                            "flex w-full items-center justify-between rounded-[18px] border px-3 py-3 text-left transition",
                            activePair &&
                              (activePair.leftFileId === file.id || activePair.rightFileId === file.id)
                              ? "border-white/20 bg-white/[0.07]"
                              : "border-white/8 bg-white/[0.02] hover:bg-white/[0.05]",
                          )}
                        >
                          <div>
                            <p className="text-sm text-white">{file.path}</p>
                            <p className="mt-1 text-xs text-zinc-500">{getFileLanguage(file)}</p>
                          </div>
                          <span className="text-xs text-zinc-500">{file.lineCount} lines</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-6 rounded-[24px] border border-dashed border-white/10 bg-black/20 px-5 py-8 text-sm leading-7 text-zinc-500">
                Run a scan to populate the file tree, similarity pairs, and duplicate clusters.
              </div>
            )}
          </aside>

          <section className="space-y-8">
            <div className="rounded-[32px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">
                    Similarity Viewer
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">
                    Side-by-side inspection
                  </h2>
                </div>
                {activePair ? (
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Similarity</p>
                    <p className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-white">
                      {formatPercent(activePair.score)}
                    </p>
                  </div>
                ) : null}
              </div>

              {analysis && activePair && activeLeftFile && activeRightFile ? (
                <>
                  <div className="mt-6 grid gap-4 xl:grid-cols-2">
                    <CodePanel
                      title={`${activeLeftFile.repoName} / ${activeLeftFile.path}`}
                      subtitle={`${getFileLanguage(activeLeftFile)} • ${activeLeftFile.lineCount} lines`}
                      content={activeLeftFile.content}
                      highlightedLines={leftHighlights}
                    />
                    <CodePanel
                      title={`${activeRightFile.repoName} / ${activeRightFile.path}`}
                      subtitle={`${getFileLanguage(activeRightFile)} • ${activeRightFile.lineCount} lines`}
                      content={activeRightFile.content}
                      highlightedLines={rightHighlights}
                    />
                  </div>

                  <div className="mt-6 grid gap-4 lg:grid-cols-3">
                    <div className="rounded-[24px] border border-white/10 bg-black/30 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Method</p>
                      <p className="mt-3 text-lg font-semibold text-white">
                        {formatMethod(activePair.method)}
                      </p>
                    </div>
                    <div className="rounded-[24px] border border-white/10 bg-black/30 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
                        Matching blocks
                      </p>
                      <p className="mt-3 text-lg font-semibold text-white">
                        {activePair.matchingBlocks.length}
                      </p>
                    </div>
                    <div className="rounded-[24px] border border-white/10 bg-black/30 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Flag</p>
                      <p className="mt-3 text-lg font-semibold text-white">
                        {activePair.flagged ? "Possible plagiarism" : "Needs review"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3">
                    {activePair.matchingBlocks.map((block, index) => (
                      <button
                        key={`${activePair.id}-${index}`}
                        type="button"
                        onClick={() => setSelectedPairId(activePair.id)}
                        className="flex items-center justify-between rounded-[22px] border border-white/10 bg-black/30 px-4 py-4 text-left transition hover:bg-white/[0.05]"
                      >
                        <div>
                          <p className="text-sm font-medium text-white">
                            Matching segment {index + 1}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {activeLeftFile.path}:{block.left.startLine}-{block.left.endLine} ↔{" "}
                            {activeRightFile.path}:{block.right.startLine}-{block.right.endLine}
                          </p>
                        </div>
                        <span className="text-sm text-zinc-300">
                          {formatPercent(block.score)}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="mt-6 rounded-[24px] border border-dashed border-white/10 bg-black/20 px-5 py-10 text-sm leading-7 text-zinc-500">
                  The similarity viewer will populate with side-by-side code once a scan returns at
                  least one matching pair.
                </div>
              )}
            </div>

            <section className="rounded-[32px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-zinc-500">Insights Panel</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">
                    Clusters, flags, and repository summaries
                  </h2>
                </div>
                {analysis ? (
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400">
                    {analysis.clusters.length} clusters
                  </span>
                ) : null}
              </div>

              {analysis ? (
                <div className="mt-6 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
                  <div className="space-y-4">
                    <div className="rounded-[24px] border border-white/10 bg-black/30 p-4">
                      <p className="text-sm font-medium text-white">Top similar files</p>
                      <div className="mt-4 space-y-3">
                        {analysis.pairs.slice(0, 5).map((pair) => (
                          <button
                            key={pair.id}
                            type="button"
                            onClick={() => setSelectedPairId(pair.id)}
                            className={clsx(
                              "w-full rounded-[20px] border px-4 py-4 text-left transition",
                              activePair?.id === pair.id
                                ? "border-white/20 bg-white/[0.08]"
                                : "border-white/8 bg-white/[0.02] hover:bg-white/[0.05]",
                            )}
                          >
                            <p className="text-sm text-white">{pair.title}</p>
                            <p className="mt-1 text-xs text-zinc-500">
                              {formatMethod(pair.method)} • {pair.reason}
                            </p>
                            <p className="mt-3 text-lg font-semibold text-white">
                              {formatPercent(pair.score)}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-black/30 p-4">
                      <p className="text-sm font-medium text-white">Duplicate clusters</p>
                      <div className="mt-4 space-y-3">
                        {analysis.clusters.map((cluster) => (
                          <div
                            key={cluster.id}
                            className="rounded-[20px] border border-white/8 bg-white/[0.02] px-4 py-4"
                          >
                            <p className="text-sm text-white">{cluster.label}</p>
                            <p className="mt-1 text-xs text-zinc-500">
                              Avg. similarity {formatPercent(cluster.averageScore)}
                            </p>
                            <p className="mt-3 text-sm leading-6 text-zinc-400">
                              {cluster.files.map((file) => `${file.repoName}/${file.path}`).join(" • ")}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[24px] border border-white/10 bg-black/30 p-4">
                      <p className="text-sm font-medium text-white">Plagiarism flags</p>
                      <div className="mt-4 space-y-3">
                        {analysis.flags.length > 0 ? (
                          analysis.flags.map((flag) => (
                            <div
                              key={flag.id}
                              className="rounded-[20px] border border-white/8 bg-white/[0.02] px-4 py-4"
                            >
                              <p className="text-sm text-white">{flag.title}</p>
                              <p className="mt-1 text-xs text-zinc-500">{flag.summary}</p>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-[20px] border border-white/8 bg-white/[0.02] px-4 py-4 text-sm text-zinc-500">
                            No files crossed the plagiarism threshold in this run.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-black/30 p-4">
                      <p className="text-sm font-medium text-white">Repo-to-repo similarity</p>
                      <div className="mt-4 space-y-3">
                        {analysis.repoPairs.map((pair) => (
                          <div
                            key={`${pair.leftRepoId}-${pair.rightRepoId}`}
                            className="flex items-center justify-between rounded-[20px] border border-white/8 bg-white/[0.02] px-4 py-4"
                          >
                            <div>
                              <p className="text-sm text-white">{pair.label}</p>
                              <p className="mt-1 text-xs text-zinc-500">{pair.reason}</p>
                            </div>
                            <p className="text-lg font-semibold text-white">
                              {formatPercent(pair.score)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-[24px] border border-dashed border-white/10 bg-black/20 px-5 py-10 text-sm leading-7 text-zinc-500">
                  Similarity insights appear here after the first scan, including top file matches,
                  duplicate clusters, and repo-to-repo overlap.
                </div>
              )}
            </section>
          </section>
        </section>
      </div>
    </main>
  );
}
