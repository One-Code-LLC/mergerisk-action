import type { PullRequestFile, RiskAssessment, RiskLevel, RiskRule, RiskSignal, TestReview } from "../types.js";
import { classifyFiles } from "./classify.js";
import { reviewTestsWithPolicy } from "./test-review.js";

const riskRank: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

function levelFromScore(score: number): RiskLevel {
  if (score >= 12) return "critical";
  if (score >= 7) return "high";
  if (score >= 3) return "medium";
  return "low";
}

function guidanceFor(level: RiskLevel): string {
  if (level === "critical") return "Block merge until a senior reviewer verifies the risk areas.";
  if (level === "high") return "Senior review recommended before merge.";
  if (level === "medium") return "Review the highlighted areas before merge.";
  return "No unusual merge risk detected.";
}

function broadChangeSignals(files: PullRequestFile[]): RiskSignal[] {
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
  const signals: RiskSignal[] = [];

  if (files.length > 20) {
    signals.push({
      category: "broad_change",
      severity: "medium",
      points: 3,
      evidence: [`${files.length} files changed`],
      message: "Large number of files changed"
    });
  }

  if (totalAdditions + totalDeletions > 500) {
    signals.push({
      category: "large_diff",
      severity: "medium",
      points: 3,
      evidence: [`${totalAdditions} additions, ${totalDeletions} deletions`],
      message: "Large diff size"
    });
  }

  return signals;
}

function missingTestsSignal(testReview: TestReview): RiskSignal[] {
  // Lower-confidence agent conclusions remain visible in the report but advisory.
  if (
    testReview.decision !== "required"
    || testReview.confidence !== "high"
    || testReview.testEvidenceFound
  ) return [];

  return [
    {
      category: "missing_tests",
      severity: "medium",
      points: 2,
      evidence: testReview.affectedFiles.length > 0 ? testReview.affectedFiles : [testReview.reason],
      message: "Test changes are required but no test evidence was found"
    }
  ];
}

function normalizeSignal(signals: RiskSignal[], category: string, targetPoints: number): void {
  const signal = signals.find((s) => s.category === category);
  if (signal && signal.points < targetPoints) {
    signal.points = targetPoints;
  }
}

export function assessRisk(
  files: PullRequestFile[],
  rules?: RiskRule[],
  testReview: TestReview = reviewTestsWithPolicy(files)
): RiskAssessment {
  const classifiedSignals = classifyFiles(files, rules);
  const signals: RiskSignal[] = [...classifiedSignals];

  // Normalize dependency and CI/CD signals to their intended total points
  normalizeSignal(signals, "dependencies", 3);
  normalizeSignal(signals, "ci_cd", 3);

  // Add broad-change and large-diff signals
  signals.push(...broadChangeSignals(files));

  // Add a missing-tests signal only when the selected review path requires tests.
  signals.push(...missingTestsSignal(testReview));

  const score = signals.reduce((sum, s) => sum + s.points, 0);
  const level = levelFromScore(score);

  const reviewerFocus = signals
    .filter((s) => riskRank[s.severity === "info" ? "low" : s.severity] >= riskRank.medium)
    .flatMap((s) => s.evidence)
    .filter((item) => !item.includes("files changed") && !item.includes("additions") && !item.includes("deletions"))
    .slice(0, 10);

  return {
    level,
    score,
    guidance: guidanceFor(level),
    signals,
    reviewerFocus,
    testEvidenceFound: testReview.testEvidenceFound,
    testReview,
    filesChanged: files.length,
    totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
    totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0)
  };
}
