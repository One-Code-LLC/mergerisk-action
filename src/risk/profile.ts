import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { RiskRule } from "../types.js";
import { defaultRiskRules } from "./defaults.js";

const validSeverities = new Set(["critical", "high", "medium", "low", "info"]);

function validateRules(rules: RiskRule[]): void {
  for (const rule of rules) {
    if (typeof rule.category !== "string" || rule.category.trim().length === 0) {
      throw new Error("Invalid risk profile: category must be a non-empty string");
    }
    if (!validSeverities.has(rule.severity)) {
      throw new Error(
        `Invalid risk profile: severity for "${rule.category}" must be one of critical, high, medium, low, or info`,
      );
    }
    if (
      !Array.isArray(rule.patterns) ||
      rule.patterns.length === 0 ||
      !rule.patterns.every((p) => typeof p === "string" && p.length > 0)
    ) {
      throw new Error(
        `Invalid risk profile: patterns for "${rule.category}" must be a non-empty array of strings`,
      );
    }
  }
}

function parseObjectShape(
  data: Record<string, unknown>,
): RiskRule[] {
  return Object.entries(data).map(([category, rule]) => {
    if (rule === null || typeof rule !== "object") {
      throw new Error(
        `Invalid risk profile: rule for "${category}" must define severity and patterns`,
      );
    }
    const r = rule as { severity: string; patterns: string[] };
    return {
      category,
      severity: r.severity as RiskRule["severity"],
      patterns: r.patterns,
    };
  });
}

function parseArrayShape(
  data: Array<{ category: string; severity: string; patterns: string[] }>,
): RiskRule[] {
  return data.map((item) => ({
    category: item.category,
    severity: item.severity as RiskRule["severity"],
    patterns: item.patterns,
  }));
}

export async function loadRiskRules(profilePath: string): Promise<RiskRule[]> {
  if (!profilePath.trim()) {
    return [...defaultRiskRules];
  }

  let raw: string;
  try {
    raw = await readFile(profilePath, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to read risk profile at "${profilePath}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    throw new Error(
      `Invalid risk profile at "${profilePath}": could not parse YAML`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid risk profile: YAML must be an object or array");
  }

  let rules: RiskRule[];

  if (Array.isArray(parsed)) {
    rules = parseArrayShape(parsed);
  } else {
    rules = parseObjectShape(
      parsed as Record<string, { severity: string; patterns: string[] }>,
    );
  }

  if (rules.length === 0) {
    throw new Error("Invalid risk profile: YAML must contain at least one rule");
  }

  validateRules(rules);
  return rules;
}
