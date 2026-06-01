/**
 * Per-repo Vercel identity guard (after token resolution).
 */
import { getExpectedVercelTeam } from "./repo-config.mjs";
import { listProjectEnvRows, readVercelProjectLink } from "./vercel-env-api.mjs";
import { resolveVercelToken } from "./vercel-token.mjs";
import { readRepoConfig } from "./repo-config.mjs";
import { getVercelProjectLabel } from "./config.mjs";
import {
  CliError,
  printBanner,
  printFactsTable,
  printSection,
  printSteps,
  syncDetail,
  syncWarn,
} from "./cli-output.mjs";

/**
 * @param {string} token
 * @returns {Promise<{ defaultTeamId?: string; email?: string } | null>}
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
    const u = /** @type {Record<string, unknown>} */ (user);
    return {
      defaultTeamId:
        typeof u.defaultTeamId === "string" ? u.defaultTeamId : undefined,
      email: typeof u.email === "string" ? u.email : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * @param {string} token
 * @param {string} teamId
 * @returns {Promise<{ status: number; projectCount: number }>}
 */
async function fetchTeamProjectListSummary(token, teamId) {
  try {
    const res = await fetch(
      `https://api.vercel.com/v9/projects?teamId=${encodeURIComponent(teamId)}&limit=20`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return { status: res.status, projectCount: -1 };
    const j = await res.json();
    const n = Array.isArray(j?.projects) ? j.projects.length : 0;
    return { status: res.status, projectCount: n };
  } catch {
    return { status: 0, projectCount: -1 };
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
      throw new CliError({
        code: "no_token",
        title: "No Vercel token",
        summary:
          "This repo requires a bearer token for the team in giggabit-env-sync.repo.json.",
        steps: [
          "Add VERCEL_TOKEN to the monorepo root .env.local (no quotes around the value).",
          "Or set ENV_SYNC_VERCEL_AUTH_FILE to a gitignored JSON file with the token.",
          "Global `vercel login` is ignored when a team guard is configured unless ENV_SYNC_ALLOW_GLOBAL_VERCEL_AUTH=1.",
        ],
      });
    }
    return;
  }

  process.env.VERCEL_TOKEN = token;

  if (!teamId && !teamSlug) return;

  const link = readVercelProjectLink();
  if (teamId && link?.orgId && link.orgId !== teamId) {
    throw new CliError({
      code: "team_mismatch",
      title: "Linked project is on the wrong team",
      facts: [
        { label: "Linked org", value: link.orgId },
        { label: "Repo expects", value: teamId },
        { label: "Project cwd", value: getVercelProjectLabel() },
      ],
      steps: [
        `cd ${getVercelProjectLabel()} && vercel link --scope ${teamSlug ?? teamId}`,
      ],
    });
  }

  if (teamId) {
    const user = await fetchVercelUser(token);
    if (user?.defaultTeamId && user.defaultTeamId !== teamId) {
      syncWarn(
        `Token default team (${user.defaultTeamId}) ≠ repo team (${teamId}). API calls use ENV_SYNC_VERCEL_TEAM_ID.`
      );
      syncWarn(
        "vercel switch does not update VERCEL_TOKEN in .env.local — create a token on the repo team or use ENV_SYNC_ALLOW_GLOBAL_VERCEL_AUTH=1 without VERCEL_TOKEN set."
      );
      syncDetail(
        `Set ENV_SYNC_VERBOSE=1 for full auth logging. User: ${user.email ?? "(unknown)"}.`
      );
    }
  }

  syncDetail(
    `Vercel auth OK for ${teamSlug ?? teamId ?? "personal"}${link?.projectName ? ` · ${link.projectName}` : ""}.`
  );

  if (link?.projectId && teamId) {
    await assertVercelProjectAccess({ token, teamId, teamSlug, link });
  }
}

/**
 * @param {{
 *   token: string;
 *   teamId: string;
 *   teamSlug?: string;
 *   link: { projectId: string; orgId?: string; projectName?: string };
 * }} params
 */
async function assertVercelProjectAccess(params) {
  const res = await listProjectEnvRows();
  if (res.ok) return;

  const user = await fetchVercelUser(params.token);
  const teamProjects = await fetchTeamProjectListSummary(
    params.token,
    params.teamId
  );
  const projectLabel = getVercelProjectLabel();
  const projectName =
    params.link.projectName ?? params.link.projectId;
  const teamLabel = params.teamSlug ?? params.teamId;
  const visibleProjects =
    teamProjects.projectCount < 0
      ? `list failed (HTTP ${teamProjects.status})`
      : String(teamProjects.projectCount);

  throw new CliError({
    code: "vercel_forbidden",
    title: "Vercel token cannot read this project",
    summary:
      "VERCEL_TOKEN is set in .env.local, but the API returns 404 for env vars on the linked project. ENV_SYNC_VERCEL_TEAM_ID only selects the team — it does not grant access.",
    facts: [
      { label: "Vercel user", value: user?.email ?? "(unknown)" },
      { label: "Token default team", value: user?.defaultTeamId ?? "(unknown)" },
      { label: "Required team", value: `${teamLabel} (${params.teamId})` },
      { label: "Linked app", value: projectLabel },
      { label: "Vercel project", value: projectName },
      { label: "Project id", value: params.link.projectId },
      { label: "Env list API", value: `HTTP ${res.status}` },
      { label: "Projects on team (token)", value: visibleProjects },
    ],
    steps: [
      "`vercel switch` only changes the Vercel CLI session — env:sync always uses VERCEL_TOKEN from root .env.local first (not your CLI login).",
      `Repo team slug is "${params.teamSlug ?? params.teamId}" (not necessarily the team shown after vercel switch).`,
      `In the Vercel dashboard, open team "${params.teamSlug ?? params.teamId}" and confirm project "${projectName}" is listed.`,
      "If the project is missing: ask a team owner for access, then run vercel link again in the linked app directory.",
      "If the project is visible: create a new token on that team (full access or scopes that include this project and env read).",
      "Paste the token into root .env.local as VERCEL_TOKEN= with no quotes or trailing spaces.",
      "Run pnpm run env:sync:auth-check — it must show Project env API: OK before pull/push.",
    ],
    hint: "Tip: ENV_SYNC_VERBOSE=1 shows extra auth lines; omit it for quieter runs.",
  });
}

/**
 * Print token/team/project diagnostics (no secret values).
 */
export async function runVercelAuthCheck() {
  const { teamId, teamSlug } = getExpectedVercelTeam();
  const token = resolveVercelToken();
  const link = readVercelProjectLink();

  printBanner("Vercel auth check", "No secret values are printed.");

  if (!token) {
    printSection("Result");
    console.log("  VERCEL_TOKEN: not set");
    console.log("  Fix: add VERCEL_TOKEN to root .env.local");
    process.exitCode = 1;
    return;
  }

  const fromEnv = Boolean(process.env.VERCEL_TOKEN?.trim());
  const user = await fetchVercelUser(token);
  const teamProjects = teamId
    ? await fetchTeamProjectListSummary(token, teamId)
    : null;

  printSection("Token");
  printFactsTable([
    {
      label: "VERCEL_TOKEN",
      value: `loaded (${token.length} chars, ${fromEnv ? "process.env" : "auth file"})`,
    },
    { label: "Vercel user", value: user?.email ?? "(could not read)" },
    {
      label: "Token default team",
      value: user?.defaultTeamId ?? "(could not read)",
    },
  ]);

  printSection("Repo & link");
  printFactsTable([
    {
      label: "Repo team",
      value: `${teamSlug ?? "?"} / ${teamId ?? "(none)"}`,
    },
    {
      label: "Linked project",
      value: link?.projectName ?? link?.projectId ?? "missing",
    },
    { label: "Project id", value: link?.projectId ?? "—" },
    { label: "Org id", value: link?.orgId ?? "—" },
    { label: "Project cwd", value: getVercelProjectLabel() },
  ]);

  if (teamProjects) {
    printSection("Team access");
    printFactsTable([
      {
        label: "Projects visible",
        value:
          teamProjects.projectCount < 0
            ? `list failed HTTP ${teamProjects.status}`
            : String(teamProjects.projectCount),
      },
    ]);
  }

  if (!link?.projectId || !teamId) {
    printSection("Result");
    syncWarn("Missing link or repo team id — cannot test project env API.");
    process.exitCode = 1;
    return;
  }

  const res = await listProjectEnvRows();
  printSection("Result");
  if (res.ok) {
    console.log(`  OK — Project env API (${res.envs.length} variable(s))`);
    process.exitCode = 0;
    return;
  }

  console.log(`  FAILED — Project env API (HTTP ${res.status})`);
  printSteps([
    "Confirm team membership and project visibility in the Vercel UI.",
    "Regenerate VERCEL_TOKEN on the correct team and update .env.local.",
    "Re-run this command until the line above shows OK.",
  ]);
  process.exitCode = 1;
}
