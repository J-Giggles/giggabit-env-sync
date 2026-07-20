import { describe, expect, it } from "vitest";

import {
  filterForVercel,
  filterMergedForLocalWorkspace,
} from "../split.mjs";

describe("Vercel env split", () => {
  it("omits empty values so check matches push behavior", () => {
    const filtered = filterForVercel(
      new Map([
        ["DATABASE_URL", "postgres://example"],
        ["SKIP_ENV_VALIDATION", ""],
        ["WHITESPACE_ONLY", "   "],
      ]),
    );

    expect(filtered.has("DATABASE_URL")).toBe(true);
    expect(filtered.has("SKIP_ENV_VALIDATION")).toBe(false);
    expect(filtered.has("WHITESPACE_ONLY")).toBe(false);
  });

  it("removes every Convex key from local output when Convex is disabled", () => {
    const prior = process.env.ENV_SYNC_DISABLE_CONVEX;
    process.env.ENV_SYNC_DISABLE_CONVEX = "1";

    try {
      const filtered = filterMergedForLocalWorkspace(
        new Map([
          ["DATABASE_URL", "postgres://example"],
          ["CONVEX_DEPLOYMENT", "dev:example"],
          ["CONVEX_DEPLOY_KEY", "test-deploy-key"],
          ["CONVEX_SELF_HOSTED_ADMIN_KEY", "test-admin-key"],
          ["CONVEX_URL", "https://example.convex.cloud"],
          ["NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud"],
        ]),
      );

      expect([...filtered.keys()]).toEqual(["DATABASE_URL"]);
    } finally {
      if (prior === undefined) {
        delete process.env.ENV_SYNC_DISABLE_CONVEX;
      } else {
        process.env.ENV_SYNC_DISABLE_CONVEX = prior;
      }
    }
  });
});
