/** Shared row grouping for cross-environment env tables (pull diff, push preview). */

/** @type {Array<{ name: string; re: RegExp }>} */
export const ENV_ROW_GROUPS = [
  { name: "URLs & Convex", re: /^(APP_URL|NEXT_PUBLIC_|CONVEX_|E2E_|PLAYWRIGHT_|ZOOM_|WORKOS_REDIRECT|NODE_ENV)/ },
  { name: "WorkOS", re: /^WORKOS_/ },
  { name: "AWS", re: /^AWS_/ },
  { name: "B2", re: /^B2_/ },
  { name: "Nylas", re: /^NYLAS_/ },
  { name: "Feature flags", re: /^NEXT_PUBLIC_EMAIL_/ },
  { name: "Vercel / Turbo", re: /^(VERCEL_|TURBO_|NX_)/ },
];

/** Keys injected by `vercel env pull` with no stable app meaning. */
export const ENV_TABLE_NOISE_KEY =
  /^VERCEL_GIT_|^VERCEL_OIDC|^VERCEL_URL$|^VERCEL$|^VERCEL_ENV$|^VERCEL_TARGET_ENV$/;

/**
 * @param {string} key
 */
export function envKeyRowGroup(key) {
  for (const g of ENV_ROW_GROUPS) {
    if (g.re.test(key)) return g.name;
  }
  return "Other";
}
