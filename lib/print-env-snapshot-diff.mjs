/**
 * Print a terminal table of env keys whose values differ across `.env.sync.*` snapshots.
 */
import fs from "node:fs";
import path from "node:path";
import { parseDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT } from "./paths.mjs";
import { classifyKeyPlatformScope } from "./env-platform-scope.mjs";
import {
  ENV_TABLE_NOISE_KEY,
  ENV_ROW_GROUPS,
  envKeyRowGroup,
} from "./env-table-groups.mjs";
import {
  formatEnvValue,
  formatPlatformScope,
  printPlatformScopeLegend,
  printTableRow,
} from "./env-table-format.mjs";
import { syncDim, syncInfo } from "./cli-style.mjs";

/** @typedef {{ label: string; rel: string; fallbackRel?: string }} TSnapshotColumnSource */

/** @type {TSnapshotColumnSource[]} */
const SNAPSHOT_COLUMNS = [
  { label: "development", rel: ".env.sync.development", fallbackRel: ".env.sync.merge.dev" },
  { label: "preview", rel: ".env.sync.preview", fallbackRel: ".env.sync.merge.preview" },
  { label: "production", rel: ".env.sync.production", fallbackRel: ".env.sync.merge.prod" },
];

/**
 * @param {string} rel
 * @returns {string | null}
 */
function readSnapshotRel(rel) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

/**
 * Load available snapshot columns (primary `.env.sync.<env>` or merge fallback).
 *
 * @returns {Array<{ label: string; rel: string; map: Map<string, string> }>}
 */
export function loadEnvSnapshotColumns() {
  /** @type {Array<{ label: string; rel: string; map: Map<string, string> }>} */
  const loaded = [];
  for (const col of SNAPSHOT_COLUMNS) {
    const content =
      readSnapshotRel(col.rel) ??
      (col.fallbackRel ? readSnapshotRel(col.fallbackRel) : null);
    if (!content) continue;
    const rel =
      fs.existsSync(path.join(REPO_ROOT, col.rel)) ? col.rel : col.fallbackRel ?? col.rel;
    loaded.push({ label: col.label, rel, map: parseDotenv(content) });
  }
  return loaded;
}

/**
 * @param {string | undefined} raw
 */
function sampleValueForScope(raw) {
  if (raw === undefined || raw === "") return undefined;
  return raw;
}

/**
 * @param {Array<{ label: string; rel: string; map: Map<string, string> }>} columns
 */
function collectDiffRows(columns) {
  const allKeys = new Set();
  for (const col of columns) {
    for (const k of col.map.keys()) allKeys.add(k);
  }

  const groupOrder = [...ENV_ROW_GROUPS.map((g) => g.name), "Other"];

  /** @type {Array<{ group: string; key: string; scope: ReturnType<typeof classifyKeyPlatformScope>; cells: string[] }>} */
  const rows = [];
  for (const key of [...allKeys].sort()) {
    if (ENV_TABLE_NOISE_KEY.test(key)) continue;
    const raw = columns.map((c) => c.map.get(key));
    const norm = raw.map((v) => (v === undefined ? "\0MISS\0" : v === "" ? "\0EMPTY\0" : v));
    const allSame = norm.every((v) => v === norm[0]);
    if (!allSame) {
      const sample =
        raw.find((v) => v !== undefined && v !== "") ?? raw.find((v) => v !== undefined);
      rows.push({
        group: envKeyRowGroup(key),
        key,
        scope: classifyKeyPlatformScope(key, sampleValueForScope(sample)),
        cells: raw.map((v) => formatEnvValue(key, v)),
      });
    }
  }
  rows.sort((a, b) => {
    const ga = groupOrder.indexOf(a.group);
    const gb = groupOrder.indexOf(b.group);
    if (ga !== gb) return ga - gb;
    return a.key.localeCompare(b.key);
  });
  return rows;
}

/**
 * Print cross-environment diff when at least two snapshot files exist.
 *
 * @param {{ minColumns?: number }} [opts]
 * @returns {boolean} Whether a table was printed
 */
export function printEnvSnapshotDiffTable(opts = {}) {
  const minColumns = opts.minColumns ?? 2;
  const columns = loadEnvSnapshotColumns();
  if (columns.length < minColumns) {
    syncDim(
      `Skipping cross-env diff table (need ${minColumns}+ of .env.sync.development / .preview / .production).`
    );
    return false;
  }

  const rows = collectDiffRows(columns);
  const scopeW = 14;
  const keyW = Math.min(
    36,
    Math.max(24, ...rows.map((r) => r.key.length), "Variable".length)
  );
  const valW = Math.max(
    24,
    Math.min(
      48,
      Math.floor(
        ((process.stdout.columns || 120) - scopeW - keyW - columns.length * 3 - 6) /
          columns.length
      )
    )
  );
  const widths = [scopeW, keyW, ...columns.map(() => valW)];

  console.log("");
  syncInfo(
    `Cross-environment diff (${rows.length} key(s) differ) — sources: ${columns.map((c) => c.rel).join(", ")}`
  );
  console.log("");

  printTableRow(["Scope", "Variable", ...columns.map((c) => c.label)], widths);
  printTableRow(widths.map((w) => "─".repeat(w)), widths);

  let lastGroup = "";
  for (const row of rows) {
    if (row.group !== lastGroup) {
      if (lastGroup) console.log("");
      syncDim(`── ${row.group} ──`);
      lastGroup = row.group;
    }
    printTableRow(
      [formatPlatformScope(row.scope), row.key, ...row.cells],
      widths
    );
  }

  if (rows.length === 0) {
    syncDim("All keys match across loaded snapshots (excluding Vercel/Turbo noise keys).");
  }

  console.log("");
  printPlatformScopeLegend();
  syncDim(
    "  Values: (missing) = absent in that snapshot · (empty) = blank · secrets shortened"
  );
  return true;
}

/**
 * @returns {boolean}
 */
export function reportEnvSnapshotDiffIfReady() {
  return printEnvSnapshotDiffTable();
}
