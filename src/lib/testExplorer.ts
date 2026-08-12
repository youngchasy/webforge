import type { ProjectLanguageSnapshot } from "../types/intelligence";
import type { ProjectTask } from "../types/tasks";
import type { DiscoveredTestCase, DiscoveredTestFile, TestFramework } from "../types/tests";

function frameworksFromTasks(tasks: ProjectTask[]): Set<TestFramework> {
  const result = new Set<TestFramework>();
  for (const task of tasks.filter((item) => item.category === "test")) {
    const text = `${task.name} ${task.script}`.toLowerCase();
    if (/\bplaywright\b/.test(text)) result.add("playwright");
    if (/\bvitest\b/.test(text)) result.add("vitest");
    if (/\bjest\b/.test(text)) result.add("jest");
  }
  return result;
}

function frameworkForFile(path: string, content: string, tasks: ProjectTask[]): TestFramework {
  const lowerPath = path.toLowerCase();
  const lowerContent = content.toLowerCase();
  if (/@playwright\/test/.test(lowerContent)) return "playwright";
  if (/from\s+["']vitest["']|require\(\s*["']vitest["']/.test(lowerContent)) return "vitest";
  if (/from\s+["']@jest\/globals["']|require\(\s*["']@jest\/globals["']/.test(lowerContent)) return "jest";

  const available = frameworksFromTasks(tasks);
  if (available.has("playwright") && /(?:^|\/)(?:e2e|playwright)(?:\/|$)/.test(lowerPath)) return "playwright";
  if (available.has("vitest") && !available.has("jest")) return "vitest";
  if (available.has("jest") && !available.has("vitest")) return "jest";
  if (available.size === 1) return [...available][0] ?? "unknown";
  return "unknown";
}

function looksLikeTestFile(path: string): boolean {
  const lower = path.toLowerCase();
  return /(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(lower) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(lower);
}

function lineAt(content: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (content.charCodeAt(cursor) === 10) line += 1;
  return line;
}

function parseCases(content: string): DiscoveredTestCase[] {
  const cases: DiscoveredTestCase[] = [];
  const suiteStack: Array<{ name: string; depth: number }> = [];
  const lineDepths: number[] = [];
  let depth = 0;
  for (const line of content.split("\n")) {
    lineDepths.push(depth);
    for (const char of line) {
      if (char === "{") depth += 1;
      else if (char === "}") depth = Math.max(0, depth - 1);
    }
  }

  const expression = /\b(describe|suite|test\.describe|test|it)(?:\.(?:only|skip|todo|concurrent|each|serial|parallel))?\s*\(\s*(["'`])([^"'`\n]+)\2/g;
  for (const match of content.matchAll(expression)) {
    const kind = match[1];
    const name = match[3].trim();
    if (!name) continue;
    const index = match.index ?? 0;
    const line = lineAt(content, index);
    const currentDepth = lineDepths[line - 1] ?? 0;
    while (suiteStack.length && suiteStack[suiteStack.length - 1].depth > currentDepth) suiteStack.pop();
    if (kind === "describe" || kind === "suite" || kind === "test.describe") {
      suiteStack.push({ name, depth: currentDepth + 1 });
      continue;
    }
    cases.push({ id: `${line}:${name}`, name, line, suite: suiteStack.map((item) => item.name).join(" › ") || null });
    if (cases.length >= 500) break;
  }
  return cases;
}

export function discoverProjectTests(snapshot: ProjectLanguageSnapshot | null, tasks: ProjectTask[]): DiscoveredTestFile[] {
  if (!snapshot) return [];
  return snapshot.files
    .filter((file) => !file.declaration && looksLikeTestFile(file.relativePath))
    .slice(0, 400)
    .map((file) => ({ relativePath: file.relativePath, framework: frameworkForFile(file.relativePath, file.content, tasks), cases: parseCases(file.content) }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function primaryTestTask(tasks: ProjectTask[], framework: TestFramework = "unknown"): ProjectTask | null {
  const candidates = tasks.filter((task) => task.category === "test");
  if (!candidates.length) return null;
  const frameworkMatch = framework === "unknown" ? null : candidates.find((task) => {
    const text = `${task.name} ${task.script}`.toLowerCase();
    return framework === "playwright" ? /\bplaywright\b/.test(text) : framework === "vitest" ? /\bvitest\b/.test(text) : /\bjest\b/.test(text);
  });
  return frameworkMatch ?? candidates.find((task) => task.name === "test") ?? candidates[0];
}
