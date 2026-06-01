/**
 * Reformat root `.env*` files to match `.env.example` section order and comments.
 */
import fs from "node:fs";
import path from "node:path";
import {
  formatEnvFromExampleTemplate,
  resolveExampleTemplatePath,
} from "./format-env-from-example.mjs";
import { parseDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT } from "./paths.mjs";
import { printFactsTable, printSection, syncSuccess, syncWarn } from "./cli-output.mjs";

/** @typedef {"dev" | "preview" | "prod"} TTarget */

/** @type {Record<TTarget, readonly string[]>} */
export const FORMAT_FILES_BY_TARGET = {
  dev: [".env.local", ".env.development.local", ".env.sync.development"],
  preview: [".env.preview", ".env.sync.preview"],
  prod: [".env.production.local", ".env.sync.production"],
};

/** Keys dropped when reformatting (ephemeral CLI injection). */
const OMIT_KEYS = new Set(["VERCEL_OIDC_TOKEN"]);

/**
 * @param {Map<string, string>} map
 * @returns {Map<string, string>}
 */
function stripOmitKeys(map) {
  const out = new Map(map);
  for (const k of OMIT_KEYS) {
    out.delete(k);
  }
  return out;
}

/**
 * @param {TTarget[]} [targets] — empty = all targets
 * @returns {Array<{ rel: string; abs: string; target: TTarget }>}
 */
export function listFormatCandidates(targets = []) {
  /** @type {TTarget[]} */
  const wanted =
    targets.length > 0 ? targets : /** @type {TTarget[]} */ (Object.keys(FORMAT_FILES_BY_TARGET));

  /** @type {Array<{ rel: string; abs: string; target: TTarget }>} */
  const out = [];
  for (const target of wanted) {
    const rels = FORMAT_FILES_BY_TARGET[target];
    if (!rels) continue;
    for (const rel of rels) {
      const abs = path.join(REPO_ROOT, rel);
      if (fs.existsSync(abs)) {
        out.push({ rel, abs, target });
      }
    }
  }
  return out;
}

/**
 * @param {string} abs
 * @param {TTarget} target
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ status: "skipped" | "unchanged" | "written" | "dry-run"; reason?: string; templateRel?: string }}
 */
export function formatOneEnvFile(abs, target, opts = {}) {
  const templateAbs = resolveExampleTemplatePath(REPO_ROOT, target);
  if (!templateAbs) {
    return {
      status: "skipped",
      reason: `no template for ${target} (.env.example or *.example)`,
    };
  }

  const rel = path.relative(REPO_ROOT, abs);
  const before = fs.readFileSync(abs, "utf8");
  const values = stripOmitKeys(parseDotenv(before));
  const templateContent = fs.readFileSync(templateAbs, "utf8");
  const after = formatEnvFromExampleTemplate(templateContent, values);
  const templateRel = path.relative(REPO_ROOT, templateAbs);

  if (before === after) {
    return { status: "unchanged", templateRel };
  }

  if (opts.dryRun) {
    return { status: "dry-run", templateRel };
  }

  fs.writeFileSync(abs, after, "utf8");
  return { status: "written", templateRel };
}

/**
 * @param {{ targets?: TTarget[]; dryRun?: boolean }} [opts]
 */
export function runFormatEnvFiles(opts = {}) {
  const candidates = listFormatCandidates(opts.targets ?? []);

  printSection("Reformat env files (.env.example layout)");

  if (!fs.existsSync(path.join(REPO_ROOT, ".env.example"))) {
    syncWarn("Missing root .env.example — cannot reformat.");
    process.exitCode = 1;
    return;
  }

  if (candidates.length === 0) {
    syncWarn(
      "No env files found to reformat. Expected one of: " +
        Object.values(FORMAT_FILES_BY_TARGET).flat().join(", ")
    );
    process.exitCode = 1;
    return;
  }

  /** @type {Array<{ rel: string; status: string; templateRel?: string; reason?: string }>} */
  const rows = [];

  for (const { rel, abs, target } of candidates) {
    const result = formatOneEnvFile(abs, target, { dryRun: opts.dryRun });
    rows.push({
      rel,
      status: result.status,
      templateRel: result.templateRel,
      reason: result.reason,
    });
  }

  printFactsTable(
    rows.map((r) => ({
      label: r.rel,
      value: r.reason
        ? `${r.status} (${r.reason})`
        : r.templateRel
          ? `${r.status} ← ${r.templateRel}`
          : r.status,
    }))
  );

  const written = rows.filter((r) => r.status === "written").length;
  const dry = rows.filter((r) => r.status === "dry-run").length;
  const unchanged = rows.filter((r) => r.status === "unchanged").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;

  console.log("");
  if (opts.dryRun) {
    syncSuccess(
      `Dry run: ${dry} file(s) would change, ${unchanged} already match template, ${skipped} skipped.`
    );
    return;
  }

  syncSuccess(
    `Done: ${written} rewritten, ${unchanged} unchanged, ${skipped} skipped.`
  );

  if (written === 0 && unchanged === 0 && skipped > 0) {
    process.exitCode = 1;
  }
}
