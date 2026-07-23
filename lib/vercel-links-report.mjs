/**
 * Report Vercel (`.vercel/project.json`) and Cloudflare Worker (`wrangler.toml`) links.
 */
import fs from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./paths.mjs";
import { getExpectedVercelTeam, readRepoConfig } from "./repo-config.mjs";
import { buildVercelCliEnv, runVercel } from "./remote.mjs";
import { resolveVercelToken } from "./vercel-token.mjs";
import { run } from "./exec.mjs";

const SCAN_ROOTS = ["apps", "packages"];
const WRANGLER_ENV_FOR_PREVIEW_SYNC = "staging";
const API_CWD = path.join(REPO_ROOT, "apps", "api");

function readLinkAt(directory) {
  const linkFile = path.join(directory, ".vercel", "project.json");
  if (!fs.existsSync(linkFile)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(linkFile, "utf8"));
    const projectId = typeof value.projectId === "string" ? value.projectId : "";
    const projectName =
      typeof value.projectName === "string" ? value.projectName : "";
    const orgId =
      typeof value.orgId === "string"
        ? value.orgId
        : typeof value.settings?.orgId === "string"
          ? value.settings.orgId
          : undefined;
    if (!projectId) return null;
    return {
      relDir: path.relative(REPO_ROOT, directory) || ".",
      projectId,
      orgId,
      projectName: projectName || "(unnamed)",
    };
  } catch {
    return null;
  }
}

export function discoverVercelLinks() {
  const rows = [];
  const rootLink = readLinkAt(REPO_ROOT);
  if (rootLink) rows.push(rootLink);

  for (const scanRoot of SCAN_ROOTS) {
    const absoluteRoot = path.join(REPO_ROOT, scanRoot);
    if (!fs.existsSync(absoluteRoot)) continue;
    for (const name of fs.readdirSync(absoluteRoot)) {
      const candidate = path.join(absoluteRoot, name);
      try {
        if (!fs.statSync(candidate).isDirectory()) continue;
      } catch {
        continue;
      }
      const link = readLinkAt(candidate);
      if (link) rows.push(link);
    }
  }

  return rows.sort((a, b) => a.relDir.localeCompare(b.relDir));
}

function parseWranglerToml(wranglerPath) {
  let text;
  try {
    text = fs.readFileSync(wranglerPath, "utf8");
  } catch {
    return null;
  }

  const beforeEnv = text.split(/\n\[env\./)[0] ?? text;
  const defaultWorker =
    beforeEnv.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? "(unknown)";
  const envs = [
    {
      wranglerEnv: "production",
      workerName: defaultWorker,
      envSyncTarget: ".env.sync.production",
    },
  ];
  const lines = text.split(/\r?\n/);
  const headers = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\[env\.([a-zA-Z0-9_-]+)\]\s*$/.test(lines[index])) {
      headers.push(index);
    }
  }
  for (let index = 0; index < headers.length; index += 1) {
    const headerIndex = headers[index];
    const nextIndex = headers[index + 1] ?? lines.length;
    const wranglerEnv = lines[headerIndex].match(
      /^\[env\.([a-zA-Z0-9_-]+)\]\s*$/,
    )?.[1];
    if (!wranglerEnv) continue;
    const body = lines.slice(headerIndex + 1, nextIndex).join("\n");
    const workerName =
      body.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] ?? defaultWorker;
    envs.push({
      wranglerEnv:
        wranglerEnv === WRANGLER_ENV_FOR_PREVIEW_SYNC
          ? "preview"
          : wranglerEnv,
      workerName,
      envSyncTarget:
        wranglerEnv === WRANGLER_ENV_FOR_PREVIEW_SYNC
          ? ".env.sync.preview"
          : undefined,
    });
  }

  return {
    relDir: path.relative(REPO_ROOT, path.dirname(wranglerPath)) || ".",
    configFile: path.relative(REPO_ROOT, wranglerPath),
    accountId: text.match(/^account_id\s*=\s*"([^"]+)"/m)?.[1],
    envs,
  };
}

