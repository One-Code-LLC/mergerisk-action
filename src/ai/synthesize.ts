import type { ActionConfig, PullRequestFile, RiskAssessment, RiskSignal } from "../types.js";

function truncatePatch(
  files: PullRequestFile[],
  maxPatchLines: number
): string {
  const lines: string[] = [];

  for (const file of files) {
    if (lines.length >= maxPatchLines) break;
    lines.push(`FILE: ${file.filename}`);
    lines.push(
      ...file.patch
        .split("\n")
        .slice(0, Math.max(0, maxPatchLines - lines.length - 1))
    );
  }

  return lines.slice(0, maxPatchLines).join("\n");
}

function promptFor(
  assessment: RiskAssessment,
  files: PullRequestFile[],
  maxPatchLines: number
): string {
  return `You are writing a concise pull request risk summary.
Do not lower the deterministic risk level.
Risk level: ${assessment.level}
Score: ${assessment.score}
Signals: ${assessment.signals
  .map((signal: RiskSignal) => `${signal.category}:${signal.severity}`)
  .join(", ")}

Changed files and truncated patches:
${truncatePatch(files, maxPatchLines)}

Return 2-4 bullet points focused on reviewer attention and merge risk.`;
}

async function synthesizeWithOpenAI(
  config: ActionConfig,
  assessment: RiskAssessment,
  files: PullRequestFile[]
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model || "gpt-4.1-mini",
      messages: [
        { role: "user", content: promptFor(assessment, files, config.maxPatchLines) }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI synthesis failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function synthesizeWithAnthropic(
  config: ActionConfig,
  assessment: RiskAssessment,
  files: PullRequestFile[]
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: config.model || "claude-3-5-haiku-latest",
      max_tokens: 500,
      messages: [
        { role: "user", content: promptFor(assessment, files, config.maxPatchLines) }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic synthesis failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return data.content?.find((part) => part.type === "text")?.text?.trim() ?? "";
}

export async function synthesizeSummary(
  config: ActionConfig,
  assessment: RiskAssessment,
  files: PullRequestFile[]
): Promise<string> {
  if (config.provider === "none") return "";
  if (config.provider === "openai") return synthesizeWithOpenAI(config, assessment, files);
  if (config.provider === "anthropic") return synthesizeWithAnthropic(config, assessment, files);
  return "";
}
