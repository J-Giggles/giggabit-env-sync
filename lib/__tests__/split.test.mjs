import { describe, expect, it } from "vitest";

import { filterForVercel } from "../split.mjs";

describe("Vercel env split", () => {
  it("omits empty values so check matches push behavior", () => {
    const filtered = filterForVercel(
      new Map([
        ["DATABASE_URL", "postgres://example"],
        ["SKIP_ENV_VALIDATION", ""],
      ]),
    );

    expect(filtered.has("DATABASE_URL")).toBe(true);
    expect(filtered.has("SKIP_ENV_VALIDATION")).toBe(false);
  });
});
