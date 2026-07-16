export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Provider = "none" | "openai" | "openai-compatible" | "anthropic";

export type CommentMode = "update" | "new";

export type TestReviewMode = "auto" | "policy" | "agent";

export type TestReviewDecision = "required" | "not_required" | "inconclusive";

export type TestReviewConfidence = "high" | "medium" | "low";

export interface ActionConfig {
  githubToken: string;
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl: string;
  failOnRisk: RiskLevel | "none";
  maxPatchLines: number;
  commentMode: CommentMode;
  riskProfilePath: string;
  testReviewMode: TestReviewMode;
  testPolicyPath: string;
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

export interface TestPolicy {
  testPatterns: string[];
  sourcePatterns: string[];
  exemptPatterns: string[];
  requireTestsFor: {
    addedSourceFiles: boolean;
    modifiedSourceFiles: boolean;
  };
}

export interface TestReview {
  mode: "policy" | "agent";
  decision: TestReviewDecision;
  confidence: TestReviewConfidence;
  reason: string;
  affectedFiles: string[];
  testEvidenceFound: boolean;
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
  testReview: TestReview;
  filesChanged: number;
  totalAdditions: number;
  totalDeletions: number;
}
