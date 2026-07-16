import { describe, expect, it } from "vitest";
import { assessRisk } from "../src/risk/score.js";
import type { PullRequestFile, RiskRule } from "../src/types.js";

function file(filename: string, additions = 10, deletions = 2, status = "modified"): PullRequestFile {
  return {
    filename,
    status,
    additions,
    deletions,
    changes: additions + deletions,
    patch: "@@ -1 +1 @@"
  };
}

describe("assessRisk", () => {
  it("marks a normal source file with a matching test file as low risk with testEvidenceFound true", () => {
    const assessment = assessRisk([
      file("src/ui/button.tsx"),
      file("src/ui/button.test.tsx")
    ]);

    expect(assessment.level).toBe("low");
    expect(assessment.score).toBe(0);
    expect(assessment.testEvidenceFound).toBe(true);
    expect(assessment.guidance).toBe("No unusual merge risk detected.");
  });

  it("does not require test changes for modified auth and database files under the default policy", () => {
    const assessment = assessRisk([
      file("src/auth/session.ts"),
      file("migrations/20260629_add_roles.sql")
    ]);

    expect(assessment.level).toBe("high");
    expect(assessment.score).toBe(8);
    expect(assessment.score).toBeLessThan(12);
    expect(assessment.signals.map((s) => s.category)).not.toContain("missing_tests");
    expect(assessment.testReview.decision).toBe("not_required");
  });

  it("adds broad_change signal when more than 20 files are changed", () => {
    const files = Array.from({ length: 25 }, (_, i) => file(`src/file-${i}.ts`, 1, 1));
    const assessment = assessRisk(files);

    const broadChange = assessment.signals.find((s) => s.category === "broad_change");
    expect(broadChange).toBeDefined();
    expect(broadChange!.points).toBe(3);
    expect(broadChange!.severity).toBe("medium");
    expect(broadChange!.evidence).toContain("25 files changed");
    expect(assessment.score).toBeGreaterThanOrEqual(3);
  });

  it("adds large_diff signal when additions plus deletions exceed 500", () => {
    const assessment = assessRisk([file("src/huge.ts", 400, 200)]);

    const largeDiff = assessment.signals.find((s) => s.category === "large_diff");
    expect(largeDiff).toBeDefined();
    expect(largeDiff!.points).toBe(3);
    expect(largeDiff!.severity).toBe("medium");
  });

  it("normalizes dependency lockfile risk to 3 total points", () => {
    const assessment = assessRisk([file("package-lock.json")]);

    const depSignal = assessment.signals.find((s) => s.category === "dependencies");
    expect(depSignal).toBeDefined();
    expect(depSignal!.points).toBe(3);
    expect(assessment.score).toBe(3);
  });

  it("normalizes CI/CD workflow risk to 3 total points", () => {
    const assessment = assessRisk([file(".github/workflows/deploy.yml")]);

    const ciCdSignal = assessment.signals.find((s) => s.category === "ci_cd");
    expect(ciCdSignal).toBeDefined();
    expect(ciCdSignal!.points).toBe(3);
    expect(assessment.score).toBe(3);
  });

  it("scores critical when combination reaches 12 or more points", () => {
    // auth (4) + database (4) + ci_cd (3 normalized) + dependencies (3 normalized)
    // + broad_change (3) = 17
    const files = Array.from({ length: 25 }, (_, i) => {
      if (i < 10) return file(`src/auth/file-${i}.ts`, 30, 30);
      if (i < 20) return file(`src/api/route-${i}.ts`, 30, 30);
      return file(`src/other/file-${i}.ts`, 30, 30);
    });
    files.push(file("migrations/20260629_add_table.sql"));
    files.push(file(".github/workflows/ci.yml"));
    files.push(file("package-lock.json"));

    const assessment = assessRisk(files);
    expect(assessment.level).toBe("critical");
    expect(assessment.score).toBeGreaterThanOrEqual(12);
  });

  it("includes concrete filenames in reviewerFocus and excludes aggregate text", () => {
    const files = [
      file("src/auth/session.ts", 30, 30),
      file("migrations/20260629_add_roles.sql", 30, 30)
    ];
    // Add 25 files to trigger broad_change (which has aggregate evidence)
    for (let i = 0; i < 23; i++) {
      files.push(file(`src/other/file-${i}.ts`, 1, 1));
    }

    const assessment = assessRisk(files);

    expect(assessment.reviewerFocus).toContain("src/auth/session.ts");
    expect(assessment.reviewerFocus).toContain("migrations/20260629_add_roles.sql");
    // Should not include aggregate evidence strings
    expect(assessment.reviewerFocus).not.toContain("25 files changed");
    expect(assessment.reviewerFocus.length).toBeLessThanOrEqual(10);
  });

  it("uses custom rules passed into assessRisk", () => {
    const customRules: RiskRule[] = [
      {
        category: "custom_cat",
        severity: "high",
        patterns: ["**/custom/**"]
      }
    ];

    const assessment = assessRisk([file("src/custom/something.ts")], customRules);

    const customSignal = assessment.signals.find((s) => s.category === "custom_cat");
    expect(customSignal).toBeDefined();
    expect(customSignal!.points).toBe(4);
    expect(customSignal!.evidence).toContain("src/custom/something.ts");
  });

  it("records missing test evidence without penalizing a modified existing source file", () => {
    const assessment = assessRisk([file("src/app.ts")]);

    expect(assessment.testEvidenceFound).toBe(false);
    expect(assessment.signals.map((s) => s.category)).not.toContain("missing_tests");
  });

  it("requires test evidence for an added source file", () => {
    const assessment = assessRisk([file("src/api/new-route.ts", 10, 0, "added")]);

    expect(assessment.testReview.decision).toBe("required");
    expect(assessment.testReview.affectedFiles).toEqual(["src/api/new-route.ts"]);
    expect(assessment.signals.map((s) => s.category)).toContain("missing_tests");
  });

  it("accepts a changed test file as evidence when a new source file requires tests", () => {
    const assessment = assessRisk([
      file("src/api/new-route.ts", 10, 0, "added"),
      file("tests/new-route.test.ts", 10, 0, "added")
    ]);

    expect(assessment.testReview.decision).toBe("required");
    expect(assessment.testEvidenceFound).toBe(true);
    expect(assessment.signals.map((s) => s.category)).not.toContain("missing_tests");
  });

  it("keeps a non-high-confidence agent requirement advisory", () => {
    const assessment = assessRisk(
      [file("src/api/existing-route.ts")],
      undefined,
      {
        mode: "agent",
        decision: "required",
        confidence: "medium",
        reason: "The patch may alter an endpoint contract.",
        affectedFiles: ["src/api/existing-route.ts"],
        testEvidenceFound: false,
      },
    );

    expect(assessment.signals.map((s) => s.category)).not.toContain("missing_tests");
    expect(assessment.testReview.decision).toBe("required");
  });

  it("returns aggregate file and diff statistics", () => {
    const assessment = assessRisk([
      file("src/a.ts", 100, 20),
      file("src/b.ts", 30, 10)
    ]);

    expect(assessment.filesChanged).toBe(2);
    expect(assessment.totalAdditions).toBe(130);
    expect(assessment.totalDeletions).toBe(30);
  });
});
