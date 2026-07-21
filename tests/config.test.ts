import { describe, expect, it } from "vitest";
import { parseConfigFromInputs } from "../src/config.js";

describe("parseConfigFromInputs", () => {
  it("uses safe defaults with only github-token", () => {
    const config = parseConfigFromInputs({
      "github-token": "ghs_test",
    });

    expect(config.provider).toBe("none");
    expect(config.model).toBe("");
    expect(config.apiKey).toBe("");
    expect(config.failOnRisk).toBe("none");
    expect(config.maxPatchLines).toBe(1200);
    expect(config.commentMode).toBe("update");
    expect(config.riskProfilePath).toBe("");
    expect(config.testReviewMode).toBe("auto");
    expect(config.testPolicyPath).toBe("");
    expect(config.baseUrl).toBe("");
  });

  it("rejects missing github-token", () => {
    expect(() =>
      parseConfigFromInputs({}),
    ).toThrow("github-token is required");
  });

  it("accepts provider: openai-compatible with a valid base-url", () => {
    const config = parseConfigFromInputs({
      "github-token": "ghs_test",
      provider: "openai-compatible",
      "base-url": "https://api.groq.com/openai/v1",
      "api-key": "sk-test-key",
    });

    expect(config.provider).toBe("openai-compatible");
    expect(config.baseUrl).toBe("https://api.groq.com/openai/v1");
  });

  it("rejects provider: openai-compatible without base-url", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        provider: "openai-compatible",
        "api-key": "sk-test-key",
      }),
    ).toThrow("base-url is required when provider is openai-compatible");
  });

  it("rejects provider: openai-compatible with empty base-url", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        provider: "openai-compatible",
        "base-url": "",
        "api-key": "sk-test-key",
      }),
    ).toThrow("base-url is required when provider is openai-compatible");
  });

  it("rejects invalid base-url that is not a URL", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        provider: "openai-compatible",
        "base-url": "not-a-url",
        "api-key": "sk-test-key",
      }),
    ).toThrow("Invalid base-url");
  });

  it("rejects non-http(s) base-url", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        provider: "openai-compatible",
        "base-url": "ftp://api.example.com/v1",
        "api-key": "sk-test-key",
      }),
    ).toThrow("Invalid base-url");
  });

  it("ignores base-url for non-openai-compatible providers", () => {
    const config = parseConfigFromInputs({
      "github-token": "ghs_test",
      provider: "openai",
      "base-url": "https://should-be-ignored.com",
      "api-key": "sk-test-key",
    });

    expect(config.provider).toBe("openai");
    expect(config.baseUrl).toBe("");
  });

  it("rejects unsupported provider such as other", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        provider: "other",
      }),
    ).toThrow("Unsupported provider: other");
  });

  it("requires api key for provider: openai", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        provider: "openai",
        "api-key": "",
      }),
    ).toThrow("api-key is required when provider is openai");
  });

  it("requires api key for provider: anthropic", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        provider: "anthropic",
        "api-key": "",
      }),
    ).toThrow("api-key is required when provider is anthropic");
  });

  it("requires api key for provider: openai-compatible", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        provider: "openai-compatible",
        "base-url": "https://api.groq.com/openai/v1",
        "api-key": "",
      }),
    ).toThrow("api-key is required when provider is openai-compatible");
  });

  it("accepts provider: none without api key", () => {
    const config = parseConfigFromInputs({
      "github-token": "ghs_test",
      provider: "none",
    });

    expect(config.provider).toBe("none");
    expect(config.apiKey).toBe("");
  });

  it("accepts policy and agent test-review modes", () => {
    const policy = parseConfigFromInputs({
      "github-token": "ghs_test",
      "test-review-mode": "policy",
      "test-policy-path": "./test-policy.yml",
    });
    expect(policy.testReviewMode).toBe("policy");
    expect(policy.testPolicyPath).toBe("./test-policy.yml");

    const agent = parseConfigFromInputs({
      "github-token": "ghs_test",
      provider: "openai",
      "api-key": "sk-test-key",
      "test-review-mode": "agent",
    });
    expect(agent.testReviewMode).toBe("agent");
  });

  it("rejects an invalid test-review mode and agent mode without a provider", () => {
    expect(() => parseConfigFromInputs({
      "github-token": "ghs_test",
      "test-review-mode": "invalid",
    })).toThrow("Unsupported test-review-mode: invalid");

    expect(() => parseConfigFromInputs({
      "github-token": "ghs_test",
      "test-review-mode": "agent",
    })).toThrow("provider must be configured when test-review-mode is agent");
  });

  it("rejects invalid fail-on-risk values including low", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        "fail-on-risk": "low",
      }),
    ).toThrow("Unsupported fail-on-risk value: low");

    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        "fail-on-risk": "invalid",
      }),
    ).toThrow("Unsupported fail-on-risk value: invalid");
  });

  it("rejects invalid comment-mode", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        "comment-mode": "delete",
      }),
    ).toThrow("Unsupported comment-mode value: delete");
  });

  it("rejects max-patch-lines below 100", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        "max-patch-lines": "99",
      }),
    ).toThrow("max-patch-lines must be an integer from 100 to 10000");
  });

  it("rejects max-patch-lines above 10000", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        "max-patch-lines": "10001",
      }),
    ).toThrow("max-patch-lines must be an integer from 100 to 10000");
  });

  it("rejects non-numeric max-patch-lines", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        "max-patch-lines": "not-a-number",
      }),
    ).toThrow("max-patch-lines must be an integer from 100 to 10000");
  });

  it("trims whitespace around valid values", () => {
    const config = parseConfigFromInputs({
      "github-token": "  ghs_test  ",
      provider: "  openai-compatible  ",
      model: "  gpt-4  ",
      "api-key": "  sk-test-key  ",
      "base-url": "  https://api.groq.com/openai/v1  ",
      "fail-on-risk": "  high  ",
      "max-patch-lines": "  500  ",
      "comment-mode": "  new  ",
      "risk-profile-path": "  ./custom.yml  ",
      "test-review-mode": "  policy  ",
      "test-policy-path": "  ./test-policy.yml  ",
    });

    expect(config.githubToken).toBe("ghs_test");
    expect(config.provider).toBe("openai-compatible");
    expect(config.model).toBe("gpt-4");
    expect(config.apiKey).toBe("sk-test-key");
    expect(config.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(config.failOnRisk).toBe("high");
    expect(config.maxPatchLines).toBe(500);
    expect(config.commentMode).toBe("new");
    expect(config.riskProfilePath).toBe("./custom.yml");
    expect(config.testReviewMode).toBe("policy");
    expect(config.testPolicyPath).toBe("./test-policy.yml");
  });

  it("accepts valid max-patch-lines at boundaries", () => {
    const min = parseConfigFromInputs({
      "github-token": "ghs_test",
      "max-patch-lines": "100",
    });
    expect(min.maxPatchLines).toBe(100);

    const max = parseConfigFromInputs({
      "github-token": "ghs_test",
      "max-patch-lines": "10000",
    });
    expect(max.maxPatchLines).toBe(10000);
  });

  it("accepts valid fail-on-risk values", () => {
    for (const value of ["none", "medium", "high", "critical"]) {
      const config = parseConfigFromInputs({
        "github-token": "ghs_test",
        "fail-on-risk": value,
      });
      expect(config.failOnRisk).toBe(value);
    }
  });

  it("accepts valid comment-mode values", () => {
    const update = parseConfigFromInputs({
      "github-token": "ghs_test",
      "comment-mode": "update",
    });
    expect(update.commentMode).toBe("update");

    const newMode = parseConfigFromInputs({
      "github-token": "ghs_test",
      "comment-mode": "new",
    });
    expect(newMode.commentMode).toBe("new");
  });
});
