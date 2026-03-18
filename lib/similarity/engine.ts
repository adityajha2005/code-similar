import type {
  AnalysisResponse,
  ClusterSummary,
  FileAnalysis,
  MatchingBlock,
  RepoSimilarity,
  RepositoryInput,
  ScanMethod,
  SimilarityPair,
  SourceFile,
  SupportedLanguage,
} from "@/lib/types";

type IndexedFile = {
  id: string;
  repoId: string;
  repoName: string;
  path: string;
  language: SupportedLanguage;
  content: string;
  lineCount: number;
  normalized: string;
  tokens: string[];
  lineTokens: string[][];
  structureVector: Map<string, number>;
  semanticVector: Map<string, number>;
};

const languageExtensions: Record<SupportedLanguage, string[]> = {
  JavaScript: [".js", ".jsx", ".mjs", ".cjs"],
  TypeScript: [".ts", ".tsx"],
  Python: [".py"],
};

const jsKeywords = new Set([
  "function",
  "return",
  "const",
  "let",
  "var",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "class",
  "extends",
  "async",
  "await",
  "try",
  "catch",
  "throw",
  "new",
  "import",
  "export",
]);

const pythonKeywords = new Set([
  "def",
  "return",
  "if",
  "elif",
  "else",
  "for",
  "while",
  "try",
  "except",
  "class",
  "import",
  "from",
  "async",
  "await",
  "raise",
  "with",
  "yield",
]);

