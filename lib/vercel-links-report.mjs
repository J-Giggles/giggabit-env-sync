/**
 * Report Vercel (`.vercel/project.json`) and Cloudflare Worker (`wrangler.toml`) links.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths.mjs";
import { readRepoConfig } from "./repo-config.mjs";
import { getExpectedVercelTeam } from "./repo-config.mjs";
import { buildVercelCliEnv, runVercel } from "./remote.mjs";
import { resolveVercelToken } from "./vercel-token.mjs";
import { run } from "./exec.mjs";
import {
  printBanner,
  printField,
  printNote,
  printSection,
  printTable,
  printTip,
  printWarning,
} from "./links-format.mjs";

/** @typedef {{ relDir: string; projectId: string; orgId?: string; projectName: string }} TVercelLinkRow */

/**
 * @typedef {{
 *   relDir: string;
 *   configFile: string;
 *   accountId?: string;
 *   defaultWorker: string;
 *   envs: Array<{ wranglerEnv: string; workerName: string; envSyncTarget?: string }>;
 * }} TCloudflareLinkRow
 */

const SCAN_ROOTS = ["apps", "packages"];
const API_CWD = path.join(REPO_ROOT, "apps/api");
const WRANGLER_ENV_FOR_PREVIEW_SYNC = "staging";

/**
 * @param {string} dir — absolute path containing `.vercel/project.json`
 * @returns {TVercelLinkRow | null}
 */
function readLinkAt(dir) {
  const linkFile = path.join(dir, ".vercel", "project.json");
  if (!fs.existsSync(linkFile)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(linkFile, "utf8"));
    const projectId = typeof j.projectId === "string" ? j.projectId : "";
    const projectName = typeof j.projectName === "string" ? j.projectName : "";
    const orgId =
      typeof j.orgId === "string"
        ? j.orgId
        : typeof j.settings?.orgId === "string"
          ? j.settings.orgId
          : undefined;
    if (!projectId) return null;
    const relDir = path.relative(REPO_ROOT, dir) || ".";
    return { relDir, projectId, orgId, projectName: projectName || "(unnamed)" };
  } catch {
    return null;
  }
}

/**
 * @returns {TVercelLinkRow[]}
 */
export function discoverVercelLinks() {
  /** @type {TVercelLinkRow[]} */
  const rows = [];
  const rootLink = readLinkAt(REPO_ROOT);
  if (rootLink) rows.push(rootLink);

  for (const scanRoot of SCAN_ROOTS) {
    const absScan = path.join(REPO_ROOT, scanRoot);
    if (!fs.existsSync(absScan)) continue;
    for (const name of fs.readdirSync(absScan)) {
      const appDir = path.join(absScan, name);
      try {
        if (!fs.statSync(appDir).isDirectory()) continue;
      } catch {
        continue;
      }
      const link = readLinkAt(appDir);
      if (link) rows.push(link);
    }
  }

  rows.sort((a, b) => a.relDir.localeCompare(b.relDir));
  return rows;
}

/**
 * @param {TVercelLinkRow[]} rows
 * @param {{ teamSlug?: string; teamId?: string }} meta
 */
function printVercelSection(rows, meta) {
  const title = meta.teamSlug
    ? `Vercel · ${meta.teamSlug}`
    : "Vercel";
  printSection(title);
  if (meta.teamId) {
    printNote(`Team id ${meta.teamId} (all apps below share this org)`);
    console.log("");
  }

  if (rows.length === 0) {
    printWarning("No .vercel/project.json under apps/* or packages/*.");
    printNote("Link: cd apps/<name> && vercel link --scope <team>");
    return;
  }

  printTable(
    ["App", "Vercel project", "Project id"],
    rows.map((r) => [r.relDir, r.projectName, r.projectId])
  );
}

/**
 * @param {TVercelLinkRow[]} rows
 */
