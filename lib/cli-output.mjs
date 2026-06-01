/**
 * Unified terminal output for giggabit-env-sync.
 * Uses boxen + cli-table3 when installed at the consumer repo root; falls back to ANSI-only.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @type {typeof import("boxen") | null} */
let boxen = null;
/** @type {typeof import("cli-table3") | null} */
let Table = null;

try {
  boxen = require("boxen");
} catch {
  /* optional — install with: pnpm add -D boxen cli-table3 -w */
}

try {
  Table = require("cli-table3");
} catch {
  /* optional */
}

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

export const SYNC_LABEL = `${c.dim}[${c.cyan}giggabit-env-sync${c.dim}]${c.reset}`;

const useColor =
  !process.env.NO_COLOR &&
  process.env.FORCE_COLOR !== "0" &&
  Boolean(process.stdout.isTTY);

/**
 * @param {string} title
 * @param {string} [body]
 * @param {{ borderColor?: string }} [opts]
 */
function printPlainBox(title, body, opts = {}) {
  const border = opts.borderColor === "red" ? c.red : c.cyan;
  const line = "─".repeat(Math.max(title.length, (body ?? "").length) + 4);
  console.log(`${border}┌${line}┐${c.reset}`);
  console.log(`${border}│ ${c.bold}${title}${c.reset}${border}${"".padEnd(Math.max(0, line.length - title.length - 1))}│${c.reset}`);
  if (body) {
    for (const row of body.split("\n")) {
      console.log(`${border}│ ${row}${c.reset}`);
    }
  }
  console.log(`${border}└${line}┘${c.reset}`);
}

/**
 * @returns {boolean}
 */
