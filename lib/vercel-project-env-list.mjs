/**
 * Project-wide Vercel environment variable inventory (`vercel env list --format json`).
 */
import { runVercel } from "./remote.mjs";

/** @typedef {"development" | "preview" | "production"} TVercelEnvironmentName */

/** Canonical Vercel deployment target order for prompts, pulls, and snapshots. */
export const VERCEL_DEPLOYMENT_TARGET_ORDER = Object.freeze([
  "development",
  "preview",
  "production",
]);

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
 * @returns {{ envs: Array<{ key: string; target?: string[] }> }}
 */
export function fetchVercelProjectEnvList() {
  const r = runVercel(["env", "list", "--format", "json"]);
  if (!r.ok) {
    throw new Error(
      `vercel env list --format json failed (${r.status}):\n${r.stderr || r.stdout}`
    );
  }
  const data = parseVercelJsonStdout(r.stdout);
  if (!data || typeof data !== "object" || !Array.isArray(data.envs)) {
    throw new Error("Unexpected vercel env list JSON shape (expected { envs: [...] }).");
  }
  return data;
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
  return /** @type {TVercelEnvironmentName[]} */ (
    VERCEL_DEPLOYMENT_TARGET_ORDER.filter((name) => set.has(name))
  );
}
