#!/usr/bin/env node
/**
 * env:sync — pull or push env between local files, Convex, and Vercel.
 *
 * Usage:
 *   pnpm run env:sync:pull
 *   pnpm run env:sync:pull -- --all
 *   pnpm run env:sync:pull -- <dev|preview|prod> [--snapshot-only]
 *   pnpm run env:sync:push -- <dev|preview|prod> [--yes] [--from-sync] [convex]
 *   pnpm run env:sync:push -- --all [--yes] [--from-working] [convex]
 *   pnpm run env:sync:push -- … [--convex-only]   (same as trailing `convex`)
 *   pnpm run env:sync:pull:cli
 *   pnpm run env:sync:push:cli
 *   pnpm run env:sync:clear [-- --dry-run]
 */
import { interactivePullCli } from "./lib/interactive-pull-cli.mjs";
import {
  countPullPlanChanges,
  executePullPlans,
  planPullAll,
  planPullTarget,
} from "./lib/pull-plan.mjs";
import { printPullPlans } from "./lib/print-pull-plan.mjs";
import { planPushTargets, pushTarget } from "./lib/push.mjs";
import { printPushPlans } from "./lib/print-push-plan.mjs";
import { confirmOrCancel } from "./lib/prompt.mjs";
import { interactivePushCli } from "./lib/interactive-push-cli.mjs";
import { interactiveClear } from "./lib/clear.mjs";
import { reportEnvSnapshotDiffIfReady } from "./lib/print-env-snapshot-diff.mjs";
import { parseKeyFilterInput } from "./lib/env-key-filter.mjs";
import { filterPushPlans, countPushPlanWrites } from "./lib/apply-key-filter.mjs";
import { syncInfo, syncWarn } from "./lib/cli-style.mjs";

const VALID = new Set(["dev", "preview", "prod"]);

function usage() {
  console.log(`
Usage:
  pnpm run env:sync:pull
  pnpm run env:sync:pull -- --all
                        Pull all targets → .env.sync.development / .preview / .production, then print
                        the cross-environment diff table (no menu).

  pnpm run env:sync:pull -- --interactive
  pnpm run env:sync:pull:cli
                        Advanced menu: inventory + Convex pairing, single preset, or pull-all with prompts.

  pnpm run env:sync:pull -- <dev|preview|prod> [--snapshot-only]
                        Non-interactive preset (same pairing as before).

  pnpm run env:sync:push -- <dev|preview|prod>
  pnpm run env:sync:push -- <dev|preview|prod> convex
  pnpm run env:sync:push -- --all
  pnpm run env:sync:push -- --all convex
                        Push dev, then preview, then prod. Default: each reads its .env.sync.* snapshot
                        (same files as env:sync:pull -- --all). Each snapshot needs Convex routing
                        (CONVEX_DEPLOY_KEY and/or NEXT_PUBLIC_CONVEX_URL).

  Trailing \`convex\` or flag \`--convex-only\`: run \`convex env set\` only — no Vercel CLI (faster).

  pnpm run env:sync:push:cli
                        Interactive push: preview tables per target, approve once, then push.

  Non-interactive push (including --all) also prints a preview table and asks for
  confirmation unless you pass --yes.

  --interactive, -i (pull only) Advanced pull menu (inventory / presets). Default pull skips this.

  pnpm run env:sync:clear [-- --dry-run]
                        Interactive: choose Vercel (dev/preview/prod) and/or Convex (dev/prod) to remove
                        hosted variables. --dry-run lists removals only.

  --from-sync       (push only, single target) Read the matching .env.sync.* instead of working files.

  --from-working    (push only, with --all) Read per-target working files (.env.local / .env.preview /
                        .env.production.local) instead of .env.sync.* — legacy behavior.

  --interactive     (push only) Same as env:sync:push:cli — guided push.

  --yes, -y         (push only) Do not ask for confirmation on drift / local file changes.

  --convex-only     (push only) Same as trailing \`convex\`: Convex only, skip Vercel.

  --force           (push only) Disable per-key diff; push every key even if the remote value matches.
                        Default behavior fetches remote Convex + Vercel maps and only pushes keys whose
                        value differs or that are new.

  --snapshot-only   (pull only) Write .env.sync.merge.<target> only; do not update .env.local / .env.production.local.

  --keys, -k <list> (pull | push) Comma-separated keys and/or globs (e.g. AWS_*,WORKOS_*).
                        Pull: update only matching keys in sync/working files (others preserved).
                        Push: push only matching keys (after the usual remote diff).

  --yes, -y         (pull | push) Skip drift/local-change prompts (push) or skip the pull
                        preview confirmation (pull — still prints the preview table).

After multi-target pulls, prints a cross-environment diff table (keys that differ across
  .env.sync.development / .preview / .production).

Requires: Convex CLI (pnpm), Vercel CLI (\`vercel\` on PATH or pnpm dlx), linked project, and auth.
Snapshots: .env/sync/metadata.json (gitignored)
`);
}