function printEnvSyncStatus(rows) {
  const cfg = readRepoConfig();
  const expected = cfg?.vercelProjects ?? [];
  if (expected.length === 0) return;

  const linked = new Set(rows.map((r) => r.relDir));
  const missing = expected.filter((rel) => !linked.has(rel));
  const extra = rows
    .map((r) => r.relDir)
    .filter((rel) => !expected.includes(rel) && rel !== ".");

  console.log("");
  printNote(`env:sync targets: ${expected.join(", ")}`);
  if (missing.length === 0 && extra.length === 0) {
    printNote("Status: all configured apps are linked ✓");
  } else {
    if (missing.length) {
      printWarning(`Missing vercel link: ${missing.join(", ")}`);
    }
    if (extra.length) {
      printNote(`Linked but not in giggabit-env-sync.repo.json: ${extra.join(", ")}`);
    }
  }
}

/**
 * @param {boolean} tryRemote
 */
async function printVercelRemote(tryRemote) {
  if (!tryRemote) return;
  const token = resolveVercelToken();
  const { teamSlug } = getExpectedVercelTeam();
  if (!token) {
    printWarning("Skipped vercel project ls — set VERCEL_TOKEN in .env.local");
    return;
  }

  const r = runVercel(["project", "ls"], {
    env: buildVercelCliEnv(),
  });
  printSection(`Remote · vercel project ls${teamSlug ? ` --scope ${teamSlug}` : ""}`);
  if (!r.ok) {
    printWarning(`CLI failed (${r.status}): ${(r.stderr || r.stdout).trim()}`);
    return;
  }
  const out = r.stdout.trim();
  if (out) {
    for (const line of out.split("\n")) console.log(`  ${line}`);
  } else {
    printNote("(no output)");
  }
}

/**
 * @param {string} wranglerPath — absolute path to `wrangler.toml`
 * @returns {TCloudflareLinkRow | null}
 */
function parseWranglerToml(wranglerPath) {
  let text;
  try {
    text = fs.readFileSync(wranglerPath, "utf8");
  } catch {
    return null;
  }
  const relDir = path.relative(REPO_ROOT, path.dirname(wranglerPath)) || ".";
  const accountId = text.match(/^account_id\s*=\s*"([^"]+)"/m)?.[1];
  const beforeEnv = text.split(/\n\[env\./)[0] ?? text;
  const defaultWorker =
    beforeEnv.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "(unknown)";

  /** @type {TCloudflareLinkRow["envs"]} */
  const envs = [
    {
      wranglerEnv: "production",
      workerName: defaultWorker,
      envSyncTarget: ".env.sync.production",
    },
  ];

  const lines = text.split(/\r?\n/);
  /** @type {number[]} */
  const envHeaderLines = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\[env\.([a-zA-Z0-9_-]+)\]\s*$/);
    if (m) envHeaderLines.push(i);
  }
  for (let i = 0; i < envHeaderLines.length; i++) {
    const headerIdx = envHeaderLines[i];
    const nextIdx = envHeaderLines[i + 1] ?? lines.length;
    const headerMatch = lines[headerIdx].match(/^\[env\.([a-zA-Z0-9_-]+)\]\s*$/);
    if (!headerMatch) continue;
    const wranglerEnv = headerMatch[1];
    const body = lines.slice(headerIdx + 1, nextIdx).join("\n");
    const workerName =
      body.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] ?? defaultWorker;
    /** @type {string | undefined} */
    let envSyncTarget;
    if (wranglerEnv === WRANGLER_ENV_FOR_PREVIEW_SYNC) {
      envSyncTarget = ".env.sync.preview";
    }
    envs.push({
      wranglerEnv: wranglerEnv === WRANGLER_ENV_FOR_PREVIEW_SYNC ? "preview" : wranglerEnv,
      workerName,
      envSyncTarget,
    });
  }

  return {
    relDir,
    configFile: path.relative(REPO_ROOT, wranglerPath),
    accountId,
    defaultWorker,
    envs,
  };
}

/**
 * @returns {TCloudflareLinkRow[]}
 */
