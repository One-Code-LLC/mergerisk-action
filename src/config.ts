export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Provider = "none" | "openai" | "anthropic";

export type CommentMode = "update" | "new";

export interface ActionConfig {
  githubToken: string;
  provider: Provider;
  model: string;
  apiKey: string;
  failOnRisk: RiskLevel | "none";
  maxPatchLines: number;
  commentMode: CommentMode;
  riskProfilePath: string;
  aiTimeoutMs: number;
}

type RawInputs = Record<string, string>;

const providers: Provider[] = ["none", "openai", "anthropic"];
const failOnRiskValues: Array<RiskLevel | "none"> = ["none", "medium", "high", "critical"];
const commentModes: CommentMode[] = ["update", "new"];

function pickProvider(value: string): Provider {
  const normalized = value.trim().toLowerCase() || "none";
  if (!providers.includes(normalized as Provider)) {
    throw new Error(`Unsupported provider: ${value}`);
  }
  return normalized as Provider;
}

function pickFailOnRisk(value: string): RiskLevel | "none" {
  const normalized = value.trim().toLowerCase() || "none";
  if (!failOnRiskValues.includes(normalized as RiskLevel | "none")) {
    throw new Error(`Unsupported fail-on-risk value: ${value}`);
  }
  return normalized as RiskLevel | "none";
}

function pickCommentMode(value: string): CommentMode {
  const normalized = value.trim().toLowerCase() || "update";
  if (!commentModes.includes(normalized as CommentMode)) {
    throw new Error(`Unsupported comment-mode value: ${value}`);
  }
  return normalized as CommentMode;
}

function pickMaxPatchLines(value: string): number {
  if (!value.trim()) {
    return 1200;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 10000) {
    throw new Error("max-patch-lines must be an integer from 100 to 10000");
  }
  return parsed;
}

function pickAiTimeoutMs(value: string): number {
  if (!value.trim()) {
    return 30000;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 300000) {
    throw new Error("ai-timeout-ms must be an integer from 1000 to 300000");
  }
  return parsed;
}

export function parseConfigFromInputs(inputs: RawInputs): ActionConfig {
  const githubToken = inputs["github-token"]?.trim() ?? "";
  if (!githubToken) {
    throw new Error("github-token is required");
  }

  const provider = pickProvider(inputs.provider ?? "");
  const apiKey = inputs["api-key"]?.trim() ?? "";
  if (provider !== "none" && !apiKey) {
    throw new Error(`api-key is required when provider is ${provider}`);
  }

  return {
    githubToken,
    provider,
    model: inputs.model?.trim() ?? "",
    apiKey,
    failOnRisk: pickFailOnRisk(inputs["fail-on-risk"] ?? ""),
    maxPatchLines: pickMaxPatchLines(inputs["max-patch-lines"] ?? ""),
    commentMode: pickCommentMode(inputs["comment-mode"] ?? ""),
    riskProfilePath: inputs["risk-profile-path"]?.trim() ?? "",
    aiTimeoutMs: pickAiTimeoutMs(inputs["ai-timeout-ms"] ?? ""),
  };
}