/** Args after `node run.mjs` — drop `--` so `pnpm run … -- dev` works. */
const argv = process.argv.slice(2).filter((a) => a !== "--");

/** @type {import("./lib/env-key-filter.mjs").TKeyFilter | null} */
let keyFilter = null;
/** @type {string[]} */
const raw = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--keys" || a === "-k") {
    const v = argv[++i];
    if (!v || v.startsWith("-")) {
      console.error("[env:sync] --keys requires a value (e.g. AWS_*,WORKOS_*)");
      process.exit(1);
    }
    keyFilter = parseKeyFilterInput(v);
    if (!keyFilter) {
      console.error("[env:sync] --keys: no patterns parsed");
      process.exit(1);
    }
  } else if (a.startsWith("--keys=")) {
    keyFilter = parseKeyFilterInput(a.slice("--keys=".length));
    if (!keyFilter) {
      console.error("[env:sync] --keys: no patterns parsed");
      process.exit(1);
    }
  } else {
    raw.push(a);
  }
}

const flags = new Set(raw.filter((a) => a.startsWith("-")));
const positional = raw.filter((a) => !a.startsWith("-"));
const convexOnly =
  flags.has("--convex-only") || positional.includes("convex");
const positionalNoConvex = positional.filter((a) => a !== "convex");
const [cmd, target] = positionalNoConvex;
const snapshotOnly = flags.has("--snapshot-only");
const pullAll = flags.has("--all");
const pushAll = cmd === "push" && flags.has("--all");
const pullYes = cmd === "pull" && (flags.has("--yes") || flags.has("-y"));
const pushYes = cmd === "push" && (flags.has("--yes") || flags.has("-y"));
const pushFromSync = cmd === "push" && flags.has("--from-sync");
const pushFromWorking = cmd === "push" && flags.has("--from-working");
const pushForce = cmd === "push" && flags.has("--force");
const pushInteractive =
  cmd === "push" && (flags.has("--interactive") || flags.has("-i"));
const pullInteractive =
  cmd === "pull" && (flags.has("--interactive") || flags.has("-i"));

if (
  !cmd ||
  (cmd === "push" && !pushAll && !pushInteractive && (!target || !VALID.has(target)))
) {
  usage();
  process.exitCode = 1;
  process.exit();
}

if (cmd === "pull" && target && !VALID.has(target)) {
  usage();
  process.exitCode = 1;
  process.exit();
}

