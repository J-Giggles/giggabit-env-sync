import { describe, expect, it } from "vitest";

import { buildMergedSnapshotBody } from "../pull.mjs";

describe("pull snapshots", () => {
  it("formats merged snapshots with the env example layout", () => {
    const merged = new Map([
      ["EXTRA_KEY", "extra"],
      ["DATABASE_URL", "postgres://example"],
      ["NEXT_PUBLIC_APP_URL", "https://example.com"],
    ]);
    const template = [
      "# Public",
      "NEXT_PUBLIC_APP_URL=",
      "",
      "# Database",
      "DATABASE_URL=",
      "",
    ].join("\n");

    expect(buildMergedSnapshotBody(merged, template)).toBe(
      [
        "# Public",
        "NEXT_PUBLIC_APP_URL=https://example.com",
        "",
        "# Database",
        "DATABASE_URL=postgres://example",
        "",
        "",
        "# -----------------------------------------------------------------------------",
        "# Additional variables (synced from Convex / Vercel; not in env template)",
        "# -----------------------------------------------------------------------------",
        "EXTRA_KEY=extra",
        "",
      ].join("\n"),
    );
  });
});
