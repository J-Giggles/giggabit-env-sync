import { describe, expect, it } from "vitest";

async function importPreviewBranchModule() {
  return import(`../vercel-preview-branch.mjs?test=${Date.now()}-${Math.random()}`);
}

describe("Vercel preview env branch scoping", () => {
  it("defaults preview env vars to all preview branches so PR builds inherit them", async () => {
    const priorNoBranch = process.env.ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH;
    const priorBranch = process.env.ENV_SYNC_VERCEL_PREVIEW_BRANCH;
    delete process.env.ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH;
    delete process.env.ENV_SYNC_VERCEL_PREVIEW_BRANCH;

    try {
      const {
        getVercelPreviewGitBranch,
        getVercelPreviewPullBranchCandidates,
        isVercelPreviewNoGitBranch,
      } = await importPreviewBranchModule();

      expect(isVercelPreviewNoGitBranch()).toBe(true);
      expect(getVercelPreviewGitBranch()).toBe("");
      expect(getVercelPreviewPullBranchCandidates()).toEqual([]);
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
