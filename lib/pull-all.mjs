/**
 * env:sync:pull --all — merged Convex + Vercel per Vercel target, formatted like preset pull.
 */
import { isConvexEnabled } from "./config.mjs";
import { computePullAllPlans, writePullPlan } from "./pull-plan.mjs";
import { syncInfo } from "./cli-style.mjs";

/**
 * @param {{ missingOnly?: boolean; plans?: import("./pull-plan.mjs").TPullPlan[] }} [opts]
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
