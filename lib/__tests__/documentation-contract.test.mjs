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

  it("keeps safe env templates committable while listing generated ignores", () => {
    expect(securityGuide).toContain(
      "Safe templates such as `.env.example` and `.env.template` remain committable.",
    );
    expect(securityGuide).not.toContain("should ignore `.env*`");
  });
});
