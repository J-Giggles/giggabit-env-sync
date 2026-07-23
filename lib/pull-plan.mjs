/**
 * Build and display pull plans before writing files (interactive CLI).
 */
import fs from "node:fs";
import path from "node:path";
import { isConvexEnabled } from "./config.mjs";
import {
  fetchConvexEnvMapOptions,
  fetchVercelEnvMapOptions,
  vercelEnvironmentToPresetTarget,
} from "./remote.mjs";
import {
  fetchVercelProjectEnvList,
  distinctVercelDeploymentTargets,
} from "./vercel-project-env-list.mjs";
import {
  formatEnvFromExampleTemplate,
  resolveExampleTemplatePath,
} from "./format-env-from-example.mjs";
import { parseDotenv, serializeDotenv } from "./parse-dotenv.mjs";
import { REPO_ROOT, envSyncPath } from "./paths.mjs";
import { mergeRemoteKeysMissingIntoLocal } from "./env-map-filters.mjs";
import { mergeWithWarnings } from "./pull.mjs";
import { resolveConvexMapForVercelPull } from "./resolve-convex-map-for-vercel-pull.mjs";
import { filterMergedForLocalWorkspace } from "./split.mjs";
import { syncInfo, syncWarn } from "./cli-style.mjs";

/** @typedef {"Vercel" | "Convex" | "Vercel+Convex"} TPullKeySource */

/** @typedef {{ key: string; source: TPullKeySource; valuePreview: string }} TPullPreviewRow */

/**
 * @typedef {{
 *   envName: string;
 *   outAbs: string;
 *   outRel: string;
 *   presetTarget: import("./remote.mjs").TTarget;
 *   missingOnly: boolean;
 *   vercelMap: Map<string, string>;
 *   convexMap: Map<string, string>;
 *   rows: TPullPreviewRow[];
 * }} TPullPlan
 */

const SECRET_KEY_PATTERN =
  /(SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|_KEY$|CREDENTIAL)/iu;

const MAX_PREVIEW_ROWS = 100;

/**
 * Merge Vercel maps from multiple linked projects into one global map.
 * Later projects overwrite earlier projects for the same key, matching the
 * declared ENV_SYNC_VERCEL_PROJECTS order.
 *
 * @param {Map<string, string>[]} maps
 * @returns {Map<string, string>}
 */
export function mergeVercelProjectMaps(maps) {
  const merged = new Map();
  for (const map of maps) {
    for (const [key, value] of map) {
      merged.set(key, value);
    }
  }
  return merged;
}

/**
 * @param {string} key
 * @param {Map<string, string>} vercelMap
 * @param {Map<string, string>} convexMap
 * @returns {TPullKeySource}
 */
export function inferPullKeySource(key, vercelMap, convexMap) {
  const onVercel = vercelMap.has(key);
  const onConvex = convexMap.has(key);
  if (onVercel && onConvex) return "Vercel+Convex";
  if (onVercel) return "Vercel";
  return "Convex";
}

/**
 * @param {string} key
 * @param {string} value
 * @returns {string}
 */
export function previewEnvValue(key, value) {
  if (value === undefined || value === "") return "(empty)";
  if (SECRET_KEY_PATTERN.test(key) && !key.startsWith("NEXT_PUBLIC_")) {
    if (value.length <= 8) return "••••••••";
    return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
  }
  if (value.length > 72) return `${value.slice(0, 69)}…`;
  return value;
}

/**
 * @param {Map<string, string>} vercelMap
 * @param {Map<string, string>} convexMap
 * @param {Map<string, string>} remoteForLocal
 * @param {Map<string, string>} existingMap
 * @param {boolean} missingOnly
 * @returns {TPullPreviewRow[]}
 */
export function buildPullPreviewRows(
  vercelMap,
  convexMap,
  remoteForLocal,
  existingMap,
  missingOnly
) {
  /** @type {TPullPreviewRow[]} */
  const rows = [];
  for (const key of [...remoteForLocal.keys()].sort()) {
    if (missingOnly && existingMap.has(key)) continue;
    const value = remoteForLocal.get(key) ?? "";
    rows.push({
      key,
      source: inferPullKeySource(key, vercelMap, convexMap),
      valuePreview: previewEnvValue(key, value),
    });
  }
  return rows;
}

/**
 * @param {{
 *   envName: string;
 *   vercelMap: Map<string, string>;
 *   convexMap: Map<string, string>;
 *   outAbs: string;
 *   missingOnly: boolean;
 * }} opts
 * @returns {TPullPlan}
 */
export function buildPullPlan(opts) {
  const { envName, vercelMap, convexMap, outAbs, missingOnly } = opts;
  const presetTarget = vercelEnvironmentToPresetTarget(
    /** @type {"development" | "preview" | "production"} */ (envName)
  );
  const merged = mergeWithWarnings(vercelMap, convexMap);
  const remoteForLocal = filterMergedForLocalWorkspace(merged);
  const existingMap = fs.existsSync(outAbs)
    ? parseDotenv(fs.readFileSync(outAbs, "utf8"))
    : new Map();
  const rows = buildPullPreviewRows(
    vercelMap,
    convexMap,
    remoteForLocal,
    existingMap,
    missingOnly
  );
  return {
    envName,
    outAbs,
    outRel: path.relative(REPO_ROOT, outAbs),
    presetTarget,
    missingOnly,
    vercelMap,
    convexMap,
    rows,
  };
}

/**
 * @param {{ missingOnly?: boolean; convexDevMap?: Map<string, string>; convexProdMap?: Map<string, string>; vercelMaps?: Map<string, Map<string, string>>; targets?: string[] }} [opts]
 * @returns {Promise<TPullPlan[]>}
 */
