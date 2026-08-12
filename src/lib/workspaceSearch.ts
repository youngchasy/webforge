import type { WorkspaceReplacement, WorkspaceSearchOptions, WorkspaceSearchResponse } from "../types/search";

function wildcard(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("?", ".").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function allowed(path: string, include: string, exclude: string): boolean {
  const includes = include.split(",").map((item) => item.trim()).filter(Boolean);
  const excludes = exclude.split(",").map((item) => item.trim()).filter(Boolean);
  return (!includes.length || includes.some((pattern) => wildcard(pattern, path))) && !excludes.some((pattern) => wildcard(pattern, path));
}

function patternFor(options: WorkspaceSearchOptions): RegExp {
  const source = options.regex ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = options.wholeWord ? `\\b(?:${source})\\b` : source;
  return new RegExp(pattern, `${options.caseSensitive ? "" : "i"}gm`);
}

export function searchInMemory(files: Record<string, string>, options: WorkspaceSearchOptions): WorkspaceSearchResponse {
  if (!options.query.trim()) return { matches: [], filesScanned: 0, truncated: false };
  const limit = Math.max(1, Math.min(10_000, options.maxResults ?? 2_000));
  const matches: WorkspaceSearchResponse["matches"] = [];
  let filesScanned = 0;
  let truncated = false;
  for (const [path, content] of Object.entries(files)) {
    if (!allowed(path, options.include, options.exclude)) continue;
    filesScanned += 1;
    const regex = patternFor(options);
    for (const match of content.matchAll(regex)) {
      const index = match.index ?? 0;
      const before = content.slice(0, index);
      const line = before.split("\n").length;
      const lineStart = before.lastIndexOf("\n") + 1;
      const lineEndIndex = content.indexOf("\n", index);
      const lineEnd = lineEndIndex < 0 ? content.length : lineEndIndex;
      const column = [...content.slice(lineStart, index)].length + 1;
      matches.push({ path, line, column, endColumn: column + [...match[0]].length, preview: content.slice(lineStart, lineEnd).replace(/\r$/, ""), matched: match[0] });
      if (matches.length >= limit) { truncated = true; break; }
    }
    if (truncated) break;
  }
  return { matches, filesScanned, truncated };
}

export function replaceInMemory(files: Record<string, string>, options: WorkspaceSearchOptions, replacement: string): WorkspaceReplacement[] {
  if (!options.query.trim()) return [];
  const output: WorkspaceReplacement[] = [];
  for (const [relativePath, before] of Object.entries(files)) {
    if (!allowed(relativePath, options.include, options.exclude)) continue;
    const regex = patternFor(options);
    const hits = [...before.matchAll(regex)].length;
    if (!hits) continue;
    const content = options.regex ? before.replace(regex, replacement) : before.replace(regex, () => replacement);
    output.push({ relativePath, before, content, replacements: hits });
  }
  return output;
}
