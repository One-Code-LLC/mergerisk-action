import type { GitHub } from "@actions/github/lib/utils.js";
import type { PullRequestFile } from "../types.js";

type Octokit = InstanceType<typeof GitHub>;

interface PullRequestRef {
  owner: string;
  repo: string;
  pullNumber: number;
}

export async function listPullRequestFiles(
  octokit: Octokit,
  ref: PullRequestRef
): Promise<PullRequestFile[]> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const files = await octokit.paginate<any>(octokit.rest.pulls.listFiles, {
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.pullNumber,
    per_page: 100
  });

  return files.map((file: { filename: string; status: string; additions: number; deletions: number; changes: number; patch?: string }) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch ?? ""
  }));
}
