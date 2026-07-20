/**
 * env:sync:pull --all — merged Convex + Vercel per Vercel target, formatted like preset pull.
 */
import { isConvexEnabled } from "./config.mjs";
import {
  computePullAllPlans,
  mergeVercelProjectMaps,
  writePullPlan,
} from "./pull-plan.mjs";
import { syncInfo } from "./cli-style.mjs";
import { checkVercelProjectLinked } from "./config.mjs";
import { fetchVercelEnvMapOptions } from "./remote.mjs";
import {
  fetchVercelProjectEnvList,
  distinctVercelDeploymentTargets,
} from "./vercel-project-env-list.mjs";

/**
 * @param {{ missingOnly?: boolean; plans?: import("./pull-plan.mjs").TPullPlan[]; projects?: import("./config.mjs").TVercelProjectEntry[] | null }} [opts]
 */
export async function pullAllVercelDeployments(opts = {}) {
  const missingOnly = Boolean(opts.missingOnly);
  const plans =
    opts.plans ??
    (await (async () => {
      syncInfo("pull --all: loading Vercel project env inventory…");
      if (isConvexEnabled()) {
        syncInfo("Loading Convex (development + production deployments)…");
      } else {
        syncInfo("Convex disabled (ENV_SYNC_DISABLE_CONVEX=1) — pulling Vercel only.");
      }
      if (opts.projects && opts.projects.length > 0) {
        const { targets, vercelMaps } = await fetchMergedProjectVercelMaps(
          opts.projects
        );
        return computePullAllPlans({ missingOnly, vercelMaps, targets });
      }
      return computePullAllPlans({ missingOnly });
    })());

  if (!opts.plans) {
    syncInfo(
      `Writing ${plans.length} merged file(s): .env.sync.<environment> (${isConvexEnabled() ? "Convex + Vercel" : "Vercel only"}, example layout)`
    );
  }

  for (const plan of plans) {
    syncInfo(
      isConvexEnabled()
        ? `Pulling Vercel ${plan.envName} + Convex (from Vercel-linked deployment when possible)…`
        : `Pulling Vercel ${plan.envName}…`
    );
    writePullPlan(plan);
  }

  syncInfo("pull --all complete.");
}

/**
 * @param {import("./config.mjs").TVercelProjectEntry[]} projects
 * @returns {Promise<{ targets: string[]; vercelMaps: Map<string, Map<string, string>> }>}
 */
async function fetchMergedProjectVercelMaps(projects) {
  const prior = process.env.ENV_SYNC_VERCEL_PROJECT_CWD;
  const hadPrior = "ENV_SYNC_VERCEL_PROJECT_CWD" in process.env;
  /** @type {Map<string, Map<string, string>[]>} */
  const mapsByEnv = new Map();
  /** @type {Set<string>} */
  const targetSet = new Set();

  try {
    for (const project of projects) {
      process.env.ENV_SYNC_VERCEL_PROJECT_CWD = project.relPath;
      const link = checkVercelProjectLinked(project.cwd);
      if (!link.ok) {
        throw new Error(
          `[env:sync] [${project.label}] ${link.reason}. Aborting multi-project pull; no files were written.`,
        );
      }

      try {
        syncInfo(`[${project.label}] loading Vercel env inventory...`);
        const { envs } = fetchVercelProjectEnvList();
        const targets = distinctVercelDeploymentTargets(envs);
        for (const envName of targets) {
          targetSet.add(envName);
        }
        for (const envName of targets) {
          syncInfo(`[${project.label}] pulling Vercel ${envName}...`);
          const map = fetchVercelEnvMapOptions(
            /** @type {"development" | "preview" | "production"} */ (envName),
          );
          const existing = mapsByEnv.get(envName) ?? [];
          existing.push(map);
          mapsByEnv.set(envName, existing);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `[env:sync] [${project.label}] ${message}. Aborting multi-project pull; no files were written.`,
          { cause: error },
        );
      }
    }
  } finally {
    if (hadPrior) {
      process.env.ENV_SYNC_VERCEL_PROJECT_CWD = prior;
    } else {
      delete process.env.ENV_SYNC_VERCEL_PROJECT_CWD;
    }
  }

  const order = ["development", "preview", "production"];
  const targets = [...targetSet].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const vercelMaps = new Map();
  for (const envName of targets) {
    vercelMaps.set(envName, mergeVercelProjectMaps(mapsByEnv.get(envName) ?? []));
  }
  return { targets, vercelMaps };
}
