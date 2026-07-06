export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Provider = "none" | "openai" | "anthropic";

export type CommentMode = "update" | "new";

export interface ActionConfig {
  githubToken: string;
  provider: Provider;
  model: string;
  apiKey: string;
  failOnRisk: RiskLevel | "none";
  maxPatchLines: number;
  commentMode: CommentMode;
  riskProfilePath: string;
  aiTimeoutMs: number;
}

export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string;
}

export interface RiskRule {
  category: string;
  severity: RiskLevel | "info";
  patterns: string[];
}

export interface RiskSignal {
  category: string;
  severity: RiskLevel | "info";
  points: number;
  evidence: string[];
  message: string;
}

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  guidance: string;
  signals: RiskSignal[];
  reviewerFocus: string[];
  testEvidenceFound: boolean;
  filesChanged: number;
  totalAdditions: number;
  totalDeletions: number;
}