export async function computePullAllPlans(opts = {}) {
  const missingOnly = Boolean(opts.missingOnly);
  let targets;
  if (opts.targets) {
    targets = opts.targets;
  } else if (opts.vercelMaps) {
    targets = [...opts.vercelMaps.keys()];
  } else {
    const { envs } = fetchVercelProjectEnvList();
    targets = distinctVercelDeploymentTargets(envs);
  }
  if (targets.length === 0) {
    throw new Error(
      "No Vercel deployment targets (development / preview / production) found in project env list."
    );
  }

  const convexEnabled = isConvexEnabled();
  const convexDevMap = convexEnabled
    ? (opts.convexDevMap ?? fetchConvexEnvMapOptions({ useProd: false }))
    : new Map();
  const convexProdMap = convexEnabled
    ? (opts.convexProdMap ?? fetchConvexEnvMapOptions({ useProd: true }))
    : new Map();

  /** @type {TPullPlan[]} */
  const plans = [];
  for (const envName of targets) {
    const presetTarget = vercelEnvironmentToPresetTarget(
      /** @type {"development" | "preview" | "production"} */ (envName)
    );
    const vercelMap =
      opts.vercelMaps?.get(envName) ??
      fetchVercelEnvMapOptions(
        /** @type {"development" | "preview" | "production"} */ (envName)
      );
    const convexMap = convexEnabled
      ? resolveConvexMapForVercelPull(
          vercelMap,
          presetTarget,
          convexDevMap,
          convexProdMap
        )
      : new Map();
    plans.push(
      buildPullPlan({
        envName,
        vercelMap,
        convexMap,
        outAbs: envSyncPath(envName),
        missingOnly,
      })
    );
  }
  return plans;
}

/**
 * @param {TPullPlan[]} plans
 * @param {{ missingOnly: boolean }} opts
 */
export function printPullPreviewPlans(plans, opts) {
  const { missingOnly } = opts;
  const total = plans.reduce((n, p) => n + p.rows.length, 0);

  console.log("");
  console.log(
    "── Pull preview ─────────────────────────────────────────────────────────"
  );
  console.log(
    missingOnly
      ? "  Mode: missing keys only (add from host; keep existing local values)"
      : "  Mode: full merge (host values replace keys in each output file)"
  );
  console.log(
    `  Total: ${total} key(s) across ${plans.length} file(s) · sources: Vercel, Convex, or Vercel+Convex (Vercel wins on conflict)`
  );

  for (const plan of plans) {
    console.log("");
    const verb = missingOnly ? "to add" : "to write";
    console.log(
      `  ${plan.envName} → ${plan.outRel} — ${plan.rows.length} key(s) ${verb}`
    );
    if (plan.rows.length === 0) {
      console.log("    (none)");
      continue;
    }

    const keyW = Math.min(
      44,
      Math.max(16, ...plan.rows.map((r) => r.key.length), 3)
    );
    console.log(
      `    ${"KEY".padEnd(keyW)}  ${"SOURCE".padEnd(16)}  VALUE`
    );
    const shown = plan.rows.slice(0, MAX_PREVIEW_ROWS);
    for (const row of shown) {
      console.log(
        `    ${row.key.padEnd(keyW)}  ${row.source.padEnd(16)}  ${row.valuePreview}`
      );
    }
    if (plan.rows.length > MAX_PREVIEW_ROWS) {
      console.log(
        `    … and ${plan.rows.length - MAX_PREVIEW_ROWS} more (not shown)`
      );
    }
  }
  console.log(
    "────────────────────────────────────────────────────────────────────────────"
  );
  console.log("");
}

/**
 * @param {TPullPlan} plan
 */
export function writePullPlan(plan) {
  const merged = mergeWithWarnings(plan.vercelMap, plan.convexMap);
  const remoteForLocal = filterMergedForLocalWorkspace(merged);
  const existingMap = fs.existsSync(plan.outAbs)
    ? parseDotenv(fs.readFileSync(plan.outAbs, "utf8"))
    : new Map();

  /** @type {Map<string, string>} */
  let forLocal = remoteForLocal;
  if (plan.missingOnly) {
    const addCount = plan.rows.length;
    forLocal = mergeRemoteKeysMissingIntoLocal(existingMap, remoteForLocal);
    syncInfo(
      `Missing-only: kept ${existingMap.size} key(s) in ${plan.outRel}, added ${addCount} from host.`
    );
  } else if (existingMap.size > 0) {
    syncInfo(
      `Full merge: writing ${forLocal.size} key(s) to ${plan.outRel} (replacing file content from host merge).`
    );
  }

  const templateAbs = resolveExampleTemplatePath(REPO_ROOT, plan.presetTarget);
  /** @type {string} */
  let body;
  if (templateAbs) {
    try {
      const templateContent = fs.readFileSync(templateAbs, "utf8");
      body = formatEnvFromExampleTemplate(templateContent, forLocal);
      syncInfo(
        `  Layout from template → ${path.relative(REPO_ROOT, templateAbs)}`
      );
    } catch (e) {
      syncWarn(
        `  Could not read template (${templateAbs}); using sorted keys. ${e instanceof Error ? e.message : e}`
      );
      body = serializeDotenv(forLocal);
    }
  } else {
    syncWarn(
      `  No .env example template for preset "${plan.presetTarget}"; using sorted keys.`
    );
    body = serializeDotenv(forLocal);
  }

  fs.writeFileSync(plan.outAbs, body, "utf8");
  syncInfo(`Wrote ${plan.outRel}`);
}

/**
 * @param {TPullPlan[]} plans
 * @returns {number}
 */
export function totalPullPreviewRows(plans) {
  return plans.reduce((n, p) => n + p.rows.length, 0);
}
