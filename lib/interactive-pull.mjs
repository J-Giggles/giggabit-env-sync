/**
 * Interactive env:sync:pull — inspect Vercel envs, infer Convex link, preview table, then merge.
 */
import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { isConvexEnabled } from "./config.mjs";
import { fetchConvexEnvMapOptions, fetchVercelEnvMapOptions, vercelEnvironmentToPresetTarget } from "./remote.mjs";
import {
  fetchVercelProjectEnvList,
  distinctVercelDeploymentTargets,
} from "./vercel-project-env-list.mjs";
import {
  allVercelTargetsShareConvexFingerprint,
  extractConvexDeploymentSlug,
  getUniformVercelConvexSlug,
  inferConvexLink,
  refineInferenceWhenUniformVercelConvex,
} from "./convex-vercel-link.mjs";
import { executePull } from "./pull.mjs";
import { pullAllVercelDeployments } from "./pull-all.mjs";
import {
  inferTargetFromPair,
  resolveLocalEnvWritePath,
  resolveOddPairPullPath,
} from "./local-env-paths.mjs";
import { envSyncPath, SYNC_DIR } from "./paths.mjs";
import {
  buildPullPlan,
  computePullAllPlans,
  printPullPreviewPlans,
  totalPullPreviewRows,
} from "./pull-plan.mjs";
import { chooseConvexUseProd, choosePullMenuIndex, confirmOrCancel } from "./prompt.mjs";
import { resolveConvexMapForVercelPull } from "./resolve-convex-map-for-vercel-pull.mjs";
import { syncInfo } from "./cli-style.mjs";

/**
 * @param {{ snapshotOnly?: boolean; missingOnly?: boolean }} opts
 */
