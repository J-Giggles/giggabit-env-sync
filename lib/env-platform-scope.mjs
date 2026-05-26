/**
 * Classify env keys by where `env:sync:push` routes them (Convex, Vercel, or both).
 */
import {
  filterForConvexWithWarnings,
  filterForVercel,
} from "./split.mjs";

/** @typedef {"both" | "convex" | "vercel" | "local"} TPlatformScope */

/**
 * @param {string} key
 * @param {string | undefined} value
 * @returns {TPlatformScope}
 */
export function classifyKeyPlatformScope(key, value) {
  const map = new Map([[key, value ?? ""]]);
  const inVercel = filterForVercel(map).has(key);
  const { out: convexEligible } = filterForConvexWithWarnings(map);
  const inConvex = convexEligible.has(key);
  if (inConvex && inVercel) return "both";
  if (inConvex) return "convex";
  if (inVercel) return "vercel";
  return "local";
}

/**
 * @param {Map<string, string>} localMap
 * @returns {Map<string, TPlatformScope>}
 */
export function buildPlatformScopeMap(localMap) {
  const scopes = new Map();
  for (const [key, value] of localMap) {
    scopes.set(key, classifyKeyPlatformScope(key, value));
  }
  return scopes;
}
