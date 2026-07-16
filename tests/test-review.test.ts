import { describe, expect, it, vi, beforeEach } from "vitest";
import { reviewTestsWithAgent } from "../src/ai/test-review.js";
import { reviewTestsWithPolicy } from "../src/risk/test-review.js";
import type { ActionConfig, PullRequestFile } from "../src/types.js";

function file(filename: string, status = "modified"): PullRequestFile {
  return { filename, status, additions: 10, deletions: 0, changes: 10, patch: "@@ -1 +1 @@\n+new code" };
}

function config(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    githubToken: "ghs_test",
    provider: "openai",
    model: "",
    apiKey: "sk-test-key",
    baseUrl: "",
    failOnRisk: "none",
    maxPatchLines: 1200,
    commentMode: "update",
    riskProfilePath: "",
    testReviewMode: "agent",
    testPolicyPath: "",
    aiTimeoutMs: 30000,
    ...overrides,
  };
}

describe("reviewTestsWithPolicy", () => {
  it("requires tests for added source files but not modified source files by default", () => {
    expect(reviewTestsWithPolicy([file("src/api/existing.ts")]).decision).toBe("not_required");

    const review = reviewTestsWithPolicy([file("src/api/new-route.ts", "added")]);
    expect(review.decision).toBe("required");
    expect(review.affectedFiles).toEqual(["src/api/new-route.ts"]);
  });

  it("does not treat docs or generated declarations as source files", () => {
    const review = reviewTestsWithPolicy([
      file("docs/api.md", "added"),
      file("src/generated.d.ts", "added"),
    ]);

    expect(review.decision).toBe("not_required");
  });

  it("reports changed test files as evidence", () => {
    const review = reviewTestsWithPolicy([
      file("src/api/new-route.ts", "added"),
      file("tests/new-route.test.ts", "added"),
    ]);

    expect(review.testEvidenceFound).toBe(true);
  });
});

describe("reviewTestsWithAgent", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.fetch = mockFetch;
  });

  it("parses a structured agent decision and filters hallucinated filenames", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        decision: "required",
        confidence: "high",
        reason: "Adds a new endpoint.",
        affectedFiles: ["src/api/new-route.ts", "imaginary.ts"],
      }) } }] }),
    });

    const review = await reviewTestsWithAgent(config(), [file("src/api/new-route.ts", "added")]);

    expect(review).toMatchObject({
      mode: "agent",
      decision: "required",
      confidence: "high",
      affectedFiles: ["src/api/new-route.ts"],
    });
  });

  it("rejects invalid agent JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not json" } }] }),
    });

    await expect(reviewTestsWithAgent(config(), [file("src/api/new-route.ts")]))
      .rejects.toThrow("Test-review agent returned invalid JSON");
  });
});
