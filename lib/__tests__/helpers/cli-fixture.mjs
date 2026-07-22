import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_SOURCE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function createCliFixture() {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-sync-compat-"));
  const repoRoot = path.join(testDir, "repo");
  const toolRoot = path.join(repoRoot, "scripts", "giggabit-env-sync");
  fs.mkdirSync(path.dirname(toolRoot), { recursive: true });
  fs.cpSync(TOOL_SOURCE_ROOT, toolRoot, {
    recursive: true,
    filter(source) {
      return ![".git", "node_modules"].includes(path.basename(source));
    },
  });

  return {
    repoRoot,
    toolRoot,
    cleanup() {
      fs.rmSync(testDir, { recursive: true, force: true });
    },
    writeFile(relativePath, content, options) {
      const absolutePath = path.join(repoRoot, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content, options);
      return absolutePath;
    },
    writeJson(relativePath, value) {
      const absolutePath = path.join(repoRoot, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
    },
  };
}

export function runCli(fixture, args, env = {}) {
  return spawnSync(process.execPath, [path.join(fixture.toolRoot, "run.mjs"), ...args], {
    cwd: fixture.repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: path.join(fixture.repoRoot, ".home"),
      NO_COLOR: "1",
      ENV_SYNC_DISABLE_CONVEX: "1",
      ENV_SYNC_SKIP_UPDATE_CHECK: "1",
      ...env,
    },
  });
}
