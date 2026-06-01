/**
 * Fetch env maps from Convex and Vercel CLIs.
 */
import fs from "node:fs";
import { getVercelProjectCwd, isConvexEnabled } from "./config.mjs";
import { vercelMapHasConvexLinkKeys } from "./convex-vercel-link.mjs";
import { syncInfo, syncWarn } from "./cli-style.mjs";
import { inferConvexUseProdFromLocalMap, pnpmExec, run } from "./exec.mjs";
import { parseDotenv } from "./parse-dotenv.mjs";
import { SYNC_DIR, cachePath } from "./paths.mjs";
import {
  getVercelPreviewGitBranch,
  getVercelPreviewPullBranchCandidates,
  isVercelPreviewNoGitBranch,
} from "./vercel-preview-branch.mjs";
import { readVercelProjectLink } from "./vercel-env-api.mjs";
import {
  resolveVercelTeamId,
  vercelCliLeadingArgs,
} from "./vercel-team-scope.mjs";
import { CliError } from "./cli-output.mjs";

/**
 * Pin CLI calls to the linked project + repo team (avoids wrong default team on token).
 *
 * @param {NodeJS.ProcessEnv} [base]
 * @returns {NodeJS.ProcessEnv}
 */
export function buildVercelCliEnv(base = process.env) {
  const env = { ...base };
  const link = readVercelProjectLink();
  const teamId = resolveVercelTeamId();
  if (teamId) env.VERCEL_ORG_ID = teamId;
  if (link?.projectId) env.VERCEL_PROJECT_ID = link.projectId;
  return env;
}

/**
 * Run the Vercel CLI (`vercel` on PATH, else `pnpm dlx vercel`). Runs from the active
 * Vercel project cwd (see `getVercelProjectCwd()`), which is `REPO_ROOT` by default and
 * an app subdirectory in monorepo mode.
 *
 * @param {string[]} args
 * @param {{ cwd?: string; env?: NodeJS.ProcessEnv }} [opts]
 */
export function runVercel(args, opts = {}) {
  const cwd = opts.cwd ?? getVercelProjectCwd();
  const cliArgs = [...vercelCliLeadingArgs(), ...args];
  const env = buildVercelCliEnv(opts.env ?? process.env);
  let r = run("vercel", cliArgs, { cwd, env });
  if (!r.ok && (r.error || /not found|ENOENT/i.test(r.stderr))) {
    r = run("pnpm", ["dlx", "vercel", ...cliArgs], { cwd, env });
  }
  return r;
}

/** @typedef {"dev" | "preview" | "prod"} TTarget */

/**
 * @param {TTarget} target
 * @returns {string[]} suffix args for `convex env …` (e.g. `--prod` must come **after** `env list` / `env set`, not before `env`).
 */
export function convexArgsForTarget(target) {
  if (target === "prod") return ["--prod"];
  return [];
}

/**
 * Map target to Vercel environment name.
 * @param {TTarget} target
 */
export function vercelEnvName(target) {
  if (target === "prod") return "production";
  if (target === "preview") return "preview";
  return "development";
}

/**
 * Map Vercel env pull scope to the preset used for `.env` templates and file paths.
 *
 * @param {"development" | "preview" | "production"} vercelEnvironment
 * @returns {TTarget}
 */
export function vercelEnvironmentToPresetTarget(vercelEnvironment) {
  if (vercelEnvironment === "production") return "prod";
  if (vercelEnvironment === "preview") return "preview";
  return "dev";
}

/**
 * Fetch Convex env as a Map (parses `convex env list` output). When Convex is disabled
 * via `ENV_SYNC_DISABLE_CONVEX=1`, returns an empty map without spawning the CLI so the
 * rest of the pipeline (merge, drift check, push) treats Convex as a non-source.
 *
 * @param {{ useProd: boolean; convexEnv?: NodeJS.ProcessEnv }} opts — `useProd: true` → production deployment (`--prod`). Pass `convexEnv` so `CONVEX_DEPLOY_KEY` matches the same file as `env:sync:push`.
 */
export function fetchConvexEnvMapOptions(opts) {
  if (!isConvexEnabled()) return new Map();
  const extra = opts.useProd ? ["--prod"] : [];
  const execOpts = opts.convexEnv ? { env: opts.convexEnv } : {};
  const r = pnpmExec("convex", ["env", "list", ...extra], execOpts);
  if (!r.ok) {
    throw new Error(
      `convex env list failed (${r.status}):\n${r.stderr || r.stdout}`
    );
  }
  return parseConvexListOutput(r.stdout);
}

/**
 * @param {TTarget} target
 * @param {NodeJS.ProcessEnv} [convexEnv]
 */
export function fetchConvexEnvMap(target, convexEnv) {
  return fetchConvexEnvMapOptions({
    useProd: target === "prod",
    convexEnv,
  });
}

/**
 * Suffix args for `convex env set …` (`--prod` or none). With `--from-sync`, uses
 * `CONVEX_DEPLOY_KEY` prefix (`prod:…` / `dev:…`) and/or the sync target.
 *
 * @param {TTarget} target
 * @param {Map<string, string>} localMap
 * @param {boolean} fromSync
 * @returns {string[]}
 */
export function convexEnvSetSuffixArgs(target, localMap, fromSync) {
  if (fromSync) {
    return inferConvexUseProdFromLocalMap(localMap, target) ? ["--prod"] : [];
  }
  return convexArgsForTarget(target);
}

/**
 * Convex prints lines like NAME=value (value may be quoted).
 * @param {string} stdout
 */
