/**
 * Per-repo policy from `giggabit-env-sync.repo.json` at the app repo root.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.mjs";

const CONFIG_FILE = path.join(REPO_ROOT, "giggabit-env-sync.repo.json");

/** @type {import("./repo-config.mjs").TRepoConfig | null} */
let cached = null;

/**
 * @typedef {{
 *   vercelTeamId?: string;
 *   vercelTeamSlug?: string;
 *   vercelProjects?: string[];
 *   disableConvex?: boolean;
 *   previewBranch?: string;
 *   extraNeverConvexKeys?: string[];
 * }} TRepoConfig
 */

/**
 * @returns {TRepoConfig | null}
 */
export function readRepoConfig() {
  if (cached !== null) return cached;
  if (!fs.existsSync(CONFIG_FILE)) {
    cached = null;
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (!raw || typeof raw !== "object") {
      cached = null;
      return null;
    }
    cached = /** @type {TRepoConfig} */ (raw);
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

/**
 * Apply repo config defaults to `process.env` when env vars are unset.
 */
export function applyRepoConfig() {
  const cfg = readRepoConfig();
  if (!cfg) return;

  if (
    cfg.disableConvex &&
    !process.env.ENV_SYNC_DISABLE_CONVEX?.trim()
  ) {
    process.env.ENV_SYNC_DISABLE_CONVEX = "1";
  }

  if (
    cfg.vercelProjects?.length &&
    !process.env.ENV_SYNC_VERCEL_PROJECTS?.trim()
  ) {
    process.env.ENV_SYNC_VERCEL_PROJECTS = cfg.vercelProjects.join(",");
  }

  if (cfg.previewBranch && !process.env.ENV_SYNC_VERCEL_PREVIEW_BRANCH?.trim()) {
    process.env.ENV_SYNC_VERCEL_PREVIEW_BRANCH = cfg.previewBranch;
  }

  if (cfg.vercelTeamId && !process.env.ENV_SYNC_VERCEL_TEAM_ID?.trim()) {
    process.env.ENV_SYNC_VERCEL_TEAM_ID = cfg.vercelTeamId;
  }
}

/**
 * Extra Convex exclusion keys from repo config (LifePass-specific, etc.).
 *
 * @returns {readonly string[]}
 */
export function getExtraNeverConvexKeys() {
  const cfg = readRepoConfig();
  return cfg?.extraNeverConvexKeys ?? [];
}

/**
 * Expected Vercel team guard from repo config.
 *
 * @returns {{ teamId?: string; teamSlug?: string }}
 */
export function getExpectedVercelTeam() {
  const cfg = readRepoConfig();
  return {
    teamId: cfg?.vercelTeamId?.trim(),
    teamSlug: cfg?.vercelTeamSlug?.trim(),
  };
}
