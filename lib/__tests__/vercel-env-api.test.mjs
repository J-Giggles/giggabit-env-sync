import { afterEach, describe, expect, it } from "vitest";

import { upsertVercelEnv } from "../vercel-env-api.mjs";

describe("Vercel env API retries", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.VERCEL_TOKEN;
  const originalProjectCwd = process.env.ENV_SYNC_VERCEL_PROJECT_CWD;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.VERCEL_TOKEN;
    } else {
      process.env.VERCEL_TOKEN = originalToken;
    }
    if (originalProjectCwd === undefined) {
      delete process.env.ENV_SYNC_VERCEL_PROJECT_CWD;
    } else {
      process.env.ENV_SYNC_VERCEL_PROJECT_CWD = originalProjectCwd;
    }
  });

  it("retries Vercel envs_ongoing_update conflicts", async () => {
    process.env.VERCEL_TOKEN = "test-token";
    process.env.ENV_SYNC_VERCEL_PROJECT_CWD = "apps/admin";
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: "envs_ongoing_update",
              message:
                "Unable to save environment variables because an ongoing environment variable update is already ongoing.",
            },
          }),
          { status: 400 },
        );
      }
      return new Response("{}", { status: 200 });
    };

    const result = await upsertVercelEnv({
      key: "EMAIL_RETURN_REMINDER_ENABLED",
      value: "true",
      type: "plain",
      target: "preview",
    });

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });
});
