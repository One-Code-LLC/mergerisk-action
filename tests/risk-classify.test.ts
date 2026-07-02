import { describe, expect, it } from "vitest";
import { classifyFiles } from "../src/risk/classify.js";
import type { PullRequestFile } from "../src/types.js";

function file(filename: string): PullRequestFile {
  return {
    filename,
    status: "modified",
    additions: 10,
    deletions: 2,
    changes: 12,
    patch: "@@ -1 +1 @@"
  };
}

describe("classifyFiles", () => {
  it("detects auth, database, ci, dependency, and test signals", () => {
    const result = classifyFiles([
      file("src/auth/session.ts"),
      file("migrations/20260629_add_roles.sql"),
      file(".github/workflows/deploy.yml"),
      file("package-lock.json"),
      file("tests/session.test.ts")
    ]);

    expect(result.map((signal) => signal.category)).toEqual(
      expect.arrayContaining(["auth", "database", "ci_cd", "dependencies", "tests"])
    );
  });

  it("keeps evidence filenames on signals", () => {
    const result = classifyFiles([file("src/billing/stripe.ts")]);
    expect(result[0]).toMatchObject({
      category: "payments",
      severity: "high",
      evidence: ["src/billing/stripe.ts"]
    });
  });

  it("detects auth file and returns high severity", () => {
    const result = classifyFiles([file("src/auth/session.ts")]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: "auth",
      severity: "high",
      evidence: ["src/auth/session.ts"]
    });
  });

  it("detects billing or stripe file as payments signal", () => {
    const result = classifyFiles([file("src/payments/stripe.ts")]);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("payments");
  });

  it("detects migration or prisma schema as database signal", () => {
    const result = classifyFiles([file("prisma/schema.prisma")]);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("database");
  });

  it("detects .github/workflows/deploy.yml as ci_cd signal", () => {
    const result = classifyFiles([file(".github/workflows/deploy.yml")]);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("ci_cd");
  });

  it("detects package-lock.json as dependencies signal", () => {
    const result = classifyFiles([file("package-lock.json")]);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("dependencies");
  });

  it("detects .env.example or config file as config signal", () => {
    const result = classifyFiles([file(".env.example")]);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("config");
  });

  it("detects security/permissions.ts as security signal", () => {
    const result = classifyFiles([file("src/security/permissions.ts")]);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("security");
  });

  it("detects tests signal with info severity and 0 points", () => {
    const result = classifyFiles([file("tests/session.test.ts")]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: "tests",
      severity: "info",
      points: 0
    });
  });

  it("preserves evidence filenames exactly", () => {
    const result = classifyFiles([
      file("src/auth/session.ts"),
      file("src/auth/middleware.ts")
    ]);
    const authSignal = result.find((s) => s.category === "auth");
    expect(authSignal?.evidence).toEqual(["src/auth/session.ts", "src/auth/middleware.ts"]);
  });

  it("preserves multiple signals when a file matches multiple categories", () => {
    const result = classifyFiles([file("src/config/auth.ts")]);
    const categories = result.map((s) => s.category);
    expect(categories).toContain("auth");
    expect(categories).toContain("config");
  });
});
