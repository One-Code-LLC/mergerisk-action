# MergeRisk Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a distributable GitHub Action that posts a concise pull request risk report and can optionally fail CI when risk exceeds a configured threshold.

**Architecture:** The Action is a Node 24 TypeScript project. GitHub-specific code fetches PR files and manages the sticky comment; risk code classifies changed files and computes deterministic severity; optional AI code synthesizes the final summary without overriding deterministic risk.

**Tech Stack:** Node 24, TypeScript, `@actions/core`, `@actions/github`, `minimatch`, `yaml`, Vitest, `ncc`.

---

## File Structure

Create this repository structure:

```text
.
├── .github/workflows/ci.yml
├── .gitignore
├── LICENSE
├── README.md
├── action.yml
├── examples/basic.yml
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── main.ts
│   ├── config.ts
│   ├── types.ts
│   ├── ai/
│   │   └── synthesize.ts
│   ├── github/
│   │   ├── comment.ts
│   │   └── pull-request.ts
│   ├── report/
│   │   └── markdown.ts
│   └── risk/
│       ├── classify.ts
│       ├── defaults.ts
│       └── score.ts
└── tests/
    ├── config.test.ts
    ├── markdown.test.ts
    ├── risk-classify.test.ts
    ├── risk-score.test.ts
    └── comment.test.ts
```

Responsibilities:

- `src/main.ts`: orchestration only.
- `src/config.ts`: parse and validate Action inputs.
- `src/types.ts`: shared TypeScript types.
- `src/github/pull-request.ts`: fetch changed PR files.
- `src/github/comment.ts`: create or update the sticky report comment.
- `src/risk/defaults.ts`: built-in risk profile.
- `src/risk/classify.ts`: map changed files to risk signals.
- `src/risk/score.ts`: compute risk level and merge guidance.
- `src/ai/synthesize.ts`: optional provider hook for report synthesis.
- `src/report/markdown.ts`: render the final PR comment.

## Task 1: Project Skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mergerisk-action",
  "version": "0.1.0",
  "private": true,
  "description": "GitHub Action that posts pull request merge-risk reports.",
  "type": "module",
  "engines": {
    "node": ">=24 <25"
  },
  "scripts": {
    "build": "tsc --noEmit && ncc build src/main.ts -o dist --source-map",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@actions/core": "^1.11.1",
    "@actions/github": "^6.0.1",
    "minimatch": "^10.0.1",
    "yaml": "^2.6.1"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@vercel/ncc": "^0.38.3",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist-types",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"]
  }
});
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
dist/
dist-types/
coverage/
.env
.DS_Store
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and `npm` exits successfully.

- [ ] **Step 6: Run the empty test suite**

Run: `npm test`

Expected: Vitest reports no failed tests. If Vitest exits because no tests exist, continue after Task 2 adds the first tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: scaffold mergerisk action project"
```

## Task 2: Core Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create `src/types.ts`**

```ts
export type RiskLevel = "low" | "medium" | "high" | "critical";

export type Provider = "none" | "openai" | "anthropic";

export type CommentMode = "update" | "new";

export interface ActionConfig {
  githubToken: string;
  provider: Provider;
  model: string;
  apiKey: string;
  failOnRisk: RiskLevel | "none";
  maxPatchLines: number;
  commentMode: CommentMode;
  riskProfilePath: string;
}

export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string;
}

export interface RiskRule {
  category: string;
  severity: RiskLevel | "info";
  patterns: string[];
}

export interface RiskSignal {
  category: string;
  severity: RiskLevel | "info";
  points: number;
  evidence: string[];
  message: string;
}

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  guidance: string;
  signals: RiskSignal[];
  reviewerFocus: string[];
  testEvidenceFound: boolean;
  filesChanged: number;
  totalAdditions: number;
  totalDeletions: number;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: define mergerisk domain types"
```

## Task 3: Config Parsing

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests in `tests/config.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseConfigFromInputs } from "../src/config";

