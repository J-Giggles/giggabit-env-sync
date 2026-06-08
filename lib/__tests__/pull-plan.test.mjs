import { describe, expect, it } from "vitest";

import { mergeVercelProjectMaps } from "../pull-plan.mjs";

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
});
