import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Octokit } from "../src/github/comment.js";
import { upsertReportComment } from "../src/github/comment.js";
import { reportMarker } from "../src/report/markdown.js";

/* ------------------------------------------------------------------ */
/*  Mock @actions/core so we can assert on warning / summary calls    */
/* ------------------------------------------------------------------ */

vi.mock("@actions/core", () => ({
  warning: vi.fn(),
  summary: {
    addRaw: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined),
  },
}));

import * as core from "@actions/core";

describe("upsertReportComment", () => {
  it("update mode updates an existing comment containing the marker", async () => {
    const updateComment = vi.fn();
    const createComment = vi.fn();
    const listComments = vi.fn();
    const octokit = {
      paginate: vi.fn().mockResolvedValue([{ id: 42, body: `${reportMarker}\nold content` }]),
      rest: {
        issues: {
          listComments,
          updateComment,
          createComment
        }
      }
    };

    await upsertReportComment(octokit as unknown as Octokit, {
      owner: "acme",
      repo: "app",
      pullNumber: 7,
      body: "new body",
      mode: "update"
    });

    expect(octokit.paginate).toHaveBeenCalledWith(listComments, {
      owner: "acme",
      repo: "app",
      issue_number: 7,
      per_page: 100
    });
    expect(updateComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "app",
      comment_id: 42,
      body: "new body"
    });
    expect(createComment).not.toHaveBeenCalled();
  });

  it("update mode creates a comment when no marker exists", async () => {
    const updateComment = vi.fn();
    const createComment = vi.fn();
    const listComments = vi.fn();
    const octokit = {
      paginate: vi.fn().mockResolvedValue([]),
      rest: {
        issues: {
          listComments,
          updateComment,
          createComment
        }
      }
    };

    await upsertReportComment(octokit as unknown as Octokit, {
      owner: "acme",
      repo: "app",
      pullNumber: 7,
      body: "new body",
      mode: "update"
    });

    expect(createComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "app",
      issue_number: 7,
      body: "new body"
    });
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("new mode always creates a new comment and does not list existing comments", async () => {
    const listComments = vi.fn();
    const updateComment = vi.fn();
    const createComment = vi.fn();
    const paginate = vi.fn();
    const octokit = {
      paginate,
      rest: {
        issues: {
          listComments,
          updateComment,
          createComment
        }
      }
    };

    await upsertReportComment(octokit as unknown as Octokit, {
      owner: "acme",
      repo: "app",
      pullNumber: 7,
      body: "new body",
      mode: "new"
    });

    expect(createComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "app",
      issue_number: 7,
      body: "new body"
    });
    expect(paginate).not.toHaveBeenCalled();
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("uses issue_number: pullNumber when creating comments", async () => {
    const createComment = vi.fn();
    const octokit = {
      paginate: vi.fn(),
      rest: {
        issues: {
          listComments: vi.fn(),
          updateComment: vi.fn(),
          createComment
        }
      }
    };

    await upsertReportComment(octokit as unknown as Octokit, {
      owner: "acme",
      repo: "app",
      pullNumber: 42,
      body: "body",
      mode: "new"
    });

    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 42 })
    );
  });

  it("uses comment_id when updating", async () => {
    const updateComment = vi.fn();
    const createComment = vi.fn();
    const listComments = vi.fn();
    const octokit = {
      paginate: vi.fn().mockResolvedValue([{ id: 99, body: `${reportMarker}\nold` }]),
      rest: {
        issues: {
          listComments,
          updateComment,
          createComment
        }
      }
    };

    await upsertReportComment(octokit as unknown as Octokit, {
      owner: "acme",
      repo: "app",
      pullNumber: 7,
      body: "updated body",
      mode: "update"
    });

    expect(updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 99 })
    );
  });

  it("does not create duplicate comments in update mode when a marker exists", async () => {
    const updateComment = vi.fn();
    const createComment = vi.fn();
    const listComments = vi.fn();
    const octokit = {
      paginate: vi.fn().mockResolvedValue([
        { id: 1, body: "some other comment" },
        { id: 2, body: `${reportMarker}\nsticky report` },
        { id: 3, body: "another comment" }
      ]),
      rest: {
        issues: {
          listComments,
          updateComment,
          createComment
        }
      }
    };

    await upsertReportComment(octokit as unknown as Octokit, {
      owner: "acme",
      repo: "app",
      pullNumber: 7,
      body: "updated report",
      mode: "update"
    });

    expect(updateComment).toHaveBeenCalledTimes(1);
    expect(createComment).not.toHaveBeenCalled();
    expect(updateComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "app",
      comment_id: 2,
      body: "updated report"
    });
  });

  it("skips comments with null body when searching for marker", async () => {
    const updateComment = vi.fn();
    const createComment = vi.fn();
    const listComments = vi.fn();
    const octokit = {
      paginate: vi.fn().mockResolvedValue([
        { id: 1, body: null },
        { id: 2, body: `${reportMarker}\nsticky report` },
        { id: 3, body: "normal comment" }
      ]),
      rest: {
        issues: {
          listComments,
          updateComment,
          createComment
        }
      }
    };

    await upsertReportComment(octokit as unknown as Octokit, {
      owner: "acme",
      repo: "app",
      pullNumber: 7,
      body: "updated report",
      mode: "update"
    });

    expect(updateComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "app",
      comment_id: 2,
      body: "updated report"
    });
    expect(createComment).not.toHaveBeenCalled();
  });

  /* ---------- 403 graceful degradation tests ---------- */

  describe("403 graceful degradation", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("warns and writes to job summary when createComment throws 403 in new mode", async () => {
      const listComments = vi.fn();
      const updateComment = vi.fn();
      const createComment = vi.fn().mockRejectedValue({ status: 403, message: "Forbidden" });
      const octokit = {
        paginate: vi.fn(),
        rest: {
          issues: { listComments, updateComment, createComment }
        }
      };

      await upsertReportComment(octokit as unknown as Octokit, {
        owner: "acme",
        repo: "app",
        pullNumber: 7,
        body: "full report body",
        mode: "new"
      });

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("GITHUB_TOKEN is read-only")
      );
      expect(core.summary.addRaw).toHaveBeenCalledWith("full report body");
      expect(core.summary.write).toHaveBeenCalledOnce();
      // The function resolved without throwing
    });

    it("warns and writes to job summary when updateComment throws 403 in update mode", async () => {
      const listComments = vi.fn();
      const updateComment = vi.fn().mockRejectedValue({ status: 403, message: "Forbidden" });
      const createComment = vi.fn();
      const octokit = {
        paginate: vi.fn().mockResolvedValue([{ id: 42, body: `${reportMarker}\nold` }]),
        rest: {
          issues: { listComments, updateComment, createComment }
        }
      };

      await upsertReportComment(octokit as unknown as Octokit, {
        owner: "acme",
        repo: "app",
        pullNumber: 7,
        body: "full report body",
        mode: "update"
      });

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("GITHUB_TOKEN is read-only")
      );
      expect(core.summary.addRaw).toHaveBeenCalledWith("full report body");
      expect(core.summary.write).toHaveBeenCalledOnce();
    });

    it("re-throws non-403 errors (e.g. network error)", async () => {
      const listComments = vi.fn();
      const updateComment = vi.fn();
      const createComment = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
      const octokit = {
        paginate: vi.fn(),
        rest: {
          issues: { listComments, updateComment, createComment }
        }
      };

      await expect(
        upsertReportComment(octokit as unknown as Octokit, {
          owner: "acme",
          repo: "app",
          pullNumber: 7,
          body: "body",
          mode: "new"
        })
      ).rejects.toThrow("ECONNRESET");

      expect(core.warning).not.toHaveBeenCalled();
      expect(core.summary.addRaw).not.toHaveBeenCalled();
    });

    it("does not interfere with successful comment creation", async () => {
      const listComments = vi.fn();
      const updateComment = vi.fn();
      const createComment = vi.fn().mockResolvedValue(undefined);
      const octokit = {
        paginate: vi.fn(),
        rest: {
          issues: { listComments, updateComment, createComment }
        }
      };

      await upsertReportComment(octokit as unknown as Octokit, {
        owner: "acme",
        repo: "app",
        pullNumber: 7,
        body: "report body",
        mode: "new"
      });

      expect(core.warning).not.toHaveBeenCalled();
      expect(core.summary.addRaw).not.toHaveBeenCalled();
      expect(core.summary.write).not.toHaveBeenCalled();
    });

    it("warns and writes to summary when createComment throws 403 in update mode (no existing comment)", async () => {
      const listComments = vi.fn();
      const updateComment = vi.fn();
      let callCount = 0;
      const createComment = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw { status: 403, message: "Forbidden" };
        return Promise.resolve();
      });
      const octokit = {
        paginate: vi.fn().mockResolvedValue([]),
        rest: {
          issues: { listComments, updateComment, createComment }
        }
      };

      await upsertReportComment(octokit as unknown as Octokit, {
        owner: "acme",
        repo: "app",
        pullNumber: 7,
        body: "full report body",
        mode: "update"
      });

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining("GITHUB_TOKEN is read-only")
      );
      expect(core.summary.addRaw).toHaveBeenCalledWith("full report body");
      expect(core.summary.write).toHaveBeenCalledOnce();
    });
  });
});
