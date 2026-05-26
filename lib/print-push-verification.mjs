/**
 * Post-push verification: confirm routed keys are present on Convex and/or Vercel.
 */
import { inferConvexUseProdFromLocalMap } from "./exec.mjs";
import {
  fetchConvexEnvMap,
  fetchConvexEnvMapOptions,
  fetchVercelEnvMap,
} from "./remote.mjs";
import {
  filterForConvexWithWarnings,
  filterForVercel,
} from "./split.mjs";
import { buildPlatformScopeMap } from "./env-platform-scope.mjs";
import {
  formatHostStatus,
  formatPlatformScope,
  printPlatformScopeLegend,
  printTableRow,
} from "./env-table-format.mjs";
import { syncDim, syncInfo, syncSuccess, syncWarn } from "./cli-style.mjs";

/** @typedef {import("./push-plan.mjs").TPushPlan} TPushPlan */

const MAX_ROWS = 80;

/**
 * @param {TPushPlan} plan
 * @param {Map<string, string>} remoteConvex
 * @param {Map<string, string> | null} remoteVercel
 */
function buildVerificationRows(plan, remoteConvex, remoteVercel) {
  const { out: convexExpected } = filterForConvexWithWarnings(plan.localMap);
  const vercelExpected = filterForVercel(plan.localMap);
  const scopes = buildPlatformScopeMap(plan.localMap);

  /** @type {Array<{ key: string; scope: import("./env-platform-scope.mjs").TPlatformScope; convex: boolean | null; vercel: boolean | null; note?: string }>} */
  const rows = [];

  for (const [key, scope] of scopes) {
    if (scope === "local") continue;

    const expectConvex = scope === "both" || scope === "convex";
    const expectVercel = scope === "both" || scope === "vercel";
    const localConvexVal = convexExpected.get(key);
    const localVercelVal = vercelExpected.get(key);

    /** @type {boolean | null} */
    let convexOk = null;
    /** @type {boolean | null} */
    let vercelOk = null;
    let note;

    if (expectConvex) {
      if (localConvexVal === undefined) {
        convexOk = null;
        note = "skipped (localhost)";
      } else {
        const remoteVal = remoteConvex.get(key);
        convexOk =
          remoteVal !== undefined && remoteVal === localConvexVal;
      }
    }

    if (expectVercel && remoteVercel) {
      const remoteVal = remoteVercel.get(key);
      vercelOk =
        remoteVal !== undefined && remoteVal === (localVercelVal ?? "");
    } else if (expectVercel && !remoteVercel) {
      vercelOk = null;
    }

    rows.push({ key, scope, convex: convexOk, vercel: vercelOk, note });
  }

  rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows;
}

/**
 * @param {TPushPlan} plan
 */
export async function printPushVerification(plan) {
  if (plan.convexOnly) {
    syncDim(`Skipping Vercel column for ${plan.target} (convex-only push).`);
  }

  syncInfo(`Verifying hosted env for "${plan.target}" after push…`);

  const convexCliEnv = plan.convexCliEnv;
  const remoteConvex = plan.fromSync
    ? fetchConvexEnvMapOptions({
        useProd: inferConvexUseProdFromLocalMap(plan.localMap, plan.target),
        convexEnv: convexCliEnv,
      })
    : fetchConvexEnvMap(plan.target, convexCliEnv);
  const remoteVercel = plan.convexOnly ? null : fetchVercelEnvMap(plan.target);

  const rows = buildVerificationRows(plan, remoteConvex, remoteVercel);
  const failures = rows.filter(
    (r) => r.convex === false || r.vercel === false
  );

  console.log("");
  syncInfo(
    `══════════ Push verification: ${plan.target} (${rows.length} routed key(s)) ══════════`
  );
  console.log("");

  const scopeW = 14;
  const keyW = 28;
  const hostW = 6;
  const widths = [scopeW, keyW, hostW, hostW];

  printTableRow(
    ["Scope", "Variable", "Convex", "Vercel"],
    widths
  );
  printTableRow(widths.map((w) => "─".repeat(w)), widths);

  const shown = rows.slice(0, MAX_ROWS);
  for (const row of shown) {
    printTableRow(
      [
        formatPlatformScope(row.scope),
        row.key,
        formatHostStatus(row.convex),
        formatHostStatus(row.vercel),
      ],
      widths
    );
  }
  if (rows.length > MAX_ROWS) {
    syncDim(`  … and ${rows.length - MAX_ROWS} more key(s).`);
  }

  console.log("");
  printPlatformScopeLegend();
  syncDim("  Host columns: ✓ = present with expected value · ✗ = missing or mismatch · — = not routed there");

  if (failures.length === 0) {
    syncSuccess(
      `All ${rows.length} routed variable(s) verified on their target platform(s).`
    );
  } else {
    syncWarn(
      `${failures.length} key(s) failed verification — re-run pull or check dashboard.`
    );
    for (const f of failures.slice(0, 12)) {
      const parts = [];
      if (f.convex === false) parts.push("Convex");
      if (f.vercel === false) parts.push("Vercel");
      syncWarn(`  • ${f.key} (${parts.join(", ")})`);
    }
  }
  console.log("");
}

/**
 * @param {TPushPlan[]} plans
 */
export async function printPushVerifications(plans) {
  for (const plan of plans) {
    await printPushVerification(plan);
  }
}
