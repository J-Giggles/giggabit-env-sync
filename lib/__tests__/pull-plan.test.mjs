import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchVercelEnvMapOptions: vi.fn(),
  fetchVercelProjectEnvList: vi.fn(),
}));

vi.mock("../config.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  isConvexEnabled: () => false,
}));

vi.mock("../remote.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchVercelEnvMapOptions: mocks.fetchVercelEnvMapOptions,
}));

vi.mock("../vercel-project-env-list.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchVercelProjectEnvList: mocks.fetchVercelProjectEnvList,
}));

import {
  computePullAllPlans,
  mergeVercelProjectMaps,
} from "../pull-plan.mjs";

beforeEach(() => {
  mocks.fetchVercelEnvMapOptions.mockReset().mockImplementation(
    (target) => new Map([[`${target.toUpperCase()}_ONLY`, "1"]]),
  );
  mocks.fetchVercelProjectEnvList.mockReset();
});

describe("pull plan project map merging", () => {
  it("merges multiple Vercel project maps into one global map", () => {
    const merged = mergeVercelProjectMaps([
      new Map([
        ["SHARED", "admin"],
        ["ADMIN_ONLY", "1"],
      ]),
      new Map([
        ["SHARED", "website"],
        ["WEBSITE_ONLY", "1"],
      ]),
    ]);

    expect([...merged.entries()]).toEqual([
      ["SHARED", "website"],
      ["ADMIN_ONLY", "1"],
      ["WEBSITE_ONLY", "1"],
    ]);
  });

  it("resolves only explicitly requested deployment targets", async () => {
    const plans = await computePullAllPlans({ targets: ["preview"] });

    expect(mocks.fetchVercelProjectEnvList).not.toHaveBeenCalled();
    expect(mocks.fetchVercelEnvMapOptions).toHaveBeenCalledTimes(1);
    expect(mocks.fetchVercelEnvMapOptions).toHaveBeenCalledWith("preview");
    expect(plans).toHaveLength(1);
    expect(plans[0].envName).toBe("preview");
    expect([...plans[0].vercelMap.entries()]).toEqual([["PREVIEW_ONLY", "1"]]);
  });
});
