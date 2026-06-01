#!/usr/bin/env node
/**
 * giggabit-env-sync — pull or push env between local files, Convex (optional), and Vercel.
 *
 * Single-repo mode (default) and monorepo mode are both supported:
 *
 * - **`ENV_SYNC_DISABLE_CONVEX=1`** — skip every Convex CLI call and Convex drift check.
 * - **`ENV_SYNC_VERCEL_PROJECT_CWD=apps/admin`** — point Vercel CLI / API at a subdirectory
 *   that owns `.vercel/project.json` (e.g. one app inside a monorepo).
 * - **`ENV_SYNC_VERCEL_PROJECTS=apps/admin,apps/website`** — when ≥ 2 entries, `push` /
 *   `check` / `deploy` loop the same operation across every project. `pull` and `clear`
 *   stay single-project (use `--project=<rel>` to choose which).
 *
 * Per-invocation `--project=<rel>` overrides any monorepo loop and pins to one project.
 */
import process from "node:process";
import { checkTarget } from "./lib/check.mjs";
import {
  checkVercelProjectLinked,
  getVercelProjects,
  isConvexEnabled,
} from "./lib/config.mjs";
import { interactivePull } from "./lib/interactive-pull.mjs";
import { pullAllVercelDeployments } from "./lib/pull-all.mjs";
import { pullTarget } from "./lib/pull.mjs";
import { pushTarget } from "./lib/push.mjs";
import { interactivePushCli } from "./lib/interactive-push-cli.mjs";
import { interactiveClear } from "./lib/clear.mjs";
import { deployTarget, parseDeployArgs } from "./lib/deploy.mjs";
import { bootstrap } from "./lib/bootstrap.mjs";
import { runToolCheck } from "./lib/upstream-check.mjs";
import { runVercelAuthCheck } from "./lib/vercel-auth.mjs";
import { runVercelLinksReport } from "./lib/vercel-links-report.mjs";
import { runFormatEnvFiles } from "./lib/format-env-files.mjs";
import {
  printCliFailure,
  printCommandHeader,
  syncInfo,
  syncWarn,
} from "./lib/cli-output.mjs";

const VALID = new Set(["dev", "preview", "prod"]);