try {
  if (cmd === "clear") {
    await interactiveClear({ dryRun: flags.has("--dry-run") });
  } else if (cmd === "pull") {
    if (pullInteractive) {
      if (target && VALID.has(target)) {
        syncWarn(
          "Ignoring preset target with --interactive; use the guided menu or `pnpm run env:sync:pull -- <target>`."
        );
      }
      await interactivePullCli({ snapshotOnly });
    } else if (pullAll || !target) {
      if (pullAll && target && VALID.has(target)) {
        syncWarn(
          "Ignoring preset target with --all; use one or the other."
        );
      }
      syncInfo("Fetching hosted env and building pull preview…");
      const plans = await planPullAll({ keyFilter });
      printPullPlans(plans, { keyFilter });
      const pullTotal = countPullPlanChanges(plans);
      if (pullTotal === 0) {
        syncInfo("Nothing to pull — local files already match hosted env for routed keys.");
        reportEnvSnapshotDiffIfReady();
      } else {
        let proceed = pullYes;
        if (!proceed) {
          proceed = await confirmOrCancel(
            `Apply ${pullTotal} local key update(s) from hosted env?`
          );
        }
        if (!proceed) {
          syncInfo("Pull cancelled — no files written.");
          process.exitCode = 1;
        } else {
          await executePullPlans(plans);
          reportEnvSnapshotDiffIfReady();
        }
      }
    } else {
      syncInfo("Fetching hosted env and building pull preview…");
      const plan = await planPullTarget(
        /** @type {"dev" | "preview" | "prod"} */ (target),
        { snapshotOnly, keyFilter }
      );
      printPullPlans([plan], { keyFilter });
      const pullTotal = countPullPlanChanges([plan]);
      if (pullTotal === 0) {
        syncInfo("Nothing to pull — local file already matches hosted env for routed keys.");
      } else {
        let proceed = pullYes;
        if (!proceed) {
          proceed = await confirmOrCancel(
            `Apply ${pullTotal} local key update(s) from hosted env?`
          );
        }
        if (!proceed) {
          syncInfo("Pull cancelled — no files written.");
          process.exitCode = 1;
        } else {
          await executePullPlans([plan]);
          reportEnvSnapshotDiffIfReady();
        }
      }
    }
  } else if (cmd === "push") {
    if (pushInteractive) {
      await interactivePushCli();
    } else {
      /** `push --all` defaults to snapshot files so preview/prod are not overwritten from `.env.local`. */
      const fromSyncForPush = pushAll ? !pushFromWorking : pushFromSync;
      if (pushFromWorking && !pushAll) {
        syncWarn(
          "Ignoring --from-working without --all (single-target push already uses working files unless you pass --from-sync)."
        );
      }
      const pushOpts = {
        yes: pushYes,
        fromSync: fromSyncForPush,
        convexOnly,
        force: pushForce,
      };
      const targets = pushAll
        ? /** @type {const} */ (["dev", "preview", "prod"])
        : [/** @type {"dev" | "preview" | "prod"} */ (target)];

      syncInfo(
        `Building push preview for ${targets.join(", ")} (fetching remote)…`
      );
      let plans = await planPushTargets(targets, pushOpts);
      if (keyFilter) {
        plans = filterPushPlans(plans, keyFilter);
        syncInfo(`Key filter: ${keyFilter.raw}`);
      }
      printPushPlans(plans, { keyFilter });

      const totalChanges = countPushPlanWrites(plans, null);
      if (totalChanges === 0) {
        syncInfo("Nothing to push — every routed key already matches hosted env.");
      } else {
        let proceed = pushYes;
        if (!proceed) {
          proceed = await confirmOrCancel(
            `Apply ${totalChanges} key write(s) to hosted Convex + Vercel?`
          );
        }
        if (!proceed) {
          syncInfo("Push cancelled — no changes applied.");
          process.exitCode = 1;
        } else {
          const executeOpts = {
            ...pushOpts,
            approved: true,
            skipPlanPrint: true,
          };
          for (const plan of plans) {
            console.log("");
            syncInfo(`========== push ${plan.target} ==========`);
            console.log("");
            await pushTarget(plan.target, { ...executeOpts, plan });
          }
        }
      }
    }
  } else {
    usage();
    process.exit(1);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