describe("parseConfigFromInputs", () => {
  it("uses safe defaults", () => {
    const config = parseConfigFromInputs({
      "github-token": "ghs_test",
      provider: "",
      model: "",
      "api-key": "",
      "fail-on-risk": "",
      "max-patch-lines": "",
      "comment-mode": "",
      "risk-profile-path": ""
    });

    expect(config.provider).toBe("none");
    expect(config.model).toBe("");
    expect(config.failOnRisk).toBe("none");
    expect(config.maxPatchLines).toBe(1200);
    expect(config.commentMode).toBe("update");
  });

  it("rejects unsupported providers", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        provider: "other",
        model: "",
        "api-key": "",
        "fail-on-risk": "",
        "max-patch-lines": "",
        "comment-mode": "",
        "risk-profile-path": ""
      })
    ).toThrow("Unsupported provider: other");
  });

  it("requires an api key when a provider is selected", () => {
    expect(() =>
      parseConfigFromInputs({
        "github-token": "ghs_test",
        provider: "openai",
        model: "",
        "api-key": "",
        "fail-on-risk": "",
        "max-patch-lines": "",
        "comment-mode": "",
        "risk-profile-path": ""
      })
    ).toThrow("api-key is required when provider is openai");
  });
});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `npm test -- tests/config.test.ts`

Expected: FAIL because `src/config.ts` does not exist.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import type { ActionConfig, CommentMode, Provider, RiskLevel } from "./types";

type RawInputs = Record<string, string>;

const providers: Provider[] = ["none", "openai", "anthropic"];
const riskLevels: Array<RiskLevel | "none"> = ["none", "low", "medium", "high", "critical"];
const commentModes: CommentMode[] = ["update", "new"];

function pickProvider(value: string): Provider {
  const normalized = value.trim().toLowerCase() || "none";
  if (!providers.includes(normalized as Provider)) {
    throw new Error(`Unsupported provider: ${value}`);
  }
  return normalized as Provider;
}

function pickFailOnRisk(value: string): RiskLevel | "none" {
  const normalized = value.trim().toLowerCase() || "none";
  if (!riskLevels.includes(normalized as RiskLevel | "none")) {
    throw new Error(`Unsupported fail-on-risk value: ${value}`);
  }
  return normalized as RiskLevel | "none";
}

function pickCommentMode(value: string): CommentMode {
  const normalized = value.trim().toLowerCase() || "update";
  if (!commentModes.includes(normalized as CommentMode)) {
    throw new Error(`Unsupported comment-mode value: ${value}`);
  }
  return normalized as CommentMode;
}

function pickMaxPatchLines(value: string): number {
  if (!value.trim()) {
    return 1200;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 100 || parsed > 10000) {
    throw new Error("max-patch-lines must be an integer from 100 to 10000");
  }
  return parsed;
}

