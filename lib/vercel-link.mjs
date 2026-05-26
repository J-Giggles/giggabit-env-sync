/**
 * Verify the app repo is linked to a Vercel project before pull/push CLIs run.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.mjs";

/**
 * @returns {boolean}
 */
export function isVercelProjectLinked() {
  return fs.existsSync(path.join(REPO_ROOT, ".vercel", "project.json"));
}

/**
 * @throws {Error} When `.vercel/project.json` is missing.
 */
export function assertVercelProjectLinked() {
  if (isVercelProjectLinked()) return;
  throw new Error(
    "[env:sync] Vercel project is not linked. From the app repo root run:\n" +
      "  vercel link\n" +
      "or non-interactively:\n" +
      "  vercel link --yes --scope <team> --project <name>\n" +
      "Then rerun this command."
  );
}
