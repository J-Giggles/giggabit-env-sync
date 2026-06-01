/**
 * Project-wide Vercel environment variable inventory (`vercel env list --format json`
 * or REST API fallback).
 */
import { syncInfo } from "./cli-style.mjs";
import { runVercel } from "./remote.mjs";
import { listProjectEnvRows } from "./vercel-env-api.mjs";

/** @typedef {"development" | "preview" | "production"} TVercelEnvironmentName */

/**
 * Parse JSON from CLI output (strip leading status lines like "Retrieving project…").
 *
 * @param {string} stdout
 */
export function parseVercelJsonStdout(stdout) {
  const i = stdout.indexOf("{");
  if (i < 0) {
    throw new Error("No JSON object found in Vercel CLI output.");
  }
  return JSON.parse(stdout.slice(i));
}

/**
 * @param {{ ok: boolean; stdout: string }} r
 * @returns {boolean}
 */
function cliListLooksUsable(r) {
  return r.ok && r.stdout.includes("{") && r.stdout.includes('"envs"');
}

/**
 * @returns {Promise<{ envs: Array<{ key: string; target?: string[] }> }>}
 */
export async function fetchVercelProjectEnvList() {
  const r = runVercel(["env", "list", "--format", "json"]);
  if (cliListLooksUsable(r)) {
    try {
      const data = parseVercelJsonStdout(r.stdout);
      if (data && typeof data === "object" && Array.isArray(data.envs)) {
        return data;
      }
    } catch {
      /* fall through to API */
    }
  }

  syncInfo(
    "Vercel CLI env list unavailable — using REST API (same team as ENV_SYNC_VERCEL_TEAM_ID / .vercel/project.json)."
  );
  const api = await listProjectEnvRows();
  if (!api.ok) {
    const cliHint = r.stdout.trim() || r.stderr.trim() || "(no CLI output)";
    throw new Error(
      `Could not list Vercel project env vars.\n` +
        `  API HTTP ${api.status}: ${api.body.slice(0, 500)}\n` +
        `  CLI: ${cliHint}\n` +
        `  Tip: use a VERCEL_TOKEN for team ${process.env.ENV_SYNC_VERCEL_TEAM_ID ?? "in giggabit-env-sync.repo.json"} (not another team's default).`
    );
  }
  return {
    envs: api.envs.map((e) => ({
      key: e.key,
      target: [...e.target],
    })),
  };
}

/**
 * Union of deployment targets referenced by any variable (subset of Vercel env names).
 *
 * @param {Array<{ target?: string[] }>} envs
 * @returns {TVercelEnvironmentName[]}
 */
export function distinctVercelDeploymentTargets(envs) {
  /** @type {Set<string>} */
  const set = new Set();
  for (const e of envs) {
    for (const t of e.target ?? []) {
      set.add(t);
    }
  }
  const order = ["development", "preview", "production"];
  return /** @type {TVercelEnvironmentName[]} */ (
    order.filter((name) => set.has(name))
  );
}
