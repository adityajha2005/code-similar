export type SupportedLanguage = "JavaScript" | "TypeScript" | "Python";

export type ScanMethod = "hybrid" | "token" | "ast" | "embedding";

export type SourceFile = {
  path: string;
  content: string;
  language: SupportedLanguage;
};

export type RepositoryInput = {
  id: string;
  name: string;
  source: string;
  files: SourceFile[];
};

export type ScanRequest = {
  repoUrls: string[];
  languages: SupportedLanguage[];
  method: ScanMethod;
  includeSeededRepos: boolean;
};

export type RepoRecord = {
  id: string;
  name: string;
  source: string;
  fileCount: number;
  dominantLanguage: SupportedLanguage;
  lastScan: string;
  status: string;
};

export type MatchingBlock = {
  score: number;
  left: {
    startLine: number;
    endLine: number;
  };
  right: {
    startLine: number;
    endLine: number;
  };
};

export type FileAnalysis = {
  id: string;
  repoId: string;
  repoName: string;
  path: string;
  language: SupportedLanguage;
  content: string;
  lineCount: number;
  matchingBlocks: Array<{
    pairId: string;
    startLine: number;
    endLine: number;
  }>;
};

export type SimilarityPair = {
  id: string;
  leftFileId: string;
  rightFileId: string;
  title: string;
  score: number;
  method: ScanMethod;
  reason: string;
  flagged: boolean;
  matchingBlocks: MatchingBlock[];
};

export type ClusterSummary = {
  id: string;
  label: string;
  averageScore: number;
  files: Array<{
    id: string;
    repoName: string;
    path: string;
  }>;
};

export type FlagSummary = {
  id: string;
  title: string;
  summary: string;
};

export type RepoSimilarity = {
  leftRepoId: string;
  rightRepoId: string;
  label: string;
  score: number;
  reason: string;
};

export type AnalysisResponse = {
  generatedAt: string;
  repositories: RepositoryInput[];
  files: FileAnalysis[];
  pairs: SimilarityPair[];
  clusters: ClusterSummary[];
  flags: FlagSummary[];
  repoPairs: RepoSimilarity[];
};
