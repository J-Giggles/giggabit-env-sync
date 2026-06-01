/**
 * Load repo-root `.env.local` for giggabit-env-sync CLI only (not app runtime).
 * Does not override variables already set in the process environment.
 */
import fs from "node:fs";
import path from "node:path";
import { parseDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT } from "./paths.mjs";

const REPO_ENV_LOCAL = path.join(REPO_ROOT, ".env.local");

/**
 * Merge keys from `.env.local` into `process.env` when not already set.
 */
export function loadRepoEnv() {
  if (!fs.existsSync(REPO_ENV_LOCAL)) return;
  const map = parseDotenv(fs.readFileSync(REPO_ENV_LOCAL, "utf8"));
  for (const [k, v] of map) {
    if (process.env[k] === undefined || process.env[k] === "") {
      process.env[k] = v;
    }
  }
}
