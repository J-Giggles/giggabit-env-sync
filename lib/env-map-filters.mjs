/**
 * Map filters for `--missing-only` pull/push (fill gaps without overwriting).
 */

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
export function isNonEmptyEnvValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Merge `remote` into `local` without overwriting keys already in `local`.
 *
 * @param {Map<string, string>} local
 * @param {Map<string, string>} remote
 * @returns {Map<string, string>}
 */
export function mergeRemoteKeysMissingIntoLocal(local, remote) {
  const out = new Map(local);
  for (const [k, v] of remote) {
    if (!out.has(k)) out.set(k, v);
  }
  return out;
}

/**
 * Count keys present in `remote` but absent from `local`.
 *
 * @param {Map<string, string>} local
 * @param {Map<string, string>} remote
 * @returns {number}
 */
export function countKeysMissingFromLocal(local, remote) {
  let n = 0;
  for (const k of remote.keys()) {
    if (!local.has(k)) n++;
  }
  return n;
}

/**
 * Local keys absent on `remote` with a non-empty local value (push fill-gaps mode).
 *
 * @param {Map<string, string>} local
 * @param {Map<string, string>} remote
 * @returns {Map<string, string>}
 */
export function filterLocalMissingOnRemoteNonEmpty(local, remote) {
  const out = new Map();
  for (const [k, v] of local) {
    if (!isNonEmptyEnvValue(v)) continue;
    if (!remote.has(k)) out.set(k, v);
  }
  return out;
}
