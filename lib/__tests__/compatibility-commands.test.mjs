import { describe, expect, it } from "vitest";

import { createCliFixture, runCli } from "./helpers/cli-fixture.mjs";

describe("public compatibility commands", () => {
  it("auth-check refuses a missing token without exposing values", () => {
    const fixture = createCliFixture();
    fixture.writeJson("giggabit-env-sync.repo.json", {
      vercelTeamId: "team_expected",
      vercelTeamSlug: "expected-team",
    });
    fixture.writeJson("apps/admin/.vercel/project.json", {
      projectId: "project_fixture",
      orgId: "team_expected",
      projectName: "fixture-admin",
    });

    try {
      const result = runCli(fixture, ["auth-check"], {
        ENV_SYNC_VERCEL_PROJECT_CWD: "apps/admin",
        COMPAT_SENTINEL_SECRET: "must-not-appear",
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Vercel auth check");
      expect(result.stdout).toContain("No secret values are printed");
      expect(result.stdout).toContain("VERCEL_TOKEN: not set");
      expect(`${result.stdout}${result.stderr}`).not.toContain("must-not-appear");
    } finally {
      fixture.cleanup();
    }
  });

  it("auth-check verifies project read access without printing the token", () => {
    const fixture = createCliFixture();
    fixture.writeJson("giggabit-env-sync.repo.json", {
      vercelTeamId: "team_expected",
      vercelTeamSlug: "expected-team",
    });
    fixture.writeJson("apps/admin/.vercel/project.json", {
      projectId: "project_fixture",
      orgId: "team_expected",
      projectName: "fixture-admin",
    });
    const preloadPath = fixture.writeFile(
      "fake-vercel-fetch.mjs",
      `globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes("/v2/user")) {
    return new Response(JSON.stringify({ user: { defaultTeamId: "team_expected", email: "fixture@example.invalid" } }), { status: 200 });
  }
  if (url.includes("/v9/projects")) {
    return new Response(JSON.stringify({ projects: [{ id: "project_fixture" }] }), { status: 200 });
  }
  if (url.includes("/v10/projects/project_fixture/env")) {
    return new Response(JSON.stringify({ envs: [{ id: "env_fixture", key: "SAFE_NAME", type: "plain", target: ["development"] }] }), { status: 200 });
  }
  throw new Error("Unexpected fake Vercel URL: " + url);
};
`,
    );

    try {
      const result = runCli(fixture, ["auth-check"], {
        ENV_SYNC_VERCEL_PROJECT_CWD: "apps/admin",
        VERCEL_TOKEN: "sentinel-secret-value",
        NODE_OPTIONS: `--import=${preloadPath}`,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Project env API");
      expect(result.stdout).toContain("OK");
      expect(result.stdout).toContain("1 variable(s)");
      expect(`${result.stdout}${result.stderr}`).not.toContain(
        "sentinel-secret-value",
      );
    } finally {
      fixture.cleanup();
    }
  });
});
