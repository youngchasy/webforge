export type TestFramework = "vitest" | "jest" | "playwright" | "unknown";

export type DiscoveredTestCase = {
  id: string;
  name: string;
  line: number;
  suite: string | null;
};

export type DiscoveredTestFile = {
  relativePath: string;
  framework: TestFramework;
  cases: DiscoveredTestCase[];
};

export type TestCaseRunState = "idle" | "running" | "passed" | "failed";
