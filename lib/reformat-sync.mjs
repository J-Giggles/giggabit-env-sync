/**
 * Rewrite local `.env.sync.*` snapshots to follow the current `.env.example`
 * layout. Keys not in the template are moved to an "Additional variables"
 * section at the bottom.
 *
 * Security: never print env values — only file paths, counts, and key names.
 */
import fs from "node:fs";
import path from "node:path";
import {
  formatEnvFromExampleTemplate,
  resolveExampleTemplatePath,
} from "./format-env-from-example.mjs";
import { parseDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT } from "./paths.mjs";
import { syncInfo, syncSuccess, syncWarn } from "./cli-style.mjs";

/** Default snapshots written by `env:sync:pull -- --all`. */
const DEFAULT_SYNC_FILES = [
  ".env.sync.development",
  ".env.sync.preview",
  ".env.sync.production",
];

/**
 * Keys declared in the example template (assignable `KEY=` lines only).
 *
 * @param {string} templateContent
 * @returns {Set<string>}
 */
function loadTemplateKeys(templateContent) {
  const keys = new Set();
  for (const rawLine of templateContent.split(/\r?\n/)) {
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
 * @param {string[]} args — flags after `reformat`
 */
export async function reformatSyncFiles(args = []) {
  const dryRun = args.includes("--dry-run");
  const allMerge = args.includes("--include-merge");

  /** @type {string[]} */
  let relFiles = [...DEFAULT_SYNC_FILES];
  if (allMerge) {
    for (const name of fs.readdirSync(REPO_ROOT)) {
      if (name.startsWith(".env.sync.merge.") && !relFiles.includes(name)) {
        relFiles.push(name);
      }
    }
  }

  const explicit = args.filter((a) => !a.startsWith("-") && a.startsWith(".env.sync"));
  if (explicit.length > 0) {
    relFiles = explicit;
  }

  const templatePath = resolveExampleTemplatePath(REPO_ROOT, "dev");
  if (!templatePath) {
    throw new Error(
      "No .env.example (or target-specific example) found at repo root.",
    );
  }
  const templateContent = fs.readFileSync(templatePath, "utf8");
  const templateKeys = loadTemplateKeys(templateContent);
  const templateLabel = path.relative(REPO_ROOT, templatePath);

  syncInfo(
    `Reformat .env.sync.* using ${templateLabel} (${templateKeys.size} template keys)${
      dryRun ? " [dry-run]" : ""
    }`,
  );

  let rewritten = 0;
  let skippedMissing = 0;

  for (const rel of relFiles) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) {
      syncWarn(`skip ${rel} (missing)`);
      skippedMissing += 1;
      continue;
    }

    const previous = fs.readFileSync(abs, "utf8");
    const values = parseDotenv(previous);
    const next = formatEnvFromExampleTemplate(templateContent, values);

    const allKeys = [...values.keys()].sort();
    const knownKeys = allKeys.filter((k) => templateKeys.has(k));
    const extraKeys = allKeys.filter((k) => !templateKeys.has(k));
    const unchanged = previous === next;

    console.log("");
    syncInfo(rel);
    console.log(`  keys: ${allKeys.length} total`);
    console.log(`  in template: ${knownKeys.length}`);
    console.log(`  extra (→ end of file): ${extraKeys.length}`);
    if (extraKeys.length > 0) {
      for (const key of extraKeys) {
        console.log(`    + ${key}`);
      }
    }
    if (unchanged) {
      console.log("  status: already matches template layout");
      continue;
    }

    if (dryRun) {
      console.log("  status: would rewrite (dry-run)");
      continue;
    }

    const tmp = `${abs}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, next, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, abs);
    rewritten += 1;
    console.log("  status: rewritten");
  }

  console.log("");
  if (dryRun) {
    syncSuccess(
      `Dry-run complete — ${relFiles.length - skippedMissing} file(s) inspected, ${skippedMissing} missing.`,
    );
  } else {
    syncSuccess(
      `Reformat complete — ${rewritten} rewritten, ${skippedMissing} missing.`,
    );
  }
}