function usage() {
  console.log(`
Usage:
  pnpm run env:sync:tool-check
                        Verify vendored tool matches J-Giggles/giggabit-env-sync hub (UPSTREAM.json).

  pnpm run env:sync:auth-check
                        Verify VERCEL_TOKEN can read the linked project on the repo's Vercel team (no secrets printed).

  pnpm run env:sync:links
                        Deployment link map: Vercel apps + Cloudflare Worker envs.

  pnpm run env:sync:links -- --remote
                        Also run \`vercel project ls\` and \`wrangler whoami\`.

  pnpm run env:sync:links -- --hints
                        Include per-app vercel inspect / wrangler commands.

  pnpm run env:sync:format
                        Reformat existing root env files to match .env.example layout
                        (comments, section order; extra keys appended at bottom).

  pnpm run env:sync:format -- <dev|preview|prod>
                        Reformat only files for that target (.env.local, .env.sync.*, etc.).

  pnpm run env:sync:format -- --dry-run
                        Show which files would change without writing.

  pnpm run env:sync:pull
                        Interactive: merge one scope or option 0 = pull all (same as pull -- --all);
                        writes .env.sync.* snapshot files. (Disabled when ENV_SYNC_DISABLE_CONVEX=1.)

  pnpm run env:sync:pull -- --all [--missing-only]
                        For each Vercel target: merge Convex + Vercel (same pairing as dev/preview/prod
                        presets), format with .env.example, write .env.sync.<environment>.

  pnpm run env:sync:pull -- <dev|preview|prod> [--snapshot-only] [--missing-only]
                        Non-interactive preset (same pairing as before). Interactive pull shows a
                        preview table and asks to confirm before writing.

  pnpm run env:sync:push -- <dev|preview|prod>
  pnpm run env:sync:push -- <dev|preview|prod> convex
  pnpm run env:sync:push -- --all
  pnpm run env:sync:push -- --all convex
                        Default: each target reads its .env.sync.* snapshot (same files as
                        env:sync:pull -- --all). With Convex enabled each snapshot needs Convex
                        routing (CONVEX_DEPLOY_KEY and/or NEXT_PUBLIC_CONVEX_URL). Pass
                        --from-working to read working files (.env.local / .env.preview /
                        .env.production.local) instead.

  Trailing \`convex\` or flag \`--convex-only\`: run \`convex env set\` only — no Vercel CLI (faster).
  Rejected when ENV_SYNC_DISABLE_CONVEX=1.

  pnpm run env:sync:push:cli
                        Interactive push: choose targets, from-sync vs working, Vercel sensitive, --yes.

  pnpm run env:sync:check -- <dev|preview|prod> [--from-working] [--convex-only|--vercel-only] [-q]
                        Read-only diff: compare local file vs hosted Convex + Vercel for the target.
                        Exits 0 if in sync, 1 otherwise. Default source is .env.sync.<env>; pass
                        --from-working for working .env files. Use -q / --quiet to print only
                        \`true\` / \`false\`. With ENV_SYNC_DISABLE_CONVEX=1 this is Vercel-only.

  pnpm run env:sync:clear [-- --dry-run]
                        Interactive: choose Vercel (dev/preview/prod) and/or Convex (dev/prod) to remove
                        hosted variables. --dry-run lists removals only. Convex options hidden when
                        Convex is disabled.

  pnpm run deploy -- <staging|production>
                        Run gates, sync env, deploy Convex (if enabled), then deploy Vercel directly.
                        Staging maps to Vercel Preview + branch staging; production maps to
                        Vercel Production + branch production.

  pnpm run deploy -- <staging|production> --git-push
                        Run the same gates/env/Convex deploy, then push the mapped branch instead
                        of calling Vercel CLI directly.

  --from-sync       (push only) No-op alias kept for backwards compatibility — push always reads
                        .env.sync.* by default now.

  --from-working    (push only) Read per-target working files (.env.local / .env.preview /
                        .env.production.local) instead of .env.sync.* — legacy behavior.

  --interactive     (push only) Same as env:sync:push:cli — guided push.

  --yes, -y         (push only) Skip drift / local-change confirmations.

  --convex-only     (push only) Same as trailing \`convex\`: Convex only, skip Vercel.

  --force           (push only) Disable per-key diff; push every key even if the remote value matches.

  --missing-only    (pull) Add host keys missing from the local file; never overwrite existing local values.
                    (push) Push only non-empty local keys absent on Convex/Vercel; never update existing remote values.

  --project=<rel>   (push/check/clear/deploy) Pin this invocation to a single Vercel project
                        directory relative to repo root (e.g. \`apps/admin\`). Overrides
                        ENV_SYNC_VERCEL_PROJECT_CWD and any monorepo loop.

  --all-projects    (push/check) Loop the operation across every project listed in
                        ENV_SYNC_VERCEL_PROJECTS (defaults to true when ≥ 2 are configured).

  Deploy flags:
  --git-push        Push staging/production branch for Vercel Git integration instead of \`vercel deploy\`.
  --from-working    Read working .env files instead of .env.sync.* snapshots for deploy env sync.
  --skip-gates      Skip lint, typecheck, and build.
  --skip-env-sync   Skip hosted env push.
  --skip-convex-deploy
  --skip-vercel-deploy

  --snapshot-only   (pull only) Write .env.sync.merge.<target> only; do not update .env.local / .env.production.local.

  --no-update-check Skip hub freshness check (UPSTREAM.json vs github.com/J-Giggles/giggabit-env-sync).

Requires: Vercel CLI (\`vercel\` on PATH or pnpm dlx), linked project, and auth.
With Convex enabled (default): Convex CLI (pnpm) and Convex auth.
Snapshots: .env/sync/metadata.json (gitignored)
`);
}

/**
 * Extract `--project=<rel>` if present and remove it from `flags`. Returns the relative
 * path or null. The flag pins this invocation to a single Vercel project (`config.mjs`
 * reads `ENV_SYNC_VERCEL_PROJECT_CWD` fresh each call).
 *
 * @param {string[]} raw
 * @returns {string | null}
 */
function takeProjectFlag(raw) {
  for (const arg of raw) {
    if (arg.startsWith("--project=")) {
      const value = arg.slice("--project=".length).trim();
      if (!value) {
        throw new Error("--project requires a value (e.g. --project=apps/admin)");
      }
      return value;
    }
  }
  return null;
}

