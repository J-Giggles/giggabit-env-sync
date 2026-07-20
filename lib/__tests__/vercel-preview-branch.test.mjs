import { describe, expect, it } from "vitest";
import {
  getVercelPreviewGitBranch,
  getVercelPreviewPullBranchCandidates,
  isVercelPreviewNoGitBranch,
} from "../vercel-preview-branch.mjs";

describe("Vercel preview env branch scoping", () => {
  it("defaults preview env vars to the stable staging branch", () => {
    const priorNoBranch = process.env.ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH;
    const priorBranch = process.env.ENV_SYNC_VERCEL_PREVIEW_BRANCH;
    delete process.env.ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH;
    delete process.env.ENV_SYNC_VERCEL_PREVIEW_BRANCH;

    try {
      expect(isVercelPreviewNoGitBranch()).toBe(false);
      expect(getVercelPreviewGitBranch()).toBe("staging");
      expect(getVercelPreviewPullBranchCandidates()[0]).toBe("staging");
    } finally {
      if (priorNoBranch === undefined) {
        delete process.env.ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH;
      } else {
        process.env.ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH = priorNoBranch;
      }
      if (priorBranch === undefined) {
        delete process.env.ENV_SYNC_VERCEL_PREVIEW_BRANCH;
      } else {
        process.env.ENV_SYNC_VERCEL_PREVIEW_BRANCH = priorBranch;
      }
    }
  });
});
