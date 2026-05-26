/**
 * Plan a push: load local file, fetch remote, compute per-key Convex/Vercel diffs.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  buildConvexCliEnvForPushLocalMap,
  inferConvexUseProdFromLocalMap,
} from "./exec.mjs";
import { hashEnvMap } from "./hash.mjs";
import { readMetadata } from "./metadata.mjs";
import { parseDotenv } from "./parse-dotenv.mjs";
import { resolveLocalEnvReadPathForPush } from "./local-env-paths.mjs";
import { REPO_ROOT } from "./paths.mjs";
import {
  fetchConvexEnvMap,
  fetchConvexEnvMapOptions,
  fetchVercelEnvMap,
  vercelEnvName,
} from "./remote.mjs";
import { filterForConvexWithWarnings, filterForVercel } from "./split.mjs";
import { extractConvexDeploymentSlug } from "./convex-vercel-link.mjs";

/** @typedef {import("./remote.mjs").TTarget} TTarget */

/**
 * @typedef {"add" | "change"} TPushChangeAction
 */

/**
 * @typedef {{
 *   key: string;
 *   action: TPushChangeAction;
 *   remote: string | undefined;
 *   local: string;
 * }} TPushKeyChange
 */

/**
 * @typedef {{
 *   target: TTarget;
 *   localPath: string;
 *   localRel: string;
 *   fromSync: boolean;
 *   convexOnly: boolean;
 *   force: boolean;
 *   driftConvex: boolean;
 *   driftVercel: boolean;
 *   localChangedSinceLastPush: boolean;
 *   convexDroppedLocalhost: string[];
 *   convexKind: "development" | "production";
 *   convexSlug: string | null;
 *   convexChanges: TPushKeyChange[];
 *   convexSkipped: number;
 *   vercelEnv: "development" | "preview" | "production" | null;
 *   vercelChanges: TPushKeyChange[];
 *   vercelSkipped: number;
 *   localMap: Map<string, string>;
 *   convexToPush: Map<string, string>;
 *   vercelToPush: Map<string, string> | null;
 *   convexCliEnv: NodeJS.ProcessEnv;
 *   localSourceHash: string;
 * }} TPushPlan
 */

/**
 * @param {Map<string, string>} local
 * @param {Map<string, string>} remote
 * @returns {Map<string, string>}
 */
export function diffMapAgainstRemote(local, remote) {
  const out = new Map();
  for (const [k, v] of local) {
    const current = remote.get(k);
    if (current === undefined || current !== v) out.set(k, v);
  }
  return out;
}

/**
 * @param {Map<string, string>} local
 * @param {Map<string, string>} remote
 * @returns {TPushKeyChange[]}
 */
export function buildPushKeyChanges(local, remote) {
  /** @type {TPushKeyChange[]} */
  const changes = [];
  for (const [k, v] of local) {
    const current = remote.get(k);
    if (current === undefined) {
      changes.push({ key: k, action: "add", remote: undefined, local: v });
    } else if (current !== v) {
      changes.push({ key: k, action: "change", remote: current, local: v });
    }
  }
  changes.sort((a, b) => a.key.localeCompare(b.key));
  return changes;
}

/**
 * @param {Map<string, string>} localMap
 * @param {boolean} fromSync
 * @param {TTarget} target
 */
function convexPushUsesProd(localMap, fromSync, target) {
  if (fromSync) return inferConvexUseProdFromLocalMap(localMap, target);
  return target === "prod";
}

/**
 * Build a push plan (fetches remote state; does not write).
 *
 * @param {TTarget} target
 * @param {{ fromSync?: boolean; convexOnly?: boolean; force?: boolean }} [opts]
 * @returns {Promise<TPushPlan>}
 */
export async function planPushTarget(target, opts = {}) {
  const fromSync = opts.fromSync === true;
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
        "[env:sync] --from-sync requires CONVEX_DEPLOY_KEY and/or NEXT_PUBLIC_CONVEX_URL (or CONVEX_URL) in the sync file."
      );
    }
  }

  const localSourceHash = crypto
    .createHash("sha256")
    .update(raw, "utf8")
    .digest("hex");

  const convexCliEnv = buildConvexCliEnvForPushLocalMap(
    localMap,
    fromSync,
    target
  );
  const remoteConvex = fromSync
    ? fetchConvexEnvMapOptions({
        useProd: inferConvexUseProdFromLocalMap(localMap, target),
        convexEnv: convexCliEnv,
      })
    : fetchConvexEnvMap(target, convexCliEnv);
  const remoteVercel = convexOnly ? null : fetchVercelEnvMap(target);

  const meta = readMetadata();
  const prev = meta[target];
  const driftConvex = Boolean(prev?.convexHash && prev.convexHash !== hashEnvMap(remoteConvex));
  const driftVercel =
    !convexOnly &&
    Boolean(prev?.vercelHash && remoteVercel && prev.vercelHash !== hashEnvMap(remoteVercel));
  const localChangedSinceLastPush = Boolean(
    prev?.lastPushedLocalHash && prev.lastPushedLocalHash !== localSourceHash
  );

  const { out: convexFiltered, droppedLocalhost: convexDroppedLocalhost } =
    filterForConvexWithWarnings(localMap);
  const vercelFiltered = filterForVercel(localMap);

  const convexToPush = force
    ? convexFiltered
    : diffMapAgainstRemote(convexFiltered, remoteConvex);
  const vercelToPush = convexOnly
    ? null
    : force
      ? vercelFiltered
      : diffMapAgainstRemote(vercelFiltered, remoteVercel ?? new Map());

  const usesProd = convexPushUsesProd(localMap, fromSync, target);

  return {
    target,
    localPath,
    localRel: path.relative(REPO_ROOT, localPath),
    fromSync,
    convexOnly,
    force,
    driftConvex,
    driftVercel,
    localChangedSinceLastPush,
    convexDroppedLocalhost,
    convexKind: usesProd ? "production" : "development",
    convexSlug: extractConvexDeploymentSlug(localMap),
    convexChanges: buildPushKeyChanges(convexToPush, remoteConvex),
    convexSkipped: convexFiltered.size - convexToPush.size,
    vercelEnv: convexOnly ? null : vercelEnvName(target),
    vercelChanges: vercelToPush
      ? buildPushKeyChanges(vercelToPush, remoteVercel ?? new Map())
      : [],
    vercelSkipped: convexOnly ? 0 : vercelFiltered.size - (vercelToPush?.size ?? 0),
    localMap,
    convexToPush,
    vercelToPush,
    convexCliEnv,
    localSourceHash,
  };
}