export function discoverCloudflareLinks() {
  /** @type {TCloudflareLinkRow[]} */
  const rows = [];
  for (const scanRoot of SCAN_ROOTS) {
    const absScan = path.join(REPO_ROOT, scanRoot);
    if (!fs.existsSync(absScan)) continue;
    for (const name of fs.readdirSync(absScan)) {
      const appDir = path.join(absScan, name);
      try {
        if (!fs.statSync(appDir).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const cfgName of ["wrangler.toml", "wrangler.jsonc"]) {
        const cfg = path.join(appDir, cfgName);
        if (!fs.existsSync(cfg)) continue;
        const row = cfgName === "wrangler.toml" ? parseWranglerToml(cfg) : null;
        if (row) rows.push(row);
      }
    }
  }
  rows.sort((a, b) => a.relDir.localeCompare(b.relDir));
  return rows;
}

/**
 * @param {TCloudflareLinkRow[]} rows
 */
function printCloudflareSection(rows) {
  printSection("Cloudflare Worker · apps/api");

  if (rows.length === 0) {
    printWarning("No wrangler.toml found — expected apps/api/wrangler.toml");
    return;
  }

  const row = rows[0];
  printField("  ", "Config", row.configFile);
  printField(
    "  ",
    "Account",
    row.accountId ?? "(from CLOUDFLARE_API_TOKEN / wrangler login)"
  );
  console.log("");

  printTable(
    ["Deploy target", "Worker name", "env:sync file"],
    row.envs.map((e) => [
      e.wranglerEnv,
      e.workerName,
      e.envSyncTarget ?? "—",
    ])
  );

  console.log("");
  printNote("Push Worker secrets: pnpm run env:sync:push:preview | env:sync:push:production");
}

/**
 * @param {boolean} tryRemote
 */
function printCloudflareRemote(tryRemote) {
  if (!tryRemote) return;
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) {
    printWarning("Skipped wrangler whoami — set CLOUDFLARE_API_TOKEN in .env.local");
    return;
  }
  if (!fs.existsSync(path.join(API_CWD, "wrangler.toml"))) return;

  const r = run("pnpm", ["exec", "wrangler", "whoami"], {
    cwd: API_CWD,
    env: process.env,
  });
  printSection("Remote · wrangler whoami");
  if (!r.ok) {
    printWarning(`CLI failed (${r.status}): ${(r.stderr || r.stdout).trim()}`);
    return;
  }
  const out = r.stdout.trim();
  if (out) {
    for (const line of out.split("\n")) console.log(`  ${line}`);
  } else {
    printNote("(no output)");
  }
}

/**
 * @param {TVercelLinkRow[]} vercelRows
 * @param {TCloudflareLinkRow[]} cloudflareRows
 * @param {{ teamSlug?: string }} meta
 */
function printCliHints(vercelRows, cloudflareRows, meta) {
  const scope = meta.teamSlug ? ` --scope ${meta.teamSlug}` : "";
  printSection("CLI reference (optional)");

  if (vercelRows.length) {
    printNote("Vercel:");
    for (const r of vercelRows) {
      console.log(`    cd ${r.relDir} && vercel project inspect ${r.projectName}${scope}`);
    }
    console.log(
      `    cd apps/admin && vercel link --yes${scope} --project <name>`
    );
  }

  if (cloudflareRows.length) {
    printNote("Cloudflare (from apps/api):");
    console.log("    pnpm exec wrangler deployments list");
    console.log("    pnpm exec wrangler secret list --env staging");
    console.log("    pnpm exec wrangler secret list");
  }
}

/**
 * @param {{ remote?: boolean; hints?: boolean }} [opts]
 */
export async function runVercelLinksReport(opts = {}) {
  const vercelRows = discoverVercelLinks();
  const cloudflareRows = discoverCloudflareLinks();
  const { teamSlug, teamId } = getExpectedVercelTeam();

  printBanner(
    "Deployment links",
    path.basename(REPO_ROOT)
  );

  printVercelSection(vercelRows, { teamSlug, teamId });
  printEnvSyncStatus(vercelRows);
  printCloudflareSection(cloudflareRows);

  if (opts.remote) {
    await printVercelRemote(true);
    printCloudflareRemote(true);
  }

  console.log("");
  if (!opts.remote) {
    printTip("Add --remote to also run vercel project ls and wrangler whoami");
  }
  if (!opts.hints) {
    printTip("Add --hints to show per-app inspect / link commands");
  } else {
    printCliHints(vercelRows, cloudflareRows, { teamSlug });
  }
  console.log("");
}
