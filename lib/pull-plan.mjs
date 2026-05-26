/**
 * Plan a pull: fetch hosted env, compute local file diffs before writing.
 */
import fs from "node:fs";
import path from "node:path";
import {
  formatEnvFromExampleTemplate,
  resolveExampleTemplatePath,
} from "./format-env-from-example.mjs";
import { parseDotenv, serializeDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT, envSyncPath } from "./paths.mjs";
import {
  resolveLocalEnvWritePath,
} from "./local-env-paths.mjs";
import {
  fetchConvexEnvMap,
  fetchConvexEnvMapOptions,
  fetchVercelEnvMap,
  fetchVercelEnvMapOptions,
  vercelEnvironmentToPresetTarget,
} from "./remote.mjs";
import {
  fetchVercelProjectEnvList,
  distinctVercelDeploymentTargets,
} from "./vercel-project-env-list.mjs";
import { resolveConvexMapForVercelPull } from "./resolve-convex-map-for-vercel-pull.mjs";
import { mergeWithWarnings } from "./pull.mjs";
import { filterMergedForLocalWorkspace } from "./split.mjs";
import { applyKeyFilterToMap } from "./apply-key-filter.mjs";
import { keyMatchesFilter } from "./env-key-filter.mjs";
import { assertVercelProjectLinked } from "./vercel-link.mjs";
import { syncInfo } from "./cli-style.mjs";

/** @typedef {import("./remote.mjs").TTarget} TTarget */
/** @typedef {import("./env-key-filter.mjs").TKeyFilter} TKeyFilter */
/** @typedef {import("./pull.mjs").TExecutePullOpts} TExecutePullOpts */

/**
 * @typedef {"add" | "change" | "remove"} TPullChangeAction
 */

/**
 * @typedef {{
 *   key: string;
 *   action: TPullChangeAction;
 *   before: string | undefined;
 *   after: string | undefined;
 * }} TPullKeyChange
 */

/**
 * @typedef {{
 *   target: TTarget;
 *   columnLabel: string;
 *   destRel: string;
 *   destAbs: string;
 *   changes: TPullKeyChange[];
 *   executeOpts?: TExecutePullOpts;
 *   body?: string;
 *   templateTarget?: TTarget;
 *   beforeMap?: Map<string, string>;
 *   afterMap?: Map<string, string>;
 *   fullMerged?: Map<string, string>;
 * }} TPullPlan
 */

/** @type {Array<{ target: TTarget; label: string }>} */
export const PULL_ENV_COLUMNS = [
  { target: "dev", label: "development" },
  { target: "preview", label: "preview" },
  { target: "prod", label: "production" },
];

/**
 * @param {Map<string, string>} before
 * @param {Map<string, string>} after
 * @param {TKeyFilter | null | undefined} [keyFilter]
 */
export function buildPullKeyChanges(before, after, keyFilter) {
  /** @type {TPullKeyChange[]} */
  const changes = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const k of [...keys].sort()) {
    if (keyFilter && !keyMatchesFilter(k, keyFilter)) continue;
    const b = before.get(k);
    const a = after.get(k);
    if (b === undefined && a !== undefined) {
      changes.push({ key: k, action: "add", before: undefined, after: a });
    } else if (b !== undefined && a === undefined) {
      changes.push({ key: k, action: "remove", before: b, after: undefined });
    } else if (b !== a) {
      changes.push({ key: k, action: "change", before: b, after: a });
    }
  }
  return changes;
}

/**
 * @param {TTarget} templateTarget
 * @param {Map<string, string>} afterMap
 */
export function formatPullDestinationBody(templateTarget, afterMap) {
  const templateAbs = resolveExampleTemplatePath(REPO_ROOT, templateTarget);
  if (templateAbs) {
    try {
      const templateContent = fs.readFileSync(templateAbs, "utf8");
      return formatEnvFromExampleTemplate(templateContent, afterMap);
    } catch {
      return serializeDotenv(afterMap);
    }
  }
  return serializeDotenv(afterMap);
}

/**
 * @param {Map<string, string>} merged
 * @param {TKeyFilter | null | undefined} keyFilter
 * @param {string} destAbs
 */
