/**
 * Compare vendored tool pin (`UPSTREAM.json`) to remote hub branch.
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncError, syncInfo, syncWarn } from "./cli-style.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = path.resolve(__dirname, "..");
const UPSTREAM_FILE = path.join(TOOL_ROOT, "UPSTREAM.json");
const VERSION_FILE = path.join(TOOL_ROOT, "VERSION");

/**
 * @returns {string}
 */
export function readToolVersion() {
  try {
    return fs.readFileSync(VERSION_FILE, "utf8").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * @returns {{ repo: string; branch: string; commit: string } | null}
 */
function readUpstreamPin() {
  if (!fs.existsSync(UPSTREAM_FILE)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(UPSTREAM_FILE, "utf8"));
    const repo = typeof j.repo === "string" ? j.repo.trim() : "";
    const branch = typeof j.branch === "string" ? j.branch.trim() : "master";
    const commit = typeof j.commit === "string" ? j.commit.trim() : "";
    if (!repo || !commit) return null;
    return { repo, branch, commit };
  } catch {
    return null;
  }
}

/**
 * @param {string} repo — `owner/name`
 * @param {string} branch
 * @returns {string | null}
 */
function fetchRemoteCommit(repo, branch) {
  const url = `https://github.com/${repo}.git`;
  try {
    const out = execSync(`git ls-remote "${url}" "refs/heads/${branch}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    }).trim();
    const sha = out.split(/\s+/)[0];
    return sha && /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ strict?: boolean }} [opts]
 * @returns {Promise<boolean>} `true` when up to date or check skipped
 */
export async function assertToolUpToDate(opts = {}) {
  const skip =
    process.env.ENV_SYNC_SKIP_UPDATE_CHECK?.trim().toLowerCase() === "1" ||
    process.env.ENV_SYNC_SKIP_UPDATE_CHECK?.trim().toLowerCase() === "true" ||
    process.env.ENV_SYNC_SKIP_UPDATE_CHECK?.trim().toLowerCase() === "yes";
  if (skip) {
    syncInfo("Skipping upstream tool check (ENV_SYNC_SKIP_UPDATE_CHECK).");
    return true;
  }

  const pin = readUpstreamPin();
  const version = readToolVersion();
  if (!pin) {
    syncWarn(
      `No UPSTREAM.json pin — cannot verify hub freshness (giggabit-env-sync v${version}).`
    );
    return true;
  }

  if (pin.commit === "pending-first-push") {
    syncWarn(
      `Tool pin is "${pin.commit}" — run env:sync:tool-update after the hub repo is published.`
    );
    return !opts.strict;
  }

  const remote = fetchRemoteCommit(pin.repo, pin.branch);
  if (!remote) {
    syncWarn(
      `Could not reach ${pin.repo}@${pin.branch} (offline or repo renamed?). Continuing.`
    );
    return true;
  }

  if (remote === pin.commit) {
    syncInfo(
      `Tool up to date — giggabit-env-sync v${version} (${pin.commit.slice(0, 12)}…).`
    );
    return true;
  }

  syncError(
    `giggabit-env-sync is out of date.\n` +
      `  Installed: ${pin.commit.slice(0, 12)}…\n` +
      `  Remote ${pin.repo}@${pin.branch}: ${remote.slice(0, 12)}…\n` +
      `  Run: pnpm run env:sync:tool-update`
  );
  return false;
}

/**
 * Print pin status only (for `tool-check`).
 */
export async function runToolCheck() {
  const version = readToolVersion();
  const pin = readUpstreamPin();
  syncInfo(`giggabit-env-sync version ${version}`);
  if (!pin) {
    syncWarn("Missing or invalid UPSTREAM.json.");
    process.exitCode = 1;
    return;
  }
  syncInfo(`Pinned: ${pin.repo}@${pin.branch} → ${pin.commit.slice(0, 12)}…`);
  const ok = await assertToolUpToDate({ strict: true });
  process.exitCode = ok ? 0 : 1;
}