export function parseConfigFromInputs(inputs: RawInputs): ActionConfig {
  const githubToken = inputs["github-token"]?.trim() ?? "";
  if (!githubToken) {
    throw new Error("github-token is required");
  }

  const provider = pickProvider(inputs.provider ?? "");
  const apiKey = inputs["api-key"]?.trim() ?? "";
  if (provider !== "none" && !apiKey) {
    throw new Error(`api-key is required when provider is ${provider}`);
  }

  return {
    githubToken,
    provider,
    model: inputs.model?.trim() ?? "",
    apiKey,
    failOnRisk: pickFailOnRisk(inputs["fail-on-risk"] ?? ""),
    maxPatchLines: pickMaxPatchLines(inputs["max-patch-lines"] ?? ""),
    commentMode: pickCommentMode(inputs["comment-mode"] ?? ""),
    riskProfilePath: inputs["risk-profile-path"]?.trim() ?? ""
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/config.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: parse action configuration"
```

## Task 4: Default Risk Profile And File Classification

**Files:**
- Create: `src/risk/defaults.ts`
- Create: `src/risk/classify.ts`
- Create: `tests/risk-classify.test.ts`

- [ ] **Step 1: Write failing tests in `tests/risk-classify.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { classifyFiles } from "../src/risk/classify";
import type { PullRequestFile } from "../src/types";

function file(filename: string): PullRequestFile {
  return {
    filename,
    status: "modified",
    additions: 10,
    deletions: 2,
    changes: 12,
    patch: "@@ -1 +1 @@"
  };
}

describe("classifyFiles", () => {
  it("detects auth, database, ci, dependency, and test signals", () => {
    const result = classifyFiles([
      file("src/auth/session.ts"),
      file("migrations/20260629_add_roles.sql"),
      file(".github/workflows/deploy.yml"),
      file("package-lock.json"),
      file("tests/session.test.ts")
    ]);

    expect(result.map((signal) => signal.category)).toEqual(
      expect.arrayContaining(["auth", "database", "ci_cd", "dependencies", "tests"])
    );
  });

  it("keeps evidence filenames on signals", () => {
    const result = classifyFiles([file("src/billing/stripe.ts")]);
    expect(result[0]).toMatchObject({
      category: "payments",
      severity: "high",
      evidence: ["src/billing/stripe.ts"]
    });
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/risk-classify.test.ts`

Expected: FAIL because risk files do not exist.

- [ ] **Step 3: Implement `src/risk/defaults.ts`**

```ts
import type { RiskRule } from "../types";

export const defaultRiskRules: RiskRule[] = [
  {
    category: "auth",
    severity: "high",
    patterns: ["**/auth/**", "**/session/**", "**/middleware/**", "**/*auth*"]
  },
  {
    category: "payments",
    severity: "high",
    patterns: ["**/billing/**", "**/payments/**", "**/stripe/**"]
  },
  {
    category: "database",
    severity: "high",
    patterns: ["**/migrations/**", "**/schema.sql", "**/prisma/schema.prisma"]
  },
  {
    category: "api",
    severity: "medium",
    patterns: ["**/api/**", "**/routes/**", "**/controllers/**"]
  },
  {
    category: "ci_cd",
    severity: "medium",
    patterns: [".github/workflows/**", "Dockerfile", "docker-compose*.yml"]
  },
  {
    category: "dependencies",
    severity: "medium",
    patterns: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "poetry.lock", "Gemfile.lock"]
  },
  {
    category: "config",
    severity: "medium",
    patterns: ["**/.env*", "**/config/**", "**/*.config.*"]
  },
  {
    category: "tests",
    severity: "info",
    patterns: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "tests/**"]
  }
];
```

- [ ] **Step 4: Implement `src/risk/classify.ts`**

```ts
import { minimatch } from "minimatch";
import type { PullRequestFile, RiskRule, RiskSignal } from "../types";
import { defaultRiskRules } from "./defaults";

const pointsBySeverity = {
  critical: 5,
  high: 4,
  medium: 2,
  low: 1,
  info: 0
} as const;

export function classifyFiles(
  files: PullRequestFile[],
  rules: RiskRule[] = defaultRiskRules
): RiskSignal[] {
  const signals: RiskSignal[] = [];

  for (const rule of rules) {
    const evidence = files
      .filter((file) =>
        rule.patterns.some((pattern) =>
          minimatch(file.filename, pattern, { dot: true, matchBase: true })
        )
      )
      .map((file) => file.filename);

    if (evidence.length > 0) {
      signals.push({
        category: rule.category,
        severity: rule.severity,
        points: pointsBySeverity[rule.severity],
        evidence,
        message: `${rule.category} files changed`
      });
    }
  }

  return signals;
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/risk-classify.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/risk/defaults.ts src/risk/classify.ts tests/risk-classify.test.ts
git commit -m "feat: classify pull request risk signals"
```

## Task 5: Risk Scoring

**Files:**
- Create: `src/risk/score.ts`
- Create: `tests/risk-score.test.ts`

- [ ] **Step 1: Write failing tests in `tests/risk-score.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { assessRisk } from "../src/risk/score";
import type { PullRequestFile } from "../src/types";

function file(filename: string, additions = 10, deletions = 2): PullRequestFile {
  return {
    filename,
    status: "modified",
    additions,
    deletions,
    changes: additions + deletions,
    patch: "@@ -1 +1 @@"
  };
}

describe("assessRisk", () => {
  it("marks a normal tested change as low risk", () => {
    const assessment = assessRisk([
      file("src/ui/button.tsx"),
      file("src/ui/button.test.tsx")
    ]);

    expect(assessment.level).toBe("low");
    expect(assessment.testEvidenceFound).toBe(true);
  });

  it("marks auth plus migration without tests as high risk", () => {
    const assessment = assessRisk([
      file("src/auth/session.ts"),
      file("migrations/20260629_add_roles.sql")
    ]);

    expect(assessment.level).toBe("high");
    expect(assessment.signals.map((signal) => signal.category)).toContain("missing_tests");
  });

  it("marks broad changes as critical when score reaches threshold", () => {
    const files = Array.from({ length: 25 }, (_, index) =>
      file(`src/auth/file-${index}.ts`, 30, 30)
    );

    const assessment = assessRisk(files);
    expect(assessment.level).toBe("critical");
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/risk-score.test.ts`

Expected: FAIL because `assessRisk` does not exist.

- [ ] **Step 3: Implement `src/risk/score.ts`**

```ts
import type { PullRequestFile, RiskAssessment, RiskLevel, RiskSignal } from "../types";
import { classifyFiles } from "./classify";

const riskRank: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

function levelFromScore(score: number): RiskLevel {
  if (score >= 12) return "critical";
  if (score >= 7) return "high";
  if (score >= 3) return "medium";
  return "low";
}

function guidanceFor(level: RiskLevel): string {
  if (level === "critical") return "Block merge until a senior reviewer verifies the risk areas.";
  if (level === "high") return "Senior review recommended before merge.";
  if (level === "medium") return "Review the highlighted areas before merge.";
  return "No unusual merge risk detected.";
}

function broadChangeSignals(files: PullRequestFile[]): RiskSignal[] {
  const totalAdditions = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const signals: RiskSignal[] = [];

  if (files.length > 20) {
    signals.push({
      category: "broad_change",
      severity: "medium",
      points: 3,
      evidence: [`${files.length} files changed`],
      message: "Large number of files changed"
    });
  }

  if (totalAdditions + totalDeletions > 500) {
    signals.push({
      category: "large_diff",
      severity: "medium",
      points: 3,
      evidence: [`${totalAdditions} additions, ${totalDeletions} deletions`],
      message: "Large diff size"
    });
  }

  return signals;
}

function missingTestsSignal(signals: RiskSignal[]): RiskSignal[] {
  const hasTests = signals.some((signal) => signal.category === "tests");
  if (hasTests) return [];

  return [
    {
      category: "missing_tests",
      severity: "medium",
      points: 2,
      evidence: ["No changed files matched default test patterns"],
      message: "No test evidence found in this pull request"
    }
  ];
}

export function assessRisk(files: PullRequestFile[]): RiskAssessment {
  const classifiedSignals = classifyFiles(files);
  const signals = [
    ...classifiedSignals,
    ...broadChangeSignals(files),
    ...missingTestsSignal(classifiedSignals)
  ];

  const score = signals.reduce((sum, signal) => sum + signal.points, 0);
  const level = levelFromScore(score);
  const reviewerFocus = signals
    .filter((signal) => riskRank[(signal.severity === "info" ? "low" : signal.severity)] >= riskRank.medium)
    .flatMap((signal) => signal.evidence)
    .filter((item) => !item.includes("files changed") && !item.includes("additions"))
    .slice(0, 10);

  return {
    level,
    score,
    guidance: guidanceFor(level),
    signals,
    reviewerFocus,
    testEvidenceFound: classifiedSignals.some((signal) => signal.category === "tests"),
    filesChanged: files.length,
    totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
    totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0)
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/risk-score.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/risk/score.ts tests/risk-score.test.ts
git commit -m "feat: score pull request merge risk"
```

## Task 6: Markdown Report Rendering

**Files:**
- Create: `src/report/markdown.ts`
- Create: `tests/markdown.test.ts`

- [ ] **Step 1: Write failing tests in `tests/markdown.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { renderReport } from "../src/report/markdown";
import type { RiskAssessment } from "../src/types";

const assessment: RiskAssessment = {
  level: "high",
  score: 8,
  guidance: "Senior review recommended before merge.",
  signals: [
    {
      category: "auth",
      severity: "high",
      points: 4,
      evidence: ["src/auth/session.ts"],
      message: "auth files changed"
    },
    {
      category: "missing_tests",
      severity: "medium",
      points: 2,
      evidence: ["No changed files matched default test patterns"],
      message: "No test evidence found in this pull request"
    }
  ],
  reviewerFocus: ["src/auth/session.ts"],
  testEvidenceFound: false,
  filesChanged: 2,
  totalAdditions: 40,
  totalDeletions: 12
};

describe("renderReport", () => {
  it("renders a sticky report marker and risk summary", () => {
    const markdown = renderReport(assessment);

    expect(markdown).toContain("<!-- mergerisk-report -->");
    expect(markdown).toContain("## MergeRisk Report");
    expect(markdown).toContain("**Overall risk:** high");
    expect(markdown).toContain("src/auth/session.ts");
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/markdown.test.ts`

Expected: FAIL because renderer does not exist.

- [ ] **Step 3: Implement `src/report/markdown.ts`**

```ts
import type { RiskAssessment, RiskSignal } from "../types";

export const reportMarker = "<!-- mergerisk-report -->";

function bulletList(items: string[]): string {
  if (items.length === 0) return "- No specific files identified.";
  return items.map((item) => `- \`${item}\``).join("\n");
}

function signalRow(signal: RiskSignal): string {
  const evidence = signal.evidence.map((item) => `\`${item}\``).join(", ");
  return `| ${signal.category} | ${signal.severity} | ${evidence} |`;
}

function checklistFor(assessment: RiskAssessment): string[] {
  const items = new Set<string>();

  for (const signal of assessment.signals) {
    if (signal.category === "database") items.add("Confirm schema changes are backward-compatible.");
    if (signal.category === "auth") items.add("Confirm authentication and authorization behavior.");
    if (signal.category === "payments") items.add("Confirm payment, refund, and subscription edge cases.");
    if (signal.category === "ci_cd") items.add("Confirm workflow and deployment behavior.");
    if (signal.category === "dependencies") items.add("Review dependency changes for security and licensing impact.");
    if (signal.category === "missing_tests") items.add("Add tests or identify existing validation evidence.");
  }

  if (items.size === 0) {
    items.add("Review the changed files and confirm expected behavior.");
  }

  return Array.from(items);
}

export function renderReport(assessment: RiskAssessment, synthesizedSummary = ""): string {
  const checklist = checklistFor(assessment).map((item) => `- ${item}`).join("\n");
  const summary = synthesizedSummary.trim()
    ? `\n### Summary\n${synthesizedSummary.trim()}\n`
    : "";

  return `${reportMarker}
## MergeRisk Report

**Overall risk:** ${assessment.level}  
**Score:** ${assessment.score}  
**Merge guidance:** ${assessment.guidance}
${summary}
### Why This PR Is Risky
${assessment.signals.map((signal) => `- ${signal.message}.`).join("\n")}

### Reviewer Focus
${bulletList(assessment.reviewerFocus)}

### Risk Signals
| Signal | Severity | Evidence |
| --- | --- | --- |
${assessment.signals.map(signalRow).join("\n")}

### Suggested Checklist
${checklist}

_MergeRisk is advisory. It does not replace human review, tests, or security scanning._
`;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/markdown.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/markdown.ts tests/markdown.test.ts
git commit -m "feat: render pull request risk report"
```

## Task 7: GitHub Pull Request Fetching

**Files:**
- Create: `src/github/pull-request.ts`

- [ ] **Step 1: Implement `src/github/pull-request.ts`**

```ts
import type { GitHub } from "@actions/github/lib/utils";
import type { PullRequestFile } from "../types";

type Octokit = InstanceType<typeof GitHub>;

interface PullRequestRef {
  owner: string;
  repo: string;
  pullNumber: number;
}

export async function listPullRequestFiles(
  octokit: Octokit,
  ref: PullRequestRef
): Promise<PullRequestFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.pullNumber,
    per_page: 100
  });

  return files.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    patch: file.patch ?? ""
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/github/pull-request.ts
git commit -m "feat: fetch pull request changed files"
```

## Task 8: Sticky PR Comment

**Files:**
- Create: `src/github/comment.ts`
- Create: `tests/comment.test.ts`

- [ ] **Step 1: Write failing tests in `tests/comment.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { upsertReportComment } from "../src/github/comment";
import { reportMarker } from "../src/report/markdown";

describe("upsertReportComment", () => {
  it("updates an existing MergeRisk comment", async () => {
    const updateComment = vi.fn();
    const createComment = vi.fn();
    const octokit = {
      paginate: vi.fn().mockResolvedValue([{ id: 42, body: `${reportMarker}\nold` }]),
      rest: {
        issues: {
          listComments: vi.fn(),
          updateComment,
          createComment
        }
      }
    };

    await upsertReportComment(octokit as never, {
      owner: "acme",
      repo: "app",
      pullNumber: 7,
      body: "new body",
      mode: "update"
    });

    expect(updateComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "app",
      comment_id: 42,
      body: "new body"
    });
    expect(createComment).not.toHaveBeenCalled();
  });

  it("creates a new comment when none exists", async () => {
    const updateComment = vi.fn();
    const createComment = vi.fn();
    const octokit = {
      paginate: vi.fn().mockResolvedValue([]),
      rest: {
        issues: {
          listComments: vi.fn(),
          updateComment,
          createComment
        }
      }
    };

    await upsertReportComment(octokit as never, {
      owner: "acme",
      repo: "app",
      pullNumber: 7,
      body: "new body",
      mode: "update"
    });

    expect(createComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "app",
      issue_number: 7,
      body: "new body"
    });
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- tests/comment.test.ts`

Expected: FAIL because comment module does not exist.

- [ ] **Step 3: Implement `src/github/comment.ts`**

```ts
import type { GitHub } from "@actions/github/lib/utils";
import type { CommentMode } from "../types";
import { reportMarker } from "../report/markdown";

type Octokit = InstanceType<typeof GitHub>;

interface UpsertCommentOptions {
  owner: string;
  repo: string;
  pullNumber: number;
  body: string;
  mode: CommentMode;
}

export async function upsertReportComment(
  octokit: Octokit,
  options: UpsertCommentOptions
): Promise<void> {
  if (options.mode === "new") {
    await octokit.rest.issues.createComment({
      owner: options.owner,
      repo: options.repo,
      issue_number: options.pullNumber,
      body: options.body
    });
    return;
  }

  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: options.owner,
    repo: options.repo,
    issue_number: options.pullNumber,
    per_page: 100
  });

  const existing = comments.find((comment) => comment.body?.includes(reportMarker));

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner: options.owner,
      repo: options.repo,
      comment_id: existing.id,
      body: options.body
    });
    return;
  }

  await octokit.rest.issues.createComment({
    owner: options.owner,
    repo: options.repo,
    issue_number: options.pullNumber,
    body: options.body
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/comment.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/github/comment.ts tests/comment.test.ts
git commit -m "feat: upsert mergerisk pull request comment"
```

## Task 9: Optional AI Synthesis

**Files:**
- Create: `src/ai/synthesize.ts`

- [ ] **Step 1: Implement `src/ai/synthesize.ts`**

```ts
import type { ActionConfig, PullRequestFile, RiskAssessment } from "../types";

function truncatePatch(files: PullRequestFile[], maxPatchLines: number): string {
  const lines: string[] = [];

  for (const file of files) {
    if (lines.length >= maxPatchLines) break;
    lines.push(`FILE: ${file.filename}`);
    lines.push(...file.patch.split("\n").slice(0, Math.max(0, maxPatchLines - lines.length)));
  }

  return lines.slice(0, maxPatchLines).join("\n");
}

function promptFor(assessment: RiskAssessment, files: PullRequestFile[], maxPatchLines: number): string {
  return `You are writing a concise pull request risk summary.
Do not lower the deterministic risk level.
Risk level: ${assessment.level}
Score: ${assessment.score}
Signals: ${assessment.signals.map((signal) => `${signal.category}:${signal.severity}`).join(", ")}

Changed files and truncated patches:
${truncatePatch(files, maxPatchLines)}

Return 2-4 bullet points focused on reviewer attention and merge risk.`;
}

async function synthesizeWithOpenAI(
  config: ActionConfig,
  assessment: RiskAssessment,
  files: PullRequestFile[]
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model || "gpt-4.1-mini",
      messages: [{ role: "user", content: promptFor(assessment, files, config.maxPatchLines) }],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI synthesis failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function synthesizeWithAnthropic(
  config: ActionConfig,
  assessment: RiskAssessment,
  files: PullRequestFile[]
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: config.model || "claude-3-5-haiku-latest",
      max_tokens: 500,
      messages: [{ role: "user", content: promptFor(assessment, files, config.maxPatchLines) }]
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic synthesis failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return data.content?.find((part) => part.type === "text")?.text?.trim() ?? "";
}

export async function synthesizeSummary(
  config: ActionConfig,
  assessment: RiskAssessment,
  files: PullRequestFile[]
): Promise<string> {
  if (config.provider === "none") return "";
  if (config.provider === "openai") return synthesizeWithOpenAI(config, assessment, files);
  if (config.provider === "anthropic") return synthesizeWithAnthropic(config, assessment, files);
  return "";
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ai/synthesize.ts
git commit -m "feat: add optional ai report synthesis"
```

## Task 10: Action Entrypoint

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: Implement `src/main.ts`**

```ts
import * as core from "@actions/core";
import * as github from "@actions/github";
import { parseConfigFromInputs } from "./config";
import { synthesizeSummary } from "./ai/synthesize";
import { upsertReportComment } from "./github/comment";
import { listPullRequestFiles } from "./github/pull-request";
import { renderReport } from "./report/markdown";
import { assessRisk } from "./risk/score";
import type { RiskLevel } from "./types";

const rank: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

function shouldFail(level: RiskLevel, failOnRisk: RiskLevel | "none"): boolean {
  if (failOnRisk === "none") return false;
  return rank[level] >= rank[failOnRisk];
}

async function run(): Promise<void> {
  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest) {
    core.info("MergeRisk only runs on pull_request events.");
    return;
  }

  const config = parseConfigFromInputs({
    "github-token": core.getInput("github-token", { required: true }),
    provider: core.getInput("provider"),
    model: core.getInput("model"),
    "api-key": core.getInput("api-key"),
    "fail-on-risk": core.getInput("fail-on-risk"),
    "max-patch-lines": core.getInput("max-patch-lines"),
    "comment-mode": core.getInput("comment-mode"),
    "risk-profile-path": core.getInput("risk-profile-path")
  });

  core.setSecret(config.apiKey);

  const octokit = github.getOctokit(config.githubToken);
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;
  const pullNumber = pullRequest.number;

  const files = await listPullRequestFiles(octokit, { owner, repo, pullNumber });
  const assessment = assessRisk(files);
  const summary = await synthesizeSummary(config, assessment, files);
  const body = renderReport(assessment, summary);

  await upsertReportComment(octokit, {
    owner,
    repo,
    pullNumber,
    body,
    mode: config.commentMode
  });

  core.setOutput("risk-level", assessment.level);
  core.setOutput("risk-score", String(assessment.score));

  if (shouldFail(assessment.level, config.failOnRisk)) {
    core.setFailed(`MergeRisk level ${assessment.level} meets fail-on-risk threshold ${config.failOnRisk}`);
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(message);
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire mergerisk action entrypoint"
```

## Task 11: Action Metadata And Example Workflow

**Files:**
- Create: `action.yml`
- Create: `examples/basic.yml`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `action.yml`**

```yaml
name: "MergeRisk"
description: "Post a concise merge-risk report on pull requests."
author: "MergeRisk"
branding:
  icon: "shield"
  color: "blue"
inputs:
  github-token:
    description: "GitHub token used to read pull requests and write comments."
    required: true
    default: "${{ github.token }}"
  provider:
    description: "AI provider: none, openai, or anthropic."
    required: false
    default: "none"
  model:
    description: "Model name for AI synthesis."
    required: false
    default: ""
  api-key:
    description: "API key for the selected AI provider."
    required: false
    default: ""
  fail-on-risk:
    description: "Fail the workflow at this risk level: none, medium, high, or critical."
    required: false
    default: "none"
  max-patch-lines:
    description: "Maximum patch lines sent to AI synthesis."
    required: false
    default: "1200"
  comment-mode:
    description: "Comment behavior: update or new."
    required: false
    default: "update"
  risk-profile-path:
    description: "Optional path to a custom YAML risk profile."
    required: false
    default: ""
outputs:
  risk-level:
    description: "Computed risk level: low, medium, high, or critical."
  risk-score:
    description: "Computed deterministic risk score."
runs:
  using: "node24"
  main: "dist/index.js"
```

- [ ] **Step 2: Create `examples/basic.yml`**

```yaml
name: MergeRisk

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: read
  issues: write

jobs:
  risk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: your-org/mergerisk-action@v0
        with:
          github-token: ${{ github.token }}
          provider: none
          fail-on-risk: critical
```

- [ ] **Step 3: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run typecheck
      - run: npm run build
```

- [ ] **Step 4: Build**

Run: `npm run build`

Expected: PASS and `dist/index.js` exists.

- [ ] **Step 5: Commit**

```bash
git add action.yml examples/basic.yml .github/workflows/ci.yml dist/index.js dist/sourcemap-register.js
git commit -m "feat: add github action metadata and ci"
```

## Task 12: README And Launch Documentation

**Files:**
- Create: `README.md`
- Create: `LICENSE`

- [ ] **Step 1: Create `README.md`**

```markdown
# MergeRisk

MergeRisk is a GitHub Action that posts a concise pull request risk report.

It is not a generic AI code reviewer. It triages merge risk so reviewers know where to focus.

## Example

```yaml
name: MergeRisk

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: read
  issues: write

jobs:
  risk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: your-org/mergerisk-action@v0
        with:
          github-token: ${{ github.token }}
          provider: none
          fail-on-risk: critical
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Token used to read PR data and write comments. |
| `provider` | `none` | `none`, `openai`, or `anthropic`. |
| `model` | empty | Model name for AI synthesis. |
| `api-key` | empty | API key for selected provider. |
| `fail-on-risk` | `none` | `none`, `medium`, `high`, or `critical`. |
| `max-patch-lines` | `1200` | Maximum patch lines sent to AI synthesis. |
| `comment-mode` | `update` | `update` or `new`. |
| `risk-profile-path` | empty | Optional YAML risk profile path. |

## Outputs

| Output | Description |
| --- | --- |
| `risk-level` | `low`, `medium`, `high`, or `critical`. |
| `risk-score` | Deterministic risk score. |

## AI Providers

MergeRisk works without an AI provider. With `provider: none`, it uses deterministic file and diff risk signals.

To enable OpenAI synthesis:

```yaml
with:
  github-token: ${{ github.token }}
  provider: openai
  api-key: ${{ secrets.OPENAI_API_KEY }}
```

To enable Anthropic synthesis:

```yaml
with:
  github-token: ${{ github.token }}
  provider: anthropic
  api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Permissions

```yaml
permissions:
  contents: read
  pull-requests: read
  issues: write
```

## Advisory Scope

MergeRisk is advisory. It does not replace human review, tests, or security scanning.
```
```

- [ ] **Step 2: Create `LICENSE`**

Use MIT for the MVP:

```text
MIT License

Copyright (c) 2026 MergeRisk

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Commit**

```bash
git add README.md LICENSE
git commit -m "docs: add mergerisk usage documentation"
```

## Task 13: End-To-End Local Verification

**Files:**
- Modify only if verification reveals failures.

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Build distributable Action**

Run: `npm run build`

Expected: PASS and `dist/index.js` exists.

- [ ] **Step 4: Verify committed Action entrypoint**

Run: `test -f dist/index.js`

Expected: command exits 0.

- [ ] **Step 5: Commit verification fixes if any files changed**

```bash
git status --short
git add .
git commit -m "fix: pass mergerisk action verification"
```

If `git status --short` shows no changes, skip the commit.

## Task 14: Manual GitHub PR Smoke Test

**Files:**
- Modify only if smoke test reveals failures.

- [ ] **Step 1: Create a temporary test repository**

Create a GitHub repository under the intended owner account.

- [ ] **Step 2: Add workflow**

Copy `examples/basic.yml` to `.github/workflows/mergerisk.yml` and replace:

```yaml
- uses: your-org/mergerisk-action@v0
```

with:

```yaml
- uses: OWNER/REPO@BRANCH
```

- [ ] **Step 3: Open a pull request that changes an auth file**

Create `src/auth/session.ts` in the test repository with any small content change.

- [ ] **Step 4: Confirm report behavior**

Expected:

- Action completes successfully.
- One PR comment appears.
- Comment includes `Overall risk: high` or higher.
- Comment includes `src/auth/session.ts`.
- Rerunning the workflow updates the same comment, not a duplicate.

- [ ] **Step 5: Commit fixes if needed**

```bash
git add .
git commit -m "fix: pass github smoke test"
```

## Release Checklist

- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] `dist/index.js` is committed.
- [ ] README install example works.
- [ ] GitHub smoke test posts one sticky comment.
- [ ] Create tag `v0.1.0`.
- [ ] Publish GitHub release.
- [ ] Publish the Action to GitHub Marketplace from the repository release page.