function afterMapForPullAllSyncFile(merged, keyFilter, destAbs) {
  const existing = fs.existsSync(destAbs)
    ? parseDotenv(fs.readFileSync(destAbs, "utf8"))
    : new Map();
  let afterMap = filterMergedForLocalWorkspace(merged);
  if (keyFilter) {
    afterMap = applyKeyFilterToMap(existing, afterMap, keyFilter);
  }
  return { beforeMap: existing, afterMap };
}

/**
 * @param {{ keyFilter?: TKeyFilter | null }} [opts]
 * @returns {Promise<TPullPlan[]>}
 */
export async function planPullAll(opts = {}) {
  const keyFilter = opts.keyFilter ?? null;
  assertVercelProjectLinked();
  syncInfo("Planning pull-all (fetching hosted Convex + Vercel)…");

  const { envs } = fetchVercelProjectEnvList();
  const targets = distinctVercelDeploymentTargets(envs);
  if (targets.length === 0) {
    throw new Error(
      "No Vercel deployment targets (development / preview / production) found in project env list."
    );
  }

  const convexDevMap = fetchConvexEnvMapOptions({ useProd: false });
  const convexProdMap = fetchConvexEnvMapOptions({ useProd: true });

  /** @type {TPullPlan[]} */
  const plans = [];
  for (const envName of targets) {
    const presetTarget = vercelEnvironmentToPresetTarget(
      /** @type {"development" | "preview" | "production"} */ (envName)
    );
    const vercelMap = fetchVercelEnvMapOptions(envName);
    const convexMap = resolveConvexMapForVercelPull(
      vercelMap,
      presetTarget,
      convexDevMap,
      convexProdMap
    );
    const merged = mergeWithWarnings(vercelMap, convexMap, { quiet: true });
    const destAbs = envSyncPath(envName);
    const destRel = path.relative(REPO_ROOT, destAbs);
    const { beforeMap, afterMap } = afterMapForPullAllSyncFile(
      merged,
      keyFilter,
      destAbs
    );
    const changes = buildPullKeyChanges(beforeMap, afterMap, keyFilter);
    const col =
      PULL_ENV_COLUMNS.find((c) => c.target === presetTarget)?.label ?? envName;
    plans.push({
      target: presetTarget,
      columnLabel: col,
      destRel,
      destAbs,
      changes,
      body: formatPullDestinationBody(presetTarget, afterMap),
      templateTarget: presetTarget,
      beforeMap,
      afterMap,
      fullMerged: merged,
    });
  }
  return plans;
}

/**
 * Compute local file diff for a preset pull (executePull path).
 *
 * @param {TExecutePullOpts} executeOpts
 * @param {TKeyFilter | null | undefined} keyFilter
 */
export function planPullFromExecuteOpts(executeOpts, keyFilter) {
  const snapshotOnly = Boolean(executeOpts.snapshotOnly);
  const merged = mergeWithWarnings(executeOpts.vercelMap, executeOpts.convexMap);
  const mergedPath = envSyncPath(`merge.${executeOpts.storageKey}`);
  const prevExists = fs.existsSync(mergedPath);
  const prevMap = prevExists
    ? parseDotenv(fs.readFileSync(mergedPath, "utf8"))
    : new Map();

  let mergedForWrite = merged;
  if (keyFilter) {
    mergedForWrite = applyKeyFilterToMap(prevMap, merged, keyFilter);
  }

  /** @type {string} */
  let destRel;
  /** @type {string} */
  let destAbs;
  /** @type {Map<string, string>} */
  let beforeMap;
  /** @type {Map<string, string>} */
  let afterMap;

  if (snapshotOnly) {
    destAbs = mergedPath;
    destRel = path.relative(REPO_ROOT, mergedPath);
    beforeMap = prevMap;
    afterMap = mergedForWrite;
  } else if (executeOpts.localWrite) {
    destAbs = executeOpts.localWrite.abs;
    destRel = executeOpts.localWrite.rel;
    const mergedLocal = filterMergedForLocalWorkspace(merged);
    beforeMap = fs.existsSync(destAbs)
      ? parseDotenv(fs.readFileSync(destAbs, "utf8"))
      : new Map();
    afterMap = keyFilter
      ? applyKeyFilterToMap(beforeMap, mergedLocal, keyFilter)
      : filterMergedForLocalWorkspace(mergedForWrite);
  } else {
    destAbs = mergedPath;
    destRel = path.relative(REPO_ROOT, mergedPath);
    beforeMap = prevMap;
    afterMap = mergedForWrite;
  }

  const templateTarget = executeOpts.templateTarget;
  const target = /** @type {TTarget} */ (
    templateTarget === "dev" || templateTarget === "preview" || templateTarget === "prod"
      ? templateTarget
      : "dev"
  );
  const columnLabel =
    PULL_ENV_COLUMNS.find((c) => c.target === target)?.label ??
    executeOpts.label ??
    executeOpts.storageKey;

  const changes = buildPullKeyChanges(beforeMap, afterMap, keyFilter);
  const mergedLocal = filterMergedForLocalWorkspace(merged);
  const fullMerged =
    executeOpts.localWrite && !executeOpts.snapshotOnly ? mergedLocal : merged;

  return {
    target,
    columnLabel,
    destRel,
    destAbs,
    changes,
    executeOpts,
    templateTarget: target,
    beforeMap,
    afterMap,
    fullMerged,
  };
}

