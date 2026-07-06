import * as core from "@actions/core";
import * as github from "@actions/github";
import { parseConfigFromInputs } from "./config.js";
import { synthesizeSummary } from "./ai/synthesize.js";
import { upsertReportComment } from "./github/comment.js";
import { listPullRequestFiles } from "./github/pull-request.js";
import { renderReport } from "./report/markdown.js";
import { assessRisk } from "./risk/score.js";
import { loadRiskRules } from "./risk/profile.js";
import type { RiskLevel } from "./types.js";

const rank: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function shouldFail(
  level: RiskLevel,
  failOnRisk: RiskLevel | "none",
): boolean {
  if (failOnRisk === "none") return false;
  return rank[level] >= rank[failOnRisk];
}

export async function run(): Promise<void> {
  try {
    const pullRequest = github.context.payload.pull_request;
    if (!pullRequest) {
      core.info("MergeRisk only runs on pull_request events.");
      return;
    }

    const config = parseConfigFromInputs({
      "github-token": core.getInput("github-token", { required: true }),
      provider: core.getInput("provider"),
      model: core.getInput("model"),
      "api-key": core.getInput("api-key"),
      "base-url": core.getInput("base-url"),
      "fail-on-risk": core.getInput("fail-on-risk"),
      "max-patch-lines": core.getInput("max-patch-lines"),
      "comment-mode": core.getInput("comment-mode"),
      "risk-profile-path": core.getInput("risk-profile-path"),
      "ai-timeout-ms": core.getInput("ai-timeout-ms"),
    });

    if (config.apiKey) {
      core.setSecret(config.apiKey);
    }

    const octokit = github.getOctokit(config.githubToken);
    const owner = github.context.repo.owner;
    const repo = github.context.repo.repo;
    const pullNumber = pullRequest.number;

    const rules = await loadRiskRules(config.riskProfilePath);
    const files = await listPullRequestFiles(octokit, { owner, repo, pullNumber });
    const assessment = assessRisk(files, rules);

    let summary = "";
    try {
      summary = await synthesizeSummary(config, assessment, files);
    } catch (err) {
      core.warning(`AI synthesis skipped: ${err instanceof Error ? err.message : String(err)}`);
    }

    const body = renderReport(assessment, summary);

    await upsertReportComment(octokit, {
      owner,
      repo,
      pullNumber,
      body,
      mode: config.commentMode,
    });

    core.setOutput("risk-level", assessment.level);
    core.setOutput("risk-score", String(assessment.score));

    if (shouldFail(assessment.level, config.failOnRisk)) {
      core.setFailed(
        `MergeRisk level ${assessment.level} meets fail-on-risk threshold ${config.failOnRisk}`,
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }
}

run();
