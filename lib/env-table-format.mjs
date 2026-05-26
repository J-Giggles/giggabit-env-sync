/**
 * Shared terminal table helpers and platform-scope colors for env:sync tables.
 */
import { classifyKeyPlatformScope } from "./env-platform-scope.mjs";

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
};

export const SECRET_KEY = /SECRET|TOKEN|PASSWORD|PRIVATE|_KEY$|API_KEY/i;

/** @typedef {import("./env-platform-scope.mjs").TPlatformScope} TPlatformScope */

/**
 * Visible length (ignores ANSI escape sequences).
 *
 * @param {string} text
 */
export function visibleLength(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/**
 * @param {string} text
 * @param {number} width
 */
export function padVisible(text, width) {
  const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
  if (plain.length >= width) {
    return text.slice(0, text.length - (plain.length - width));
  }
  return text + " ".repeat(width - plain.length);
}

/**
 * @param {string[]} cells
 * @param {number[]} widths
 */
export function printTableRow(cells, widths) {
  console.log(cells.map((cell, i) => padVisible(cell, widths[i])).join(" │ "));
}

/**
 * @param {TPlatformScope} scope
 * @returns {string}
 */
export function formatPlatformScope(scope) {
  switch (scope) {
    case "both":
      return `${c.green}${c.bold}both${c.reset}`;
    case "convex":
      return `${c.yellow}convex${c.reset}`;
    case "vercel":
      return `${c.magenta}vercel${c.reset}`;
    default:
      return `${c.dim}local${c.reset}`;
  }
}

/**
 * @param {string} key
 * @param {string | undefined} value
 * @param {Map<string, string>} [localMap] — when set, use map value for scope
 */
export function formatKeyWithScope(key, value, localMap) {
  const v = localMap?.get(key) ?? value;
  const scope = classifyKeyPlatformScope(key, v);
  return `${formatPlatformScope(scope)}  ${c.dim}${key}${c.reset}`;
}

/**
 * @param {string} key
 * @param {string | undefined} value
 */
export function formatEnvValue(key, value) {
  if (value === undefined) return `${c.dim}(missing)${c.reset}`;
  if (value === "") return `${c.dim}(empty)${c.reset}`;
  if (SECRET_KEY.test(key) && value.length > 10) {
    return `${value.slice(0, 6)}…${value.slice(-4)} (${value.length})`;
  }
  if (value.length > 48) return `${value.slice(0, 44)}…`;
  return value;
}

/**
 * One planned write for a target column: remote (or missing) → local value after push.
 *
 * @param {string} key
 * @param {{ remote?: string; local: string; action?: string } | undefined} convex
 * @param {{ remote?: string; local: string; action?: string } | undefined} vercel
 */
export function formatPushChangeCell(key, convex, vercel) {
  const arrow = `${c.dim}→${c.reset}`;
  if (!convex && !vercel) return `${c.dim}—${c.reset}`;

  const ch = convex ?? vercel;
  const to = formatEnvValue(key, ch?.local);

  if (
    convex &&
    vercel &&
    (convex.remote !== vercel.remote ||
      convex.local !== vercel.local ||
      convex.action !== vercel.action)
  ) {
    const cFrom = formatEnvValue(key, convex.remote);
    const vFrom = formatEnvValue(key, vercel.remote);
    return `C:${cFrom} V:${vFrom} ${arrow} ${to}`;
  }

  const from = formatEnvValue(key, ch?.remote);
  return `${from} ${arrow} ${to}`;
}

/**
 * Local file value before pull → after pull.
 *
 * @param {string} key
 * @param {{ before?: string; after?: string } | undefined} change
 */
export function formatPullChangeCell(key, change) {
  const arrow = `${c.dim}→${c.reset}`;
  if (!change) return `${c.dim}—${c.reset}`;
  const from = formatEnvValue(key, change.before);
  const to = formatEnvValue(key, change.after);
  return `${from} ${arrow} ${to}`;
}

/**
 * @param {boolean | null} ok — `true` ok, `false` missing/wrong, `null` not applicable
 */
export function formatHostStatus(ok) {
  if (ok === null) return `${c.dim}—${c.reset}`;
  if (ok) return `${c.green}✓${c.reset}`;
  return `${c.red}✗${c.reset}`;
}

/**
 * Print platform-scope legend below tables.
 */
export function printPlatformScopeLegend() {
  console.log(
    `  Scope colors: ${formatPlatformScope("both")} = Convex + Vercel · ${formatPlatformScope("convex")} = Convex only · ${formatPlatformScope("vercel")} = Vercel only · ${formatPlatformScope("local")} = local file only (not pushed)`
  );
}
