import type { RiskAssessment, RiskSignal } from "../types.js";

export const reportMarker = "<!-- mergerisk-report -->";

/**
 * Wrap an untrusted string in backticks, escaping any characters that could
 * break the code span or surrounding markdown structure.
 *
 * - Backticks inside the string are neutralized with zero-width spaces so they
 *   cannot close the outer code span.
 * - Pipe characters are replaced with spaces to prevent table-cell breakout.
 * - Newlines are replaced with spaces to keep the rendered text on one line.
 */
function code(s: string): string {
  return `\`${s.replace(/`/g, "\u200B`\u200B").replace(/\|/g, " ").replace(/\r?\n/g, " ")}\``;
}

function bulletList(items: string[]): string {
  if (items.length === 0) return "- No specific files identified.";
  return items.map((item) => `- ${code(item)}`).join("\n");
}

function signalRow(signal: RiskSignal): string {
  const evidence = signal.evidence.map((item) => code(item)).join(", ");
  return `| ${signal.category} | ${signal.severity} | ${evidence} |`;
}

function checklistFor(assessment: RiskAssessment): string[] {
  const items = new Set<string>();

  for (const signal of assessment.signals) {
    if (signal.category === "database")
      items.add("Confirm schema changes are backward-compatible.");
    if (signal.category === "auth")
      items.add("Confirm authentication and authorization behavior.");
    if (signal.category === "payments")
      items.add("Confirm payment, refund, and subscription edge cases.");
    if (signal.category === "ci_cd")
      items.add("Confirm workflow and deployment behavior.");
    if (signal.category === "dependencies")
      items.add("Review dependency changes for security and licensing impact.");
    if (signal.category === "missing_tests")
      items.add("Add tests or identify existing validation evidence.");
  }

  if (items.size === 0) {
    items.add("Review the changed files and confirm expected behavior.");
  }

  return Array.from(items);
}

export function renderReport(
  assessment: RiskAssessment,
  synthesizedSummary = "",
): string {
  const checklist = checklistFor(assessment)
    .map((item) => `- ${item}`)
    .join("\n");
  const summary = synthesizedSummary.trim()
    ? `\n### Summary\n${synthesizedSummary.trim()}\n`
    : "";

  return `${reportMarker}
## MergeRisk Report

**Overall risk:** ${assessment.level}  
**Score:** ${assessment.score}  
**Merge guidance:** ${assessment.guidance}
${summary}
### Why This PR Is Risky
${assessment.signals.map((signal) => `- ${signal.message}.`).join("\n")}

### Reviewer Focus
${bulletList(assessment.reviewerFocus)}

### Risk Signals
| Signal | Severity | Evidence |
| --- | --- | --- |
${assessment.signals.map(signalRow).join("\n")}

### Suggested Checklist
${checklist}

_MergeRisk is advisory. It does not replace human review, tests, or security scanning._
`;
}
