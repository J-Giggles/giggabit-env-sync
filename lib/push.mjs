/**
 * env:sync:push — push local env file to Convex + Vercel with drift warnings.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  buildConvexCliEnvForPushLocalMap,
  inferConvexUseProdFromLocalMap,
  pnpmExec,
} from "./exec.mjs";
import { hashEnvMap } from "./hash.mjs";
import { patchTarget, readMetadata } from "./metadata.mjs";
import { parseDotenv, serializeDotenv } from "./parse-dotenv.mjs";
import {
  resolveLocalEnvReadPathForPush,
} from "./local-env-paths.mjs";
import { REPO_ROOT, SYNC_DIR, cachePath } from "./paths.mjs";
import { confirmOrCancel } from "./prompt.mjs";
import {
  convexEnvSetSuffixArgs,
  fetchConvexEnvMap,
  fetchConvexEnvMapOptions,
  fetchVercelEnvMap,
  vercelEnvName,
} from "./remote.mjs";
import { filterForConvexWithWarnings, filterForVercel } from "./split.mjs";
import {
  getVercelPreviewGitBranch,
  isVercelPreviewNoGitBranch,
} from "./vercel-preview-branch.mjs";
import { extractConvexDeploymentSlug } from "./convex-vercel-link.mjs";
import {
  resolveVercelEnvApiType,
  upsertVercelEnvPreviewAllBranches,
} from "./vercel-env-api.mjs";
import { syncDim, syncInfo, syncWarn } from "./cli-style.mjs";

/** @typedef {import("./remote.mjs").TTarget} TTarget */

/**
 * @param {TTarget} target
 * @param {{ yes?: boolean; fromSync?: boolean; vercelSensitive?: "default" | "on" | "off"; convexOnly?: boolean; force?: boolean }} [opts]
 *   — `yes`: skip confirmations; `fromSync`: read `.env.sync.<env>` and match Convex CLI to `CONVEX_DEPLOY_KEY` / URLs in that file;
 *   `vercelSensitive`: whether to pass `--sensitive` for matching keys (`default` → env / project constant);
 *   `convexOnly`: run `convex env set` only — skip Vercel CLI (faster; metadata `vercelHash` is left unchanged);
 *   `force`: disable per-key diff filtering and push every key (legacy behavior).
 */
