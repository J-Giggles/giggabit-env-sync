/**
 * env:sync:pull --all — merged Convex + Vercel per Vercel target, formatted like preset pull.
 */
import { assertVercelProjectLinked } from "./vercel-link.mjs";
import {
  executePullPlans,
  planPullAll,
} from "./pull-plan.mjs";
import { reportEnvSnapshotDiffIfReady } from "./print-env-snapshot-diff.mjs";
import { syncInfo } from "./cli-style.mjs";

/** @typedef {import("./env-key-filter.mjs").TKeyFilter} TKeyFilter */

/**
 * @param {{ keyFilter?: TKeyFilter | null; skipDiffReport?: boolean }} [opts]
 */
export async function pullAllVercelDeployments(opts = {}) {
  const keyFilter = opts.keyFilter ?? null;
  assertVercelProjectLinked();
  const plans = await planPullAll({ keyFilter });
  await executePullPlans(plans);
  syncInfo("pull --all complete.");
  if (opts.skipDiffReport !== true) {
    reportEnvSnapshotDiffIfReady();
  }
}