export async function interactivePull(opts = {}) {
  if (!isConvexEnabled()) {
    await interactivePullVercelOnly(opts);
    return;
  }

  const snapshotOnly = Boolean(opts.snapshotOnly);
  let missingOnly = Boolean(opts.missingOnly);
  fs.mkdirSync(SYNC_DIR, { recursive: true });

  syncInfo("Interactive pull — loading Vercel project env inventory…");

  if (!missingOnly) {
    const rl = readline.createInterface({ input, output });
    try {
      missingOnly = await askMissingOnlyPull(rl);
    } finally {
      rl.close();
    }
  } else {
    syncInfo("Missing-only mode (from --missing-only): add host keys not already in local files.");
  }
  const { envs } = fetchVercelProjectEnvList();
  const vercelTargets = distinctVercelDeploymentTargets(envs);
  if (vercelTargets.length === 0) {
    throw new Error(
      "No Vercel deployment targets (development / preview / production) found in project env list."
    );
  }
  syncInfo(
    `Project defines ${envs.length} variable(s) across target(s): ${vercelTargets.join(", ")}`
  );

  syncInfo("Loading Convex env for development and production deployments…");
  const convexDevMap = fetchConvexEnvMapOptions({ useProd: false });
  const convexProdMap = fetchConvexEnvMapOptions({ useProd: true });

  /** @type {Array<{ envName: import("./vercel-project-env-list.mjs").TVercelEnvironmentName; vercelMap: Map<string, string>; inference: import("./convex-vercel-link.mjs").TConvexLinkInference }>} */
  const rows = [];
  for (const envName of vercelTargets) {
    syncInfo(`Pulling Vercel env: ${envName}…`);
    const vercelMap = fetchVercelEnvMapOptions(envName);
    const inference = inferConvexLink(vercelMap, convexDevMap, convexProdMap);
    rows.push({ envName, vercelMap, inference });
  }

  const multipleVercelTargets = rows.length >= 2;
  const uniformSlug = multipleVercelTargets
    ? getUniformVercelConvexSlug(rows)
    : null;
  const sharedFingerprint =
    multipleVercelTargets && allVercelTargetsShareConvexFingerprint(rows);

  for (let i = 0; i < rows.length; i++) {
    rows[i].inference = refineInferenceWhenUniformVercelConvex(rows[i].inference, {
      uniformSlug,
      sharedFingerprint,
      multipleVercelTargets,
    });
  }

  const hasUniformAssumedProd =
    multipleVercelTargets &&
    rows.some((r) => r.inference.status === "uniform-assumed-prod");

  if (hasUniformAssumedProd) {
    const devSlug = extractConvexDeploymentSlug(convexDevMap);
    const prodSlug = extractConvexDeploymentSlug(convexProdMap);
    console.log("");
    console.log("── Why Convex is assumed to be production ─────────────────────────────────");
    if (uniformSlug !== null) {
      console.log(
        `  • On Vercel, development / preview / production all reference the same Convex deployment`
      );
      console.log(`    (slug "${uniformSlug}" from NEXT_PUBLIC_CONVEX_URL, CONVEX_DEPLOY_KEY, etc.).`);
    } else {
      console.log(
        `  • The same Convex-related variables are copied across all ${rows.length} Vercel targets.`
      );
    }
    console.log("");
    if (uniformSlug !== null) {
      console.log(
        `  • This machine’s Convex CLI is pointed at different deployments than Vercel: \`convex env list\``
      );
      console.log(
        `    → "${devSlug ?? "?"}", \`convex env list --prod\` → "${prodSlug ?? "?"}" — Vercel uses "${uniformSlug}".`
      );
      console.log(
        "    (Often: CLI linked to another Convex project, or teammates deploy a different project.)"
      );
    } else {
      console.log(
        `  • This machine’s Convex CLI: \`convex env list\` → "${devSlug ?? "?"}", \`convex env list --prod\` → "${prodSlug ?? "?"}".`
      );
      console.log(
        "    Convex-related values match on every Vercel target, but we could not match slugs to your CLI."
      );
    }
    console.log("");
    console.log(
      "  • Because every Vercel scope agrees on one hosted Convex app, the merge uses Convex **production**"
    );
    console.log(
      "    variables from `convex env list --prod` (your CLI’s prod deployment), not `convex env list`."
    );
    console.log("");
    console.log(
      "  • Override: `pnpm run env:sync:pull -- dev|preview|prod` forces the classic dev/preview/prod pairings"
    );
    console.log("    from the README (ignores this inference).");
    console.log("────────────────────────────────────────────────────────────────────────────");
  }

  console.log("");
  console.log("── Per–Vercel-target summary (deployment slug / URL) ──");
  for (const row of rows) {
    console.log(`  ${row.envName.padEnd(14)} ${formatInferenceLine(row.inference)}`);
  }
  console.log("");

  const idx = await choosePullMenuIndex(
    [
      "Choose which Vercel **environment** to merge.",
      "",
      "  Option **0** runs a full multi-target pull (writes `.env.sync.development`, `.env.sync.preview`, …).",
      "  Options **1–3** merge one scope; Convex env is taken from the deployment Vercel points at when possible",
      "  (`NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOY_KEY` from the same snapshot), else your local CLI default.",
      "",
      "  For a single row, the `vercel env pull --environment …` snapshot is merged.",
      hasUniformAssumedProd
        ? "  Convex variables in the merge come from `convex env list --prod` (see box above) unless overridden by Vercel snapshot targeting."
        : "  Convex variables follow the inference shown in the summary column for each row (refined by snapshot targeting when possible).",
      "",
    ].join("\n"),
    rows,
    (row) => formatVercelMenuLine(row, hasUniformAssumedProd)
  );
  if (idx === -1) {
    /** @type {Map<string, Map<string, string>>} */
    const vercelMaps = new Map(rows.map((r) => [r.envName, r.vercelMap]));
    const plans = await computePullAllPlans({
      missingOnly,
      convexDevMap,
      convexProdMap,
      vercelMaps,
    });
    printPullPreviewPlans(plans, { missingOnly });
    const total = totalPullPreviewRows(plans);
    if (total === 0 && missingOnly) {
      syncInfo("Nothing to add — host keys already present in all `.env.sync.*` files.");
      return;
    }
    const ok = await confirmOrCancel(
      missingOnly
        ? `Add ${total} key(s) to the file(s) above?`
        : `Write ${total} key(s) from host merge to the file(s) above?`
    );
    if (!ok) {
      syncInfo("Pull cancelled.");
      return;
    }
    await pullAllVercelDeployments({ missingOnly, plans });
    return;
  }
  const chosen = rows[idx];
  const templateTarget = vercelEnvironmentToPresetTarget(chosen.envName);

  /** @type {boolean} */
  let useProd;
  const inf = chosen.inference;
  if (inf.status === "linked-dev") {
    useProd = false;
  } else if (inf.status === "linked-prod" || inf.status === "uniform-assumed-prod") {
    useProd = true;
  } else if (inf.status === "ambiguous") {
    syncInfo(
      "Vercel slug matches both Convex dev and prod maps — choose which Convex deployment to use."
    );
    useProd = await chooseConvexUseProd(
      'Same deployment slug on dev and prod — which Convex side should we use for `convex env list`?'
    );
  } else {
    const reason =
      inf.status === "no-convex-on-vercel"
        ? "This Vercel environment has no Convex URL / deploy-key variables (or they are empty)."
        : inf.status === "no-slug"
          ? "Could not derive a deployment slug from Vercel Convex variables."
          : "Vercel deployment slug does not match your Convex dev or prod deployment slugs.";
    syncInfo(reason);
    useProd = await chooseConvexUseProd(
      "Choose which Convex deployment to merge with this Vercel environment:"
    );
  }

  const needExplicitConvexSide =
    inf.status === "ambiguous" ||
    inf.status === "no-convex-on-vercel" ||
    inf.status === "no-slug" ||
    inf.status === "unmatched-slug";
  const convexSideFromUser = needExplicitConvexSide ? useProd : undefined;

  const convexMap = resolveConvexMapForVercelPull(
    chosen.vercelMap,
    templateTarget,
    convexDevMap,
    convexProdMap,
    convexSideFromUser
  );
  const preset = inferTargetFromPair(useProd, chosen.envName);
  const storageKey =
    preset ?? `vx-${chosen.envName.replace(/[^a-z0-9-]/gi, "-")}-${useProd ? "cprod" : "cdev"}`;

  const localWrite = snapshotOnly
    ? null
    : preset
      ? resolveLocalEnvWritePath(preset)
      : resolveOddPairPullPath(storageKey);

  const label = `${chosen.envName} + Convex ${useProd ? "production" : "development"}`;

  const previewOutAbs = snapshotOnly
    ? envSyncPath(`merge.${storageKey}`)
    : localWrite?.abs;
  if (!previewOutAbs) {
    throw new Error("interactive pull: no output path for preview");
  }
  const previewMissingOnly = snapshotOnly ? false : missingOnly;
  const plan = buildPullPlan({
    envName: chosen.envName,
    vercelMap: chosen.vercelMap,
    convexMap,
    outAbs: previewOutAbs,
    missingOnly: previewMissingOnly,
  });
  printPullPreviewPlans([plan], { missingOnly: previewMissingOnly });
  if (plan.rows.length === 0 && previewMissingOnly) {
    syncInfo(`Nothing to add — host keys already present in ${plan.outRel}.`);
    return;
  }
  const ok = await confirmOrCancel(
    previewMissingOnly
      ? `Add ${plan.rows.length} key(s) to ${plan.outRel}?`
      : `Write ${plan.rows.length} key(s) from host merge to ${plan.outRel}?`
  );
  if (!ok) {
    syncInfo("Pull cancelled.");
    return;
  }

  await executePull({
    convexMap,
    vercelMap: chosen.vercelMap,
    storageKey,
    templateTarget,
    snapshotOnly,
    missingOnly,
    localWrite,
    label,
  });
}

