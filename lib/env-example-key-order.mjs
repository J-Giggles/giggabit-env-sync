/**
 * Key order from `.env.example` (template order, then extras alphabetically).
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.mjs";

/**
 * If the line is a assignable `KEY=...` (not a comment), return the key.
 *
 * @param {string} line
 * @returns {string | null}
 */
export function envLineKey(line) {
  let t = line.trim();
  if (!t || t.startsWith("#")) return null;
  if (t.startsWith("export ")) {
    t = t.slice(7).trim();
  }
  const eq = t.indexOf("=");
  if (eq <= 0) return null;
  const key = t.slice(0, eq).trim();
  if (!key || key.includes(" ")) return null;
  return key;
}

/**
 * Ordered keys from `.env.example` (first existing template at repo root).
 *
 * @param {string} [repoRoot]
 * @returns {string[]}
 */
export function loadEnvExampleKeyOrder(repoRoot = REPO_ROOT) {
  const abs = path.join(repoRoot, ".env.example");
  if (!fs.existsSync(abs)) return [];
  /** @type {string[]} */
  const keys = [];
  for (const line of fs.readFileSync(abs, "utf8").split(/\r?\n/)) {
    const k = envLineKey(line);
    if (k) keys.push(k);
  }
  return keys;
}

/**
 * Sort keys: template order first, then keys not in template (A–Z).
 *
 * @param {Iterable<string>} keys
 * @param {string[]} [exampleOrder]
 */
export function sortKeysLikeEnvExample(keys, exampleOrder) {
  const order = exampleOrder ?? loadEnvExampleKeyOrder();
  const index = new Map(order.map((k, i) => [k, i]));
  return [...keys].sort((a, b) => {
    const ia = index.has(a) ? index.get(a) : Number.MAX_SAFE_INTEGER;
    const ib = index.has(b) ? index.get(b) : Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}

/**
 * @template {{ key: string }} T
 * @param {T[]} rows
 * @param {string[]} [exampleOrder]
 * @returns {T[]}
 */
export function sortRowsByEnvExampleKeyOrder(rows, exampleOrder) {
  const order = exampleOrder ?? loadEnvExampleKeyOrder();
  const index = new Map(order.map((k, i) => [k, i]));
  return [...rows].sort((a, b) => {
    const ia = index.has(a.key) ? index.get(a.key) : Number.MAX_SAFE_INTEGER;
    const ib = index.has(b.key) ? index.get(b.key) : Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.key.localeCompare(b.key);
  });
}
