/**
 * Print a terminal table of env keys whose values differ across `.env.sync.*` snapshots.
 */
import fs from "node:fs";
import path from "node:path";
import { parseDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT } from "./paths.mjs";
import { syncDim, syncInfo } from "./cli-style.mjs";

/** @typedef {{ label: string; rel: string; fallbackRel?: string }} TSnapshotColumnSource */

/** @type {TSnapshotColumnSource[]} */
const SNAPSHOT_COLUMNS = [
  { label: "development", rel: ".env.sync.development", fallbackRel: ".env.sync.merge.dev" },
  { label: "preview", rel: ".env.sync.preview", fallbackRel: ".env.sync.merge.preview" },
  { label: "production", rel: ".env.sync.production", fallbackRel: ".env.sync.merge.prod" },
];

/** @type {Array<{ name: string; re: RegExp }>} */
const ROW_GROUPS = [
  { name: "URLs & Convex", re: /^(APP_URL|NEXT_PUBLIC_|CONVEX_|E2E_|PLAYWRIGHT_|ZOOM_|WORKOS_REDIRECT|NODE_ENV)/ },
  { name: "WorkOS", re: /^WORKOS_/ },
  { name: "AWS", re: /^AWS_/ },
  { name: "B2", re: /^B2_/ },
  { name: "Nylas", re: /^NYLAS_/ },
  { name: "Feature flags", re: /^NEXT_PUBLIC_EMAIL_/ },
  { name: "Vercel / Turbo", re: /^(VERCEL_|TURBO_|NX_)/ },
];

const SECRET_KEY = /SECRET|TOKEN|PASSWORD|PRIVATE|_KEY$|API_KEY/i;

/** Keys injected by `vercel env pull` with no stable app meaning. */
const NOISE_KEY =
  /^VERCEL_GIT_|^VERCEL_OIDC|^VERCEL_URL$|^VERCEL$|^VERCEL_ENV$|^VERCEL_TARGET_ENV$/;

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
 * @param {string} key
 * @param {string | undefined} value
 */
function formatCell(key, value) {
  if (value === undefined) return "(missing)";
  if (value === "") return "(empty)";
  if (SECRET_KEY.test(key) && value.length > 10) {
    return `${value.slice(0, 6)}…${value.slice(-4)} (${value.length})`;
  }
  if (value.length > 48) return `${value.slice(0, 44)}…`;
  return value;
}

/**
 * @param {string} key
 */
function rowGroup(key) {
  for (const g of ROW_GROUPS) {
    if (g.re.test(key)) return g.name;
  }
  return "Other";
}

/**
 * @param {Array<{ label: string; rel: string; map: Map<string, string> }>} columns
 */
function collectDiffRows(columns) {
  const allKeys = new Set();
  for (const col of columns) {
    for (const k of col.map.keys()) allKeys.add(k);
  }

  const groupOrder = [...ROW_GROUPS.map((g) => g.name), "Other"];

  /** @type {Array<{ group: string; key: string; cells: string[] }>} */
  const rows = [];
  for (const key of [...allKeys].sort()) {
    if (NOISE_KEY.test(key)) continue;
    const raw = columns.map((c) => c.map.get(key));
    const norm = raw.map((v) => (v === undefined ? "\0MISS\0" : v === "" ? "\0EMPTY\0" : v));
    const allSame = norm.every((v) => v === norm[0]);
    if (allSame) continue;
    rows.push({
      group: rowGroup(key),
      key,
      cells: raw.map((v) => formatCell(key, v)),
    });
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
 * @param {string} text
 * @param {number} width
 */
function pad(text, width) {
  if (text.length >= width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

/**
 * @param {string[]} headers
 * @param {number[]} widths
 */
function printRow(headers, widths) {
  const parts = headers.map((h, i) => pad(h, widths[i]));
  console.log(parts.join(" │ "));
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
  const keyW = Math.min(
    40,
    Math.max(28, ...rows.map((r) => r.key.length), "Variable".length)
  );
  const valW = Math.max(
    28,
    Math.min(
      52,
      Math.floor(((process.stdout.columns || 120) - keyW - columns.length * 3 - 4) / columns.length)
    )
  );
  const widths = [keyW, ...columns.map(() => valW)];

  console.log("");
  syncInfo(
    `Cross-environment diff (${rows.length} key(s) differ) — sources: ${columns.map((c) => c.rel).join(", ")}`
  );
  console.log("");

  const header = ["Variable", ...columns.map((c) => c.label)];
  printRow(header, widths);
  printRow(widths.map((w) => "─".repeat(w)), widths);

  let lastGroup = "";
  for (const row of rows) {
    if (row.group !== lastGroup) {
      if (lastGroup) console.log("");
      syncDim(`── ${row.group} ──`);
      lastGroup = row.group;
    }
    printRow([row.key, ...row.cells], widths);
  }

  if (rows.length === 0) {
    syncDim("All keys match across loaded snapshots (excluding Vercel/Turbo noise keys).");
  }

  console.log("");
  syncDim(
    "Legend: (missing) = absent · (empty) = set but blank · secrets shortened as prefix…suffix (len)"
  );
  return true;
}

/**
 * Convenience wrapper after pull completes.
 *
 * @returns {boolean}
 */
export function reportEnvSnapshotDiffIfReady() {
  return printEnvSnapshotDiffTable();
}
