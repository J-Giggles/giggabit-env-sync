/**
 * Reformat root `.env*` files using the resolved target-specific template, with
 * the shared `.env.example` template as fallback.
 */
import fs from "node:fs";
import path from "node:path";

import {
  formatEnvFromExampleTemplate,
  resolveExampleTemplatePath,
} from "./format-env-from-example.mjs";
import { parseDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT } from "./paths.mjs";
import { syncSuccess, syncWarn } from "./cli-style.mjs";

export const FORMAT_FILES_BY_TARGET = {
  dev: [".env.local", ".env.development.local", ".env.sync.development"],
  preview: [".env.preview", ".env.sync.preview"],
  prod: [".env.production.local", ".env.sync.production"],
};

const OMIT_KEYS = new Set(["VERCEL_OIDC_TOKEN"]);

function stripOmitKeys(values) {
  const result = new Map(values);
  for (const key of OMIT_KEYS) result.delete(key);
  return result;
}

export function listFormatCandidates(targets = []) {
  const wanted = targets.length > 0 ? targets : Object.keys(FORMAT_FILES_BY_TARGET);
  const candidates = [];
  for (const target of wanted) {
    for (const relativePath of FORMAT_FILES_BY_TARGET[target] ?? []) {
      const absolutePath = path.join(REPO_ROOT, relativePath);
      if (fs.existsSync(absolutePath)) {
        candidates.push({ rel: relativePath, abs: absolutePath, target });
      }
    }
  }
  return candidates;
}

export function formatOneEnvFile(absolutePath, target, opts = {}) {
  const templatePath = resolveExampleTemplatePath(REPO_ROOT, target);
  if (!templatePath) {
    return {
      status: "skipped",
      reason: `no template for ${target} (.env.example or *.example)`,
    };
  }

  const before = fs.readFileSync(absolutePath, "utf8");
  const values = stripOmitKeys(parseDotenv(before));
  const after = formatEnvFromExampleTemplate(
    fs.readFileSync(templatePath, "utf8"),
    values,
  );
  const templateRel = path.relative(REPO_ROOT, templatePath);

  if (before === after) return { status: "unchanged", templateRel };
  if (opts.dryRun) return { status: "dry-run", templateRel };

  fs.writeFileSync(absolutePath, after, "utf8");
  return { status: "written", templateRel };
}

export function runFormatEnvFiles(opts = {}) {
  console.log(
    "Reformat env files (resolved target-specific/shared template layout)",
  );
  console.log("");

  const candidates = listFormatCandidates(opts.targets ?? []);
  if (candidates.length === 0) {
    syncWarn(
      `No env files found to reformat. Expected one of: ${Object.values(FORMAT_FILES_BY_TARGET).flat().join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  const results = candidates.map(({ rel, abs, target }) => ({
    rel,
    ...formatOneEnvFile(abs, target, { dryRun: opts.dryRun }),
  }));
  for (const result of results) {
    const detail = result.reason
      ? `${result.status} (${result.reason})`
      : `${result.status}${result.templateRel ? ` ← ${result.templateRel}` : ""}`;
    console.log(`  ${result.rel}: ${detail}`);
  }

  const written = results.filter((result) => result.status === "written").length;
  const dryRun = results.filter((result) => result.status === "dry-run").length;
  const unchanged = results.filter((result) => result.status === "unchanged").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  if (written + dryRun + unchanged === 0 && skipped > 0) process.exitCode = 1;
  console.log("");
  if (opts.dryRun) {
    syncSuccess(
      `Dry run: ${dryRun} file(s) would change, ${unchanged} already match template, ${skipped} skipped.`,
    );
    return;
  }

  syncSuccess(
    `Done: ${written} rewritten, ${unchanged} unchanged, ${skipped} skipped.`,
  );
}
