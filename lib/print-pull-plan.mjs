/**
 * Terminal tables for planned env:sync pulls (before writing local files).
 */
import { classifyKeyPlatformScope } from "./env-platform-scope.mjs";
import { ENV_TABLE_NOISE_KEY } from "./env-table-groups.mjs";
import { sortRowsByEnvExampleKeyOrder } from "./env-example-key-order.mjs";
import {
  formatPlatformScope,
  formatPullChangeCell,
  printPlatformScopeLegend,
  printTableRow,
} from "./env-table-format.mjs";
import { PULL_ENV_COLUMNS } from "./pull-plan.mjs";
import { syncDim, syncInfo } from "./cli-style.mjs";

/** @typedef {import("./pull-plan.mjs").TPullPlan} TPullPlan */
/** @typedef {import("./pull-plan.mjs").TPullKeyChange} TPullKeyChange */

/** @type {number} */
const DEFAULT_MAX_ROWS = 120;

/**
 * @param {TPullPlan[]} plans
 * @param {Array<{ target: import("./remote.mjs").TTarget; label: string }>} columns
 */
function collectCrossEnvPullRows(plans, columns) {
  const planByTarget = new Map(plans.map((p) => [p.target, p]));
  /** @type {Map<string, { group: string; scope: ReturnType<typeof classifyKeyPlatformScope>; slots: Array<TPullKeyChange | null> }>} */
  const matrix = new Map();

  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    const col = columns[colIdx];
    const plan = planByTarget.get(col.target);
    if (!plan) continue;
    for (const ch of plan.changes) {
      if (ENV_TABLE_NOISE_KEY.test(ch.key)) continue;
      let entry = matrix.get(ch.key);
      if (!entry) {
        entry = {
          scope: classifyKeyPlatformScope(ch.key, ch.after ?? ch.before),
          slots: Array.from({ length: columns.length }, () => null),
        };
        matrix.set(ch.key, entry);
      }
      entry.slots[colIdx] = ch;
      entry.scope = classifyKeyPlatformScope(ch.key, ch.after ?? ch.before);
    }
  }

  return sortRowsByEnvExampleKeyOrder(
    [...matrix.entries()].map(([key, row]) => ({
      key,
      scope: row.scope,
      cells: row.slots.map((slot) => formatPullChangeCell(key, slot ?? undefined)),
    }))
  );
}

/**
 * @param {TPullPlan[]} plans
 * @param {Array<{ target: import("./remote.mjs").TTarget; label: string }>} columns
 */
/**
 * @param {TPullPlan[]} plans
 * @param {Array<{ target: import("./remote.mjs").TTarget; label: string }>} columns
 * @param {{ maxRows?: number }} [opts]
 */
function printCrossEnvPullTable(plans, columns, opts = {}) {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  const rows = collectCrossEnvPullRows(plans, columns);
  if (rows.length === 0) {
    syncDim("  No local file changes (hosted env matches on-disk values for routed keys).");
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
 * @param {TPullPlan[]} plans
 * @param {{
 *   keyFilter?: import("./env-key-filter.mjs").TKeyFilter | null;
 *   maxTableRows?: number;
 * }} [opts]
 */
export function printPullPlans(plans, opts = {}) {
  if (plans.length === 0) return;
  const keyFilter = opts.keyFilter ?? null;
  const maxTableRows = opts.maxTableRows ?? DEFAULT_MAX_ROWS;

  const columns =
    plans.length === 1
      ? PULL_ENV_COLUMNS.filter((c) => c.target === plans[0].target)
      : PULL_ENV_COLUMNS.filter((c) => plans.some((p) => p.target === c.target));

  console.log("");
  syncInfo("══════════ Pull preview (local file changes if you approve) ══════════");
  if (keyFilter) {
    syncDim(`  Key filter: ${keyFilter.raw}`);
  }
  syncDim(
    `  Destinations: ${plans.map((p) => `${p.columnLabel} → ${p.destRel}`).join(" · ")}`
  );
  syncDim(
    "  Cells show current local value → value after pull; — = no change in that file. Row order follows `.env.example`."
  );

  const rowCount = collectCrossEnvPullRows(plans, columns).length;
  console.log("");
  syncInfo(
    `Cross-environment pull preview (${rowCount} key(s) would change) — columns: ${columns.map((c) => c.label).join(", ")}`
  );
  console.log("");

  printCrossEnvPullTable(plans, columns, { maxRows: maxTableRows });

  const total = plans.reduce((n, p) => n + p.changes.length, 0);
  console.log("");
  syncInfo(`Total: ${total} local key update(s) across ${plans.length} file(s).`);
  printPlatformScopeLegend();
  syncDim(
    "  Cell: current on disk → after pull · add / change / remove inferred from file state"
  );
  console.log("");
}

/**
 * Row count for the cross-environment pull preview table.
 *
 * @param {TPullPlan[]} plans
 */
export function countPullPreviewTableRows(plans) {
  if (plans.length === 0) return 0;
  const columns =
    plans.length === 1
      ? PULL_ENV_COLUMNS.filter((c) => c.target === plans[0].target)
      : PULL_ENV_COLUMNS.filter((c) => plans.some((p) => p.target === c.target));
  return collectCrossEnvPullRows(plans, columns).length;
}
