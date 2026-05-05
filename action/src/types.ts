export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface FileAnalysis {
  filename: string;
  language: string;
  aiSignals: AiSignal[];
  aiConfidence: number;
  qualityDeductions: QualityDeduction[];
  qualityScore: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface AiSignal {
  type: AiSignalType;
  description: string;
  weight: number;
  matches: number;
}

export type AiSignalType =
  | "generic_naming"
  | "verbose_comments"
  | "boilerplate_patterns"
  | "ai_comment_phrases"
  | "perfect_structure"
  | "repetitive_patterns"
  | "excessive_docstrings"
  | "placeholder_content";

export interface QualityDeduction {
  reason: string;
  points: number;
  category: QualityCategory;
}

export type QualityCategory =
  | "ai_detection"
  | "code_size"
  | "naming"
  | "error_handling"
  | "code_duplication"
  | "test_coverage"
  | "complexity"
  | "documentation";

export interface LlmAnalysis {
  ai_probability: number;
  quality_score: number;
  ai_indicators: string[];
  quality_issues: string[];
  suggestions: string[];
  reasoning: string;
}

export type LlmProvider = "openai" | "anthropic";

export interface AnalysisResult {
  repoOwner: string;
  repoName: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  filesAnalyzed: number;
  totalFilesInPr: number;
  qualityScore: number;
  aiDetected: boolean;
  aiConfidence: number;
  llmAnalysis: LlmAnalysis | null;
  fileAnalyses: FileAnalysis[];
  summary: AnalysisSummary;
  passed: boolean;
  timestamp: string;
}

export interface AnalysisSummary {
  totalLinesAdded: number;
  totalLinesRemoved: number;
  topAiSignals: string[];
  topQualityIssues: string[];
  languagesDetected: string[];
  hasTests: boolean;
  hasDocumentation: boolean;
}

export interface ActionConfig {
  minQualityScore: number;
  aiDetectionThreshold: number;
  failOnLowQuality: boolean;
  commentOnPr: boolean;
  labelPr: boolean;
  aiGeneratedLabel: string;
  lowQualityLabel: string;
  highQualityLabel: string;
  maxFilesAnalyzed: number;
  excludePaths: string[];
  llmProvider: LlmProvider | null;
  llmApiKey: string | null;
  llmModel: string;
  trackHistory: boolean;
  historyBranch: string;
}