/**
 * Run `fn` with `ENV_SYNC_VERCEL_PROJECT_CWD` set to each entry's relPath. Resets the env
 * var to its prior value when finished (or unset if it was unset).
 *
 * Skips entries whose `.vercel/project.json` is missing — logs and continues so a partial
 * monorepo (one project linked, others not) still completes the linked ones.
 *
 * @param {ReturnType<typeof getVercelProjects>} projects
 * @param {(entry: ReturnType<typeof getVercelProjects>[number]) => Promise<void>} fn
 */
async function forEachProject(projects, fn) {
  const prior = process.env.ENV_SYNC_VERCEL_PROJECT_CWD;
  const hadPrior = "ENV_SYNC_VERCEL_PROJECT_CWD" in process.env;
  let hardFailure = false;
  try {
    for (const entry of projects) {
      process.env.ENV_SYNC_VERCEL_PROJECT_CWD = entry.relPath;
      const link = checkVercelProjectLinked(entry.cwd);
      if (!link.ok) {
        syncWarn(`[${entry.label}] skipping — ${link.reason}`);
        continue;
      }
      console.log("");
      syncInfo(`========== project: ${entry.label} ==========`);
      console.log("");
      try {
        await fn(entry);
      } catch (err) {
        hardFailure = true;
        console.error(
          `[${entry.label}] failed: ${err instanceof Error ? err.message : err}`
        );
      }
    }
  } finally {
    if (hadPrior) {
      process.env.ENV_SYNC_VERCEL_PROJECT_CWD = prior;
    } else {
      delete process.env.ENV_SYNC_VERCEL_PROJECT_CWD;
    }
  }
  if (hardFailure) process.exitCode = 1;
}

/** Args after `node run.mjs` — drop `--` so `pnpm run … -- dev` works. */
const raw = process.argv.slice(2).filter((a) => a !== "--");
const projectOverride = takeProjectFlag(raw);
const rawWithoutProject = raw.filter((a) => !a.startsWith("--project="));
const flags = new Set(rawWithoutProject.filter((a) => a.startsWith("-")));
const positional = rawWithoutProject.filter((a) => !a.startsWith("-"));
const convexOnly =
  flags.has("--convex-only") || positional.includes("convex");
const positionalNoConvex = positional.filter((a) => a !== "convex");
const [cmd, target] = positionalNoConvex;
const snapshotOnly = flags.has("--snapshot-only");
const missingOnly = flags.has("--missing-only");
const pullAll = flags.has("--all");
const pushAll = cmd === "push" && flags.has("--all");
const pushYes = cmd === "push" && (flags.has("--yes") || flags.has("-y"));
const pushFromSync = cmd === "push" && flags.has("--from-sync");
const pushFromWorking = cmd === "push" && flags.has("--from-working");
const pushForce = cmd === "push" && flags.has("--force");
const pushInteractive =
  cmd === "push" && (flags.has("--interactive") || flags.has("-i"));
const explicitAllProjects = flags.has("--all-projects");
const skipUpdateCheck = flags.has("--no-update-check");

if (cmd === "tool-check") {
  await runToolCheck();
  process.exit(process.exitCode ?? 0);
}

