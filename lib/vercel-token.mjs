/**
 * Vercel bearer token resolution (shared by API helpers and auth guard).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT } from "./paths.mjs";
import { readRepoConfig } from "./repo-config.mjs";

/**
 * @returns {readonly string[]}
 */
export function getVercelAuthJsonPaths() {
  const h = os.homedir();
  /** @type {string[]} */
  const paths = [];
  if (process.platform === "darwin") {
    paths.push(
      path.join(h, "Library", "Application Support", "com.vercel.cli", "auth.json")
    );
  } else if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(h, "AppData", "Roaming");
    paths.push(path.join(appData, "com.vercel.cli", "auth.json"));
  } else {
    const xdg =
      process.env.XDG_DATA_HOME || path.join(h, ".local", "share");
    paths.push(path.join(xdg, "com.vercel.cli", "auth.json"));
  }
  paths.push(path.join(h, ".config", "vercel", "auth.json"));
  return paths;
}

/**
 * @param {unknown} j
 * @returns {string}
 */
export function extractTokenFromAuthObject(j) {
  if (!j || typeof j !== "object") return "";
  const o = /** @type {Record<string, unknown>} */ (j);
  const top = o.token;
  if (typeof top === "string" && top.trim()) return top.trim();
  const creds = o.credentials;
  if (Array.isArray(creds)) {
    for (const c of creds) {
      if (c && typeof c === "object" && "token" in c) {
        const t = /** @type {{ token?: unknown }} */ (c).token;
        if (typeof t === "string" && t.trim()) return t.trim();
      }
    }
  }
  return "";
}

/**
 * @returns {string}
 */
function readTokenFromAuthFile() {
  const rel = process.env.ENV_SYNC_VERCEL_AUTH_FILE?.trim();
  if (!rel) return "";
  const abs = path.isAbsolute(rel) ? rel : path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) return "";
  try {
    return extractTokenFromAuthObject(
      JSON.parse(fs.readFileSync(abs, "utf8"))
    );
  } catch {
    return "";
  }
}

/**
 * @returns {string}
 */
function readTokenFromGlobalCliAuth() {
  for (const p of getVercelAuthJsonPaths()) {
    if (!fs.existsSync(p)) continue;
    try {
      const tok = extractTokenFromAuthObject(
        JSON.parse(fs.readFileSync(p, "utf8"))
      );
      if (tok) return tok;
    } catch {
      /* ignore */
    }
  }
  return "";
}

/**
 * @returns {string}
 */
export function resolveVercelToken() {
  const fromEnv = process.env.VERCEL_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  const fromFile = readTokenFromAuthFile();
  if (fromFile) return fromFile;

  const allowGlobal =
    process.env.ENV_SYNC_ALLOW_GLOBAL_VERCEL_AUTH?.trim().toLowerCase() ===
      "1" ||
    process.env.ENV_SYNC_ALLOW_GLOBAL_VERCEL_AUTH?.trim().toLowerCase() ===
      "true" ||
    process.env.ENV_SYNC_ALLOW_GLOBAL_VERCEL_AUTH?.trim().toLowerCase() ===
      "yes";
  const cfg = readRepoConfig();
  const hasTeamGuard =
    Boolean(cfg?.vercelTeamId?.trim()) ||
    Boolean(cfg?.vercelTeamSlug?.trim());

  if (!hasTeamGuard || allowGlobal) {
    return readTokenFromGlobalCliAuth();
  }

  return "";
}
