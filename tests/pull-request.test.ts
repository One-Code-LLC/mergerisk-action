import { describe, expect, it, vi } from "vitest";
import { listPullRequestFiles } from "../src/github/pull-request.js";
import type { PullRequestFile } from "../src/types.js";

describe("listPullRequestFiles", () => {
  it("calls octokit.paginate with octokit.rest.pulls.listFiles and correct params", async () => {
    const paginate = vi.fn().mockResolvedValue([]);
    const listFiles = vi.fn();
    const octokit = {
      paginate,
      rest: {
        pulls: {
          listFiles
        }
      }
    };

    await listPullRequestFiles(octokit as never, {
      owner: "test-owner",
      repo: "test-repo",
      pullNumber: 42
    });

    expect(paginate).toHaveBeenCalledWith(listFiles, {
      owner: "test-owner",
      repo: "test-repo",
      pull_number: 42,
      per_page: 100
    });
  });

  it("maps returned files to PullRequestFile shape", async () => {
    const paginate = vi.fn().mockResolvedValue([
      {
        filename: "src/index.ts",
        status: "modified",
        additions: 10,
        deletions: 2,
        changes: 12,
        patch: "@@ -1 +1 @@"
      }
    ]);
    const octokit = {
      paginate,
      rest: {
        pulls: {
          listFiles: vi.fn()
        }
      }
    };

    const result: PullRequestFile[] = await listPullRequestFiles(octokit as never, {
      owner: "test-owner",
      repo: "test-repo",
      pullNumber: 42
    });

    expect(result).toEqual([
      {
        filename: "src/index.ts",
        status: "modified",
        additions: 10,
        deletions: 2,
        changes: 12,
        patch: "@@ -1 +1 @@"
      }
    ]);
  });

  it("converts missing patch to empty string", async () => {
    const paginate = vi.fn().mockResolvedValue([
      {
        filename: "large-file.bin",
        status: "added",
        additions: 1000,
        deletions: 0,
        changes: 1000
      }
    ]);
    const octokit = {
      paginate,
      rest: {
        pulls: {
          listFiles: vi.fn()
        }
      }
    };

    const result: PullRequestFile[] = await listPullRequestFiles(octokit as never, {
      owner: "test-owner",
      repo: "test-repo",
      pullNumber: 42
    });

    expect(result[0].patch).toBe("");
  });
});
