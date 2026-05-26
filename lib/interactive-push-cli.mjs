/**
 * Guided interactive `env:sync:push` — preview changes, approve, then push.
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { planPushTargets, pushTarget } from "./push.mjs";
import { printPushVerifications } from "./print-push-verification.mjs";
import { printPushPlans } from "./print-push-plan.mjs";
import { countPushPlanWrites } from "./apply-key-filter.mjs";
import { refinePlansWithKeyFilterAfterPreview } from "./interactive-key-filter.mjs";
import { syncInfo, syncWarn } from "./cli-style.mjs";

/** @typedef {"dev" | "preview" | "prod"} TTarget */

/**
 * @returns {Promise<void>}
 */
export async function interactivePushCli() {
  const rl = readline.createInterface({ input, output });
  try {
    syncInfo("Interactive push — choose targets and options.");
    syncInfo(
      "All three targets use `.env.sync.*` snapshots by default (same as `pnpm run env:sync:push -- --all`). Other targets ask snapshot vs working."
    );

    const targets = await askTargets(rl);
    if (targets.length === 0) {
      syncWarn("No targets selected. Exiting.");
      return;
    }

    const pushAll =
      targets.length === 3 &&
      targets.includes("dev") &&
      targets.includes("preview") &&
      targets.includes("prod");

    /** Same as `pnpm run env:sync:push -- --all`: each pass reads the matching `.env.sync.*` file. */
    let fromSync;
    if (pushAll) {
      fromSync = true;
      syncInfo(
        "Reading `.env.sync.development` → `.env.sync.preview` → `.env.sync.production` (same as non-interactive `env:sync:push -- --all`). For working files instead, use `pnpm run env:sync:push -- --all --from-working`."
      );
    } else {
      fromSync = await askYesNo(
        rl,
        "Read `.env.sync.<env>` for this target (`--from-sync`)? (N = working files for that target)"
      );
    }

    const vercelSensitive = await askSensitiveMode(rl);

    const askForChanges = await askYesNo(rl, "Ask for changes?", {
      defaultYes: true,
    });

    syncInfo(
      `Fetching remote state and building push preview for: ${targets.join(", ")}…`
    );
    let plans = await planPushTargets(targets, { fromSync });
    printPushPlans(plans);
    const refined = await refinePlansWithKeyFilterAfterPreview(rl, "push", plans, {
      printPlans: (p, o) => printPushPlans(/** @type {typeof plans} */ (p), o),
    });
    plans = refined.plans;

    const totalChanges = countPushPlanWrites(plans, null);
    if (totalChanges === 0) {
      syncInfo("Nothing to push — every routed key already matches hosted env.");
      return;
    }

    const go = await askYesNo(
      rl,
      `Apply ${totalChanges} key write(s) to hosted Convex + Vercel?`
    );
    if (!go) {
      syncInfo("Push cancelled — no changes applied.");
      return;
    }

    /** @type {{ yes: boolean; approved: boolean; fromSync: boolean; vercelSensitive: "default" | "on" | "off"; skipPlanPrint: boolean }} */
    const pushOpts = {
      yes: !askForChanges,
      approved: true,
      fromSync,
      vercelSensitive,
      skipPlanPrint: true,
    };

    for (const plan of plans) {
      console.log("");
      syncInfo(`========== push ${plan.target} ==========`);
      await pushTarget(plan.target, { ...pushOpts, plan, skipVerification: true });
    }
    await printPushVerifications(plans);
  } finally {
    rl.close();
  }
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @returns {Promise<TTarget[]>}
 */
async function askTargets(rl) {
  console.log(`
  1) All three (dev → preview → prod)
  2) dev only
  3) preview only
  4) prod only
  5) Multiple (you will enter dev / preview / prod)
`);
  for (;;) {
    const raw = (await rl.question("Choose 1–5: ")).trim();
    if (raw === "1") return ["dev", "preview", "prod"];
    if (raw === "2") return ["dev"];
    if (raw === "3") return ["preview"];
    if (raw === "4") return ["prod"];
    if (raw === "5") {
      const sub = (
        await rl.question("Enter targets (comma-separated: dev, preview, prod): ")
      )
        .trim()
        .toLowerCase();
      const parts = sub.split(/[\s,]+/).filter(Boolean);
      /** @type {TTarget[]} */
      const acc = [];
      for (const p of parts) {
        if (p === "dev" || p === "development") acc.push("dev");
        else if (p === "preview" || p === "staging") acc.push("preview");
        else if (p === "prod" || p === "production") acc.push("prod");
      }
      const uniq = /** @type {TTarget[]} */ ([...new Set(acc)]);
      if (uniq.length === 0) {
        console.log("No valid targets. Use dev, preview, prod.");
        continue;
      }
      return uniq;
    }
    console.log("Invalid choice.");
  }
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @param {string} q
 * @param {{ defaultYes?: boolean }} [opts]
 */
async function askYesNo(rl, q, opts = {}) {
  const defaultYes = opts.defaultYes === true;
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  for (;;) {
    const a = (await rl.question(`${q} ${hint} `)).trim().toLowerCase();
    if (a === "y" || a === "yes") return true;
    if (a === "n" || a === "no") return false;
    if (a === "") return defaultYes;
    console.log('Type "y" or "n".');
  }
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @returns {Promise<"default" | "on" | "off">}
 */
async function askSensitiveMode(rl) {
  console.log(`
Vercel \`--sensitive\` for matching key names (SECRET, TOKEN, KEY, …):
  1) Project/env default (ENV_SYNC_VERCEL_USE_SENSITIVE or built-in default)
  2) Force ON (non-readable on Vercel after push)
  3) Force OFF (never pass --sensitive)
`);
  for (;;) {
    const raw = (await rl.question("Choose 1–3: ")).trim();
    if (raw === "1") return "default";
    if (raw === "2") return "on";
    if (raw === "3") return "off";
    console.log("Invalid choice.");
  }
}
