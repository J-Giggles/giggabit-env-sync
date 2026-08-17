import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatEnvFromExampleTemplate } from "../format-env-from-example.mjs";

describe("formatEnvFromExampleTemplate (reformat layout)", () => {
  it("keeps template order and appends unknown keys without leaking into assertions on values", () => {
    const template = [
      "# Core (demo)",
      "APP_URL=",
      "OPENAI_API_KEY=",
      "",
      "# Extra section",
      "RESEND_API_KEY=",
      "",
    ].join("\n");

    const values = new Map([
      ["LEGACY_UNUSED", "should-not-appear-in-test-output-assertions"],
      ["OPENAI_API_KEY", "sk-test"],
      ["APP_URL", "https://example.test"],
      ["RESEND_API_KEY", "re_test"],
    ]);

    const formatted = formatEnvFromExampleTemplate(template, values);
    const lines = formatted.split("\n");

    const appIdx = lines.findIndex((l) => l.startsWith("APP_URL="));
    const openaiIdx = lines.findIndex((l) => l.startsWith("OPENAI_API_KEY="));
    const resendIdx = lines.findIndex((l) => l.startsWith("RESEND_API_KEY="));
    const legacyIdx = lines.findIndex((l) => l.startsWith("LEGACY_UNUSED="));
    const extraHeaderIdx = lines.findIndex((l) =>
      l.includes("Additional variables"),
    );

    assert.ok(appIdx >= 0);
    assert.ok(openaiIdx > appIdx);
    assert.ok(resendIdx > openaiIdx);
    assert.ok(extraHeaderIdx > resendIdx);
    assert.ok(legacyIdx > extraHeaderIdx);

    // Assert structure only — never log or assert secret substrings in failure messages.
    assert.equal(lines[appIdx].includes("="), true);
    assert.equal(lines[legacyIdx].startsWith("LEGACY_UNUSED="), true);
  });
});
