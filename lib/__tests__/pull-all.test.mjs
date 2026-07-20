import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkVercelProjectLinked: vi.fn(),
  computePullAllPlans: vi.fn(),
  fetchVercelEnvMapOptions: vi.fn(),
  fetchVercelProjectEnvList: vi.fn(),
  writePullPlan: vi.fn(),
}));

vi.mock("../config.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  checkVercelProjectLinked: mocks.checkVercelProjectLinked,
}));

vi.mock("../remote.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchVercelEnvMapOptions: mocks.fetchVercelEnvMapOptions,
}));

vi.mock("../vercel-project-env-list.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchVercelProjectEnvList: mocks.fetchVercelProjectEnvList,
}));

vi.mock("../pull-plan.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  computePullAllPlans: mocks.computePullAllPlans,
  writePullPlan: mocks.writePullPlan,
}));

import { pullAllVercelDeployments } from "../pull-all.mjs";

const projects = [
  { cwd: "/fixtures/admin", relPath: "apps/admin", label: "admin" },
  { cwd: "/fixtures/website", relPath: "apps/website", label: "website" },
];

describe("multi-project pull", () => {
  const originalDisableConvex = process.env.ENV_SYNC_DISABLE_CONVEX;
  const originalProjectCwd = process.env.ENV_SYNC_VERCEL_PROJECT_CWD;

  beforeEach(() => {
    process.env.ENV_SYNC_DISABLE_CONVEX = "1";
    process.env.ENV_SYNC_VERCEL_PROJECT_CWD = "original-project";
    mocks.checkVercelProjectLinked.mockReset().mockReturnValue({ ok: true });
    mocks.fetchVercelProjectEnvList.mockReset().mockReturnValue({
      envs: [{ key: "SHARED", target: ["development"] }],
    });
    mocks.fetchVercelEnvMapOptions.mockReset().mockImplementation(() =>
      new Map([
        ["SHARED", process.env.ENV_SYNC_VERCEL_PROJECT_CWD ?? "missing"],
      ]),
    );
    mocks.computePullAllPlans.mockReset().mockResolvedValue([]);
    mocks.writePullPlan.mockReset();
  });

  afterEach(() => {
    if (originalDisableConvex === undefined) {
      delete process.env.ENV_SYNC_DISABLE_CONVEX;
    } else {
      process.env.ENV_SYNC_DISABLE_CONVEX = originalDisableConvex;
    }
    if (originalProjectCwd === undefined) {
      delete process.env.ENV_SYNC_VERCEL_PROJECT_CWD;
    } else {
      process.env.ENV_SYNC_VERCEL_PROJECT_CWD = originalProjectCwd;
    }
  });

  it("collects every configured project in order and restores project context", async () => {
    await pullAllVercelDeployments({ projects });

    expect(mocks.fetchVercelProjectEnvList).toHaveBeenCalledTimes(2);
    expect(mocks.fetchVercelEnvMapOptions).toHaveBeenCalledTimes(2);
    const options = mocks.computePullAllPlans.mock.calls[0][0];
    expect(options.targets).toEqual(["development"]);
    expect(options.vercelMaps.get("development").get("SHARED")).toBe(
      "apps/website",
    );
    expect(process.env.ENV_SYNC_VERCEL_PROJECT_CWD).toBe("original-project");
  });

  it("refuses the whole pull when any configured project is unlinked", async () => {
    mocks.checkVercelProjectLinked
      .mockReturnValueOnce({ ok: true })
      .mockReturnValueOnce({
        ok: false,
        cwd: "/fixtures/website",
        reason: "not linked",
      });

    await expect(pullAllVercelDeployments({ projects })).rejects.toThrow(
      /website.*not linked/u,
    );

    expect(mocks.computePullAllPlans).not.toHaveBeenCalled();
    expect(mocks.writePullPlan).not.toHaveBeenCalled();
    expect(process.env.ENV_SYNC_VERCEL_PROJECT_CWD).toBe("original-project");
  });

  it("reports the failing project without writing a partial snapshot", async () => {
    mocks.fetchVercelEnvMapOptions
      .mockReturnValueOnce(new Map([["ADMIN_ONLY", "1"]]))
      .mockImplementationOnce(() => {
        throw new Error("fetch failed");
      });

    await expect(pullAllVercelDeployments({ projects })).rejects.toThrow(
      /website.*fetch failed/u,
    );

    expect(mocks.computePullAllPlans).not.toHaveBeenCalled();
    expect(mocks.writePullPlan).not.toHaveBeenCalled();
    expect(process.env.ENV_SYNC_VERCEL_PROJECT_CWD).toBe("original-project");
  });
});
