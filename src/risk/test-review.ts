import { minimatch } from "minimatch";
import type { PullRequestFile, TestPolicy, TestReview } from "../types.js";
import { defaultTestPolicy } from "./defaults.js";

function matches(filename: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(filename, pattern, { dot: true, matchBase: true }));
}

function isSourceFile(file: PullRequestFile, policy: TestPolicy): boolean {
  return matches(file.filename, policy.sourcePatterns)
    && !matches(file.filename, policy.testPatterns)
    && !matches(file.filename, policy.exemptPatterns);
}

export function reviewTestsWithPolicy(
  files: PullRequestFile[],
  policy: TestPolicy = defaultTestPolicy
): TestReview {
  const testEvidenceFound = files.some((file) => matches(file.filename, policy.testPatterns));
  const affectedFiles = files.filter((file) => {
    if (!isSourceFile(file, policy)) return false;
    if (file.status === "added") return policy.requireTestsFor.addedSourceFiles;
    return policy.requireTestsFor.modifiedSourceFiles && (file.status === "modified" || file.status === "renamed");
  }).map((file) => file.filename);

  if (affectedFiles.length > 0) {
    const verb = policy.requireTestsFor.modifiedSourceFiles ? "source files changed" : "new source files added";
    return {
      mode: "policy",
      decision: "required",
      confidence: "high",
      reason: `The configured policy requires test changes when ${verb}.`,
      affectedFiles,
      testEvidenceFound
    };
  }

  return {
    mode: "policy",
    decision: "not_required",
    confidence: "high",
    reason: "The configured policy does not require test changes for these files.",
    affectedFiles: [],
    testEvidenceFound
  };
}
