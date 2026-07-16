import type {
  ActionConfig,
  PullRequestFile,
  TestReview,
  TestReviewConfidence,
  TestReviewDecision
} from "../types.js";

const OPENAI_BASE = "https://api.openai.com/v1";
const CHAT_COMPLETIONS_PATH = "/chat/completions";
const decisions = new Set<TestReviewDecision>(["required", "not_required", "inconclusive"]);
const confidences = new Set<TestReviewConfidence>(["high", "medium", "low"]);

function truncatePatch(files: PullRequestFile[], maxPatchLines: number): string {
  const lines: string[] = [];
  for (const file of files) {
    if (lines.length >= maxPatchLines) break;
    lines.push(`FILE: ${file.filename} (${file.status})`);
    lines.push(...file.patch.split("\n").slice(0, Math.max(0, maxPatchLines - lines.length - 1)));
  }
  return lines.slice(0, maxPatchLines).join("\n");
}

function promptFor(files: PullRequestFile[], maxPatchLines: number): string {
  return `Assess whether this pull request requires tests to be added or updated.
Decide based on whether changed implementation alters observable behavior, a public contract, or error handling.
Do not require tests for comments, formatting, documentation, equivalent refactors, generated files, or dependency metadata.
Do not infer coverage from tests that are not in the pull request. This is a test-change decision, not a claim that the repository's test suite is adequate.

Return only JSON with this exact shape:
{"decision":"required|not_required|inconclusive","confidence":"high|medium|low","reason":"short explanation","affectedFiles":["changed/file.ts"]}

Changed files and patches:
${truncatePatch(files, maxPatchLines)}`;
}

function buildOpenAIEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith(CHAT_COMPLETIONS_PATH) ? trimmed : `${trimmed}${CHAT_COMPLETIONS_PATH}`;
}

function parseReview(content: string, files: PullRequestFile[]): TestReview {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Test-review agent returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Test-review agent returned an invalid response");
  }
  const result = parsed as Record<string, unknown>;
  if (!decisions.has(result.decision as TestReviewDecision) || !confidences.has(result.confidence as TestReviewConfidence) || typeof result.reason !== "string" || result.reason.trim().length === 0 || !Array.isArray(result.affectedFiles) || !result.affectedFiles.every((file) => typeof file === "string")) {
    throw new Error("Test-review agent returned an invalid schema");
  }

  const changedFilenames = new Set(files.map((file) => file.filename));
  return {
    mode: "agent",
    decision: result.decision as TestReviewDecision,
    confidence: result.confidence as TestReviewConfidence,
    reason: result.reason.trim().slice(0, 500),
    affectedFiles: (result.affectedFiles as string[]).filter((file) => changedFilenames.has(file)).slice(0, 10),
    testEvidenceFound: false
  };
}

async function requestOpenAI(config: ActionConfig, files: PullRequestFile[], baseUrl: string): Promise<string> {
  const response = await fetch(buildOpenAIEndpoint(baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model || "gpt-4.1-mini",
      messages: [{ role: "user", content: promptFor(files, config.maxPatchLines) }],
      temperature: 0
    }),
    signal: AbortSignal.timeout(config.aiTimeoutMs)
  });
  if (!response.ok) throw new Error(`Test-review agent failed with status ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function requestAnthropic(config: ActionConfig, files: PullRequestFile[]): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: config.model || "claude-3-5-haiku-latest",
      max_tokens: 300,
      messages: [{ role: "user", content: promptFor(files, config.maxPatchLines) }]
    }),
    signal: AbortSignal.timeout(config.aiTimeoutMs)
  });
  if (!response.ok) throw new Error(`Test-review agent failed with status ${response.status}`);
  const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
  return data.content?.find((part) => part.type === "text")?.text?.trim() ?? "";
}

export async function reviewTestsWithAgent(config: ActionConfig, files: PullRequestFile[]): Promise<TestReview> {
  if (config.provider === "none") throw new Error("Test-review agent requires a configured provider");
  const content = config.provider === "anthropic"
    ? await requestAnthropic(config, files)
    : await requestOpenAI(config, files, config.provider === "openai-compatible" ? config.baseUrl : OPENAI_BASE);
  return parseReview(content, files);
}
