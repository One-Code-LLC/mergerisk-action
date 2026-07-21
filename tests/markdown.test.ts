import { describe, expect, it } from "vitest";
import { renderReport, reportMarker } from "../src/report/markdown.js";
import type { RiskAssessment } from "../src/types.js";

function makeAssessment(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    level: "high",
    score: 8,
    guidance: "Senior review recommended before merge.",
    signals: [
      {
        category: "auth",
        severity: "high",
        points: 4,
        evidence: ["src/auth/session.ts"],
        message: "auth files changed",
      },
      {
        category: "missing_tests",
        severity: "medium",
        points: 2,
        evidence: ["No changed files matched default test patterns"],
        message: "No test evidence found in this pull request",
      },
    ],
    reviewerFocus: ["src/auth/session.ts"],
    testEvidenceFound: false,
    testReview: {
      mode: "policy",
      decision: "required",
      confidence: "high",
      reason: "Test fixture",
      affectedFiles: ["src/auth/session.ts"],
      testEvidenceFound: false,
    },
    filesChanged: 2,
    totalAdditions: 40,
    totalDeletions: 12,
    ...overrides,
  };
}

describe("renderReport", () => {
  it("renders a sticky report marker and risk summary", () => {
    const markdown = renderReport(makeAssessment());

    expect(markdown).toContain("<!-- mergerisk-report -->");
    expect(markdown).toContain("## MergeRisk Report");
    expect(markdown).toContain("**Overall risk:** high");
    expect(markdown).toContain("src/auth/session.ts");
  });

  it("contains overall risk, score, and merge guidance", () => {
    const markdown = renderReport(makeAssessment());

    expect(markdown).toContain("**Overall risk:** high");
    expect(markdown).toContain("**Score:** 8");
    expect(markdown).toContain(
      "**Merge guidance:** Senior review recommended before merge.",
    );
  });

  it("renders the structured test-review decision", () => {
    const markdown = renderReport(makeAssessment());

    expect(markdown).toContain("### Test Review");
    expect(markdown).toContain("**Mode:** policy");
    expect(markdown).toContain("**Decision:** Test changes required");
    expect(markdown).toContain("**Reason:** `Test fixture`");
    expect(markdown).toContain("`src/auth/session.ts`");
  });

  it("includes a Risk Signals table", () => {
    const markdown = renderReport(makeAssessment());

    expect(markdown).toContain("### Risk Signals");
    expect(markdown).toContain("| Signal | Severity | Evidence |");
    expect(markdown).toContain("| --- | --- | --- |");
  });

  it("renders reviewer focus filenames inside backticks", () => {
    const assessment = makeAssessment({
      reviewerFocus: ["src/auth/session.ts", "src/api/routes.ts"],
    });
    const markdown = renderReport(assessment);

    expect(markdown).toContain("`src/auth/session.ts`");
    expect(markdown).toContain("`src/api/routes.ts`");
  });

  it("does not create a Summary section when synthesized summary is empty", () => {
    const markdown = renderReport(makeAssessment(), "");

    expect(markdown).not.toContain("### Summary");
  });

  it("creates a Summary section when synthesized summary is non-empty", () => {
    const markdown = renderReport(
      makeAssessment(),
      "This is a synthesized summary.",
    );

    expect(markdown).toContain("### Summary");
    expect(markdown).toContain("This is a synthesized summary.");
  });

  it("includes the advisory footer", () => {
    const markdown = renderReport(makeAssessment());

    expect(markdown).toContain("_MergeRisk is advisory");
    expect(markdown).toContain("does not replace human review");
  });

  it("escapes pipe characters in evidence to prevent table breakage", () => {
    const assessment = makeAssessment({
      signals: [
        {
          category: "test_category",
          severity: "medium",
          points: 2,
          evidence: ["file|with|pipe.ts", "another|test.ts"],
          message: "test evidence with pipe characters",
        },
      ],
    });
    const markdown = renderReport(assessment);

    // Pipes in evidence should be replaced with spaces
    expect(markdown).not.toContain("`file|with|pipe.ts`");
    expect(markdown).toContain("`file with pipe.ts`");
    expect(markdown).toContain("`another test.ts`");
  });

  it("escapes backticks in filenames to prevent code span breakout", () => {
    const assessment = makeAssessment({
      signals: [
        {
          category: "test_category",
          severity: "medium",
          points: 2,
          evidence: ["a`b"],
          message: "evidence with backtick",
        },
      ],
      reviewerFocus: ["a`b"],
    });
    const markdown = renderReport(assessment);

    // Backticks inside the evidence should not close the outer code span.
    // Backticks are replaced with spaces to prevent code-span breakout.
    expect(markdown).not.toContain("``"); // no empty code span
    expect(markdown).not.toContain("`a`b`"); // backtick not closing
    // Evidence table cell should contain the escaped filename
    expect(markdown).toContain("`a");
    expect(markdown).toContain("b`");
    // Reviewer focus should also be escaped
    expect(markdown).toContain("- `a");
    expect(markdown).toContain("b`");
  });

  it("escapes newlines in filenames to prevent multiline injection", () => {
    const assessment = makeAssessment({
      signals: [
        {
          category: "test_category",
          severity: "medium",
          points: 2,
          evidence: ["file\nwith\nnewlines.ts"],
          message: "evidence with newlines",
        },
      ],
      reviewerFocus: ["file\nwith\nnewlines.ts"],
    });
    const markdown = renderReport(assessment);

    // Newlines should be replaced with spaces
    expect(markdown).toContain("`file with newlines.ts`");
    expect(markdown).not.toContain("file\nwith\nnewlines.ts");
  });

  it("escapes combined malicious content in filenames", () => {
    const assessment = makeAssessment({
      signals: [
        {
          category: "test_category",
          severity: "medium",
          points: 2,
          evidence: ["a`b|c\nd"],
          message: "evidence with mixed injection",
        },
      ],
      reviewerFocus: ["a`b|c\nd"],
    });
    const markdown = renderReport(assessment);

    // Backticks are neutralized, pipes are spaces, newlines are spaces
    expect(markdown).toContain("a");
    expect(markdown).toContain("b");
    expect(markdown).toContain("c");
    expect(markdown).toContain("d");
    // No raw pipe in backtick content (pipes become spaces)
    expect(markdown).not.toContain("`a`b");
    expect(markdown).not.toContain("c|d");
  });

  it("renders all signal categories in Why This PR Is Risky section", () => {
    const markdown = renderReport(makeAssessment());

    expect(markdown).toContain("### Why This PR Is Risky");
    expect(markdown).toContain("- auth files changed.");
    expect(markdown).toContain(
      "- No test evidence found in this pull request.",
    );
  });

  it("renders low risk assessment with correct guidance", () => {
    const assessment = makeAssessment({
      level: "low",
      score: 2,
      guidance: "No unusual merge risk detected.",
      signals: [],
      reviewerFocus: [],
      testEvidenceFound: true,
    });
    const markdown = renderReport(assessment);

    expect(markdown).toContain("**Overall risk:** low");
    expect(markdown).toContain("**Score:** 2");
    expect(markdown).toContain("**Merge guidance:** No unusual merge risk detected.");
  });

  it("uses a compact layout when no risk findings exist", () => {
    const assessment = makeAssessment({
      level: "low",
      score: 0,
      guidance: "No unusual merge risk detected.",
      signals: [],
      reviewerFocus: [],
      testEvidenceFound: true,
      testReview: {
        mode: "agent",
        decision: "not_required",
        confidence: "high",
        reason: "Changes are limited to documentation.",
        affectedFiles: ["docs/guide.md"],
        testEvidenceFound: false,
      },
    });

    const markdown = renderReport(
      assessment,
      "- No elevated merge risk was detected for this documentation-only change.",
    );

    expect(markdown).toContain("### Summary");
    expect(markdown).toContain("### Test Review");
    expect(markdown).toContain("### Suggested Checklist");
    expect(markdown).not.toContain("### Why This PR Is Risky");
    expect(markdown).not.toContain("### Reviewer Focus");
    expect(markdown).not.toContain("### Risk Signals");
    expect(markdown).not.toContain("No specific files identified.");
    expect(markdown).toContain(
      "- Review the changed files for accuracy and intended scope.",
    );
  });
});
