/**
 * Decide which keys go to Convex vs Vercel when pushing from a merged local file.
 */
import { getExtraNeverConvexKeys } from "./repo-config.mjs";
import { isConvexEnabled } from "./config.mjs";

/** Keys / patterns never pushed to Convex runtime. */
const NEVER_CONVEX_PREFIXES = [/^NEXT_PUBLIC_/u, /^VERCEL_/u];

const BASE_NEVER_CONVEX_KEYS = new Set([
  "CI",
  "NODE_ENV",
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOY_KEY",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_SHA",
]);

/**
 * @param {string} key
 * @returns {boolean}
 */
function isNeverConvexKey(key) {
  if (BASE_NEVER_CONVEX_KEYS.has(key)) return true;
  for (const extra of getExtraNeverConvexKeys()) {
    if (key === extra) return true;
  }
  return false;
}

/**
 * URL keys whose value Convex cloud actions fetch. A localhost value here would
 * cause `ECONNREFUSED` inside Convex (Convex cloud cannot reach your laptop).
 * We keep them eligible for Convex in principle, but drop them at push time
 * when the value is localhost-ish (see {@link isLocalhostUrlValue}).
 *
 * `NEXT_PUBLIC_APP_URL` is also listed even though `NEXT_PUBLIC_*` is already
 * excluded by {@link NEVER_CONVEX_PREFIXES} — the set exists so callers can
 * warn symmetrically for both keys when drift is reported.
 */
const CONVEX_CALLABLE_URL_KEYS = new Set(["APP_URL", "NEXT_PUBLIC_APP_URL"]);

/** `localhost`, `127.0.0.1`, or `::1` (any scheme / port / path). */
const LOCALHOST_URL_PATTERN =
  /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[?::1\]?)(?::\d+)?(?:\/|$)/iu;

/**
 * Whether a URL value points at the developer's machine (Convex cloud cannot reach it).
 *
 * @param {string | undefined} value
 * @returns {boolean}
 */
export function isLocalhostUrlValue(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return LOCALHOST_URL_PATTERN.test(trimmed);
}

/**
 * Split a push map into the Convex payload + the list of keys we intentionally
 * dropped so the caller can surface a warning (e.g. `APP_URL=http://localhost:3000`
 * being filtered out before `convex env set`).
 *
 * @param {Map<string, string>} map
 * @returns {{ out: Map<string, string>, droppedLocalhost: string[] }}
 */
export function filterForConvexWithWarnings(map) {
  const out = new Map();
  const droppedLocalhost = [];
  for (const [k, v] of map) {
    if (isNeverConvexKey(k)) continue;
    if (NEVER_CONVEX_PREFIXES.some((re) => re.test(k))) continue;
    if (CONVEX_CALLABLE_URL_KEYS.has(k) && isLocalhostUrlValue(v)) {
      droppedLocalhost.push(k);
      continue;
    }
    out.set(k, v);
  }
  return { out, droppedLocalhost };
}

/**
 * @param {Map<string, string>} map
 * @returns {Map<string, string>}
 */
export function filterForConvex(map) {
  return filterForConvexWithWarnings(map).out;
}

/**
 * Vercel hosts the Next.js app; include all keys needed at build/runtime.
 * Omit Convex-only noise if any is introduced later.
 * @param {Map<string, string>} map
 * @returns {Map<string, string>}
 */
export function filterForVercel(map) {
  const out = new Map();
  for (const [k, v] of map) {
    if (k === "CONVEX_DEPLOYMENT") continue;
    if (typeof v !== "string" || v.trim() === "") continue;
    out.set(k, v);
  }
  return out;
}

/** Vercel CLI injects short-lived tokens into `vercel env pull` — not useful in app `.env*` files. */
const LOCAL_PULL_OMIT_KEYS = new Set(["VERCEL_OIDC_TOKEN"]);

const LOCAL_PULL_OMIT_PREFIXES = [/^TURBO_/u];

/**
 * Keys that Vercel injects automatically at build/runtime — never user-managed.
 * Excluded from `env:sync:check` diffs so the table only shows actionable drift.
 */
const VERCEL_AUTO_INJECTED_KEYS = new Set([
  "CI",
  "NX_DAEMON",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_TARGET_ENV",
  "VERCEL_URL",
]);

