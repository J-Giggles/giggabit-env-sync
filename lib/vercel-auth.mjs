/**
 * Per-repo Vercel identity guard (after token resolution).
 */
import { getExpectedVercelTeam } from "./repo-config.mjs";
import { listProjectEnvRows, readVercelProjectLink } from "./vercel-env-api.mjs";
import { resolveVercelToken } from "./vercel-token.mjs";
import { readRepoConfig } from "./repo-config.mjs";
import { getVercelProjectLabel } from "./config.mjs";
import { syncInfo } from "./cli-style.mjs";

/**
 * @param {string} token
 * @returns {Promise<{ defaultTeamId?: string } | null>}
 */
async function fetchVercelUser(token) {
  try {
    const res = await fetch("https://api.vercel.com/v2/user", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const j = await res.json();
    const user = j?.user;
    if (!user || typeof user !== "object") return null;
    return {
      defaultTeamId:
        typeof user.defaultTeamId === "string" ? user.defaultTeamId : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Ensure token exists and matches repo `giggabit-env-sync.repo.json` team when configured.
 */
export async function assertVercelAuthForRepo() {
  const { teamId, teamSlug } = getExpectedVercelTeam();
  const token = resolveVercelToken();

  if (!token) {
    const cfg = readRepoConfig();
    if (cfg?.vercelTeamId || cfg?.vercelTeamSlug) {
      throw new Error(
        "[giggabit-env-sync] No Vercel token for this repo. Set VERCEL_TOKEN in root .env.local " +
          "or ENV_SYNC_VERCEL_AUTH_FILE (e.g. .env/sync/vercel.auth.json, or .env.sync-cache/vercel.auth.json when root .env is a file). " +
          "Global `vercel login` is disabled when giggabit-env-sync.repo.json defines a team guard " +
          "unless ENV_SYNC_ALLOW_GLOBAL_VERCEL_AUTH=1."
      );
    }
    return;
  }

  process.env.VERCEL_TOKEN = token;

  if (!teamId && !teamSlug) return;

  const link = readVercelProjectLink();
  if (teamId && link?.orgId && link.orgId !== teamId) {
    throw new Error(
      `[giggabit-env-sync] Linked Vercel project team (${link.orgId}) does not match ` +
        `giggabit-env-sync.repo.json vercelTeamId (${teamId}). Run vercel link in the correct team scope.`
    );
  }

  if (teamId) {
    const user = await fetchVercelUser(token);
    if (user?.defaultTeamId && user.defaultTeamId !== teamId) {
      syncInfo(
        `Vercel token default team is ${user.defaultTeamId}; repo expects ${teamId}. Using ENV_SYNC_VERCEL_TEAM_ID for API calls.`
      );
    }
  }

  if (teamSlug) {
    syncInfo(
      `Vercel auth: using token for repo team (${teamSlug}${teamId ? ` / ${teamId}` : ""}).`
    );
  }
}

/**
 * Print non-mutating Vercel auth diagnostics without exposing token values.
 */
export async function runVercelAuthCheck() {
  const { teamId, teamSlug } = getExpectedVercelTeam();
  const token = resolveVercelToken();
  const link = readVercelProjectLink();

  console.log("Vercel auth check");
  console.log("No secret values are printed.");
  console.log("");

  if (!token) {
    console.log("Result");
    console.log("");
    console.log("  VERCEL_TOKEN: not set");
    console.log("  Fix: add VERCEL_TOKEN to root .env.local");
    process.exitCode = 1;
    return;
  }

  console.log("Token");
  console.log("");
  console.log(`  VERCEL_TOKEN: loaded (${token.length} chars)`);
  console.log("");
  console.log("Repo & link");
  console.log("");
  console.log(`  Repo team: ${teamSlug ?? "?"} / ${teamId ?? "(none)"}`);
  console.log(`  Linked project: ${link?.projectId ?? "missing"}`);
  console.log(`  Org id: ${link?.orgId ?? "—"}`);
  console.log(`  Project cwd: ${getVercelProjectLabel()}`);

  if (!link?.projectId || !teamId) {
    console.log("");
    console.log("Result");
    console.log("");
    console.log("  FAILED — missing project link or repo team id");
    process.exitCode = 1;
    return;
  }

  const result = await listProjectEnvRows();
  console.log("");
  console.log("Result");
  console.log("");
  if (result.ok) {
    console.log(`  OK — Project env API (${result.envs.length} variable(s))`);
    process.exitCode = 0;
    return;
  }

  console.log(`  FAILED — Project env API (HTTP ${result.status})`);
  console.log("  Confirm team membership and project visibility, then regenerate VERCEL_TOKEN.");
  process.exitCode = 1;
}