function parseConvexListOutput(stdout) {
  const map = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map.set(key, value);
  }
  return map;
}

/**
 * @param {{ ok: boolean; status: number; stderr: string; stdout: string }} r
 * @param {string} environment
 */
function throwOnVercelPullFailure(r, environment) {
  if (r.ok) return;
  const detail = (r.stderr || r.stdout).trim();
  const scopeError = /scope does not exist|scope-not-existent/i.test(detail);
  if (scopeError) {
    throw new CliError({
      code: "vercel_cli_scope",
      title: "vercel env pull — team scope not found",
      summary: detail,
      facts: [
        { label: "Environment", value: environment },
        {
          label: "CLI scope",
          value:
            "Omitted (using VERCEL_ORG_ID). If you still see this, check VERCEL_ORG_ID matches .vercel/project.json orgId.",
        },
      ],
      steps: [
        "Confirm giggabit-env-sync.repo.json vercelTeamSlug matches your Vercel team URL (e.g. vercel.com/mountain-technologies → slug mountain-technologies).",
        "Or set ENV_SYNC_VERCEL_TEAM_SLUG to the slug from the dashboard URL.",
        "Ensure ENV_SYNC_VERCEL_TEAM_ID matches the orgId in apps/*/ .vercel/project.json.",
      ],
    });
  }
  throw new CliError({
    code: "vercel_env_pull",
    title: "vercel env pull failed",
    summary: detail || `exit ${r.status}`,
    facts: [{ label: "Environment", value: environment }],
  });
}

/**
 * @param {"development" | "preview" | "production"} environment
 */
export function fetchVercelEnvMapOptions(environment) {
  const safe = environment.replace(/[^a-z0-9-]/gi, "-");
  fs.mkdirSync(SYNC_DIR, { recursive: true });
  const outFile = cachePath(`cache.vercel.${safe}.env`);

  if (environment !== "preview") {
    const pullArgs = [
      "env",
      "pull",
      outFile,
      "--environment",
      environment,
      "--yes",
    ];
    throwOnVercelPullFailure(runVercel(pullArgs), environment);
    const content = fs.readFileSync(outFile, "utf8");
    try {
      fs.unlinkSync(outFile);
    } catch {
      /* ignore */
    }
    return parseDotenv(content);
  }

  /** Preview without git branch: all Preview deployments (Vercel CLI omits `--git-branch`). */
  if (isVercelPreviewNoGitBranch()) {
    const pullArgs = [
      "env",
      "pull",
      outFile,
      "--environment",
      environment,
      "--yes",
    ];
    throwOnVercelPullFailure(runVercel(pullArgs), environment);
    const content = fs.readFileSync(outFile, "utf8");
    try {
      fs.unlinkSync(outFile);
    } catch {
      /* ignore */
    }
    syncInfo(
      "Preview env pull: unscoped Preview (no `--git-branch`). Applies to all Preview deployments."
    );
    return parseDotenv(content);
  }

  /** Preview: try `staging` first, then current git branch, until a pull includes Convex link keys. */
  const branches = getVercelPreviewPullBranchCandidates();
  const primary = getVercelPreviewGitBranch();
  /**
   * Convex disabled: there are no Convex link keys to seek, so the multi-branch loop is
   * unnecessary — pull the primary branch and return whatever it gives back.
   */
  const skipConvexLinkSearch = !isConvexEnabled();
  /** @type {Error | null} */
  let lastErr = null;
  /** @type {Map<string, string> | null} */
  let lastMap = null;

  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i];
    const pullArgs = [
      "env",
      "pull",
      outFile,
      "--environment",
      environment,
      "--yes",
      "--git-branch",
      branch,
    ];
    const r = runVercel(pullArgs);
    if (!r.ok) {
      lastErr = new Error(
        `vercel env pull failed (${r.status}) for preview branch "${branch}":\n${r.stderr || r.stdout}`
      );
      try {
        fs.unlinkSync(outFile);
      } catch {
        /* ignore */
      }
      continue;
    }
    const content = fs.readFileSync(outFile, "utf8");
    try {
      fs.unlinkSync(outFile);
    } catch {
      /* ignore */
    }
    const map = parseDotenv(content);
    lastMap = map;
    if (skipConvexLinkSearch || vercelMapHasConvexLinkKeys(map)) {
      if (!skipConvexLinkSearch && branch !== primary) {
        syncInfo(
          `Preview env pull: using git branch "${branch}" (Convex link keys not found on "${primary}" pull; your Preview vars may be branch-scoped in Vercel). Fix: set \`ENV_SYNC_VERCEL_PREVIEW_BRANCH=${branch}\`, or use default unscoped Preview (clear branch env / \`ENV_SYNC_VERCEL_PREVIEW_NO_BRANCH=1\`).`
        );
      }
      return map;
    }
  }

  if (lastMap) {
    if (!skipConvexLinkSearch) {
      syncWarn(
        `Preview env pull: no branch in [${branches.join(", ")}] returned \`NEXT_PUBLIC_CONVEX_URL\` / \`CONVEX_DEPLOY_KEY\` / related keys — merge may miss Convex linkage.`
      );
    }
    return lastMap;
  }
  throw lastErr ?? new Error("vercel env pull preview failed for all branch candidates.");
}

/**
 * Pull Vercel env to a temp file and parse.
 * @param {TTarget} target
 */
export function fetchVercelEnvMap(target) {
  return fetchVercelEnvMapOptions(vercelEnvName(target));
}
