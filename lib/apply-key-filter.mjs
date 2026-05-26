/**
 * Apply optional key filters to pull merges and push plans.
 */
import { keyMatchesFilter } from "./env-key-filter.mjs";
import { sortKeysLikeEnvExample } from "./env-example-key-order.mjs";

/** @typedef {import("./env-key-filter.mjs").TKeyFilter} TKeyFilter */
/** @typedef {import("./push-plan.mjs").TPushPlan} TPushPlan */
/** @typedef {import("./pull-plan.mjs").TPullPlan} TPullPlan */

/**
 * @param {TPushPlan[]} plans
 */
export function collectPushPlanKeys(plans) {
  const keys = new Set();
  for (const p of plans) {
    for (const ch of p.convexChanges) keys.add(ch.key);
    for (const ch of p.vercelChanges) keys.add(ch.key);
  }
  return sortKeysLikeEnvExample(keys);
}

/**
 * @param {TPullPlan[]} plans
 */
export function collectPullPlanKeys(plans) {
  const keys = new Set();
  for (const p of plans) {
    for (const ch of p.changes) keys.add(ch.key);
  }
  return sortKeysLikeEnvExample(keys);
}

/**
 * Overlay remote values onto `base`, updating only keys that match `filter`.
 *
 * @param {Map<string, string>} base — existing file contents (may be empty)
 * @param {Map<string, string>} remoteFull — full merged pull from hosted env
 * @param {TKeyFilter} filter
 */
export function applyKeyFilterToMap(base, remoteFull, filter) {
  const out = new Map(base);
  for (const [k, v] of remoteFull) {
    if (keyMatchesFilter(k, filter)) out.set(k, v);
  }
  return out;
}

/**
 * @param {TPushPlan} plan
 * @param {TKeyFilter} filter
 * @returns {TPushPlan}
 */
export function filterPushPlanByKeys(plan, filter) {
  const convexChanges = plan.convexChanges.filter((c) =>
    keyMatchesFilter(c.key, filter)
  );
  const vercelChanges = plan.vercelChanges.filter((c) =>
    keyMatchesFilter(c.key, filter)
  );
  const convexToPush = new Map(convexChanges.map((c) => [c.key, c.local]));
  const vercelToPush =
    plan.vercelToPush === null
      ? null
      : new Map(vercelChanges.map((c) => [c.key, c.local]));

  return {
    ...plan,
    convexChanges,
    vercelChanges,
    convexToPush,
    vercelToPush,
  };
}

/**
 * @param {TPushPlan[]} plans
 * @param {TKeyFilter} filter
 */
export function filterPushPlans(plans, filter) {
  return plans.map((p) => filterPushPlanByKeys(p, filter));
}

/**
 * @param {TPushPlan[]} plans
 * @param {TKeyFilter | null | undefined} filter
 */
export function countPushPlanWrites(plans, filter) {
  let n = 0;
  for (const p of plans) {
    const plan = filter ? filterPushPlanByKeys(p, filter) : p;
    n += plan.convexChanges.length + plan.vercelChanges.length;
  }
  return n;
}
