import { minimatch } from "minimatch";
import type { PullRequestFile, RiskRule, RiskSignal } from "../types.js";
import { defaultRiskRules } from "./defaults.js";

const pointsBySeverity: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 2,
  low: 1,
  info: 0
};

export function classifyFiles(
  files: PullRequestFile[],
  rules: RiskRule[] = defaultRiskRules
): RiskSignal[] {
  const signals: RiskSignal[] = [];

  for (const rule of rules) {
    const evidence = files
      .filter((file) =>
        rule.patterns.some((pattern) =>
          minimatch(file.filename, pattern, { dot: true, matchBase: true })
        )
      )
      .map((file) => file.filename);

    if (evidence.length > 0) {
      signals.push({
        category: rule.category,
        severity: rule.severity,
        points: pointsBySeverity[rule.severity],
        evidence,
        message: `${rule.category} files changed`
      });
    }
  }

  return signals;
}
