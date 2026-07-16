import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { TestPolicy } from "../types.js";
import { defaultTestPolicy } from "./defaults.js";

function copyDefaultPolicy(): TestPolicy {
  return {
    testPatterns: [...defaultTestPolicy.testPatterns],
    sourcePatterns: [...defaultTestPolicy.sourcePatterns],
    exemptPatterns: [...defaultTestPolicy.exemptPatterns],
    requireTestsFor: { ...defaultTestPolicy.requireTestsFor }
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

function parsePolicy(value: unknown): TestPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid test policy: YAML must be an object");
  }

  const policy = value as Record<string, unknown>;
  const required = policy["require-tests-for"];
  if (!required || typeof required !== "object" || Array.isArray(required)) {
    throw new Error("Invalid test policy: require-tests-for must be an object");
  }
  const requirements = required as Record<string, unknown>;

  if (!isStringArray(policy["test-patterns"])) {
    throw new Error("Invalid test policy: test-patterns must be a non-empty list of strings");
  }
  if (!isStringArray(policy["source-patterns"])) {
    throw new Error("Invalid test policy: source-patterns must be a non-empty list of strings");
  }
  if (!Array.isArray(policy["exempt-patterns"]) || !policy["exempt-patterns"].every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error("Invalid test policy: exempt-patterns must be a list of strings");
  }
  if (typeof requirements["added-source-files"] !== "boolean" || typeof requirements["modified-source-files"] !== "boolean") {
    throw new Error("Invalid test policy: require-tests-for values must be booleans");
  }

  return {
    testPatterns: policy["test-patterns"],
    sourcePatterns: policy["source-patterns"],
    exemptPatterns: policy["exempt-patterns"] as string[],
    requireTestsFor: {
      addedSourceFiles: requirements["added-source-files"],
      modifiedSourceFiles: requirements["modified-source-files"]
    }
  };
}

export async function loadTestPolicy(policyPath: string): Promise<TestPolicy> {
  if (!policyPath.trim()) return copyDefaultPolicy();

  let raw: string;
  try {
    raw = await readFile(policyPath, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to read test policy at "${policyPath}": ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    throw new Error("Invalid test policy: could not parse YAML");
  }
  return parsePolicy(parsed);
}
