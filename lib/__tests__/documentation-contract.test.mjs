import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const localEnvPathsSource = readFileSync(
  new URL("../local-env-paths.mjs", import.meta.url),
  "utf8",
);
const securityGuide = readFileSync(
  new URL("../../SECURITY.md", import.meta.url),
  "utf8",
);
const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const securityIgnoreGuidance = securityGuide.match(
  /Parent app `.gitignore` should explicitly ignore[^\n]+/,
)?.[0];
const readmeIgnoreGuidance = readme.match(
  /## `.gitignore`[\s\S]*?(?=\n---)/,
)?.[0];
const readmeIgnoreBlock = readmeIgnoreGuidance?.match(
  /```gitignore\n([\s\S]*?)```/,
)?.[1];
const securityIgnoreEntries = [
  ...(securityIgnoreGuidance?.matchAll(/`([^`]+)`/g) ?? []),
].map((match) => match[1]);
const readmeIgnoreEntries =
  readmeIgnoreBlock
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")) ?? [];

describe("published documentation contracts", () => {
  it("assigns odd-pair artifact writes to callers, not the path resolver", () => {
    expect(localEnvPathsSource).toContain(
      "`resolveOddPairPullPath` only resolves the root",
    );
    expect(localEnvPathsSource).toContain(
      "`.env.sync.<storageKey>` artifact path; callers write it",
    );
    expect(localEnvPathsSource).not.toContain("`resolveOddPairPullPath` writes");
  });

  it.each([
    {
      name: "security guide",
      explicitIgnoreSet: securityIgnoreEntries,
      safeExceptions: securityIgnoreGuidance,
    },
    {
      name: "README ignore block",
      explicitIgnoreSet: readmeIgnoreEntries,
      safeExceptions: readmeIgnoreGuidance,
    },
  ])("lists every secret path explicitly in the $name", (guide) => {
    const secretPathPatterns = [
      ".env",
      ".env.local",
      ".env.*.local",
      ".env.preview",
      ".env.sync.*",
      ".env/sync/",
      ".env.sync-cache/",
    ];

    for (const pattern of secretPathPatterns) {
      expect(guide.explicitIgnoreSet).toContain(pattern);
    }
    expect(guide.safeExceptions).toContain("`.env.example`");
    expect(guide.safeExceptions).toContain("`.env.template`");
    expect(guide.safeExceptions).not.toContain("should ignore `.env*`");
  });

  it("documents target-specific format templates before the shared fallback", () => {
    const formatSection = readme
      .match(/### Reformat local env files[\s\S]*?(?=### Deploy command)/)?.[0]
      .replace(/\s+/g, " ");

    expect(formatSection).toContain("target-specific template takes priority");
    expect(formatSection).toContain("`.env.example` is the fallback");
  });

  it("documents removal of the transient Vercel OIDC token", () => {
    const formatSection = readme
      .match(/### Reformat local env files[\s\S]*?(?=### Deploy command)/)?.[0]
      .replace(/\s+/g, " ");

    expect(formatSection).toContain(
      "removes the transient `VERCEL_OIDC_TOKEN`",
    );
  });
});
