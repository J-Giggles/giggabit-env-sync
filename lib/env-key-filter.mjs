/**
 * Optional key filters for pull/push (exact names and `*` globs).
 */

/**
 * @typedef {{
 *   patterns: RegExp[];
 *   exactKeys?: Set<string>;
 *   raw: string;
 * }} TKeyFilter
 */

/**
 * @param {string} part
 */
function globPartToRegExp(part) {
  const escaped = part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}

/**
 * Parse comma/space-separated keys and globs (e.g. `AWS_*,WORKOS_API_KEY`).
 *
 * @param {string} input
 * @returns {TKeyFilter | null} `null` = no filter (all keys)
 */
export function parseKeyFilterInput(input) {
  const parts = input
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length === 0) return null;
  const patterns = parts.map((p) =>
    p.includes("*") ? globPartToRegExp(p) : globPartToRegExp(p)
  );
  return { patterns, raw: parts.join(", ") };
}

/**
 * @param {string} key
 * @param {TKeyFilter | null | undefined} filter
 */
/**
 * @param {Iterable<string>} keys
 */
export function keyFilterFromExactKeys(keys) {
  const list = [...keys].sort();
  if (list.length === 0) return null;
  return {
    patterns: [],
    exactKeys: new Set(list),
    raw: list.join(", "),
  };
}

export function keyMatchesFilter(key, filter) {
  if (!filter) return true;
  if (filter.exactKeys) return filter.exactKeys.has(key);
  return filter.patterns.some((re) => re.test(key));
}

/**
 * @param {Iterable<string>} keys
 * @param {TKeyFilter} filter
 */
export function listKeysMatchingFilter(keys, filter) {
  return [...keys].filter((k) => keyMatchesFilter(k, filter)).sort();
}