export async function pushTarget(target, opts = {}) {
  const skipConfirm = opts.yes === true;
  const fromSync = opts.fromSync === true;
  const vercelSensitive = opts.vercelSensitive ?? "default";
  const convexOnly = opts.convexOnly === true;
  const force = opts.force === true;
  const localPath = resolveLocalEnvReadPathForPush(target, { fromSync });
  if (!localPath) {
    throw new Error(
      `[env:sync] No local env file found for "${target}". Create one (see docs/env/ENVIRONMENTS.md).`
    );
  }

  const raw = fs.readFileSync(localPath, "utf8");
  const localMap = parseDotenv(raw);
  if (fromSync) {
    const hasConvexRouting =
      Boolean(localMap.get("CONVEX_DEPLOY_KEY")?.trim()) ||
      Boolean(extractConvexDeploymentSlug(localMap));
    if (!hasConvexRouting) {
      throw new Error(
        "[env:sync] --from-sync requires CONVEX_DEPLOY_KEY and/or NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) in the sync file so the Convex CLI can target the correct deployment."
      );
    }
  }
  const localSourceHash = crypto
    .createHash("sha256")
    .update(raw, "utf8")
    .digest("hex");

  syncInfo(`Source file: ${path.relative(REPO_ROOT, localPath)}`);
  if (fromSync) {
    const kind = inferConvexUseProdFromLocalMap(localMap, target)
      ? "production"
      : "development";
    syncInfo(
      `--from-sync: Convex drift/compare uses ${kind} deployment (CONVEX_DEPLOY_KEY prefix and/or sync target).`
    );
  }

  fs.mkdirSync(SYNC_DIR, { recursive: true });

  if (convexOnly) {
    syncInfo(
      "Convex-only push: skipping Vercel (no `vercel env` calls; stored `vercelHash` is not updated)."
    );
  }

  syncInfo(
    convexOnly
      ? "Fetching current remote Convex (for drift check)…"
      : "Fetching current remote Convex + Vercel (for drift check)…"
  );
  /** Must match `pnpm exec convex` subprocess so list/set target the same deployment (CLI prefers `CONVEX_DEPLOY_KEY`). */
  const convexCliEnv = buildConvexCliEnvForPushLocalMap(
    localMap,
    fromSync,
    target
  );
  if (localMap.get("CONVEX_DEPLOY_KEY")?.trim()) {
    syncInfo(
      "Convex CLI: using CONVEX_DEPLOY_KEY from this push file (CLI follows the deploy key over `--prod` alone; align the key with this snapshot)."
    );
  }
  const remoteConvex = fromSync
    ? fetchConvexEnvMapOptions({
        useProd: inferConvexUseProdFromLocalMap(localMap, target),
        convexEnv: convexCliEnv,
      })
    : fetchConvexEnvMap(target, convexCliEnv);
  const remoteVercel = convexOnly ? null : fetchVercelEnvMap(target);

  const remoteConvexHash = hashEnvMap(remoteConvex);
  const remoteVercelHash = remoteVercel ? hashEnvMap(remoteVercel) : "";

  const meta = readMetadata();
  const prev = meta[target];
  const driftConvex =
    prev?.convexHash && prev.convexHash !== remoteConvexHash;
  const driftVercel =
    !convexOnly &&
    Boolean(prev?.vercelHash && remoteVercelHash !== prev.vercelHash);

  if (driftConvex || driftVercel) {
    syncWarn(
      "⚠ Remote environment(s) changed since the last recorded pull (or never pulled)."
    );
    if (driftConvex) {
      syncWarn(
        "  • Convex: hosted env no longer matches last stored snapshot hash."
      );
    }
    if (driftVercel) {
      syncWarn(
        "  • Vercel: hosted env no longer matches last stored snapshot hash."
      );
    }
    syncWarn(
      "  Run `pnpm run env:sync:pull -- " +
        target +
        "` first to merge remote state, or continue to overwrite remote with your local file."
    );
    if (!skipConfirm) {
      const ok = await confirmOrCancel("Continue with push?");
      if (!ok) {
        syncInfo("Push cancelled.");
        process.exitCode = 1;
        return;
      }
    } else {
      syncWarn("--yes: continuing despite drift.");
    }
  }

  if (
    prev?.lastPushedLocalHash &&
    prev.lastPushedLocalHash !== localSourceHash
  ) {
    syncWarn(
      "⚠ Your local env file bytes changed since the last successful push."
    );
    if (!skipConfirm) {
      const ok2 = await confirmOrCancel("Continue anyway?");
      if (!ok2) {
        syncInfo("Push cancelled.");
        process.exitCode = 1;
        return;
      }
    } else {
      syncWarn("--yes: continuing despite local file change.");
    }
  }

  if (target === "preview" && !fromSync) {
    syncWarn(
      "Note: Convex CLI targets dev or prod deployments only. This push applies Convex env to the **dev** deployment; ephemeral PR preview backends also use dashboard defaults."
    );
  }

  const { out: convexFiltered, droppedLocalhost: convexDroppedLocalhost } =
    filterForConvexWithWarnings(localMap);
  const vercelFiltered = filterForVercel(localMap);

  if (convexDroppedLocalhost.length > 0) {
    for (const key of convexDroppedLocalhost) {
      syncWarn(
        `Skipping ${key}=${JSON.stringify(localMap.get(key))} for Convex push — Convex cloud cannot reach localhost. ` +
          `Set ${key} on this Convex deployment manually (dashboard → Settings → Environment Variables) to a public URL ` +
          `(Vercel preview/production or a tunnel). This key is left untouched on Convex.`
      );
    }
  }

  logConvexPushPlan(target, localMap, fromSync, convexFiltered);

  /**
   * Per-key diff: only keys that are **new** or have a **different value** on Convex go in the push payload.
   * Equal keys are skipped entirely — `convex env set --from-file` only writes the keys in the file, so
   * untouched remote keys stay intact. Pass `--force` flag (at script level) to disable this optimization.
   */
  const convexToPush = force
    ? convexFiltered
    : diffMapAgainstRemote(convexFiltered, remoteConvex);
  const convexSkipped = convexFiltered.size - convexToPush.size;
  if (!force && convexSkipped > 0) {
    syncInfo(
      `Convex diff: ${convexToPush.size} key(s) to push, ${convexSkipped} unchanged → skipped.`
    );
  }
  if (convexToPush.size > 0) {
    const convexFile = cachePath(`push.convex.${target}.env`);
    fs.writeFileSync(convexFile, serializeDotenv(convexToPush), "utf8");

    const cArgs = [
      "env",
      "set",
      "--from-file",
      convexFile,
      "--force",
      ...convexEnvSetSuffixArgs(target, localMap, fromSync),
    ];
    syncInfo(
      `Running convex env set --from-file (${target} sync target, ${convexToPush.size} key(s))…`
    );
    const cRes = pnpmExec("convex", cArgs, { env: convexCliEnv });
    try {
      fs.unlinkSync(convexFile);
    } catch {
      /* ignore */
    }
    if (!cRes.ok) {
      console.error(cRes.stderr || cRes.stdout);
      throw new Error("convex env set --from-file failed");
    }
    if (cRes.stdout.trim()) console.log(cRes.stdout.trim());
  } else {
    syncInfo(
      "Convex: no changes vs remote — skipping `convex env set` entirely."
    );
  }

  if (!convexOnly) {
    const vEnv = vercelEnvName(target);
    const vercelToPush = force
      ? vercelFiltered
      : diffMapAgainstRemote(vercelFiltered, remoteVercel ?? new Map());
    const vercelSkipped = vercelFiltered.size - vercelToPush.size;
    syncInfo(
      force
        ? `Pushing to Vercel (${vEnv}) — ${vercelFiltered.size} key(s) (--force)…`
        : `Pushing to Vercel (${vEnv}) — ${vercelToPush.size} changed/new, ${vercelSkipped} unchanged skipped.`
    );
    const appUrl = vercelToPush.get("APP_URL");
    const nextPublicApp = vercelToPush.get("NEXT_PUBLIC_APP_URL");
    if (appUrl !== undefined || nextPublicApp !== undefined) {
      syncInfo(
        `From this push file → Vercel \`${vEnv}\`: APP_URL=${JSON.stringify(appUrl ?? "(unchanged)")} · NEXT_PUBLIC_APP_URL=${JSON.stringify(nextPublicApp ?? "(unchanged)")}`
      );
    }
    if (vercelToPush.size > 0) {
      await pushVercelMap(vercelToPush, vEnv, { vercelSensitive });
    } else {
      syncInfo(
        `Vercel (${vEnv}): no changes vs remote — skipping all \`vercel env\` calls.`
      );
    }
  }

  const now = new Date().toISOString();
  syncInfo(
    convexOnly
      ? "Re-fetching Convex hash after push…"
      : "Re-fetching remote hashes after push…"
  );
  const afterConvex = hashEnvMap(
    fromSync
      ? fetchConvexEnvMapOptions({
          useProd: inferConvexUseProdFromLocalMap(localMap, target),
          convexEnv: convexCliEnv,
        })
      : fetchConvexEnvMap(target, convexCliEnv)
  );
  if (convexOnly) {
    patchTarget(target, {
      convexHash: afterConvex,
      lastPushedLocalHash: localSourceHash,
      lastPushAt: now,
    });
  } else {
    const afterVercel = hashEnvMap(fetchVercelEnvMap(target));
    patchTarget(target, {
      convexHash: afterConvex,
      vercelHash: afterVercel,
      lastPushedLocalHash: localSourceHash,
      lastPushAt: now,
    });
  }

  syncInfo("Push finished.");
}

