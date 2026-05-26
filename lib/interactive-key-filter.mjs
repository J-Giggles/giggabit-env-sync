/**
 * Interactive prompt for limiting pull/push to specific env keys (comma-separated / globs).
 */
import { parseKeyFilterInput } from "./env-key-filter.mjs";
import { filterPushPlans } from "./apply-key-filter.mjs";
import { filterPullPlans } from "./pull-plan.mjs";
import { syncDim, syncInfo } from "./cli-style.mjs";

/** @typedef {import("./env-key-filter.mjs").TKeyFilter} TKeyFilter */
/** @typedef {import("./pull-plan.mjs").TPullPlan} TPullPlan */
/** @typedef {import("./push-plan.mjs").TPushPlan} TPushPlan */

/**
 * @param {import("node:readline/promises").Interface} rl
 * @param {string} verb — `pull` or `push`
 * @returns {Promise<TKeyFilter | null>}
 */
export async function askKeyFilter(rl, verb) {
  const use = await askYesNo(
    rl,
    `Limit ${verb} to specific keys only?`,
    { defaultYes: false }
  );
  if (!use) return null;

  syncInfo(
    "Enter comma-separated variable names and/or globs — copy from the preview table above."
  );
  syncDim(
    "  Example: AWS_*, WORKOS_API_KEY, B2_*"
  );
  syncDim(
    `  Pull: only matching keys update in sync/working files (others preserved). Push: only matching keys are written.`
  );

  for (;;) {
    const line = (await rl.question("Keys: ")).trim();
    if (line === "") {
      syncDim("  Empty input — no key filter.");
      return null;
    }
    const filter = parseKeyFilterInput(line);
    if (!filter) {
      console.log("Could not parse any keys — try again.");
      continue;
    }
    syncInfo(`Key filter: ${filter.raw}`);
    return filter;
  }
}

/**
 * Ask whether to limit keys, then filter plans — intended after the full preview table is printed.
 *
 * @param {import("node:readline/promises").Interface} rl
 * @param {"pull" | "push"} verb
 * @param {TPullPlan[] | TPushPlan[]} plans
 * @param {{
 *   printPlans: (plans: TPullPlan[] | TPushPlan[], opts: { keyFilter: TKeyFilter | null }) => void;
 * }} opts
 * @returns {Promise<{ plans: TPullPlan[] | TPushPlan[]; keyFilter: TKeyFilter | null }>}
 */
export async function refinePlansWithKeyFilterAfterPreview(rl, verb, plans, opts) {
  const keyFilter = await askKeyFilter(rl, verb);
  if (!keyFilter) {
    return { plans, keyFilter: null };
  }

  const filtered =
    verb === "pull"
      ? filterPullPlans(/** @type {TPullPlan[]} */ (plans), keyFilter)
      : filterPushPlans(/** @type {TPushPlan[]} */ (plans), keyFilter);

  console.log("");
  syncInfo(`Filtered ${verb} preview — ${keyFilter.raw}`);
  opts.printPlans(filtered, { keyFilter });

  return { plans: filtered, keyFilter };
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @param {string} q
 * @param {{ defaultYes?: boolean }} [opts]
 */
async function askYesNo(rl, q, opts = {}) {
  const defaultYes = opts.defaultYes === true;
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  for (;;) {
    const a = (await rl.question(`${q} ${hint} `)).trim().toLowerCase();
    if (a === "y" || a === "yes") return true;
    if (a === "n" || a === "no") return false;
    if (a === "") return defaultYes;
    console.log('Type "y" or "n".');
  }
}
