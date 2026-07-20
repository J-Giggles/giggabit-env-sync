import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

describe("env-sync cache paths", () => {
  it("uses a cache directory that is not nested below the root .env file", async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-sync-paths-"));
    const fixtureRoot = path.join(testDir, "repo");
    const fixtureLib = path.join(fixtureRoot, "scripts", "giggabit-env-sync", "lib");
    fs.mkdirSync(fixtureLib, { recursive: true });
    fs.copyFileSync(
      fileURLToPath(new URL("../paths.mjs", import.meta.url)),
      path.join(fixtureLib, "paths.mjs")
    );

    const REPO_ROOT = fixtureRoot;
    const envPath = path.join(REPO_ROOT, ".env");

    try {
      fs.writeFileSync(envPath, "EXAMPLE=1\n");
      const fixtureUrl = pathToFileURL(path.join(fixtureLib, "paths.mjs"));
      fixtureUrl.search = "?env-file-fallback";
      const { SYNC_DIR } = await import(fixtureUrl.href);

      expect(SYNC_DIR).toBe(path.join(REPO_ROOT, ".env.sync-cache"));
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("uses .env/sync when the root .env path is not a file", async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-sync-paths-"));
    const fixtureRoot = path.join(testDir, "repo");
    const fixtureLib = path.join(fixtureRoot, "scripts", "giggabit-env-sync", "lib");
    fs.mkdirSync(fixtureLib, { recursive: true });
    fs.copyFileSync(
      fileURLToPath(new URL("../paths.mjs", import.meta.url)),
      path.join(fixtureLib, "paths.mjs")
    );

    try {
      fs.mkdirSync(path.join(fixtureRoot, ".env"));
      const fixtureUrl = pathToFileURL(path.join(fixtureLib, "paths.mjs"));
      fixtureUrl.search = "?env-directory-fallback";
      const { SYNC_DIR } = await import(fixtureUrl.href);

      expect(SYNC_DIR).toBe(path.join(fixtureRoot, ".env", "sync"));
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