/**
 * Return a subset of `local` containing only keys where the value differs from `remote`
 * (or the key is missing remotely). Used for per-key diff pushes so equal values are skipped.
 *
 * @param {Map<string, string>} local
 * @param {Map<string, string>} remote
 * @returns {Map<string, string>}
 */
function diffMapAgainstRemote(local, remote) {
  const out = new Map();
  for (const [k, v] of local) {
    const current = remote.get(k);
    if (current === undefined || current !== v) out.set(k, v);
  }
  return out;
}

/**
 * Whether `convex env set` will use `--prod` (same rules as {@link convexEnvSetSuffixArgs}).
 *
 * @param {import("./remote.mjs").TTarget} target
 * @param {Map<string, string>} localMap
 * @param {boolean} fromSync
 * @returns {boolean}
 */
function convexPushUsesProd(target, localMap, fromSync) {
  if (fromSync) {
    return inferConvexUseProdFromLocalMap(localMap, target);
  }
  return target === "prod";
}

/**
 * Log Convex deployment identity and safe fingerprint vars before `convex env set`.
 *
 * @param {import("./remote.mjs").TTarget} target
 * @param {Map<string, string>} localMap
 * @param {boolean} fromSync
 * @param {Map<string, string>} convexFiltered
 */
function logConvexPushPlan(target, localMap, fromSync, convexFiltered) {
  const usesProd = convexPushUsesProd(target, localMap, fromSync);
  const slug = extractConvexDeploymentSlug(localMap);
  const kind = usesProd ? "production" : "development";
  syncInfo(
    `Convex push target: ${kind} deployment${slug ? ` — slug \`${slug}\`` : ""}`
  );
  syncDim(
    `  CLI: convex env set --from-file … --force${usesProd ? " --prod" : ""}`
  );
  const dk = localMap.get("CONVEX_DEPLOY_KEY");
  if (typeof dk === "string" && dk.trim()) {
    const raw = dk.trim();
    const line = raw.length > 96 ? `${raw.slice(0, 93)}…` : raw;
    syncDim(`  CONVEX_DEPLOY_KEY in file: ${line}`);
  }
  const ncu = localMap.get("NEXT_PUBLIC_CONVEX_URL") ?? localMap.get("CONVEX_URL");
  if (typeof ncu === "string" && ncu.trim()) {
    syncDim(
      `  Convex HTTP URL in file (Next.js only; not stored in Convex env): ${ncu.trim()}`
    );
  }
  const app = convexFiltered.get("APP_URL");
  if (app !== undefined) {
    syncDim(`  APP_URL in this push (→ Convex): ${JSON.stringify(app)}`);
  }
  if (localMap.has("NODE_ENV") && !convexFiltered.has("NODE_ENV")) {
    syncDim(
      `  NODE_ENV in file: ${JSON.stringify(localMap.get("NODE_ENV"))} — not sent to Convex (split rules).`
    );
  }
  syncDim(
    `  ${convexFiltered.size} key(s) in Convex env payload after split rules.`
  );
}

/** @param {{ stderr?: string; stdout?: string }} r */
function vercelOutput(r) {
  return `${r.stderr || ""}${r.stdout || ""}`;
}

/** @param {string} combined */
function vercelLooksMissing(combined) {
  return /not found|does not exist|Unknown|No such|env_not_found|No Environment Variable.*found matching/i.test(
    combined
  );
}

/** @param {string} combined */
function vercelNeedsPreviewGitBranch(combined) {
  return /git_branch_required|"reason"\s*:\s*"git_branch_required"/i.test(combined);
}

/** @param {string} combined */
function vercelAlreadyExists(combined) {
  return /already exists|duplicate|Environment Variable.*already/i.test(combined);
}

/**
 * Run CLI with captured stdout/stderr (async so multiple Vercel calls can overlap).
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string; input?: string; env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<{ ok: boolean; status: number; stdout: string; stderr: string; error: Error | null }>}
 */
function spawnCaptureAsync(command, args, opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    /** @param {{ ok: boolean; status: number; stdout: string; stderr: string; error: Error | null }} payload */
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    const child = spawn(command, args, {
      cwd: opts.cwd ?? REPO_ROOT,
      env: opts.env ?? process.env,
      stdio: opts.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    });
    if (opts.input && child.stdin) {
      child.stdin.write(opts.input, "utf8");
      child.stdin.end();
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });
    child.on("error", (err) => {
      finish({
        ok: false,
        status: 127,
        stdout,
        stderr: `${stderr}${err.message}`,
        error: err,
      });
    });
    child.on("close", (code) => {
      finish({
        ok: code === 0,
        status: code ?? 0,
        stdout,
        stderr,
        error: null,
      });
    });
  });
}

/**
 * @param {string[]} args
 * @param {{ input?: string }} [opts]
 */
async function runVercelCliAsync(args, opts = {}) {
  let r = await spawnCaptureAsync("vercel", args, {
    cwd: REPO_ROOT,
    env: process.env,
    ...opts,
  });
  if (!r.ok && (r.error || /not found|ENOENT/i.test(r.stderr))) {
    r = await spawnCaptureAsync("pnpm", ["dlx", "vercel", ...args], {
      cwd: REPO_ROOT,
      env: process.env,
      ...opts,
    });
  }
  return r;
}

/**
 * @param {readonly string[][]} items — [key, value][]
 * @param {number} limit
 * @param {(entry: string[]) => Promise<void>} fn
 */
async function mapWithConcurrency(items, limit, fn) {
  if (items.length === 0) return;
  const cap = Math.min(Math.max(1, limit), items.length);
  let index = 0;
  /** @type {Error | undefined} */
  let failure;
  async function worker() {
    for (;;) {
      if (failure) return;
      const cur = index++;
      if (cur >= items.length) return;
      try {
        await fn(items[cur]);
      } catch (err) {
        failure = err instanceof Error ? err : new Error(String(err));
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: cap }, () => worker()));
  if (failure) throw failure;
}

/**
 * @param {Map<string, string>} map
 * @param {string} envName
 * @param {{ vercelSensitive?: "default" | "on" | "off" }} [opts]
 */
async function pushVercelMap(map, envName, _opts = {}) {
  const previewBranch =
    envName === "preview" ? getVercelPreviewGitBranch() : "";
  if (envName === "preview") {
    if (isVercelPreviewNoGitBranch()) {
      syncInfo(
        "Vercel Preview: no git branch — `vercel env add … preview` applies to all Preview deployments."
      );
    } else if (previewBranch) {
      syncInfo(`Vercel Preview variables scoped to git branch: ${previewBranch}`);
    }
  }
  const entries = [...map].filter(([, value]) => value !== "");

  const rawConc = process.env.ENV_SYNC_VERCEL_CONCURRENCY?.trim();
  const parsed =
    rawConc === undefined || rawConc === ""
      ? 4
      : Number.parseInt(rawConc, 10);
  const concurrency =
    Number.isFinite(parsed) && parsed >= 1 ? Math.min(12, parsed) : 1;
  if (concurrency > 1) {
    syncInfo(
      `Vercel CLI concurrency ${concurrency} (set ENV_SYNC_VERCEL_CONCURRENCY=1 to serialize)`
    );
  }

  await mapWithConcurrency(entries, concurrency, async ([key, value]) => {
    /**
     * Drop any existing binding for this **exact** Vercel scope (and optional Preview branch).
     * Failures are ignored (variable may not exist in this scope yet).
     *
     * **Why:** In the dashboard, one row can attach the same key to Development + Preview +
     * Production with a **single** value. `vercel env update … development` can replace that
     * one value, so Production/Preview incorrectly get Development’s value. Removing only this
     * scope first splits shared rows so the following add applies **only** here.
     */
    const runRmScoped = async (/** @type {string | undefined} */ branch) => {
      const args = ["env", "rm", key, envName];
      if (branch) args.push(branch);
      args.push("-y");
      await runVercelCliAsync(args);
    };
    await runRmScoped(undefined);
    if (envName === "preview" && previewBranch) {
      await runRmScoped(previewBranch);
    }

    const runUpdate = async (/** @type {string | undefined} */ branch) => {
      const args = ["env", "update", key, envName];
      if (branch) args.push(branch);
      args.push("-y", "--value", value);
      return runVercelCliAsync(args);
    };
    /**
     * Project policy: never pass `--sensitive`. Values must stay readable via `vercel env pull`
     * so snapshots and the diff logic work.
     *
     * @param {string | undefined} branch
     */
    const runAdd = async (branch) => {
      const args = ["env", "add", key, envName];
      if (branch) args.push(branch);
      args.push("-y", "--value", value);
      return runVercelCliAsync(args);
    };

    const applyAddRetries = async (
      /** @type {{ ok: boolean; stdout: string; stderr: string }} */ first
    ) => {
      let r = first;
      let out = vercelOutput(r);
      if (
        !r.ok &&
        envName === "preview" &&
        vercelNeedsPreviewGitBranch(out) &&
        previewBranch
      ) {
        r = await runAdd(previewBranch);
        out = vercelOutput(r);
      }
      return { r, out };
    };

    let r = await runAdd(undefined);
    let out = vercelOutput(r);
    ({ r, out } = await applyAddRetries(r));

    if (!r.ok && vercelAlreadyExists(out)) {
      r = await runUpdate(undefined);
      out = vercelOutput(r);
      if (
        !r.ok &&
        envName === "preview" &&
        vercelNeedsPreviewGitBranch(out) &&
        previewBranch
      ) {
        r = await runUpdate(previewBranch);
        out = vercelOutput(r);
      }
    }

    if (!r.ok && vercelLooksMissing(out)) {
      r = await runAdd(undefined);
      out = vercelOutput(r);
      ({ r, out } = await applyAddRetries(r));
    }

    if (!r.ok) {
      if (
        envName === "preview" &&
        !previewBranch &&
        vercelNeedsPreviewGitBranch(out)
      ) {
        const apiType = resolveVercelEnvApiType(key, false, false);
        const apiRes = await upsertVercelEnvPreviewAllBranches({
          key,
          value,
          type: apiType,
        });
        if (apiRes.ok) {
          syncInfo(
            `Vercel Preview: set ${key} via REST API (CLI returned git_branch_required for unscoped Preview — known CLI limitation).`
          );
          return;
        }
        throw new Error(
          `vercel env failed for ${key}: ${out.trim() || "(no output)"} REST API fallback failed (${apiRes.status}): ${apiRes.body.slice(0, 500)} — set VERCEL_TOKEN, run \`vercel login\` (token is read from the CLI auth file when present), or set ENV_SYNC_VERCEL_PREVIEW_BRANCH for branch-scoped CLI.`
        );
      }
      throw new Error(
        `vercel env failed for ${key}: ${out.trim() || "(no output)"}`
      );
    }
  });
}

/**
 * Kept for backwards compatibility — project policy is "nothing is Sensitive", so this always
 * returns `false`. Call-sites should prefer treating every key as non-sensitive.
 *
 * @param {string} _key
 * @returns {false}
 */
export function isSensitiveKey(_key) {
  return false;
}
