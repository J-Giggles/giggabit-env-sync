import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({ projectCwd: "" }));

vi.mock("../config.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  getVercelProjectCwd: () => mocks.projectCwd,
}));

import { upsertVercelEnv } from "../vercel-env-api.mjs";

describe("Vercel env API retries", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.VERCEL_TOKEN;
  const originalProjectCwd = process.env.ENV_SYNC_VERCEL_PROJECT_CWD;
  let fixtureRoot;

  beforeEach(() => {
    vi.useFakeTimers();
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "env-sync-vercel-api-"));
    mocks.projectCwd = fixtureRoot;
    const vercelDir = path.join(fixtureRoot, ".vercel");
    fs.mkdirSync(vercelDir, { recursive: true });
    fs.writeFileSync(
      path.join(vercelDir, "project.json"),
      JSON.stringify({ projectId: "test-project", orgId: "test-org" }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
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

    const pendingResult = upsertVercelEnv({
      key: "EMAIL_RETURN_REMINDER_ENABLED",
      value: "true",
      type: "plain",
      target: "preview",
    });
    await vi.runAllTimersAsync();
    const result = await pendingResult;

    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("uses exponential ongoing-update retry backoff with deterministic bounded jitter", async () => {
    process.env.VERCEL_TOKEN = "test-token";
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls <= 3) {
        return new Response(
          JSON.stringify({ error: { code: "envs_ongoing_update" } }),
          { status: 400 },
        );
      }
      return new Response("{}", { status: 200 });
    };

    const pendingResult = upsertVercelEnv({
      key: "EMAIL_RETURN_REMINDER_ENABLED",
      value: "true",
      type: "plain",
      target: "preview",
    });

    await vi.advanceTimersByTimeAsync(299);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);

    await vi.advanceTimersByTimeAsync(549);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(3);

    await vi.advanceTimersByTimeAsync(1_049);
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pendingResult;

    expect(result.ok).toBe(true);
    expect(calls).toBe(4);
    expect(random).toHaveBeenCalledTimes(3);
  });

  it("caps ongoing-update retry jitter at 100 milliseconds", async () => {
    process.env.VERCEL_TOKEN = "test-token";
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ error: { code: "envs_ongoing_update" } }),
        { status: 400 },
      );
    };

    const pendingResult = upsertVercelEnv({
      key: "EMAIL_RETURN_REMINDER_ENABLED",
      value: "true",
      type: "plain",
      target: "preview",
    });

    await vi.advanceTimersByTimeAsync(349);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    await vi.runAllTimersAsync();
    const result = await pendingResult;

    expect(result.ok).toBe(false);
    expect(calls).toBe(6);
  });

  it("stops retrying an ongoing-update conflict after the bounded attempt count", async () => {
    process.env.VERCEL_TOKEN = "test-token";
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          error: {
            code: "envs_ongoing_update",
            message: "An environment variable update is already ongoing.",
          },
        }),
        { status: 400 },
      );
    };

    const pendingResult = upsertVercelEnv({
      key: "EMAIL_RETURN_REMINDER_ENABLED",
      value: "true",
      type: "plain",
      target: "preview",
    });
    await vi.runAllTimersAsync();
    const result = await pendingResult;

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(calls).toBe(6);
  });

  it("uses exponential backoff for transient network failures", async () => {
    process.env.VERCEL_TOKEN = "test-token";
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls <= 3) {
        throw new TypeError("fetch failed");
      }
      return new Response("{}", { status: 200 });
    };

    const pendingResult = upsertVercelEnv({
      key: "EMAIL_RETURN_REMINDER_ENABLED",
      value: "true",
      type: "plain",
      target: "preview",
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(1);

    const result = await pendingResult;
    expect(result.ok).toBe(true);
    expect(calls).toBe(4);
  });

  it("does not retry a permanent client error", async () => {
    process.env.VERCEL_TOKEN = "test-token";
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ error: { code: "invalid_request" } }),
        { status: 400 },
      );
    };

    const result = await upsertVercelEnv({
      key: "EMAIL_RETURN_REMINDER_ENABLED",
      value: "true",
      type: "plain",
      target: "preview",
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(calls).toBe(1);
  });
});
