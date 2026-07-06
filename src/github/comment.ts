import * as core from "@actions/core";
import type { GitHub } from "@actions/github/lib/utils.js";
import type { CommentMode } from "../types.js";
import { reportMarker } from "../report/markdown.js";

export type Octokit = InstanceType<typeof GitHub>;

interface UpsertCommentOptions {
  owner: string;
  repo: string;
  pullNumber: number;
  body: string;
  mode: CommentMode;
}

/**
 * Returns true when the error is an HTTP 403 from the GitHub API,
 * indicating the GITHUB_TOKEN is read-only (fork PR scenario).
 */
function is403Error(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === 403
  );
}

async function writeToJobSummary(body: string): Promise<void> {
  await core.summary.addRaw(body).write();
}

export async function upsertReportComment(
  octokit: Octokit,
  options: UpsertCommentOptions
): Promise<void> {
  try {
    if (options.mode === "new") {
      await octokit.rest.issues.createComment({
        owner: options.owner,
        repo: options.repo,
        issue_number: options.pullNumber,
        body: options.body
      });
      return;
    }

    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner: options.owner,
      repo: options.repo,
      issue_number: options.pullNumber,
      per_page: 100
    });

    const existing = comments.find((comment) => comment.body?.includes(reportMarker));

    if (existing) {
      await octokit.rest.issues.updateComment({
        owner: options.owner,
        repo: options.repo,
        comment_id: existing.id,
        body: options.body
      });
      return;
    }

    await octokit.rest.issues.createComment({
      owner: options.owner,
      repo: options.repo,
      issue_number: options.pullNumber,
      body: options.body
    });

    const commentsAfter = await octokit.paginate(octokit.rest.issues.listComments, {
      owner: options.owner,
      repo: options.repo,
      issue_number: options.pullNumber,
      per_page: 100
    });

    const markers = commentsAfter.filter((c) => c.body?.includes(reportMarker));
    if (markers.length > 1) {
      markers.sort((a, b) => a.id - b.id);
      const [keeper, ...extras] = markers;
      for (const m of extras) {
        await octokit.rest.issues.deleteComment({
          owner: options.owner,
          repo: options.repo,
          comment_id: m.id
        });
      }
      await octokit.rest.issues.updateComment({
        owner: options.owner,
        repo: options.repo,
        comment_id: keeper.id,
        body: options.body
      });
    }
  } catch (error: unknown) {
    if (is403Error(error)) {
      core.warning(
        "Unable to post or update the PR comment because GITHUB_TOKEN is read-only " +
        "on pull requests from forks. The full report has been written to the " +
        "job summary instead. " +
        "See https://github.com/One-Code-LLC/mergerisk-action#fork-pull-requests " +
        "for details.",
      );
      await writeToJobSummary(options.body);
      return;
    }
    throw error;
  }
}