function stripComments(content: string, language: SupportedLanguage) {
  if (language === "Python") {
    return content.replace(/#.*$/gm, "");
  }

  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function normalizeIdentifiers(content: string, language: SupportedLanguage) {
  const keywordSet = language === "Python" ? pythonKeywords : jsKeywords;
  const seen = new Map<string, string>();
  let index = 0;

  return content.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (token) => {
    if (keywordSet.has(token)) {
      return token;
    }

    if (!seen.has(token)) {
      index += 1;
      seen.set(token, `id${index}`);
    }

    return seen.get(token) ?? token;
  });
}

function normalizeContent(file: SourceFile) {
  const withoutComments = stripComments(file.content, file.language);
  const compact = withoutComments.replace(/\r/g, "");
  return normalizeIdentifiers(compact, file.language);
}

function tokenize(input: string) {
  return input.match(/[A-Za-z_][A-Za-z0-9_]*|\d+|==|!=|<=|>=|=>|[-+*/%=<>()[\]{}:.,]/g) ?? [];
}

function vectorize(tokens: string[]) {
  const vector = new Map<string, number>();
  for (const token of tokens) {
    vector.set(token, (vector.get(token) ?? 0) + 1);
  }
  return vector;
}

function buildStructureVector(tokens: string[], language: SupportedLanguage) {
  const keywordSet = language === "Python" ? pythonKeywords : jsKeywords;
  const structureTokens = tokens
    .filter((token) => keywordSet.has(token) || ["{", "}", "(", ")", "[", "]"].includes(token))
    .map((token) => `shape:${token}`);

  return vectorize(structureTokens);
}

function buildSemanticVector(tokens: string[]) {
  const semanticTokens = tokens
    .filter((token) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(token))
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 2);

  return vectorize(semanticTokens);
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>) {
  const allKeys = new Set([...left.keys(), ...right.keys()]);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (const key of allKeys) {
    const leftValue = left.get(key) ?? 0;
    const rightValue = right.get(key) ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function buildShingles(tokens: string[], size = 5) {
  const shingles = new Set<string>();
  if (tokens.length < size) {
    shingles.add(tokens.join(" "));
    return shingles;
  }

  for (let index = 0; index <= tokens.length - size; index += 1) {
    shingles.add(tokens.slice(index, index + size).join(" "));
  }

  return shingles;
}

function jaccardSimilarity(left: string[], right: string[]) {
  const leftShingles = buildShingles(left);
  const rightShingles = buildShingles(right);
  const union = new Set([...leftShingles, ...rightShingles]);
  const intersection = [...leftShingles].filter((token) => rightShingles.has(token));

  if (union.size === 0) {
    return 0;
  }

  return intersection.length / union.size;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function detectMatchingBlocks(left: IndexedFile, right: IndexedFile): MatchingBlock[] {
  const blocks: MatchingBlock[] = [];
  const window = 3;

  for (let leftIndex = 0; leftIndex <= left.lineTokens.length - window; leftIndex += 1) {
    const leftWindow = left.lineTokens.slice(leftIndex, leftIndex + window).flat();
    if (leftWindow.length === 0) {
      continue;
    }

    let bestMatch: MatchingBlock | null = null;

    for (let rightIndex = 0; rightIndex <= right.lineTokens.length - window; rightIndex += 1) {
      const rightWindow = right.lineTokens.slice(rightIndex, rightIndex + window).flat();
      if (rightWindow.length === 0) {
        continue;
      }

      const score = jaccardSimilarity(leftWindow, rightWindow);
      if (score < 0.62) {
        continue;
      }

      const candidate: MatchingBlock = {
        score,
        left: {
          startLine: leftIndex + 1,
          endLine: leftIndex + window,
        },
        right: {
          startLine: rightIndex + 1,
          endLine: rightIndex + window,
        },
      };

      if (!bestMatch || candidate.score > bestMatch.score) {
        bestMatch = candidate;
      }
    }

    if (bestMatch) {
      blocks.push(bestMatch);
    }
  }

  return blocks
    .sort((first, second) => second.score - first.score)
    .filter((block, index, allBlocks) => {
      return !allBlocks
        .slice(0, index)
        .some(
          (entry) =>
            Math.abs(entry.left.startLine - block.left.startLine) < window &&
            Math.abs(entry.right.startLine - block.right.startLine) < window,
        );
    })
    .slice(0, 4);
}

function scorePair(left: IndexedFile, right: IndexedFile, method: ScanMethod) {
  const tokenScore = jaccardSimilarity(left.tokens, right.tokens);
  const structureScore = cosineSimilarity(left.structureVector, right.structureVector);
  const semanticScore = cosineSimilarity(left.semanticVector, right.semanticVector);

  if (method === "token") {
    return tokenScore;
  }

  if (method === "ast") {
    return structureScore;
  }

  if (method === "embedding") {
    return semanticScore;
  }

  return clamp(tokenScore * 0.45 + structureScore * 0.35 + semanticScore * 0.2);
}

function buildReason(
  method: ScanMethod,
  tokenScore: number,
  structureScore: number,
  semanticScore: number,
) {
  if (method === "token") {
    return `High token overlap (${Math.round(tokenScore * 100)}%) after normalization.`;
  }

  if (method === "ast") {
    return `Matching control-flow and declaration structure (${Math.round(structureScore * 100)}%).`;
  }

  if (method === "embedding") {
    return `Shared identifier intent and behavior profile (${Math.round(semanticScore * 100)}%).`;
  }

  return `Hybrid score with ${Math.round(tokenScore * 100)}% token, ${Math.round(
    structureScore * 100,
  )}% structural, and ${Math.round(semanticScore * 100)}% semantic overlap.`;
}

function flattenRepositories(repositories: RepositoryInput[]) {
  const files: IndexedFile[] = [];

  for (const repository of repositories) {
    for (const file of repository.files) {
      const normalized = normalizeContent(file);
      const tokens = tokenize(normalized);
      const lineTokens = normalized.split("\n").map((line) => tokenize(line));

      files.push({
        id: `${repository.id}:${file.path}`,
        repoId: repository.id,
        repoName: repository.name,
        path: file.path,
        language: file.language,
        content: file.content,
        lineCount: file.content.split("\n").length,
        normalized,
        tokens,
        lineTokens,
        structureVector: buildStructureVector(tokens, file.language),
        semanticVector: buildSemanticVector(tokens),
      });
    }
  }

  return files;
}

function buildClusters(pairs: SimilarityPair[], fileLookup: Map<string, IndexedFile>): ClusterSummary[] {
  const parent = new Map<string, string>();

  function find(id: string): string {
    const current = parent.get(id) ?? id;
    if (current === id) {
      parent.set(id, id);
      return id;
    }

    const root = find(current);
    parent.set(id, root);
    return root;
  }

  function union(left: string, right: string) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent.set(rightRoot, leftRoot);
    }
  }

  for (const pair of pairs.filter((entry) => entry.score >= 0.72)) {
    union(pair.leftFileId, pair.rightFileId);
  }

  const groups = new Map<string, SimilarityPair[]>();
  for (const pair of pairs.filter((entry) => entry.score >= 0.72)) {
    const key = find(pair.leftFileId);
    const list = groups.get(key) ?? [];
    list.push(pair);
    groups.set(key, list);
  }

  return [...groups.entries()].map(([root, clusterPairs], index) => {
    const fileIds = new Set<string>();
    for (const pair of clusterPairs) {
      fileIds.add(pair.leftFileId);
      fileIds.add(pair.rightFileId);
    }

    const files = [...fileIds]
      .map((id) => fileLookup.get(id))
      .filter((file): file is IndexedFile => Boolean(file))
      .map((file) => ({
        id: file.id,
        repoName: file.repoName,
        path: file.path,
      }));

    const averageScore =
      clusterPairs.reduce((total, pair) => total + pair.score, 0) / Math.max(clusterPairs.length, 1);

    return {
      id: `${root}-${index}`,
      label: `Cluster ${index + 1}`,
      averageScore,
      files,
    };
  });
}

function buildRepoSimilarity(
  repositories: RepositoryInput[],
  pairs: SimilarityPair[],
  fileLookup: Map<string, IndexedFile>,
): RepoSimilarity[] {
  const repoPairs = new Map<string, SimilarityPair[]>();

  for (const pair of pairs) {
    const left = fileLookup.get(pair.leftFileId);
    const right = fileLookup.get(pair.rightFileId);
    if (!left || !right || left.repoId === right.repoId) {
      continue;
    }

    const key = [left.repoId, right.repoId].sort().join("::");
    const list = repoPairs.get(key) ?? [];
    list.push(pair);
    repoPairs.set(key, list);
  }

  return [...repoPairs.entries()].map(([key, groupedPairs]) => {
    const [leftRepoId, rightRepoId] = key.split("::");
    const leftRepo = repositories.find((repo) => repo.id === leftRepoId);
    const rightRepo = repositories.find((repo) => repo.id === rightRepoId);
    const strongest = groupedPairs
      .slice()
      .sort((first, second) => second.score - first.score)
      .slice(0, 3);
    const score =
      strongest.reduce((total, pair) => total + pair.score, 0) / Math.max(strongest.length, 1);

    return {
      leftRepoId,
      rightRepoId,
      label: `${leftRepo?.name ?? leftRepoId} ↔ ${rightRepo?.name ?? rightRepoId}`,
      score,
      reason: `${groupedPairs.length} cross-repository file matches identified.`,
    };
  });
}

function summarizeFlags(pairs: SimilarityPair[]) {
  return pairs
    .filter((pair) => pair.flagged)
    .slice(0, 6)
    .map((pair) => ({
      id: pair.id,
      title: pair.title,
      summary: `${Math.round(pair.score * 100)}% similarity with ${pair.matchingBlocks.length} repeated segments.`,
    }));
}

function toFileAnalysis(files: IndexedFile[], pairs: SimilarityPair[]): FileAnalysis[] {
  return files.map((file) => ({
    id: file.id,
    repoId: file.repoId,
    repoName: file.repoName,
    path: file.path,
    language: file.language,
    content: file.content,
    lineCount: file.lineCount,
    matchingBlocks: pairs.flatMap((pair) => {
      if (pair.leftFileId === file.id) {
        return pair.matchingBlocks.map((block) => ({
          pairId: pair.id,
          startLine: block.left.startLine,
          endLine: block.left.endLine,
        }));
      }

      if (pair.rightFileId === file.id) {
        return pair.matchingBlocks.map((block) => ({
          pairId: pair.id,
          startLine: block.right.startLine,
          endLine: block.right.endLine,
        }));
      }

      return [];
    }),
  }));
}

export function analyzeRepositories(
  repositories: RepositoryInput[],
  method: ScanMethod,
): AnalysisResponse {
  const indexedFiles = flattenRepositories(repositories);
  const fileLookup = new Map(indexedFiles.map((file) => [file.id, file]));
  const pairs: SimilarityPair[] = [];

  for (let leftIndex = 0; leftIndex < indexedFiles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < indexedFiles.length; rightIndex += 1) {
      const left = indexedFiles[leftIndex];
      const right = indexedFiles[rightIndex];

      if (left.language !== right.language && !(left.language === "TypeScript" && right.language === "JavaScript") && !(left.language === "JavaScript" && right.language === "TypeScript")) {
        continue;
      }

      const tokenScore = jaccardSimilarity(left.tokens, right.tokens);
      const structureScore = cosineSimilarity(left.structureVector, right.structureVector);
      const semanticScore = cosineSimilarity(left.semanticVector, right.semanticVector);
      const score = scorePair(left, right, method);

      if (score < 0.42) {
        continue;
      }

      const matchingBlocks = detectMatchingBlocks(left, right);
      const pairId = `${left.id}::${right.id}`;

      pairs.push({
        id: pairId,
        leftFileId: left.id,
        rightFileId: right.id,
        title: `${left.repoName}/${left.path} ↔ ${right.repoName}/${right.path}`,
        score,
        method,
        reason: buildReason(method, tokenScore, structureScore, semanticScore),
        flagged: score >= 0.84 || (tokenScore >= 0.8 && structureScore >= 0.78),
        matchingBlocks,
      });
    }
  }

  pairs.sort((first, second) => second.score - first.score);

  return {
    generatedAt: new Date().toISOString(),
    repositories,
    files: toFileAnalysis(indexedFiles, pairs),
    pairs,
    clusters: buildClusters(pairs, fileLookup),
    flags: summarizeFlags(pairs),
    repoPairs: buildRepoSimilarity(repositories, pairs, fileLookup),
  };
}

export function filterRepositoryFiles(
  repositories: RepositoryInput[],
  selectedLanguages: SupportedLanguage[],
) {
  return repositories
    .map((repository) => ({
      ...repository,
      files: repository.files.filter((file) => {
        const extensions = languageExtensions[file.language];
        return (
          selectedLanguages.includes(file.language) &&
          extensions.some((suffix) => file.path.endsWith(suffix))
        );
      }),
    }))
    .filter((repository) => repository.files.length > 0);
}