const VERCEL_AUTO_INJECTED_PREFIXES = [/^VERCEL_GIT_/u];

/**
 * Whether a key is auto-injected by Vercel and should be skipped in diff views.
 *
 * @param {string} key
 */
export function isVercelAutoInjectedKey(key) {
  if (VERCEL_AUTO_INJECTED_KEYS.has(key)) return true;
  return VERCEL_AUTO_INJECTED_PREFIXES.some((re) => re.test(key));
}

/**
 * Strip Vercel-injected build/runtime keys from a Vercel env map.
 *
 * @param {Map<string, string>} map
 * @returns {Map<string, string>}
 */
export function filterOutVercelAutoInjected(map) {
  const out = new Map();
  for (const [k, v] of map) {
    if (isVercelAutoInjectedKey(k)) continue;
    out.set(k, v);
  }
  return out;
}

/**
 * Strip ephemeral keys before writing merged pull output to `.env.local` / `.env.production.local`.
 * @param {Map<string, string>} map
 * @returns {Map<string, string>}
 */
export function filterMergedForLocalWorkspace(map) {
  const out = new Map(map);
  for (const k of LOCAL_PULL_OMIT_KEYS) {
    out.delete(k);
  }
  for (const k of [...out.keys()]) {
    if (
      isVercelAutoInjectedKey(k) ||
      LOCAL_PULL_OMIT_PREFIXES.some((re) => re.test(k))
    ) {
      out.delete(k);
    }
  }
  if (!isConvexEnabled()) {
    for (const k of [...out.keys()]) {
      if (k.startsWith("CONVEX_") || k.startsWith("NEXT_PUBLIC_CONVEX_")) {
        out.delete(k);
      }
    }
  }
  dropLegacyAliasWhenCanonicalExists(out, "CLERK_SECRET_KEY", "CLERK_ADMIN_SECRET_KEY");
  dropLegacyAliasWhenCanonicalExists(
    out,
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_CLERK_ADMIN_PUBLISHABLE_KEY"
  );
  dropLegacyAliasWhenCanonicalExists(
    out,
    "CLERK_CLIENT_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_CLERK_CLIENT_PUBLISHABLE_KEY"
  );
  dropLegacyAliasWhenCanonicalExists(out, "CUSTOMER_CLERK_SECRET_KEY", "CLERK_CLIENT_SECRET_KEY");
  dropLegacyAliasWhenCanonicalExists(
    out,
    "CUSTOMER_CLERK_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_CLERK_CLIENT_PUBLISHABLE_KEY"
  );
  dropLegacyAliasWhenCanonicalExists(
    out,
    "NEXT_PUBLIC_POSTHOG_HOST",
    "NEXT_PUBLIC_ADMIN_POSTHOG_HOST"
  );
  dropLegacyAliasWhenCanonicalExists(
    out,
    "NEXT_PUBLIC_POSTHOG_KEY",
    "NEXT_PUBLIC_ADMIN_POSTHOG_KEY"
  );
  dropLegacyAliasWhenCanonicalExists(out, "PAYLOAD_DATABASE_URL", "BLOG_PAYLOAD_DATABASE_URL");
  dropLegacyAliasWhenCanonicalExists(out, "PAYLOAD_SECRET", "BLOG_PAYLOAD_SECRET");
  dropLegacyAliasWhenCanonicalExists(out, "PAYLOAD_URL", "NEXT_PUBLIC_BLOG_PAYLOAD_URL");
  dropLegacyAliasWhenCanonicalExists(out, "PAYLOAD_NEON_DATABASE_URL", "BLOG_PAYLOAD_DATABASE_URL");
  const cd = out.get("CONVEX_DEPLOYMENT");
  if (typeof cd === "string" && cd.includes("|")) {
    out.set("CONVEX_DEPLOYMENT", cd.split("|")[0].trim());
  }
  return out;
}

/**
 * @param {Map<string, string>} map
 * @param {string} alias
 * @param {string} canonical
 */
function dropLegacyAliasWhenCanonicalExists(map, alias, canonical) {
  if (map.has(alias) && map.has(canonical)) {
    map.delete(alias);
  }
}
