import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRiskRules } from "../src/risk/profile.js";

async function tmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "mergerisk-profile-"));
}

describe("loadRiskRules", () => {
  it("returns defaultRiskRules when path is empty", async () => {
    const rules = await loadRiskRules("");
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0]).toHaveProperty("category");
    expect(rules[0]).toHaveProperty("severity");
    expect(rules[0]).toHaveProperty("patterns");
  });

  it("loads object-style YAML with expected category, severity, and patterns", async () => {
    const dir = await tmpDir();
    const filePath = join(dir, "profile.yml");
    await writeFile(
      filePath,
      [
        "custom_auth:",
        '  severity: high',
        '  patterns:',
        '    - "**/auth/**"',
        "",
      ].join("\n"),
    );

    const rules = await loadRiskRules(filePath);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual({
      category: "custom_auth",
      severity: "high",
      patterns: ["**/auth/**"],
    });

    await rm(dir, { recursive: true, force: true });
  });

  it("loads array-style YAML with expected category, severity, and patterns", async () => {
    const dir = await tmpDir();
    const filePath = join(dir, "profile.yml");
    await writeFile(
      filePath,
      [
        "- category: custom_auth",
        "  severity: high",
        "  patterns:",
        '    - "**/auth/**"',
        "",
      ].join("\n"),
    );

    const rules = await loadRiskRules(filePath);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual({
      category: "custom_auth",
      severity: "high",
      patterns: ["**/auth/**"],
    });

    await rm(dir, { recursive: true, force: true });
  });

  it("throws clear error for invalid severity", async () => {
    const dir = await tmpDir();
    const filePath = join(dir, "profile.yml");
    await writeFile(
      filePath,
      [
        "custom_rule:",
        "  severity: extreme",
        "  patterns:",
        '    - "**/**"',
        "",
      ].join("\n"),
    );

    await expect(loadRiskRules(filePath)).rejects.toThrow(
      /Invalid risk profile/,
    );

    await rm(dir, { recursive: true, force: true });
  });

  it("throws clear error for empty patterns", async () => {
    const dir = await tmpDir();
    const filePath = join(dir, "profile.yml");
    await writeFile(
      filePath,
      [
        "custom_rule:",
        "  severity: high",
        "  patterns: []",
        "",
      ].join("\n"),
    );

    await expect(loadRiskRules(filePath)).rejects.toThrow(
      /Invalid risk profile/,
    );

    await rm(dir, { recursive: true, force: true });
  });

  it("rejects with clear error for missing file that includes the path", async () => {
    await expect(
      loadRiskRules("/nonexistent/mergerisk-custom-profile.yml"),
    ).rejects.toThrow(/nonexistent/);
  });

  it("rejects malformed YAML syntax with error that does NOT include raw file content", async () => {
    const dir = await tmpDir();
    const filePath = join(dir, "profile.yml");
    await writeFile(filePath, "foo: [unterminated");

    await expect(loadRiskRules(filePath)).rejects.toThrow(
      /Invalid risk profile.*could not parse YAML/,
    );
    await expect(loadRiskRules(filePath)).rejects.not.toThrow(
      /unterminated/,
    );

    await rm(dir, { recursive: true, force: true });
  });

  it("rejects object-shape entry with null value with clear Invalid risk profile error, not TypeError", async () => {
    const dir = await tmpDir();
    const filePath = join(dir, "profile.yml");
    await writeFile(
      filePath,
      [
        "custom_rule:",
        "",
      ].join("\n"),
    );

    await expect(loadRiskRules(filePath)).rejects.toThrow(
      /Invalid risk profile/,
    );
    await expect(loadRiskRules(filePath)).rejects.not.toThrow(
      /TypeError/,
    );

    await rm(dir, { recursive: true, force: true });
  });
});
