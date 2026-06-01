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
 * @param {string} sha
 * @returns {string | null}
 */
function normalizeCommitSha(sha) {
  return typeof sha === "string" && /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null;
}

/**
 * @param {string} repo — `owner/name`
 * @param {string} branch
 * @returns {{ sha: string | null; detail?: string }}
 */
function fetchRemoteCommitViaGit(repo, branch) {
  const url = `https://github.com/${repo}.git`;
  try {
    const out = execSync(`git ls-remote "${url}" "refs/heads/${branch}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).trim();
    const sha = normalizeCommitSha(out.split(/\s+/)[0]);
    return sha ? { sha } : { sha: null, detail: "git ls-remote returned no ref" };
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err && typeof err.stderr === "string"
        ? err.stderr.trim()
        : "";
    const msg = err instanceof Error ? err.message : String(err);
    return {
      sha: null,
      detail: stderr || msg || "git ls-remote failed",
    };
  }
}

/**
 * GitHub REST fallback when `git` is missing, blocked, or offline for `git ls-remote` only.
 *
 * @param {string} repo — `owner/name`
 * @param {string} branch
 * @returns {Promise<{ sha: string | null; detail?: string }>}
 */
async function fetchRemoteCommitViaGithubApi(repo, branch) {
  const parts = repo.split("/").filter(Boolean);
  if (parts.length !== 2) {
    return { sha: null, detail: "invalid repo slug" };
  }
  const [owner, name] = parts;
  const ref = encodeURIComponent(`heads/${branch}`);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${name}/git/ref/${ref}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "giggabit-env-sync",
        },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) {
      return {
        sha: null,
        detail: `GitHub API ${res.status} for ${repo}@${branch}`,
      };
    }
    const body = await res.json();
    const sha = normalizeCommitSha(body?.object?.sha);
    return sha ? { sha } : { sha: null, detail: "GitHub API ref had no commit sha" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { sha: null, detail: msg || "GitHub API request failed" };
  }
}

/**
 * @param {string} repo — `owner/name`
 * @param {string} branch
 * @returns {Promise<{ sha: string | null; detail?: string }>}
 */
async function fetchRemoteCommit(repo, branch) {
  const git = fetchRemoteCommitViaGit(repo, branch);
  if (git.sha) return git;

  const api = await fetchRemoteCommitViaGithubApi(repo, branch);
  if (api.sha) return api;

  return {
    sha: null,
    detail: [git.detail, api.detail].filter(Boolean).join("; ") || undefined,
  };
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

  const { sha: remote, detail } = await fetchRemoteCommit(pin.repo, pin.branch);
  if (!remote) {
    const hint =
      `Could not reach ${pin.repo}@${pin.branch}. ` +
      `Check network, repo visibility, and that \`git\` is on PATH. ` +
      `Or set ENV_SYNC_SKIP_UPDATE_CHECK=1 to skip.`;
    const detailSuffix = detail ? ` (${detail})` : "";
    if (opts.strict) {
      syncError(`${hint}${detailSuffix}`);
      return false;
    }
    syncWarn(`${hint} Continuing.${detailSuffix}`);
    return true;
  }

  const pinned = normalizeCommitSha(pin.commit);
  if (remote === pinned) {
    syncInfo(
      `Tool up to date — giggabit-env-sync v${version} (${(pinned ?? pin.commit).slice(0, 12)}…).`
    );
    return true;
  }

  syncError(
    `giggabit-env-sync is out of date.\n` +
      `  Installed: ${(pinned ?? pin.commit).slice(0, 12)}…\n` +
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
