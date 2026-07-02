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

export async function upsertReportComment(
  octokit: Octokit,
  options: UpsertCommentOptions
): Promise<void> {
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
}