export function discoverCloudflareLinks() {
  const rows = [];
  for (const scanRoot of SCAN_ROOTS) {
    const absoluteRoot = path.join(REPO_ROOT, scanRoot);
    if (!fs.existsSync(absoluteRoot)) continue;
    for (const name of fs.readdirSync(absoluteRoot)) {
      const wranglerPath = path.join(absoluteRoot, name, "wrangler.toml");
      if (!fs.existsSync(wranglerPath)) continue;
      const row = parseWranglerToml(wranglerPath);
      if (row) rows.push(row);
    }
  }
  return rows.sort((a, b) => a.relDir.localeCompare(b.relDir));
}

export async function runVercelLinksReport(opts = {}) {
  const vercelRows = discoverVercelLinks();
  const cloudflareRows = discoverCloudflareLinks();
  const { teamId, teamSlug } = getExpectedVercelTeam();

  console.log("Deployment links");
  console.log("");
  console.log(`Vercel${teamSlug ? ` · ${teamSlug}` : ""}`);
  if (teamId) console.log(`  Team id: ${teamId}`);
  if (vercelRows.length === 0) {
    console.log("  No .vercel/project.json under apps/* or packages/*.");
  } else {
    for (const row of vercelRows) {
      console.log(`  ${row.relDir}  ${row.projectName}  ${row.projectId}`);
    }
  }

  const expected = readRepoConfig()?.vercelProjects ?? [];
  if (expected.length > 0) {
    const linked = new Set(vercelRows.map((row) => row.relDir));
    const missing = expected.filter((relativePath) => !linked.has(relativePath));
    console.log(`  env:sync targets: ${expected.join(", ")}`);
    console.log(
      missing.length === 0
        ? "  Status: all configured apps are linked ✓"
        : `  Missing vercel link: ${missing.join(", ")}`,
    );
  }

  console.log("");
  console.log("Cloudflare Worker");
  if (cloudflareRows.length === 0) {
    console.log("  No wrangler.toml found.");
  } else {
    for (const row of cloudflareRows) {
      console.log(`  Config: ${row.configFile}`);
      console.log(`  Account: ${row.accountId ?? "(from token or wrangler login)"}`);
      for (const environment of row.envs) {
        console.log(
          `  ${environment.wranglerEnv}  ${environment.workerName}  ${environment.envSyncTarget ?? "—"}`,
        );
      }
    }
  }

  if (!opts.remote) return;

  console.log("");
  console.log(`Remote · vercel project ls${teamSlug ? ` --scope ${teamSlug}` : ""}`);
  if (!resolveVercelToken()) {
    console.log("  Skipped — set VERCEL_TOKEN in .env.local");
  } else {
    const result = runVercel(["project", "ls"], {
      env: buildVercelCliEnv(),
    });
    if (!result.ok) {
      console.log(`  CLI failed (${result.status}): ${(result.stderr || result.stdout).trim()}`);
    } else {
      for (const line of result.stdout.trim().split("\n")) {
        if (line) console.log(`  ${line}`);
      }
    }
  }

  console.log("");
  console.log("Remote · wrangler whoami");
  if (!process.env.CLOUDFLARE_API_TOKEN?.trim()) {
    console.log("  Skipped — set CLOUDFLARE_API_TOKEN in .env.local");
  } else if (!fs.existsSync(path.join(API_CWD, "wrangler.toml"))) {
    console.log("  Skipped — apps/api/wrangler.toml is missing");
  } else {
    const result = run("pnpm", ["exec", "wrangler", "whoami"], {
      cwd: API_CWD,
      env: process.env,
    });
    if (!result.ok) {
      console.log(`  CLI failed (${result.status}): ${(result.stderr || result.stdout).trim()}`);
    } else {
      for (const line of result.stdout.trim().split("\n")) {
        if (line) console.log(`  ${line}`);
      }
    }
  }
}
