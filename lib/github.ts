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

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "code-similar-mvp",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed (${response.status}) for ${url}`);
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

  const files: SourceFile[] = [];

  for (const node of fileNodes.slice(0, 24)) {
    const language = getLanguageForPath(node.path);
    if (!language || !selectedLanguages.includes(language)) {
      continue;
    }

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