export function isVerbose() {
  const raw = process.env.ENV_SYNC_VERBOSE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Structured CLI failure (formatted by {@link printCliFailure}).
 */
export class CliError extends Error {
  /**
   * @param {{
   *   code?: string;
   *   title: string;
   *   summary?: string;
   *   facts?: Array<{ label: string; value: string }>;
   *   steps?: string[];
   *   hint?: string;
   * }} opts
   */
  constructor(opts) {
    super(opts.summary ?? opts.title);
    this.name = "CliError";
    this.code = opts.code ?? "error";
    this.title = opts.title;
    /** @type {Array<{ label: string; value: string }>} */
    this.facts = opts.facts ?? [];
    /** @type {string[]} */
    this.steps = opts.steps ?? [];
    this.hint = opts.hint;
  }
}

/**
 * @param {string} message
 */
export function syncInfo(message) {
  console.log(`${SYNC_LABEL} ${message}`);
}

/**
 * @param {string} message — auth / bootstrap detail (hidden unless ENV_SYNC_VERBOSE=1)
 */
export function syncDetail(message) {
  if (!isVerbose()) return;
  console.log(`${SYNC_LABEL} ${c.dim}${message}${c.reset}`);
}

/**
 * @param {string} message
 */
export function syncWarn(message) {
  console.warn(`${SYNC_LABEL} ${c.yellow}${message}${c.reset}`);
}

/**
 * @param {string} message
 */
export function syncError(message) {
  console.error(`${SYNC_LABEL} ${c.red}${message}${c.reset}`);
}

/**
 * @param {string} message
 */
export function syncSuccess(message) {
  console.log(`${SYNC_LABEL} ${c.green}${message}${c.reset}`);
}

/**
 * @param {string} message
 */
export function syncDim(message) {
  console.log(`${SYNC_LABEL} ${c.dim}${message}${c.reset}`);
}

/**
 * One-line command context (always shown before work starts).
 *
 * @param {{ command: string; mode?: string; project?: string; extras?: string[] }} ctx
 */
export function printCommandHeader(ctx) {
  const parts = [
    c.bold + "giggabit-env-sync" + c.reset,
    ctx.command,
    ctx.mode,
    ctx.project,
    ...(ctx.extras ?? []),
  ].filter(Boolean);
  console.log("");
  console.log(parts.join(c.dim + " · " + c.reset));
  console.log("");
}

/**
 * @param {string} title
 * @param {string} [subtitle]
 * @param {{ borderColor?: string }} [opts]
 */
export function printBanner(title, subtitle, opts = {}) {
  const body = subtitle ? `${title}\n${subtitle}` : title;
  if (boxen) {
    console.log(
      boxen(body, {
        title: "giggabit-env-sync",
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        borderColor: useColor ? (opts.borderColor ?? "cyan") : undefined,
        dimBorder: !useColor,
      })
    );
  } else {
    printPlainBox("giggabit-env-sync", body, opts);
  }
  console.log("");
}

/**
 * @param {string} title
 */
export function printSection(title) {
  if (boxen) {
    console.log(
      boxen(title, {
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        margin: { top: 1, bottom: 0, left: 0, right: 0 },
        borderStyle: "round",
        borderColor: useColor ? "yellow" : undefined,
        dimBorder: !useColor,
      })
    );
  } else {
    console.log("");
    console.log(`${c.yellow}${c.bold}${title}${c.reset}`);
    console.log(`${c.dim}${"─".repeat(Math.min(title.length + 4, 60))}${c.reset}`);
  }
  console.log("");
}

/**
 * @param {readonly string[]} headers
 * @param {readonly (readonly string[])[]} rows
 * @param {{ compact?: boolean }} [opts]
 */
export function printTable(headers, rows, opts = {}) {
  if (Table) {
    /** @type {import('cli-table3').TableConstructorOptions} */
    const tableOpts = {
      head: [...headers],
      style: {
        head: useColor ? ["cyan", "bold"] : [],
        border: useColor ? ["dim"] : [],
        "padding-left": 0,
        "padding-right": 1,
      },
      chars: opts.compact
        ? {
            top: "",
            "top-mid": "",
            "top-left": "",
            "top-right": "",
            bottom: "",
            "bottom-mid": "",
            "bottom-left": "",
            "bottom-right": "",
            left: "  ",
            "left-mid": "",
            mid: "",
            "mid-mid": "",
            right: "",
            "right-mid": "",
            middle: "  ",
          }
        : undefined,
    };
    const table = new Table(tableOpts);
    for (const row of rows) {
      table.push([...row]);
    }
    for (const line of table.toString().split("\n")) {
      console.log(line);
    }
    return;
  }

  console.log(headers.join("  "));
  for (const row of rows) {
    console.log(row.join("  "));
  }
}

/**
 * @param {Array<{ label: string; value: string }>} facts
 */
export function printFactsTable(facts) {
  printTable(
    ["Field", "Value"],
    facts.map((f) => [f.label, f.value])
  );
}

/**
 * @param {string[]} steps
 */
export function printSteps(steps) {
  if (steps.length === 0) return;
  console.log("");
  console.log(`${c.bold}What to do${c.reset}`);
  steps.forEach((step, i) => {
    console.log(`  ${i + 1}. ${step}`);
  });
  console.log("");
}

/**
 * @param {unknown} err
 */
export function printCliFailure(err) {
  console.log("");

  if (err instanceof CliError) {
    const body =
      err.message && err.message !== err.title ? err.message : "";
    if (boxen) {
      console.log(
        boxen(body || "See details below.", {
          title: err.title,
          padding: 1,
          borderColor: useColor ? "red" : undefined,
          dimBorder: !useColor,
        })
      );
    } else {
      printPlainBox(err.title, body || "See details below.", { borderColor: "red" });
    }
    if (err.facts.length > 0) {
      console.log("");
      printFactsTable(err.facts);
    }
    printSteps(err.steps);
    if (err.hint) {
      syncDim(err.hint);
    }
    return;
  }

  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  const cleaned = raw
    .replace(/^\[giggabit-env-sync\]\s*/gm, "")
    .replace(/^\[env:sync\]\s*/gm, "")
    .trim();

  if (boxen) {
    console.log(
      boxen(cleaned, {
        title: "Failed",
        padding: 1,
        borderColor: useColor ? "red" : undefined,
        dimBorder: !useColor,
      })
    );
  } else {
    printPlainBox("Failed", cleaned, { borderColor: "red" });
  }
  console.log("");
}

/**
 * @param {string} indent
 * @param {string} key
 * @param {string} value
 */
export function printField(indent, key, value) {
  const pad = 14;
  console.log(`${indent}${key.padEnd(pad)}${value}`);
}

/**
 * @param {string} message
 */
export function printTip(message) {
  syncDim(message);
}

/**
 * @param {string} message
 */
export function printNote(message) {
  console.log(`  ${message}`);
}

/**
 * @param {string} message
 */
export function printWarning(message) {
  console.log("");
  syncWarn(message);
}
