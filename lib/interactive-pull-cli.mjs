/**
 * Guided interactive `env:sync:pull` — choose mode and targets, preview local changes, then pull.
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { interactivePull } from "./interactive-pull.mjs";
import {
  countPullPlanChanges,
  executePullPlans,
  planPullAll,
  planPullTargets,
} from "./pull-plan.mjs";
import { printPullPlans } from "./print-pull-plan.mjs";
import { assertVercelProjectLinked } from "./vercel-link.mjs";
import { refinePlansWithKeyFilterAfterPreview } from "./interactive-key-filter.mjs";
import { syncInfo } from "./cli-style.mjs";
import { reportEnvSnapshotDiffIfReady } from "./print-env-snapshot-diff.mjs";

/** @typedef {"dev" | "preview" | "prod"} TTarget */

/**
 * @param {{ snapshotOnly?: boolean }} [opts] — when true, skip the snapshot-only prompt (e.g. `--snapshot-only` on CLI).
 * @returns {Promise<void>}
 */
export async function interactivePullCli(opts = {}) {
  assertVercelProjectLinked();

  const rl = readline.createInterface({ input, output });
  try {
    syncInfo("Interactive pull — choose how to fetch hosted env.");

    const mode = await askPullMode(rl);
    let snapshotOnly = Boolean(opts.snapshotOnly);
    if (!snapshotOnly && mode !== "all") {
      snapshotOnly = await askYesNo(
        rl,
        "Snapshot only (write `.env.sync.merge.*` / skip `.env.local`, `.env.preview`, …)?"
      );
    }

    const summary =
      mode === "all"
        ? "mode=pull-all → `.env.sync.development`, `.env.sync.preview`, `.env.sync.production`"
        : mode === "inventory"
          ? `mode=inventory · snapshotOnly=${snapshotOnly}`
          : `mode=preset · targets=${/** @type {TTarget[]} */ (mode).join(",")} · snapshotOnly=${snapshotOnly}`;

    syncInfo(`Summary: ${summary}`);

    if (mode === "inventory") {
      const confirmBeforeWrite = async (/** @type {number} */ n) =>
        askYesNo(rl, `Apply ${n} local key update(s) from hosted env?`);
      await interactivePull({
        snapshotOnly,
        rl,
        confirmBeforeWrite,
      });
      return;
    }

    syncInfo("Fetching hosted env and building pull preview…");
    let plans =
      mode === "all"
        ? await planPullAll({ keyFilter: null })
        : await planPullTargets(/** @type {TTarget[]} */ (mode), {
            snapshotOnly,
            keyFilter: null,
          });

    printPullPlans(plans);
    const refined = await refinePlansWithKeyFilterAfterPreview(rl, "pull", plans, {
      printPlans: (p, o) => printPullPlans(/** @type {typeof plans} */ (p), o),
    });
    plans = refined.plans;

    const total = countPullPlanChanges(plans);
    if (total === 0) {
      syncInfo("Nothing to pull — local files already match hosted env for routed keys.");
      return;
    }

    const go = await askYesNo(
      rl,
      `Apply ${total} local key update(s) from hosted env?`
    );
    if (!go) {
      syncInfo("Pull cancelled.");
      return;
    }

    await executePullPlans(plans);
    reportEnvSnapshotDiffIfReady();
  } finally {
    rl.close();
  }
}

/**
 * @param {import("node:readline/promises").Interface} rl
 * @returns {Promise<"all" | "inventory" | TTarget[]>}
 */
async function askPullMode(rl) {
  console.log(`
  1) Pull all Vercel targets → \`.env.sync.development\`, \`.env.sync.preview\`, \`.env.sync.production\`
     (same as \`pnpm run env:sync:pull -- --all\`)

  2) Vercel inventory + Convex pairing (pick one scope or 0 for all)
     (same as legacy interactive \`env:sync:pull\`)

  3) Classic preset — dev only
  4) Classic preset — preview only
  5) Classic preset — prod only
  6) Classic preset — multiple (dev, preview, prod)
`);
  for (;;) {
    const raw = (await rl.question("Choose 1–6: ")).trim();
    if (raw === "1") return "all";
    if (raw === "2") return "inventory";
    if (raw === "3") return ["dev"];
    if (raw === "4") return ["preview"];
    if (raw === "5") return ["prod"];
    if (raw === "6") {
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
 */
async function askYesNo(rl, q) {
  for (;;) {
    const a = (await rl.question(`${q} [y/N] `)).trim().toLowerCase();
    if (a === "y" || a === "yes") return true;
    if (a === "" || a === "n" || a === "no") return false;
    console.log('Type "y" or "n".');
  }
}
