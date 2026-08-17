/**
 * Parse host `env.ts` zod files to extract actively validated environment keys.
 * Used by `env:sync:check` to flag keys in `.env.example` / hosted env that are
 * no longer validated (deprecated / removed).
 *
 * Best-effort regex parser — handles the common pattern:
 *
 *   KEY: z.string()…
 *   KEY: z
 *       .string()…
 *
 * Multiple `z.object({...})` schemas across monorepo env files are walked;
 * duplicate keys collapse into one Set.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.mjs";
import { getVercelProjectCwd } from "./config.mjs";

/**
 * Match `KEY:` followed by a zod builder (`z.` / multiline `z`) or a local
 * schema binding (`fooSchema`, `reasoningEffortSchema.default(...)`).
 */
const ENV_TS_KEY_RE =
  /^\s+([A-Z][A-Z0-9_]*)\s*:\s*(?:z[\s.]|[A-Za-z_][A-Za-z0-9_]*(?:Schema)?\b)/gm;

/**
 * Extra monorepo validators beyond the Vercel project `env.ts`.
 * Include both dashboard and Convex-side helpers so `.env.example` audits stay
 * truthful even when `ENV_SYNC_VERCEL_PROJECT_CWD` is unset.
 */
const EXTRA_ENV_TS_RELS = [
  "apps/dashboard/env.ts",
  "packages/backend/env.ts",
  "packages/backend/convex/_lib/devSuggestions/devSuggestionEnv.ts",
];

/**
 * Locate the host project's primary env validation file.
 *
 * @returns {string | null} Absolute path, or null if not present.
 */
export function resolveEnvTsPath() {
  const projectCwd = getVercelProjectCwd();
  const roots = projectCwd === REPO_ROOT ? [REPO_ROOT] : [projectCwd, REPO_ROOT];
  for (const root of roots) {
    for (const rel of ["env.ts", "src/env.ts", "lib/env.ts", "src/lib/env.ts"]) {
      const abs = path.join(root, rel);
      if (fs.existsSync(abs)) return abs;
    }
  }
  return null;
}

/**
 * All env validation files used for schema audit (dashboard + backend + Convex helpers).
 *
 * @returns {string[]} Absolute paths (may be empty).
 */
export function resolveEnvTsPaths() {
  /** @type {string[]} */
  const paths = [];
  const primary = resolveEnvTsPath();
  if (primary) paths.push(primary);
  for (const rel of EXTRA_ENV_TS_RELS) {
    const abs = path.join(REPO_ROOT, rel);
    if (fs.existsSync(abs) && !paths.includes(abs)) paths.push(abs);
  }
  return paths;
}

/**
 * Locate the env template nearest to the active host project, falling back to repo root.
 *
 * @returns {string | null} Absolute path, or null if not present.
 */
export function resolveEnvExamplePath() {
  const projectCwd = getVercelProjectCwd();
  const roots = projectCwd === REPO_ROOT ? [REPO_ROOT] : [projectCwd, REPO_ROOT];
  for (const root of roots) {
    for (const rel of [".env.example", ".env.template"]) {
      const abs = path.join(root, rel);
      if (fs.existsSync(abs)) return abs;
    }
  }
  return null;
}

/**
 * Read `.env.example` and return the set of declared keys.
 *
 * @returns {Set<string> | null} `null` when no template exists.
 */
export function loadEnvExampleKeys() {
  const abs = resolveEnvExamplePath();
  if (!abs) return null;
  const content = fs.readFileSync(abs, "utf8");
  const keys = new Set();
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Read monorepo `env.ts` validators and return the set of validated names.
 *
 * @returns {Set<string> | null} `null` when no env.ts was found (cross-check is skipped).
 */
export function loadEnvTsKeys() {
  const envTsPaths = resolveEnvTsPaths();
  if (envTsPaths.length === 0) return null;
  const keys = new Set();
  for (const envTsPath of envTsPaths) {
    const content = fs.readFileSync(envTsPath, "utf8");
    ENV_TS_KEY_RE.lastIndex = 0;
    let m;
    while ((m = ENV_TS_KEY_RE.exec(content)) !== null) {
      keys.add(m[1]);
    }
  }
  return keys;
}
