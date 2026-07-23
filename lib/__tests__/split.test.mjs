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

  it("omits Turbo and Vercel-injected process keys from local output", () => {
    const filtered = filterMergedForLocalWorkspace(
      new Map([
        ["DATABASE_URL", "postgres://example"],
        ["TURBO_TEAM", "example-team"],
        ["NX_DAEMON", "true"],
      ]),
    );

    expect([...filtered.keys()]).toEqual(["DATABASE_URL"]);
  });

  const legacyAliasGroups = {
    Clerk: [
      ["CLERK_SECRET_KEY", "CLERK_ADMIN_SECRET_KEY"],
      [
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_CLERK_ADMIN_PUBLISHABLE_KEY",
      ],
      [
        "CLERK_CLIENT_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_CLERK_CLIENT_PUBLISHABLE_KEY",
      ],
      ["CUSTOMER_CLERK_SECRET_KEY", "CLERK_CLIENT_SECRET_KEY"],
      [
        "CUSTOMER_CLERK_PUBLISHABLE_KEY",
        "NEXT_PUBLIC_CLERK_CLIENT_PUBLISHABLE_KEY",
      ],
    ],
    PostHog: [
      ["NEXT_PUBLIC_POSTHOG_HOST", "NEXT_PUBLIC_ADMIN_POSTHOG_HOST"],
      ["NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_ADMIN_POSTHOG_KEY"],
    ],
    Payload: [
      ["PAYLOAD_DATABASE_URL", "BLOG_PAYLOAD_DATABASE_URL"],
      ["PAYLOAD_SECRET", "BLOG_PAYLOAD_SECRET"],
      ["PAYLOAD_URL", "NEXT_PUBLIC_BLOG_PAYLOAD_URL"],
      ["PAYLOAD_NEON_DATABASE_URL", "BLOG_PAYLOAD_DATABASE_URL"],
    ],
  };

  it.each(Object.entries(legacyAliasGroups))(
    "drops %s legacy aliases when canonical keys are present",
    (_provider, pairs) => {
      const input = new Map();
      for (const [alias, canonical] of pairs) {
        input.set(alias, `legacy:${alias}`);
        input.set(canonical, `canonical:${canonical}`);
      }

      const filtered = filterMergedForLocalWorkspace(input);

      for (const [alias, canonical] of pairs) {
        expect(filtered.has(alias)).toBe(false);
        expect(filtered.get(canonical)).toBe(`canonical:${canonical}`);
      }
    },
  );

  it.each(Object.entries(legacyAliasGroups))(
    "retains %s legacy aliases when canonical keys are absent",
    (_provider, pairs) => {
      const input = new Map(pairs.map(([alias]) => [alias, `legacy:${alias}`]));

      const filtered = filterMergedForLocalWorkspace(input);

      for (const [alias] of pairs) {
        expect(filtered.get(alias)).toBe(`legacy:${alias}`);
      }
    },
  );
});