/**
 * Interactive pull when Convex is disabled — Vercel-only with the same preview table UX.
 *
 * @param {{ snapshotOnly?: boolean; missingOnly?: boolean }} opts
 */
async function interactivePullVercelOnly(opts = {}) {
  const snapshotOnly = Boolean(opts.snapshotOnly);
  let missingOnly = Boolean(opts.missingOnly);
  fs.mkdirSync(SYNC_DIR, { recursive: true });

  syncInfo(
    "Interactive pull (Vercel only — ENV_SYNC_DISABLE_CONVEX=1) — loading project env inventory…"
  );

  if (!missingOnly) {
    const rl = readline.createInterface({ input, output });
    try {
      missingOnly = await askMissingOnlyPull(rl);
    } finally {
      rl.close();
    }
  } else {
    syncInfo("Missing-only mode (from --missing-only): add host keys not already in local files.");
  }

  const { envs } = fetchVercelProjectEnvList();
  const vercelTargets = distinctVercelDeploymentTargets(envs);
  if (vercelTargets.length === 0) {
    throw new Error(
      "No Vercel deployment targets (development / preview / production) found in project env list."
    );
  }
  syncInfo(
    `Project defines ${envs.length} variable(s) across target(s): ${vercelTargets.join(", ")}`
  );

  /** @type {Array<{ envName: string; vercelMap: Map<string, string> }>} */
  const rows = [];
  for (const envName of vercelTargets) {
    syncInfo(`Pulling Vercel env: ${envName}…`);
    rows.push({ envName, vercelMap: fetchVercelEnvMapOptions(envName) });
  }

  const idx = await choosePullMenuIndex(
    [
      "Choose which Vercel **environment** to merge into `.env.sync.*`.",
      "",
      "  Option **0** pulls all targets (`.env.sync.development`, `.env.sync.preview`, …).",
      "  Options **1–N** pull one scope.",
      "",
    ].join("\n"),
    rows,
    (row) =>
      ({
        development: 'Vercel "Development" → `.env.sync.development`',
        preview: 'Vercel "Preview" → `.env.sync.preview`',
        production: 'Vercel "Production" → `.env.sync.production`',
      })[row.envName] ?? row.envName
  );

  if (idx === -1) {
    const vercelMaps = new Map(rows.map((r) => [r.envName, r.vercelMap]));
    const plans = await computePullAllPlans({ missingOnly, vercelMaps });
    printPullPreviewPlans(plans, { missingOnly });
    const total = totalPullPreviewRows(plans);
    if (total === 0 && missingOnly) {
      syncInfo("Nothing to add — host keys already present in all `.env.sync.*` files.");
      return;
    }
    const ok = await confirmOrCancel(
      missingOnly
        ? `Add ${total} key(s) to the file(s) above?`
        : `Write ${total} key(s) from host merge to the file(s) above?`
    );
    if (!ok) {
      syncInfo("Pull cancelled.");
      return;
    }
    await pullAllVercelDeployments({ missingOnly, plans });
    return;
  }

  const chosen = rows[idx];
  const plan = buildPullPlan({
    envName: chosen.envName,
    vercelMap: chosen.vercelMap,
    convexMap: new Map(),
    outAbs: envSyncPath(chosen.envName),
    missingOnly,
  });
  printPullPreviewPlans([plan], { missingOnly });
  if (plan.rows.length === 0 && missingOnly) {
    syncInfo(`Nothing to add — host keys already present in ${plan.outRel}.`);
    return;
  }
  const ok = await confirmOrCancel(
    missingOnly
      ? `Add ${plan.rows.length} key(s) to ${plan.outRel}?`
      : `Write ${plan.rows.length} key(s) from host merge to ${plan.outRel}?`
  );
  if (!ok) {
    syncInfo("Pull cancelled.");
    return;
  }
  await pullAllVercelDeployments({ missingOnly, plans: [plan] });
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @returns {Promise<boolean>}
 */
async function askMissingOnlyPull(rl) {
  for (;;) {
    const a = (
      await rl.question(
        "Missing keys only? Add host vars not in local file; keep existing values [y/N] "
      )
    )
      .trim()
      .toLowerCase();
    if (a === "y" || a === "yes") return true;
    if (a === "" || a === "n" || a === "no") return false;
    console.log('Type "y" or "n".');
  }
}

/**
 * @param {{ envName: string; inference: import("./convex-vercel-link.mjs").TConvexLinkInference }} row
 * @param {boolean} uniformConvexProd
 */
function formatVercelMenuLine(row, uniformConvexProd) {
  const scopeLabel =
    {
      development: 'Vercel "Development" (local `next dev` / non-prod Vercel)',
      preview: 'Vercel "Preview" (git branch & PR preview deployments)',
      production: 'Vercel "Production" (production traffic)',
    }[row.envName] ?? row.envName;

  const mergeHint =
    {
      development: "template / path rules for **dev** (.env.local, …)",
      preview: "template / path rules for **preview** (.env.preview, …)",
      production: "template / path rules for **production** (.env.production.local, …)",
    }[row.envName] ?? "";

  if (uniformConvexProd) {
    return `${scopeLabel}. Merge = this scope’s Vercel vars + \`convex env list --prod\`; ${mergeHint}.`;
  }

  return `${scopeLabel}. ${formatInferenceLine(row.inference)} ${mergeHint}.`;
}

/**
 * @param {import("./convex-vercel-link.mjs").TConvexLinkInference} inference
 */
function formatInferenceLine(inference) {
  switch (inference.status) {
    case "linked-dev":
      return `→ Convex development (slug ${inference.vercelSlug ?? "?"})`;
    case "linked-prod":
      return `→ Convex production (slug ${inference.vercelSlug ?? "?"})`;
    case "ambiguous":
      return `⚠ same slug on dev & prod (${inference.vercelSlug ?? "?"}) — choose Convex side`;
    case "no-convex-on-vercel":
      return "— no Convex vars on Vercel — choose Convex side";
    case "no-slug":
      return "— Convex vars present but slug unknown — choose Convex side";
    case "unmatched-slug":
      return `⚠ Vercel slug ${inference.vercelSlug ?? "?"} ≠ local dev/prod — choose Convex side`;
    case "uniform-assumed-prod":
      return `→ merge Convex via \`convex env list --prod\` (Vercel slug ${inference.vercelSlug ?? "?"} on all scopes)`;
    default:
      return "—";
  }
}
