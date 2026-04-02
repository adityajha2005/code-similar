"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  AnalysisResponse,
  FileAnalysis,
  ResavaPreprocessor,
  ScanEngine,
  ScanMethod,
  SupportedLanguage,
} from "@/lib/types";

const languageOptions: SupportedLanguage[] = ["JavaScript", "TypeScript", "Python"];

const methodOptions: { value: ScanMethod; label: string }[] = [
  { value: "hybrid", label: "Hybrid" },
  { value: "token", label: "Token" },
  { value: "ast", label: "Structure" },
  { value: "embedding", label: "Semantic" },
];

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatMethod(method: ScanMethod) {
  if (method === "ast") return "Structure";
  if (method === "resava") return "Resava";
  return method[0].toUpperCase() + method.slice(1);
}

function getFileLanguage(file: FileAnalysis) {
  return file.language ?? "Unknown";
}

function getHighlightedLines(file: FileAnalysis, activePairId?: string) {
  if (!activePairId) return new Set<number>();
  const block = file.matchingBlocks.find((entry) => entry.pairId === activePairId);
  if (!block) return new Set<number>();
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
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      <header className="border-b border-white/10 px-4 py-3">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
      </header>
      <div className="max-h-[min(28rem,50vh)] overflow-auto bg-[#0c0c0c]">
        <div className="min-w-full px-0 py-2 font-mono text-[12px] leading-6 text-zinc-300">
          {lines.map((line, index) => {
            const lineNumber = index + 1;
            const highlighted = highlightedLines.has(lineNumber);
            return (
              <div
                key={`${title}-${lineNumber}`}
                className={clsx(
                  "grid grid-cols-[2.75rem_1fr] px-3 transition-colors",
                  highlighted ? "bg-white/[0.08]" : "hover:bg-white/[0.03]",
                )}
              >
                <span className="select-none pr-2 text-right text-zinc-600">{lineNumber}</span>
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
  const [scanEngine, setScanEngine] = useState<ScanEngine>("internal");
  const [resavaMinSimilarity, setResavaMinSimilarity] = useState(40);
  const [resavaPreprocessor, setResavaPreprocessor] = useState<ResavaPreprocessor>("text");
  const [includeSeededRepos, setIncludeSeededRepos] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filesByRepo = useMemo(() => {
    if (!analysis) return [];
    return analysis.repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      source: repo.source,
      files: analysis.files.filter((file) => file.repoId === repo.id),
    }));
  }, [analysis]);

  const activePair = useMemo(() => {
    if (!analysis) return null;
    return (
      analysis.pairs.find((entry) => entry.id === selectedPairId) ?? analysis.pairs[0] ?? null
    );
  }, [analysis, selectedPairId]);

  const fileMap = useMemo(() => {
    if (!analysis) return new Map<string, FileAnalysis>();
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
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              repoUrls: repoInput
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
              languages: selectedLanguages,
              method: selectedMethod,
              includeSeededRepos,
              engine: scanEngine,
              ...(scanEngine === "resava"
                ? { resavaMinSimilarity, resavaPreprocessor }
                : {}),
            }),
          });

          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { error?: string } | null;
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
    setSelectedLanguages((current) =>
      current.includes(language) ? current.filter((entry) => entry !== language) : [...current, language],
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_40%)]" />
      <div className="relative mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Code similarity
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Paste public GitHub repo URLs (one per line)—use the repo home URL, not a link to a single
            file. Run a scan, then pick a match to compare files side by side.
          </p>
        </header>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1 space-y-4">
              <label className="block">
                <span className="text-sm text-zinc-300">Repository URLs</span>
                <textarea
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  className="mt-2 min-h-[100px] w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-sm text-zinc-100 outline-none focus:border-white/25"
                  placeholder="https://github.com/org/repo"
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-zinc-500">Languages:</span>
                {languageOptions.map((language) => (
                  <button
                    key={language}
                    type="button"
                    onClick={() => toggleLanguage(language)}
                    className={clsx(
                      "rounded-full border px-3 py-1.5 text-sm",
                      selectedLanguages.includes(language)
                        ? "border-white/25 bg-white text-black"
                        : "border-white/10 bg-white/[0.04] text-zinc-400 hover:bg-white/[0.08]",
                    )}
                  >
                    {language}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-zinc-500">Engine:</span>
                <select
                  value={scanEngine}
                  onChange={(e) => setScanEngine(e.target.value as ScanEngine)}
                  className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                >
                  <option value="internal">Built-in</option>
                  <option value="resava">Resava (local CLI)</option>
                </select>
                {scanEngine === "internal" ? (
                  <select
                    value={selectedMethod}
                    onChange={(e) => setSelectedMethod(e.target.value as ScanMethod)}
                    className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                  >
                    {methodOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <label className="flex items-center gap-2 text-sm text-zinc-400">
                      Min %
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={resavaMinSimilarity}
                        onChange={(e) => setResavaMinSimilarity(Number(e.target.value) || 40)}
                        className="w-16 rounded-lg border border-white/10 bg-black/50 px-2 py-1.5 text-sm text-white"
                      />
                    </label>
                    <select
                      value={resavaPreprocessor}
                      onChange={(e) => setResavaPreprocessor(e.target.value as ResavaPreprocessor)}
                      className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none"
                    >
                      <option value="text">Text</option>
                      <option value="c">C-like</option>
                      <option value="asm">Assembly</option>
                      <option value="none">None</option>
                    </select>
                  </>
                )}
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  checked={includeSeededRepos}
                  onChange={(e) => setIncludeSeededRepos(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 accent-white"
                />
                Include demo sample repos in the scan
              </label>
            </div>

            <button
              type="button"
              onClick={runScan}
              disabled={isPending || selectedLanguages.length === 0}
              className="shrink-0 rounded-xl bg-white px-6 py-3 text-sm font-medium text-black hover:bg-zinc-200 disabled:opacity-50"
            >
              {isPending ? "Scanning…" : "Run scan"}
            </button>
          </div>

          {error ? (
            <p className="mt-4 rounded-lg border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          ) : null}
        </section>

        {analysis ? (
          <section className="mt-8 grid gap-6 lg:grid-cols-[260px_1fr]">
            <aside className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Files</p>
              <p className="mt-1 text-sm text-zinc-400">{analysis.files.length} indexed</p>
              <div className="mt-4 max-h-[50vh] space-y-4 overflow-y-auto">
                {filesByRepo.map((repo) => (
                  <div key={repo.id}>
                    <p className="text-xs text-zinc-500">{repo.name}</p>
                    <ul className="mt-2 space-y-1">
                      {repo.files.map((file) => (
                        <li key={file.id}>
                          <button
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
                              "w-full rounded-lg px-2 py-1.5 text-left text-sm transition",
                              activePair &&
                                (activePair.leftFileId === file.id || activePair.rightFileId === file.id)
                                ? "bg-white/10 text-white"
                                : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
                            )}
                          >
                            {file.path}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </aside>

            <div className="min-w-0 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Similar pairs
                </p>
                {analysis.pairs.length === 0 ? (
                  <p className="mt-3 text-sm text-zinc-500">
                    No pairs above the current threshold. Try lowering the minimum similarity (Resava)
                    or using the built-in engine.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {analysis.pairs.map((pair) => (
                      <li key={pair.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedPairId(pair.id)}
                          className={clsx(
                            "rounded-lg border px-3 py-2 text-left text-xs transition sm:text-sm",
                            activePair?.id === pair.id
                              ? "border-white/30 bg-white/10 text-white"
                              : "border-white/10 bg-black/30 text-zinc-400 hover:border-white/20",
                          )}
                        >
                          <span className="line-clamp-2">{pair.title}</span>
                          <span className="mt-1 block text-zinc-500">
                            {formatPercent(pair.score)} · {formatMethod(pair.method)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {analysis && activePair && activeLeftFile && activeRightFile ? (
                <div>
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm text-zinc-400">
                      {formatMethod(activePair.method)}
                      {activePair.flagged ? " · Flagged" : ""}
                    </p>
                    <p className="text-2xl font-semibold text-white">{formatPercent(activePair.score)}</p>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <CodePanel
                      title={`${activeLeftFile.repoName} / ${activeLeftFile.path}`}
                      subtitle={`${getFileLanguage(activeLeftFile)} · ${activeLeftFile.lineCount} lines`}
                      content={activeLeftFile.content}
                      highlightedLines={leftHighlights}
                    />
                    <CodePanel
                      title={`${activeRightFile.repoName} / ${activeRightFile.path}`}
                      subtitle={`${getFileLanguage(activeRightFile)} · ${activeRightFile.lineCount} lines`}
                      content={activeRightFile.content}
                      highlightedLines={rightHighlights}
                    />
                  </div>
                </div>
              ) : analysis && analysis.pairs.length === 0 ? (
                <p className="text-sm text-zinc-500">No pair selected to compare.</p>
              ) : null}
            </div>
          </section>
        ) : (
          <p className="mt-8 text-center text-sm text-zinc-600">
            Run a scan to see files and similar pairs here.
          </p>
        )}
      </div>
    </main>
  );
}
