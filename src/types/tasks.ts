export type ProjectTask = {
  id: string;
  name: string;
  script: string;
  category: "test" | "lint" | "typecheck" | "build" | "format" | "other" | string;
  packageManager: string;
};

export type TaskStatus = {
  running: boolean;
  taskId: string | null;
  name: string | null;
  category: string | null;
  command: string | null;
  packageManager: string | null;
  exitCode: number | null;
  testPath: string | null;
  testName: string | null;
  testFramework: string | null;
  coverage: boolean;
};

export type TaskLogBatch = {
  cursor: number;
  lines: string[];
  status: TaskStatus;
};

export type CoverageMetric = {
  total: number;
  covered: number;
  skipped: number;
  percent: number;
};

export type CoverageSummary = {
  lines: CoverageMetric;
  statements: CoverageMetric;
  functions: CoverageMetric;
  branches: CoverageMetric;
};

export type TestCaseResult = {
  id: string;
  path: string;
  title: string;
  fullName: string;
  suite: string | null;
  status: "passed" | "failed" | "skipped" | "todo" | string;
  durationMs: number | null;
  failureMessage: string | null;
  stack: string | null;
  line: number | null;
  column: number | null;
};

export type TestRunReport = {
  framework: string;
  path: string | null;
  requestedTest: string | null;
  success: boolean;
  durationMs: number | null;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  cases: TestCaseResult[];
  coverage: CoverageSummary | null;
  finishedAtMs: number;
};

export type TestHistoryEntry = {
  framework: string;
  finishedAtMs: number;
  path: string | null;
  requestedTest: string | null;
  success: boolean;
  durationMs: number | null;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  coverage: CoverageSummary | null;
};
