/**
 * Terminal tables for planned env:sync pushes (before applying).
 * Multi-target previews use environment columns (like pull cross-env diff).
 */
import { classifyKeyPlatformScope } from "./env-platform-scope.mjs";
import { ENV_TABLE_NOISE_KEY } from "./env-table-groups.mjs";
import { sortRowsByEnvExampleKeyOrder } from "./env-example-key-order.mjs";
import {
  formatPlatformScope,
  formatPushChangeCell,
  printPlatformScopeLegend,
  printTableRow,
} from "./env-table-format.mjs";
import { syncDim, syncInfo, syncWarn } from "./cli-style.mjs";

/** @typedef {import("./push-plan.mjs").TPushPlan} TPushPlan */
/** @typedef {import("./push-plan.mjs").TPushKeyChange} TPushKeyChange */
/** @typedef {import("./remote.mjs").TTarget} TTarget */

/** @type {Array<{ target: TTarget; label: string }>} */
const PUSH_ENV_COLUMNS = [
  { target: "dev", label: "development" },
  { target: "preview", label: "preview" },
  { target: "prod", label: "production" },
];

const DEFAULT_MAX_ROWS = 120;

/**
 * @param {TPushPlan} plan
 */
function collectUnifiedChangeRows(plan) {
  /** @type {Map<string, { scope: ReturnType<typeof classifyKeyPlatformScope>; convex?: TPushKeyChange; vercel?: TPushKeyChange }>} */
  const byKey = new Map();
  for (const ch of plan.convexChanges) {
    const e = byKey.get(ch.key) ?? {
      scope: classifyKeyPlatformScope(ch.key, plan.localMap.get(ch.key)),
    };
    e.convex = ch;
    byKey.set(ch.key, e);
  }
  for (const ch of plan.vercelChanges) {
    const e = byKey.get(ch.key) ?? {
      scope: classifyKeyPlatformScope(ch.key, plan.localMap.get(ch.key)),
    };
    e.vercel = ch;
    e.scope = classifyKeyPlatformScope(ch.key, plan.localMap.get(ch.key));
    byKey.set(ch.key, e);
  }

  return [...byKey.entries()].map(([key, row]) => ({ key, ...row }));
}

/**
 * @param {TPushPlan[]} plans
 * @param {Array<{ target: TTarget; label: string }>} columns
 */
function collectCrossEnvPushRows(plans, columns) {
  const planByTarget = new Map(plans.map((p) => [p.target, p]));
  /** @type {Map<string, { group: string; scope: ReturnType<typeof classifyKeyPlatformScope>; slots: Array<{ convex?: TPushKeyChange; vercel?: TPushKeyChange } | null> }>} */
  const matrix = new Map();

  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    const col = columns[colIdx];
    const plan = planByTarget.get(col.target);
    if (!plan) continue;
    for (const row of collectUnifiedChangeRows(plan)) {
      if (ENV_TABLE_NOISE_KEY.test(row.key)) continue;
      let entry = matrix.get(row.key);
      if (!entry) {
        entry = {
          scope: row.scope,
          slots: Array.from({ length: columns.length }, () => null),
        };
        matrix.set(row.key, entry);
      }
      entry.slots[colIdx] = { convex: row.convex, vercel: row.vercel };
      entry.scope = row.scope;
    }
  }

  return sortRowsByEnvExampleKeyOrder(
    [...matrix.entries()].map(([key, row]) => ({
      key,
      scope: row.scope,
      cells: row.slots.map((slot) =>
        slot
          ? formatPushChangeCell(key, slot.convex, slot.vercel)
          : formatPushChangeCell(key, undefined, undefined)
      ),
    }))
  );
}

/**
 * @param {TPushPlan} plan
 */
function printPlanWarnings(plan) {
  const label =
    PUSH_ENV_COLUMNS.find((c) => c.target === plan.target)?.label ?? plan.target;
  const notes = [];
  if (plan.driftConvex || plan.driftVercel) {
    const parts = [];
    if (plan.driftConvex) parts.push("Convex drift");
    if (plan.driftVercel) parts.push("Vercel drift");
    notes.push(`hosted drift (${parts.join(", ")})`);
  }
  if (plan.localChangedSinceLastPush) notes.push("local file changed since last push");
  if (plan.convexDroppedLocalhost.length > 0) {
    notes.push(`not sent to Convex: ${plan.convexDroppedLocalhost.join(", ")}`);
  }
  if (notes.length === 0) return;
  syncWarn(`  ${label} ← ${plan.localRel}: ${notes.join(" · ")}`);
}

/**
 * @param {TPushPlan[]} plans
 * @param {Array<{ target: TTarget; label: string }>} columns
 */
/**
 * @param {TPushPlan[]} plans
 * @param {Array<{ target: TTarget; label: string }>} columns
 * @param {{ maxRows?: number }} [opts]
 */
