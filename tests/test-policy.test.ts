import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTestPolicy } from "../src/risk/test-policy.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mergerisk-test-policy-"));
}

describe("loadTestPolicy", () => {
  it("returns the default policy for an empty path", async () => {
    const policy = await loadTestPolicy("");

    expect(policy.requireTestsFor).toEqual({ addedSourceFiles: true, modifiedSourceFiles: false });
    expect(policy.testPatterns).toContain("tests/**");
  });

  it("loads a repository-specific policy", async () => {
    const directory = await tempDir();
    const filePath = join(directory, "test-policy.yml");
    await writeFile(filePath, [
      "test-patterns:",
      '  - "**/*.spec.ts"',
      "source-patterns:",
      '  - "app/**/*.ts"',
      "exempt-patterns:",
      '  - "docs/**"',
      "require-tests-for:",
      "  added-source-files: true",
      "  modified-source-files: true",
      "",
    ].join("\n"));

    await expect(loadTestPolicy(filePath)).resolves.toEqual({
      testPatterns: ["**/*.spec.ts"],
      sourcePatterns: ["app/**/*.ts"],
      exemptPatterns: ["docs/**"],
      requireTestsFor: { addedSourceFiles: true, modifiedSourceFiles: true },
    });
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects policies that omit required boolean controls", async () => {
    const directory = await tempDir();
    const filePath = join(directory, "test-policy.yml");
    await writeFile(filePath, [
      "test-patterns: [\"**/*.test.ts\"]",
      "source-patterns: [\"src/**/*.ts\"]",
      "exempt-patterns: []",
      "require-tests-for:",
      "  added-source-files: true",
      "",
    ].join("\n"));

    await expect(loadTestPolicy(filePath)).rejects.toThrow("require-tests-for values must be booleans");
    await rm(directory, { recursive: true, force: true });
  });
});
