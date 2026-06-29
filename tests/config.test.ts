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
  });

  it("rejects missing github-token", () => {
    expect(() =>
      parseConfigFromInputs({}),
    ).toThrow("github-token is required");
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

  it("accepts provider: none without api key", () => {
    const config = parseConfigFromInputs({
      "github-token": "ghs_test",
      provider: "none",
    });

    expect(config.provider).toBe("none");
    expect(config.apiKey).toBe("");
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
      provider: "  openai  ",
      model: "  gpt-4  ",
      "api-key": "  sk-test-key  ",
      "fail-on-risk": "  high  ",
      "max-patch-lines": "  500  ",
      "comment-mode": "  new  ",
      "risk-profile-path": "  ./custom.yml  ",
    });

    expect(config.githubToken).toBe("ghs_test");
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4");
    expect(config.apiKey).toBe("sk-test-key");
    expect(config.failOnRisk).toBe("high");
    expect(config.maxPatchLines).toBe(500);
    expect(config.commentMode).toBe("new");
    expect(config.riskProfilePath).toBe("./custom.yml");
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