function printCrossEnvPushTable(plans, columns, opts = {}) {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  const rows = collectCrossEnvPushRows(plans, columns);
  if (rows.length === 0) {
    syncDim("  No hosted changes (remote already matches local for routed keys).");
    return;
  }

  const scopeW = 14;
  const keyW = Math.min(
    36,
    Math.max(24, ...rows.map((r) => r.key.length), "Variable".length)
  );
  const valW = Math.max(
    28,
    Math.min(
      52,
      Math.floor(
        ((process.stdout.columns || 120) - scopeW - keyW - columns.length * 3 - 6) /
          columns.length
      )
    )
  );
  const widths = [scopeW, keyW, ...columns.map(() => valW)];

  printTableRow(["Scope", "Variable", ...columns.map((c) => c.label)], widths);
  printTableRow(widths.map((w) => "─".repeat(w)), widths);

  const shown = rows.slice(0, maxRows);
  for (const row of shown) {
    printTableRow(
      [formatPlatformScope(row.scope), row.key, ...row.cells],
      widths
    );
  }
  if (rows.length > maxRows) {
    syncDim(`  … and ${rows.length - maxRows} more key(s).`);
  }
}

/**
 * @param {TPushPlan} plan
 */
export function printPushPlan(plan) {
  console.log("");
  syncInfo(
    `Push plan: ${plan.target} ← ${plan.localRel}${plan.fromSync ? " (from-sync)" : ""}${plan.force ? " (--force)" : ""}`
  );
  printPlanWarnings(plan);
  syncDim(
    `  Convex ${plan.convexKind}${plan.convexSlug ? ` (${plan.convexSlug})` : ""} · ${plan.convexChanges.length} change(s), ${plan.convexSkipped} skipped · Vercel ${plan.vercelEnv ?? "—"} · ${plan.vercelChanges.length} change(s), ${plan.vercelSkipped} skipped`
  );

  const columns = PUSH_ENV_COLUMNS.filter((c) => c.target === plan.target);
  console.log("");
  syncDim(`  Planned writes (${columns[0]?.label ?? plan.target}) — remote → after push:`);
  printCrossEnvPushTable([plan], columns);

  const total = plan.convexChanges.length + plan.vercelChanges.length;
  syncDim(`  Total key writes (Convex + Vercel rows): ${total}`);
}

/**
 * @param {TPushPlan[]} plans
 * @param {{
 *   keyFilter?: import("./env-key-filter.mjs").TKeyFilter | null;
 *   maxTableRows?: number;
 * }} [opts]
 */
export function printPushPlans(plans, opts = {}) {
  if (plans.length === 0) return;
  const keyFilter = opts.keyFilter ?? null;
  const maxTableRows = opts.maxTableRows ?? DEFAULT_MAX_ROWS;

  const columns =
    plans.length === 1
      ? PUSH_ENV_COLUMNS.filter((c) => c.target === plans[0].target)
      : PUSH_ENV_COLUMNS.filter((c) =>
          plans.some((p) => p.target === c.target)
        );

  console.log("");
  syncInfo("══════════ Push preview (hosted changes if you approve) ══════════");
  if (keyFilter) {
    syncDim(`  Key filter: ${keyFilter.raw}`);
  }
  syncDim(
    `  Sources: ${plans.map((p) => `${p.target} ← ${p.localRel}`).join(" · ")}`
  );
  syncDim(
    "  Cells show remote → value after push; — = no write for that environment. Row order follows `.env.example`."
  );

  const anyWarnings = plans.some(
    (p) =>
      p.driftConvex ||
      p.driftVercel ||
      p.localChangedSinceLastPush ||
      p.convexDroppedLocalhost.length > 0
  );
  if (anyWarnings) {
    console.log("");
    syncWarn("Warnings:");
    for (const plan of plans) printPlanWarnings(plan);
  }

  console.log("");
  const rowCount = collectCrossEnvPushRows(plans, columns).length;
  syncInfo(
    `Cross-environment push preview (${rowCount} key(s) with writes) — columns: ${columns.map((c) => c.label).join(", ")}`
  );
  console.log("");

  printCrossEnvPushTable(plans, columns, { maxRows: maxTableRows });

  let grandTotal = 0;
  for (const plan of plans) {
    syncDim(
      `  ${plan.target}: Convex ${plan.convexChanges.length} + Vercel ${plan.vercelChanges.length} row write(s)`
    );
    grandTotal += plan.convexChanges.length + plan.vercelChanges.length;
  }

  console.log("");
  syncInfo(
    `Grand total: ${grandTotal} key write(s) across ${plans.length} target(s).`
  );
  printPlatformScopeLegend();
  syncDim(
    "  Cell: (missing) or current remote → value after push · add/change inferred from remote state"
  );
  console.log("");
}

/**
 * @param {TPushPlan[]} plans
 */
export function countPushPreviewTableRows(plans) {
  if (plans.length === 0) return 0;
  const columns =
    plans.length === 1
      ? PUSH_ENV_COLUMNS.filter((c) => c.target === plans[0].target)
      : PUSH_ENV_COLUMNS.filter((c) => plans.some((p) => p.target === c.target));
  return collectCrossEnvPushRows(plans, columns).length;
}
