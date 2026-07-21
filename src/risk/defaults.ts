import type { RiskRule, TestPolicy } from "../types.js";

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
    category: "security",
    severity: "high",
    patterns: ["**/security/**", "**/*token*", "**/*secret*", "**/*permission*"]
  },
  {
    category: "tests",
    severity: "info",
    patterns: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "tests/**"]
  }
];

export const defaultTestPolicy: TestPolicy = {
  testPatterns: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "tests/**"],
  sourcePatterns: [
    "**/*.{js,jsx,mjs,cjs,ts,tsx,py,rb,go,java,kt,cs,php,rs,swift,scala,sh}"
  ],
  exemptPatterns: ["docs/**", "**/*.md", "**/*.d.ts", "**/*.generated.*"],
  requireTestsFor: {
    addedSourceFiles: true,
    modifiedSourceFiles: false
  }
};
