/**
 * Resolve Vercel team scope for CLI vs REST (slug can differ from dashboard display name).
 */
import { readVercelProjectLink } from "./vercel-env-api.mjs";
import { getExpectedVercelTeam } from "./repo-config.mjs";
import { resolveVercelToken } from "./vercel-token.mjs";

/** @type {{ teamId: string; slug: string } | null} */
let cachedSlugForTeamId = null;

/**
 * Team id used for REST and `VERCEL_ORG_ID` (from repo config or link).
 *
 * @returns {string | undefined}
 */
export function resolveVercelTeamId() {
  const link = readVercelProjectLink();
  return process.env.ENV_SYNC_VERCEL_TEAM_ID?.trim() || link?.orgId;
}

/**
 * Leading args for `vercel` CLI.
 *
 * When a team id is known we rely on `VERCEL_ORG_ID` from {@link buildVercelCliEnv}
 * and omit `--scope`. A wrong `vercelTeamSlug` in repo config causes
 * `Error: The specified scope does not exist` even when the REST API works.
 *
 * @returns {string[]}
 */
export function vercelCliLeadingArgs() {
  if (resolveVercelTeamId()) return [];

  const override = process.env.ENV_SYNC_VERCEL_TEAM_SLUG?.trim();
  if (override) return ["--scope", override];

  const { teamSlug } = getExpectedVercelTeam();
  return teamSlug ? ["--scope", teamSlug] : [];
}

/**
 * Fetch canonical team slug from Vercel API (for diagnostics / repo config hints).
 *
 * @param {string} teamId
 * @returns {Promise<string | undefined>}
 */
export async function fetchVercelTeamSlug(teamId) {
  const token = resolveVercelToken();
  if (!token || !teamId) return undefined;
  if (cachedSlugForTeamId?.teamId === teamId) return cachedSlugForTeamId.slug;

  try {
    const res = await fetch(
      `https://api.vercel.com/v2/teams/${encodeURIComponent(teamId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return undefined;
    const j = await res.json();
    const slug = typeof j?.slug === "string" ? j.slug : undefined;
    if (slug) cachedSlugForTeamId = { teamId, slug };
    return slug;
  } catch {
    return undefined;
  }
}

/**
 * @returns {Promise<string | undefined>}
 */
export async function resolveVercelTeamSlugForDisplay() {
  const { teamSlug } = getExpectedVercelTeam();
  const teamId = resolveVercelTeamId();
  if (!teamId) return teamSlug;
  const apiSlug = await fetchVercelTeamSlug(teamId);
  return apiSlug ?? teamSlug;
}