/**
 * @param {TPullPlan} plan
 * @param {TKeyFilter} filter
 * @returns {TPullPlan}
 */
export function filterPullPlanByKeys(plan, filter) {
  const templateTarget = plan.templateTarget ?? plan.target;
  const beforeMap = plan.beforeMap ?? new Map();
  const fullMerged = plan.fullMerged ?? plan.afterMap ?? new Map();
  const afterMap = applyKeyFilterToMap(beforeMap, fullMerged, filter);
  const changes = buildPullKeyChanges(beforeMap, afterMap, filter);

  return {
    ...plan,
    changes,
    beforeMap,
    afterMap,
    fullMerged,
    executeOpts: plan.executeOpts
      ? { ...plan.executeOpts, keyFilter: filter }
      : undefined,
    body: plan.body !== undefined
      ? formatPullDestinationBody(templateTarget, afterMap)
      : undefined,
  };
}

/**
 * @param {TPullPlan[]} plans
 * @param {TKeyFilter} filter
 */
export function filterPullPlans(plans, filter) {
  return plans.map((p) => filterPullPlanByKeys(p, filter));
}

/**
 * @param {TTarget} target
 * @param {{ snapshotOnly?: boolean; keyFilter?: TKeyFilter | null }} [opts]
 * @returns {Promise<TPullPlan>}
 */
export async function planPullTarget(target, opts = {}) {
  const snapshotOnly = Boolean(opts.snapshotOnly);
  const keyFilter = opts.keyFilter ?? null;
  syncInfo(`Planning pull for "${target}" (fetching hosted Convex + Vercel)…`);

  const vercelMap = fetchVercelEnvMap(target);
  const convexDevMap = fetchConvexEnvMap("dev");
  const convexProdMap = fetchConvexEnvMap("prod");
  const convexMap = resolveConvexMapForVercelPull(
    vercelMap,
    target,
    convexDevMap,
    convexProdMap
  );

  const localWrite = snapshotOnly ? null : resolveLocalEnvWritePath(target);

  return planPullFromExecuteOpts(
    {
      convexMap,
      vercelMap,
      storageKey: target,
      templateTarget: target,
      snapshotOnly,
      localWrite,
      label: target,
      keyFilter,
    },
    keyFilter
  );
}

/**
 * @param {TTarget[]} targets
 * @param {{ snapshotOnly?: boolean; keyFilter?: TKeyFilter | null }} [opts]
 */
export async function planPullTargets(targets, opts = {}) {
  /** @type {TPullPlan[]} */
  const plans = [];
  for (const t of targets) {
    plans.push(await planPullTarget(t, opts));
  }
  return plans;
}

/**
 * @param {TPullPlan[]} plans
 */
export function countPullPlanChanges(plans) {
  return plans.reduce((n, p) => n + p.changes.length, 0);
}

/**
 * @param {TPullPlan} plan
 */
export async function executePullPlan(plan) {
  if (plan.executeOpts) {
    const { executePull } = await import("./pull.mjs");
    await executePull(plan.executeOpts);
    return;
  }
  if (plan.body === undefined) {
    throw new Error("[env:sync] Pull plan has no executeOpts or body.");
  }
  fs.writeFileSync(plan.destAbs, plan.body, "utf8");
  syncInfo(`Wrote ${plan.destRel}`);
}

/**
 * @param {TPullPlan[]} plans
 */
export async function executePullPlans(plans) {
  for (const plan of plans) {
    await executePullPlan(plan);
  }
}
