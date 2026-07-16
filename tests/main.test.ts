import { describe, expect, it, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mutable mock objects (hoisted before vi.mock factories)            */
/* ------------------------------------------------------------------ */

const mockContext = vi.hoisted(() => ({
  payload: {} as Record<string, unknown>,
  repo: { owner: "acme", repo: "app" },
}));

/* ------------------------------------------------------------------ */
/*  Module mocks                                                      */
/* ------------------------------------------------------------------ */

vi.mock("@actions/core", () => ({
  getInput: vi.fn(),
  setSecret: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@actions/github", () => ({
  context: mockContext,
  getOctokit: vi.fn().mockReturnValue({}),
}));

vi.mock("../src/config.js", () => ({
  parseConfigFromInputs: vi.fn(),
}));

vi.mock("../src/risk/profile.js", () => ({
  loadRiskRules: vi.fn(),
}));

vi.mock("../src/risk/test-policy.js", () => ({
  loadTestPolicy: vi.fn(),
}));

vi.mock("../src/risk/test-review.js", () => ({
  reviewTestsWithPolicy: vi.fn(),
}));

vi.mock("../src/github/pull-request.js", () => ({
  listPullRequestFiles: vi.fn(),
}));

vi.mock("../src/risk/score.js", () => ({
  assessRisk: vi.fn(),
}));

vi.mock("../src/ai/synthesize.js", () => ({
  synthesizeSummary: vi.fn(),
}));

vi.mock("../src/ai/test-review.js", () => ({
  reviewTestsWithAgent: vi.fn(),
}));

vi.mock("../src/report/markdown.js", () => ({
  renderReport: vi.fn(),
}));

vi.mock("../src/github/comment.js", () => ({
  upsertReportComment: vi.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Module under test                                                  */
/* ------------------------------------------------------------------ */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { parseConfigFromInputs } from "../src/config.js";
import { loadRiskRules } from "../src/risk/profile.js";
import { loadTestPolicy } from "../src/risk/test-policy.js";
import { reviewTestsWithPolicy } from "../src/risk/test-review.js";
import { listPullRequestFiles } from "../src/github/pull-request.js";
import { assessRisk } from "../src/risk/score.js";
import { synthesizeSummary } from "../src/ai/synthesize.js";
import { reviewTestsWithAgent } from "../src/ai/test-review.js";
import { renderReport } from "../src/report/markdown.js";
import { upsertReportComment } from "../src/github/comment.js";
import { run } from "../src/main.js";
import type { ActionConfig, PullRequestFile, RiskAssessment } from "../src/types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function defaultConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    githubToken: "ghs_test",
    provider: "none",
    model: "",
    apiKey: "",
    baseUrl: "",
    failOnRisk: "none",
    maxPatchLines: 1200,
    commentMode: "update",
    riskProfilePath: "",
    testReviewMode: "auto",
    testPolicyPath: "",
    aiTimeoutMs: 30000,
    ...overrides,
  };
}

function defaultAssessment(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    level: "low",
    score: 0,
    guidance: "No unusual merge risk detected.",
    signals: [],
    reviewerFocus: [],
    testEvidenceFound: false,
    testReview: {
      mode: "policy",
      decision: "not_required",
      confidence: "high",
      reason: "Test fixture",
      affectedFiles: [],
      testEvidenceFound: false,
    },
    filesChanged: 0,
    totalAdditions: 0,
    totalDeletions: 0,
    ...overrides,
  };
}

function defaultFiles(): PullRequestFile[] {
  return [
    {
      filename: "src/ui/button.tsx",
      status: "modified",
      additions: 5,
      deletions: 2,
      changes: 7,
      patch: "@@ -1 +1 @@",
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext.payload = {};
    vi.mocked(loadTestPolicy).mockResolvedValue({
      testPatterns: ["tests/**"],
      sourcePatterns: ["src/**"],
      exemptPatterns: [],
      requireTestsFor: { addedSourceFiles: true, modifiedSourceFiles: false },
    });
    vi.mocked(reviewTestsWithPolicy).mockReturnValue({
      mode: "policy",
      decision: "not_required",
      confidence: "high",
      reason: "Policy fixture",
      affectedFiles: [],
      testEvidenceFound: false,
    });
  });

  /* ---------- Test 1: non-PR event ---------- */

  it("logs and returns early when not a pull_request event", async () => {
    await run();

    expect(core.info).toHaveBeenCalledWith(
      "MergeRisk only runs on pull_request events.",
    );
    expect(core.setSecret).not.toHaveBeenCalled();
    expect(core.setOutput).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(parseConfigFromInputs).not.toHaveBeenCalled();
    expect(loadRiskRules).not.toHaveBeenCalled();
    expect(loadTestPolicy).not.toHaveBeenCalled();
    expect(listPullRequestFiles).not.toHaveBeenCalled();
    expect(assessRisk).not.toHaveBeenCalled();
    expect(synthesizeSummary).not.toHaveBeenCalled();
    expect(renderReport).not.toHaveBeenCalled();
    expect(upsertReportComment).not.toHaveBeenCalled();
  });

  /* ---------- Test 2: PR event with provider: none ---------- */

  it("fetches files, scores risk, renders report, upserts comment, and sets outputs", async () => {
    const config = defaultConfig();
    const assessment = defaultAssessment({ level: "medium", score: 5 });
    const files = defaultFiles();
    const reportBody = "<!-- mergerisk-report -->\n## MergeRisk Report";

    mockContext.payload = { pull_request: { number: 42 } };
    vi.mocked(parseConfigFromInputs).mockReturnValue(config);
    vi.mocked(loadRiskRules).mockResolvedValue([]);
    vi.mocked(listPullRequestFiles).mockResolvedValue(files);
    vi.mocked(assessRisk).mockReturnValue(assessment);
    vi.mocked(synthesizeSummary).mockResolvedValue("");
    vi.mocked(renderReport).mockReturnValue(reportBody);

    await run();

    expect(parseConfigFromInputs).toHaveBeenCalled();
    expect(loadRiskRules).toHaveBeenCalledWith(config.riskProfilePath);
    expect(loadTestPolicy).toHaveBeenCalledWith(config.testPolicyPath);
    expect(listPullRequestFiles).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ owner: "acme", repo: "app", pullNumber: 42 }),
    );
    expect(assessRisk).toHaveBeenCalledWith(
      files,
      [],
      expect.objectContaining({ mode: "policy", decision: "not_required" }),
    );
    expect(synthesizeSummary).toHaveBeenCalledWith(config, assessment, files);
    expect(renderReport).toHaveBeenCalledWith(assessment, "");
    expect(upsertReportComment).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        owner: "acme",
        repo: "app",
        pullNumber: 42,
        body: reportBody,
        mode: "update",
      }),
    );
    expect(core.setOutput).toHaveBeenCalledWith("risk-level", "medium");
    expect(core.setOutput).toHaveBeenCalledWith("risk-score", "5");
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("uses an agent review in auto mode when a provider is configured", async () => {
    const config = defaultConfig({ provider: "openai", apiKey: "sk-test-key" });
    const assessment = defaultAssessment();
    const files = defaultFiles();
    const agentReview = {
      mode: "agent" as const,
      decision: "required" as const,
      confidence: "high" as const,
      reason: "Adds behavior.",
      affectedFiles: ["src/ui/button.tsx"],
      testEvidenceFound: false,
    };

    mockContext.payload = { pull_request: { number: 42 } };
    vi.mocked(parseConfigFromInputs).mockReturnValue(config);
    vi.mocked(loadRiskRules).mockResolvedValue([]);
    vi.mocked(listPullRequestFiles).mockResolvedValue(files);
    vi.mocked(reviewTestsWithAgent).mockResolvedValue(agentReview);
    vi.mocked(assessRisk).mockReturnValue(assessment);
    vi.mocked(synthesizeSummary).mockResolvedValue("");
    vi.mocked(renderReport).mockReturnValue("report");

    await run();

    expect(reviewTestsWithAgent).toHaveBeenCalledWith(config, files);
    expect(assessRisk).toHaveBeenCalledWith(files, [], agentReview);
  });

  it("falls back to policy review when the agent review fails", async () => {
    const config = defaultConfig({ provider: "openai", apiKey: "sk-test-key" });
    const assessment = defaultAssessment();
    const files = defaultFiles();

    mockContext.payload = { pull_request: { number: 42 } };
    vi.mocked(parseConfigFromInputs).mockReturnValue(config);
    vi.mocked(loadRiskRules).mockResolvedValue([]);
    vi.mocked(listPullRequestFiles).mockResolvedValue(files);
    vi.mocked(reviewTestsWithAgent).mockRejectedValue(new Error("invalid JSON"));
    vi.mocked(assessRisk).mockReturnValue(assessment);
    vi.mocked(synthesizeSummary).mockResolvedValue("");
    vi.mocked(renderReport).mockReturnValue("report");

    await run();

    expect(core.warning).toHaveBeenCalledWith("Agent test review skipped; using policy review: invalid JSON");
    expect(assessRisk).toHaveBeenCalledWith(
      files,
      [],
      expect.objectContaining({ mode: "policy" }),
    );
  });

  /* ---------- Test 3: fail-on-risk: high with high assessment ---------- */

  it("calls setFailed when fail-on-risk is high and deterministic level is high", async () => {
    const config = defaultConfig({ failOnRisk: "high" });
    const assessment = defaultAssessment({ level: "high", score: 8 });

    mockContext.payload = { pull_request: { number: 42 } };
    vi.mocked(parseConfigFromInputs).mockReturnValue(config);
    vi.mocked(loadRiskRules).mockResolvedValue([]);
    vi.mocked(listPullRequestFiles).mockResolvedValue(defaultFiles());
    vi.mocked(assessRisk).mockReturnValue(assessment);
    vi.mocked(synthesizeSummary).mockResolvedValue("");
    vi.mocked(renderReport).mockReturnValue("report");

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      "MergeRisk level high meets fail-on-risk threshold high",
    );
  });

  /* ---------- Test 4: fail-on-risk: critical with high assessment ---------- */

  it("does not fail when fail-on-risk is critical and deterministic level is high", async () => {
    const config = defaultConfig({ failOnRisk: "critical" });
    const assessment = defaultAssessment({ level: "high", score: 8 });

    mockContext.payload = { pull_request: { number: 42 } };
    vi.mocked(parseConfigFromInputs).mockReturnValue(config);
    vi.mocked(loadRiskRules).mockResolvedValue([]);
    vi.mocked(listPullRequestFiles).mockResolvedValue(defaultFiles());
    vi.mocked(assessRisk).mockReturnValue(assessment);
    vi.mocked(synthesizeSummary).mockResolvedValue("");
    vi.mocked(renderReport).mockReturnValue("report");

    await run();

    expect(core.setFailed).not.toHaveBeenCalled();
  });

  /* ---------- Test 5: synthesis failure degrades gracefully ---------- */

  it("does not fail the action when synthesis throws; degrades to deterministic report", async () => {
    const config = defaultConfig();
    const assessment = defaultAssessment({ level: "medium", score: 5 });
    const files = defaultFiles();
    const reportBody = "<!-- mergerisk-report -->\n## MergeRisk Report";

    mockContext.payload = { pull_request: { number: 42 } };
    vi.mocked(parseConfigFromInputs).mockReturnValue(config);
    vi.mocked(loadRiskRules).mockResolvedValue([]);
    vi.mocked(listPullRequestFiles).mockResolvedValue(files);
    vi.mocked(assessRisk).mockReturnValue(assessment);
    vi.mocked(synthesizeSummary).mockRejectedValue(
      new Error("OpenAI synthesis failed with status 500"),
    );
    vi.mocked(renderReport).mockReturnValue(reportBody);

    await run();

    // Should emit a warning, not setFailed
    expect(core.warning).toHaveBeenCalledWith(
      "AI synthesis skipped: OpenAI synthesis failed with status 500",
    );
    expect(core.setFailed).not.toHaveBeenCalled();

    // Deterministic flow should still complete
    expect(renderReport).toHaveBeenCalledWith(assessment, "");
    expect(upsertReportComment).toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith("risk-level", "medium");
    expect(core.setOutput).toHaveBeenCalledWith("risk-score", "5");
  });

  /* ---------- Test 6: API key is set as secret ---------- */

  it("passes api key to core.setSecret and does not include key in setFailed messages", async () => {
    const config = defaultConfig({ apiKey: "sk-secret-key-12345" });
    const assessment = defaultAssessment({ level: "high", score: 8 });

    mockContext.payload = { pull_request: { number: 42 } };
    vi.mocked(parseConfigFromInputs).mockReturnValue(config);
    vi.mocked(loadRiskRules).mockResolvedValue([]);
    vi.mocked(listPullRequestFiles).mockResolvedValue(defaultFiles());
    vi.mocked(assessRisk).mockReturnValue(assessment);
    vi.mocked(synthesizeSummary).mockResolvedValue("");
    vi.mocked(renderReport).mockReturnValue("report");

    await run();

    expect(core.setSecret).toHaveBeenCalledWith("sk-secret-key-12345");

    // Verify setFailed messages do not contain the API key
    for (const call of vi.mocked(core.setFailed).mock.calls) {
      const message = call[0];
      expect(message).not.toContain("sk-secret-key-12345");
    }
  });

  /* ---------- Test 7: custom risk profile path ---------- */

  it("passes custom risk profile path to loadRiskRules", async () => {
    const config = defaultConfig({ riskProfilePath: ".github/risk-profile.yml" });
    const assessment = defaultAssessment({ level: "low", score: 1 });

    mockContext.payload = { pull_request: { number: 42 } };
    vi.mocked(parseConfigFromInputs).mockReturnValue(config);
    vi.mocked(loadRiskRules).mockResolvedValue([]);
    vi.mocked(listPullRequestFiles).mockResolvedValue(defaultFiles());
    vi.mocked(assessRisk).mockReturnValue(assessment);
    vi.mocked(synthesizeSummary).mockResolvedValue("");
    vi.mocked(renderReport).mockReturnValue("report");

    await run();

    expect(loadRiskRules).toHaveBeenCalledWith(".github/risk-profile.yml");
  });

  /* ---------- Test 8: API key not set when empty ---------- */

  it("does not call setSecret when api key is empty", async () => {
    const config = defaultConfig({ apiKey: "" });

    mockContext.payload = { pull_request: { number: 42 } };
    vi.mocked(parseConfigFromInputs).mockReturnValue(config);
    vi.mocked(loadRiskRules).mockResolvedValue([]);
    vi.mocked(listPullRequestFiles).mockResolvedValue(defaultFiles());
    vi.mocked(assessRisk).mockReturnValue(defaultAssessment());
    vi.mocked(synthesizeSummary).mockResolvedValue("");
    vi.mocked(renderReport).mockReturnValue("report");

    await run();

    expect(core.setSecret).not.toHaveBeenCalled();
  });
});