if (cmd === "auth-check") {
  printCommandHeader({ command: "auth-check", project: process.env.ENV_SYNC_VERCEL_PROJECT_CWD?.trim() || "repo root" });
  try {
    await bootstrap({ skipAuth: true, skipUpdateCheck: true });
    await runVercelAuthCheck();
  } catch (e) {
    printCliFailure(e);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

if (cmd === "links") {
  printCommandHeader({ command: "links" });
  try {
    await bootstrap({ skipAuth: true, skipUpdateCheck: true });
    await runVercelLinksReport({
      remote: flags.has("--remote"),
      hints: flags.has("--hints"),
    });
  } catch (e) {
    printCliFailure(e);
    process.exit(1);
  }
  process.exit(0);
}

if (cmd === "format") {
  if (target && !VALID.has(target)) {
    usage();
    process.exitCode = 1;
    process.exit();
  }
  printCommandHeader({
    command: "format",
    extras: [
      ...(target ? [target] : ["all targets"]),
      ...(flags.has("--dry-run") ? ["dry-run"] : []),
    ],
  });
  try {
    await bootstrap({ skipAuth: true, skipUpdateCheck: true });
    runFormatEnvFiles({
      targets: target ? [/** @type {"dev" | "preview" | "prod"} */ (target)] : [],
      dryRun: flags.has("--dry-run"),
    });
  } catch (e) {
    printCliFailure(e);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

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

if (cmd === "check" && (!target || !VALID.has(target))) {
  usage();
  process.exitCode = 1;
  process.exit();
}

/**
 * `--project` overrides everything else: pin to that one project for this invocation.
 * Otherwise: loop when ENV_SYNC_VERCEL_PROJECTS has ≥ 2 entries, or when --all-projects
 * is explicitly set. With 0/1 entries, behavior matches single-repo mode.
 */
if (projectOverride !== null) {
  process.env.ENV_SYNC_VERCEL_PROJECT_CWD = projectOverride;
}
const monorepoProjects = getVercelProjects();
const shouldLoopProjects =
  projectOverride === null &&
  (explicitAllProjects || monorepoProjects.length >= 2);

/** @type {string[]} */
const headerExtras = [];
if (!isConvexEnabled()) {
  headerExtras.push("Vercel-only (Convex off)");
}
if (shouldLoopProjects) {
  headerExtras.push(
    `${monorepoProjects.length} projects: ${monorepoProjects.map((p) => p.label).join(", ")}`
  );
}

printCommandHeader({
  command: cmd ?? "help",
  project: process.env.ENV_SYNC_VERCEL_PROJECT_CWD?.trim() || "repo root",
  extras: headerExtras,
});

try {
  await bootstrap({ skipUpdateCheck });

  if (cmd === "clear") {
    await interactiveClear({ dryRun: flags.has("--dry-run") });
  } else if (cmd === "pull") {
    if (pullAll) {
      if (target && VALID.has(target)) {
        syncWarn(
          "Ignoring preset target with --all; use one or the other."
        );
      }
      await pullAllVercelDeployments({ missingOnly });
    } else if (!target) {
      await interactivePull({ snapshotOnly, missingOnly });
    } else {
      await pullTarget(/** @type {"dev" | "preview" | "prod"} */ (target), {
        snapshotOnly,
        missingOnly,
      });
    }
  } else if (cmd === "push") {
    if (pushInteractive) {
      await interactivePushCli();
    } else {
      /** Push always reads `.env.sync.*` by default — pass `--from-working` to read working files. */
      const fromSyncForPush = !pushFromWorking;
      if (pushFromSync && pushFromWorking) {
        syncWarn(
          "Both --from-sync and --from-working passed; --from-working wins."
        );
      }
      /**
       * @param {string} [metadataNamespace] — per-project suffix for metadata storage so
       *   monorepo pushes (same target across multiple projects) don't conflate drift state.
       */
      const buildPushOpts = (metadataNamespace) => ({
        yes: pushYes,
        fromSync: fromSyncForPush,
        convexOnly,
        force: pushForce,
        missingOnly,
        ...(metadataNamespace ? { metadataNamespace } : {}),
      });
      /**
       * @param {"dev" | "preview" | "prod"} t
       * @param {string} [metadataNamespace]
       */
      const runOne = async (t, metadataNamespace) => {
        const opts = buildPushOpts(metadataNamespace);
        if (pushAll) {
          for (const eachT of /** @type {const} */ (["dev", "preview", "prod"])) {
            console.log("");
            syncInfo(`========== push ${eachT} ==========`);
            console.log("");
            await pushTarget(eachT, opts);
          }
        } else {
          await pushTarget(t, opts);
        }
      };
      const t = /** @type {"dev" | "preview" | "prod"} */ (target ?? "dev");
      if (shouldLoopProjects) {
        await forEachProject(monorepoProjects, (entry) => runOne(t, entry.relPath));
      } else {
        await runOne(t);
      }
    }
  } else if (cmd === "check") {
    const t = /** @type {"dev" | "preview" | "prod"} */ (target);
    const checkOpts = {
      fromSync: !flags.has("--from-working"),
      quiet: flags.has("--quiet") || flags.has("-q"),
      convexOnly: flags.has("--convex-only") || positional.includes("convex"),
      vercelOnly: flags.has("--vercel-only"),
    };
    if (shouldLoopProjects) {
      await forEachProject(monorepoProjects, () => checkTarget(t, checkOpts));
    } else {
      await checkTarget(t, checkOpts);
    }
  } else if (cmd === "deploy") {
    const deployArgs = parseDeployArgs(rawWithoutProject.slice(1));
    if (shouldLoopProjects) {
      await forEachProject(monorepoProjects, () => deployTarget(deployArgs));
    } else {
      await deployTarget(deployArgs);
    }
  } else {
    usage();
    process.exit(1);
  }
} catch (e) {
  printCliFailure(e);
  process.exitCode = 1;
}
