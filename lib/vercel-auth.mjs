/**
 * Per-repo Vercel identity guard (after token resolution).
 */
import { getExpectedVercelTeam } from "./repo-config.mjs";
import { readVercelProjectLink } from "./vercel-env-api.mjs";
import { resolveVercelToken } from "./vercel-token.mjs";
import { readRepoConfig } from "./repo-config.mjs";
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
          "or ENV_SYNC_VERCEL_AUTH_FILE (e.g. .env/sync/vercel.auth.json). " +
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
