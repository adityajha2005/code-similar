import type { RepositoryInput, SourceFile, SupportedLanguage } from "@/lib/types";

const supportedExtensions: Record<string, SupportedLanguage> = {
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".py": "Python",
};

type GitHubRepoRef = {
  owner: string;
  repo: string;
};

type GitHubRepoResponse = {
  default_branch: string;
  full_name: string;
};

type GitHubTreeNode = {
  path: string;
  type: "blob" | "tree";
  url: string;
  size?: number;
};

type GitHubTreeResponse = {
  tree: GitHubTreeNode[];
};

type GitHubBlobResponse = {
  content: string;
  encoding: string;
};

function parseGitHubUrl(input: string): GitHubRepoRef | null {
  try {
    const url = new URL(input);
    if (url.hostname !== "github.com") {
      return null;
    }

    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) {
      return null;
    }

    return {
      owner,
      repo: repo.replace(/\.git$/, ""),
    };
  } catch {
    return null;
  }
}

function getLanguageForPath(path: string) {
  const extension = Object.keys(supportedExtensions).find((suffix) => path.endsWith(suffix));
  return extension ? supportedExtensions[extension] : null;
}

function decodeContent(blob: GitHubBlobResponse) {
  if (blob.encoding !== "base64") {
    return blob.content;
  }

  return Buffer.from(blob.content, "base64").toString("utf8");
}

/** Prefer `GITHUB_TOKEN`; `GH_TOKEN` is also common (GitHub CLI). */
function getGithubToken(): string | undefined {
  const t = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  return t || undefined;
}

function githubRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "code-similar-mvp",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = getGithubToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    headers: githubRequestHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    const detail = body?.message ? ` — ${body.message}` : "";
    const rateRemaining = response.headers.get("x-ratelimit-remaining");
    const authHint =
      response.status === 403 && !getGithubToken()
        ? " Unauthenticated GitHub API is limited to ~60 requests/hour per IP; add GITHUB_TOKEN in .env.local (classic PAT with repo scope for private repos) to raise the limit and access private repositories."
        : response.status === 403 && getGithubToken()
          ? " Check that GITHUB_TOKEN has access to this repository (repo scope for private repos)."
          : "";
    const rateHint =
      response.status === 403 && rateRemaining === "0"
        ? " Rate limit may be exhausted; try again later or use GITHUB_TOKEN."
        : "";
    throw new Error(
      `GitHub request failed (${response.status}) for ${url}${detail}.${rateHint}${authHint}`,
    );
  }

  return (await response.json()) as T;
}

export async function fetchGitHubRepository(
  rawUrl: string,
  selectedLanguages: SupportedLanguage[],
): Promise<RepositoryInput | null> {
  const reference = parseGitHubUrl(rawUrl);
  if (!reference) {
    return null;
  }

  const repo = await fetchJson<GitHubRepoResponse>(
    `https://api.github.com/repos/${reference.owner}/${reference.repo}`,
  );
  const tree = await fetchJson<GitHubTreeResponse>(
    `https://api.github.com/repos/${reference.owner}/${reference.repo}/git/trees/${repo.default_branch}?recursive=1`,
  );

  const fileNodes = tree.tree
    .filter((node) => node.type === "blob")
    .filter((node) => !node.path.includes("node_modules/"))
    .filter((node) => !node.path.includes("dist/"))
    .filter((node) => !node.path.includes("build/"))
    .filter((node) => !node.path.includes(".next/"));

  /** Paths that look like source (not only root configs), ranked before alphabetical tie-break. */
  function sourcePriority(path: string): number {
    const lower = path.toLowerCase();
    if (lower.includes("/src/") || lower.startsWith("src/")) return 0;
    if (lower.includes("/app/") || lower.includes("/pages/")) return 1;
    if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) return 2;
    if (lower.endsWith(".ts") || lower.endsWith(".js")) return 3;
    return 4;
  }

  const candidates = fileNodes
    .map((node) => ({ node, language: getLanguageForPath(node.path) }))
    .filter(
      (entry): entry is { node: GitHubTreeNode; language: SupportedLanguage } =>
        entry.language !== null && selectedLanguages.includes(entry.language),
    )
    .sort((a, b) => {
      const pa = sourcePriority(a.node.path);
      const pb = sourcePriority(b.node.path);
      if (pa !== pb) return pa - pb;
      return a.node.path.localeCompare(b.node.path);
    });

  const maxFiles = 48;
  const files: SourceFile[] = [];

  for (const { node, language } of candidates.slice(0, maxFiles)) {
    const blob = await fetchJson<GitHubBlobResponse>(node.url);
    const content = decodeContent(blob);

    if (!content.trim()) {
      continue;
    }

    files.push({
      path: node.path,
      content,
      language,
    });
  }

  if (files.length === 0) {
    return null;
  }

  return {
    id: repo.full_name.toLowerCase().replace(/[^\w-]+/g, "-"),
    name: repo.full_name,
    source: rawUrl,
    files,
  };
}
