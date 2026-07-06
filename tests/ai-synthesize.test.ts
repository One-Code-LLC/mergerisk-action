import { describe, expect, it, vi, beforeEach } from "vitest";
import { synthesizeSummary } from "../src/ai/synthesize.js";
import type { ActionConfig, PullRequestFile, RiskAssessment } from "../src/types.js";

function makeConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
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
    aiTimeoutMs: 30000,
    ...overrides
  };
}

function makeAssessment(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    level: "medium",
    score: 5,
    guidance: "Review the highlighted areas before merge.",
    signals: [],
    reviewerFocus: [],
    testEvidenceFound: false,
    filesChanged: 2,
    totalAdditions: 40,
    totalDeletions: 12,
    ...overrides
  };
}

function makeFile(
  filename: string,
  patch = "@@ -1 +1 @@\n-context\n+new-context"
): PullRequestFile {
  return {
    filename,
    status: "modified",
    additions: 10,
    deletions: 2,
    changes: 12,
    patch
  };
}

const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  globalThis.fetch = mockFetch;
});

describe("synthesizeSummary", () => {
  describe("provider: none", () => {
    it("returns empty string and does not call fetch", async () => {
      const config = makeConfig({ provider: "none" });
      const result = await synthesizeSummary(config, makeAssessment(), []);

      expect(result).toBe("");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("OpenAI path", () => {
    it("calls the expected URL with authorization header and default model when model is empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Summary text" } }]
        })
      });

      const config = makeConfig({
        provider: "openai",
        apiKey: "sk-test-key-12345",
        model: ""
      });
      const assessment = makeAssessment({
        level: "high",
        score: 10,
        signals: [
          { category: "auth", severity: "high", points: 4, evidence: ["src/auth/session.ts"], message: "auth files changed" }
        ]
      });
      const files = [makeFile("src/auth/session.ts")];

      const result = await synthesizeSummary(config, assessment, files);

      expect(result).toBe("Summary text");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            authorization: "Bearer sk-test-key-12345",
            "content-type": "application/json"
          })
        })
      );

      const callArg = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArg.body);
      expect(body.model).toBe("gpt-4.1-mini");
      expect(body.temperature).toBe(0.2);
    });

    it("uses the configured model when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Custom model summary" } }]
        })
      });

      const config = makeConfig({
        provider: "openai",
        apiKey: "sk-test-key",
        model: "gpt-4o"
      });

      await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);

      const callArg = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArg.body);
      expect(body.model).toBe("gpt-4o");
    });

    it("includes reviewerFocus in the prompt content", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "summary" } }]
        })
      });

      const config = makeConfig({
        provider: "openai",
        apiKey: "sk-test"
      });
      const assessment = makeAssessment({
        reviewerFocus: ["auth/session.ts", "db/migrations"]
      });

      await synthesizeSummary(config, assessment, [makeFile("test.ts")]);

      const callArg = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArg.body);
      const content = body.messages[0].content;
      expect(content).toContain("Reviewer focus: auth/session.ts, db/migrations");
    });

    it("passes an AbortSignal signal with a timeout bound to the fetch call", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "summary" } }]
        })
      });

      const config = makeConfig({
        provider: "openai",
        apiKey: "sk-test-key",
        model: "",
        aiTimeoutMs: 15000
      });

      await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);

      const callArg = mockFetch.mock.calls[0][1];
      expect(callArg.signal).toBeInstanceOf(AbortSignal);
      expect(callArg.signal.aborted).toBe(false);
    });

    it("throws an error when the response is not OK and does not leak the API key", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized"
      });

      const config = makeConfig({
        provider: "openai",
        apiKey: "sk-secret-key"
      });

      await expect(
        synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")])
      ).rejects.toThrow("OpenAI synthesis failed with status 401");

      // The error should not contain the API key
      try {
        await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);
      } catch (error) {
        expect(String(error)).not.toContain("sk-secret-key");
      }
    });
  });

  describe("openai-compatible path", () => {
    it("calls the base-url endpoint with /chat/completions appended", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Compatible summary" } }]
        })
      });

      const config = makeConfig({
        provider: "openai-compatible",
        apiKey: "sk-test-key",
        baseUrl: "https://api.groq.com/openai/v1"
      });

      const result = await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);

      expect(result).toBe("Compatible summary");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.groq.com/openai/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            authorization: "Bearer sk-test-key",
            "content-type": "application/json"
          })
        })
      );
    });

    it("does not double-append /chat/completions when base-url already ends with it", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Already complete" } }]
        })
      });

      const config = makeConfig({
        provider: "openai-compatible",
        apiKey: "sk-test-key",
        baseUrl: "https://api.groq.com/openai/v1/chat/completions"
      });

      await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.groq.com/openai/v1/chat/completions",
        expect.any(Object)
      );
    });

    it("sends OpenAI-format body with the configured model", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Model summary" } }]
        })
      });

      const config = makeConfig({
        provider: "openai-compatible",
        apiKey: "sk-test-key",
        baseUrl: "https://api.mistral.ai/v1",
        model: "mistral-large-latest"
      });

      await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);

      const callArg = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArg.body);
      expect(body.model).toBe("mistral-large-latest");
      expect(body.temperature).toBe(0.2);
      expect(body.messages).toBeDefined();
    });

    it("uses default model gpt-4.1-mini when model is empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Default model" } }]
        })
      });

      const config = makeConfig({
        provider: "openai-compatible",
        apiKey: "sk-test-key",
        baseUrl: "https://api.groq.com/openai/v1",
        model: ""
      });

      await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);

      const callArg = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArg.body);
      expect(body.model).toBe("gpt-4.1-mini");
    });

    it("throws an error when the response is not OK", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized"
      });

      const config = makeConfig({
        provider: "openai-compatible",
        apiKey: "sk-test-key",
        baseUrl: "https://api.groq.com/openai/v1"
      });

      await expect(
        synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")])
      ).rejects.toThrow("OpenAI synthesis failed with status 401");
    });

    it("passes an AbortSignal signal to the fetch call", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "summary" } }]
        })
      });

      const config = makeConfig({
        provider: "openai-compatible",
        apiKey: "sk-test-key",
        baseUrl: "https://api.groq.com/openai/v1",
        aiTimeoutMs: 15000
      });

      await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);

      const callArg = mockFetch.mock.calls[0][1];
      expect(callArg.signal).toBeInstanceOf(AbortSignal);
      expect(callArg.signal.aborted).toBe(false);
    });
  });

  describe("Anthropic path", () => {
    it("calls the expected URL with required headers and default model when model is empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Anthropic summary" }]
        })
      });

      const config = makeConfig({
        provider: "anthropic",
        apiKey: "sk-ant-test-key"
      });
      const assessment = makeAssessment({
        level: "high",
        score: 9,
        signals: [
          { category: "database", severity: "high", points: 4, evidence: ["migrations/001.sql"], message: "database files changed" }
        ]
      });
      const files = [makeFile("migrations/001.sql")];

      const result = await synthesizeSummary(config, assessment, files);

      expect(result).toBe("Anthropic summary");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/messages",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-api-key": "sk-ant-test-key",
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          })
        })
      );

      const callArg = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArg.body);
      expect(body.model).toBe("claude-3-5-haiku-latest");
      expect(body.max_tokens).toBe(500);
    });

    it("uses the configured model when provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Custom model summary" }]
        })
      });

      const config = makeConfig({
        provider: "anthropic",
        apiKey: "sk-ant-test-key",
        model: "claude-sonnet-4-20250514"
      });

      await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);

      const callArg = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArg.body);
      expect(body.model).toBe("claude-sonnet-4-20250514");
    });

    it("throws an error when the response is not OK and does not leak the API key", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden"
      });

      const config = makeConfig({
        provider: "anthropic",
        apiKey: "sk-ant-secret"
      });

      await expect(
        synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")])
      ).rejects.toThrow("Anthropic synthesis failed with status 403");

      // The error should not contain the API key
      try {
        await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);
      } catch (error) {
        expect(String(error)).not.toContain("sk-ant-secret");
      }
    });

    it("passes an AbortSignal signal to the fetch call", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Anthropic summary" }]
        })
      });

      const config = makeConfig({
        provider: "anthropic",
        apiKey: "sk-ant-test",
        aiTimeoutMs: 20000
      });

      await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);

      const callArg = mockFetch.mock.calls[0][1];
      expect(callArg.signal).toBeInstanceOf(AbortSignal);
      expect(callArg.signal.aborted).toBe(false);
    });
  });

  describe("patch truncation", () => {
    it("respects maxPatchLines by truncating the total patch output", async () => {
      const longPatch = Array.from({ length: 50 }, (_, i) => `@@ -${i + 1} +${i + 1} @@\n line ${i}`).join("\n");

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "truncated summary" } }]
        })
      });

      const config = makeConfig({
        provider: "openai",
        apiKey: "sk-test",
        maxPatchLines: 5
      });
      const files = [makeFile("src/large.ts", longPatch)];

      await synthesizeSummary(config, makeAssessment(), [makeFile("src/large.ts", longPatch)]);

      const callArg = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArg.body);
      const messageContent = body.messages[0].content;

      // The truncated patches should be at most 5 lines in total
      const lines = messageContent.split("\n");

      // Extract the portion after "Changed files and truncated patches:" header
      const patchesStart = lines.findIndex((l: string) => l === "Changed files and truncated patches:");
      const patchesSection = lines.slice(patchesStart + 1);
      const patchLines = patchesSection.filter(
        (l: string) => !l.startsWith("Return ")
      );
      expect(patchLines.length).toBeLessThanOrEqual(7); // 5 maxPatchLines + 1 FILE header
    });
  });

  describe("timeout behavior", () => {
    it("rejects when fetch throws an AbortError (simulating timeout)", async () => {
      mockFetch.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

      const config = makeConfig({
        provider: "openai",
        apiKey: "sk-test-key"
      });

      await expect(
        synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")])
      ).rejects.toThrow("The operation was aborted");
    });
  });

  describe("text trimming", () => {
    it("returns provider text trimmed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "  \nSummary with whitespace\n  " } }]
        })
      });

      const config = makeConfig({
        provider: "openai",
        apiKey: "sk-test"
      });

      const result = await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);

      expect(result).toBe("Summary with whitespace");
      expect(result).not.toContain("\n  ");
    });

    it("returns empty string when provider returns empty content", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "   " } }]
        })
      });

      const config = makeConfig({
        provider: "openai",
        apiKey: "sk-test"
      });

      const result = await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);

      expect(result).toBe("");
    });

    it("returns empty string when content is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: {} }]
        })
      });

      const config = makeConfig({
        provider: "openai",
        apiKey: "sk-test"
      });

      const result = await synthesizeSummary(config, makeAssessment(), [makeFile("test.ts")]);

      expect(result).toBe("");
    });
  });
});
