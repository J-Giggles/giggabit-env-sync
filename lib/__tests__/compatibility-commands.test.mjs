import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { createCliFixture, runCli } from "./helpers/cli-fixture.mjs";

describe("public compatibility commands", () => {
  it("usage lists every restored public command", () => {
    const fixture = createCliFixture();

    try {
      const result = runCli(fixture, []);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("env:sync:auth-check");
      expect(result.stdout).toContain("env:sync:links -- --remote");
      expect(result.stdout).toContain("env:sync:format");
    } finally {
      fixture.cleanup();
    }
  });

  it("auth-check refuses a missing token without exposing values", () => {
    const fixture = createCliFixture();
    const originalVercelToken = process.env.VERCEL_TOKEN;
    process.env.VERCEL_TOKEN = "inherited-sentinel-token";
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
        VERCEL_TOKEN: undefined,
        COMPAT_SENTINEL_SECRET: "must-not-appear",
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("Vercel auth check");
      expect(result.stdout).toContain("No secret values are printed");
      expect(result.stdout).toContain("VERCEL_TOKEN: not set");
      expect(`${result.stdout}${result.stderr}`).not.toContain("must-not-appear");
      expect(`${result.stdout}${result.stderr}`).not.toContain(
        "inherited-sentinel-token",
      );
    } finally {
      if (originalVercelToken === undefined) {
        delete process.env.VERCEL_TOKEN;
      } else {
        process.env.VERCEL_TOKEN = originalVercelToken;
      }
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
      expect(result.stdout).toContain("fixture@example.invalid");
      expect(result.stdout).toContain("Projects visible: 1");
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

  it("links reports configured Vercel and Cloudflare deployment mappings", () => {
    const fixture = createCliFixture();
    fixture.writeJson("giggabit-env-sync.repo.json", {
      vercelTeamId: "team_expected",
      vercelTeamSlug: "expected-team",
      vercelProjects: ["apps/admin", "apps/website"],
    });
    fixture.writeJson("apps/admin/.vercel/project.json", {
      projectId: "project_admin",
      orgId: "team_expected",
      projectName: "fixture-admin",
    });
    fixture.writeJson("apps/website/.vercel/project.json", {
      projectId: "project_website",
      orgId: "team_expected",
      projectName: "fixture-website",
    });
    fixture.writeFile(
      "apps/api/wrangler.toml",
      `name = "fixture-api"
account_id = "account_fixture"

[env.staging]
name = "fixture-api-staging"
`,
    );

    try {
      const result = runCli(fixture, ["links"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Deployment links");
      expect(result.stdout).toContain("apps/admin");
      expect(result.stdout).toContain("fixture-admin");
      expect(result.stdout).toContain("apps/website");
      expect(result.stdout).toContain("fixture-website");
      expect(result.stdout).toContain("Status: all configured apps are linked");
      expect(result.stdout).toContain("fixture-api-staging");
      expect(result.stdout).toContain(".env.sync.preview");
    } finally {
      fixture.cleanup();
    }
  });

  it("links --remote adds read-only Vercel and Cloudflare identity reports", () => {
    const fixture = createCliFixture();
    fixture.writeJson("giggabit-env-sync.repo.json", {
      vercelTeamId: "team_expected",
      vercelTeamSlug: "expected-team",
    });
    fixture.writeJson("apps/admin/.vercel/project.json", {
      projectId: "project_admin",
      orgId: "team_expected",
      projectName: "fixture-admin",
    });
    fixture.writeFile(
      "apps/api/wrangler.toml",
      `name = "fixture-api"

[env.staging]
name = "fixture-api-staging"
`,
    );
    const fakeBin = fixture.writeFile(
      "fake-bin/vercel",
      "#!/bin/sh\nprintf '%s\\n' 'fixture-project-list'\n",
      { mode: 0o755 },
    );
    fixture.writeFile(
      "fake-bin/pnpm",
      "#!/bin/sh\nprintf '%s\\n' 'fixture-wrangler-identity'\n",
      { mode: 0o755 },
    );

    try {
      const result = runCli(fixture, ["links", "--remote"], {
        ENV_SYNC_VERCEL_PROJECT_CWD: "apps/admin",
        VERCEL_TOKEN: "sentinel-vercel-token",
        CLOUDFLARE_API_TOKEN: "sentinel-cloudflare-token",
        PATH: `${fakeBin.slice(0, fakeBin.lastIndexOf("/"))}:${process.env.PATH}`,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Remote · vercel project ls");
      expect(result.stdout).toContain("fixture-project-list");
      expect(result.stdout).toContain("Remote · wrangler whoami");
      expect(result.stdout).toContain("fixture-wrangler-identity");
      expect(`${result.stdout}${result.stderr}`).not.toContain(
        "sentinel-vercel-token",
      );
      expect(`${result.stdout}${result.stderr}`).not.toContain(
        "sentinel-cloudflare-token",
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("format rewrites existing env files to the example layout", () => {
    const fixture = createCliFixture();
    fixture.writeFile(
      ".env.example",
      `# Fixture layout
SECOND=
FIRST=
`,
    );
    fixture.writeFile(
      ".env.local",
      `FIRST=one
EXTRA=extra
SECOND=two
VERCEL_OIDC_TOKEN=ephemeral-value
`,
    );

    try {
      const result = runCli(fixture, ["format", "dev"]);
      const content = readFileSync(`${fixture.repoRoot}/.env.local`, "utf8");

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Done: 1 rewritten");
      expect(content).toMatch(/^# Fixture layout\nSECOND=two\nFIRST=one\n/u);
      expect(content.indexOf("EXTRA=extra")).toBeGreaterThan(
        content.indexOf("FIRST=one"),
      );
      expect(content).not.toContain("VERCEL_OIDC_TOKEN");
    } finally {
      fixture.cleanup();
    }
  });

  it("format uses a target-specific template without a shared fallback", () => {
    const fixture = createCliFixture();
    fixture.writeFile(
      ".env.preview.example",
      `# Preview layout
SECOND=
FIRST=
`,
    );
    const envPath = fixture.writeFile(
      ".env.preview",
      `FIRST=one
SECOND=two
`,
    );

    try {
      const result = runCli(fixture, ["format", "preview"]);
      const content = readFileSync(envPath, "utf8");

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("← .env.preview.example");
      expect(content).toMatch(/^# Preview layout\nSECOND=two\nFIRST=one\n/u);
    } finally {
      fixture.cleanup();
    }
  });

  it("format dry-run prefers the target template without mutating the file", () => {
    const fixture = createCliFixture();
    fixture.writeFile(
      ".env.example",
      `# Shared layout
FIRST=
SECOND=
`,
    );
    fixture.writeFile(
      ".env.preview.example",
      `# Preview layout
SECOND=
FIRST=
`,
    );
    const envPath = fixture.writeFile(
      ".env.preview",
      `FIRST=one
SECOND=two
`,
    );
    const before = readFileSync(envPath);

    try {
      const result = runCli(fixture, ["format", "preview", "--dry-run"]);
      const after = readFileSync(envPath);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "Reformat env files (resolved target-specific/shared template layout)",
      );
      expect(result.stdout).toContain("dry-run ← .env.preview.example");
      expect(after.equals(before)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("format refuses safely when no candidate has an applicable template", () => {
    const fixture = createCliFixture();
    const envPath = fixture.writeFile(".env.preview", "FIRST=one\n");
    const before = readFileSync(envPath);

    try {
      const result = runCli(fixture, ["format", "preview"]);
      const after = readFileSync(envPath);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("skipped (no template for preview");
      expect(after.equals(before)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it("format --dry-run reports changes without mutating env files", () => {
    const fixture = createCliFixture();
    fixture.writeFile(
      ".env.example",
      `# Fixture layout
SECOND=
FIRST=
`,
    );
    const envPath = fixture.writeFile(
      ".env.local",
      `FIRST=one
SECOND=two
`,
    );
    const before = readFileSync(envPath);

    try {
      const result = runCli(fixture, ["format", "--dry-run"]);
      const after = readFileSync(envPath);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Dry run: 1 file(s) would change");
      expect(after.equals(before)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });
});
