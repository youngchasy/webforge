import { listHtmlDependencies } from "./preview";
import { cssLineAt, parseCssStylesheet, type CssAstAtRule } from "./cssAst";

export type ResponsiveBreakpointMode = "max" | "min";

export type ResponsiveBreakpoint = {
  id: string;
  path: string;
  line: number;
  condition: string;
  mode: ResponsiveBreakpointMode | "complex";
  width: number | null;
  editable: boolean;
  preludeStart: number;
  preludeEnd: number;
};

export type ResponsivePatch = {
  path: string;
  before: string;
  after: string;
  label: string;
};

function cssPaths(files: Record<string, string>, htmlPath: string): string[] {
  const html = files[htmlPath] ?? "";
  const linked = listHtmlDependencies(htmlPath, html).filter((path) => /\.css$/i.test(path) && files[path] !== undefined);
  const fallback = Object.keys(files).filter((path) => /\.css$/i.test(path));
  return [...new Set([...linked, ...fallback])];
}

function breakpointFromAtRule(path: string, content: string, rule: CssAstAtRule): ResponsiveBreakpoint | null {
  if (rule.name !== "media") return null;
  const minMatches = [...rule.prelude.matchAll(/\bmin-width\s*:\s*(\d+(?:\.\d+)?)px\b/gi)];
  const maxMatches = [...rule.prelude.matchAll(/\bmax-width\s*:\s*(\d+(?:\.\d+)?)px\b/gi)];
  const single = minMatches.length + maxMatches.length === 1;
  const match = maxMatches[0] ?? minMatches[0];
  const mode: ResponsiveBreakpoint["mode"] = single ? (maxMatches.length ? "max" : "min") : "complex";
  return {
    id: `${path}:${rule.headerStart}`,
    path,
    line: cssLineAt(content, rule.headerStart),
    condition: rule.prelude,
    mode,
    width: match ? Number(match[1]) : null,
    editable: Boolean(single && match),
    preludeStart: rule.preludeStart,
    preludeEnd: rule.preludeEnd,
  };
}

export function listResponsiveBreakpoints(files: Record<string, string>, htmlPath: string): ResponsiveBreakpoint[] {
  const output: ResponsiveBreakpoint[] = [];
  for (const path of cssPaths(files, htmlPath)) {
    const content = files[path];
    if (content === undefined) continue;
    const ast = parseCssStylesheet(content);
    for (const rule of ast.atRules) {
      const breakpoint = breakpointFromAtRule(path, content, rule);
      if (breakpoint) output.push(breakpoint);
    }
  }
  return output.sort((a, b) => (b.width ?? -1) - (a.width ?? -1) || a.path.localeCompare(b.path) || a.line - b.line);
}

export function patchResponsiveBreakpoint(files: Record<string, string>, breakpoint: ResponsiveBreakpoint, nextWidth: number): ResponsivePatch | null {
  const before = files[breakpoint.path];
  if (before === undefined || !breakpoint.editable || !Number.isFinite(nextWidth)) return null;
  const width = Math.max(240, Math.min(3840, Math.round(nextWidth)));
  const prelude = before.slice(breakpoint.preludeStart, breakpoint.preludeEnd);
  const property = breakpoint.mode === "min" ? "min-width" : "max-width";
  const replaced = prelude.replace(new RegExp(`\\b${property}\\s*:\\s*\\d+(?:\\.\\d+)?px\\b`, "i"), `${property}: ${width}px`);
  if (replaced === prelude) return null;
  const after = `${before.slice(0, breakpoint.preludeStart)}${replaced}${before.slice(breakpoint.preludeEnd)}`;
  return { path: breakpoint.path, before, after, label: `Breakpoint ${property} → ${width}px` };
}

export function createResponsiveBreakpoint(
  files: Record<string, string>,
  htmlPath: string,
  width: number,
  mode: ResponsiveBreakpointMode,
): ResponsivePatch | null {
  const path = cssPaths(files, htmlPath)[0];
  if (!path) return null;
  const before = files[path];
  if (before === undefined) return null;
  const normalized = Math.max(240, Math.min(3840, Math.round(width)));
  const marker = "/* WebForge responsive breakpoints */";
  const block = `@media (${mode}-width: ${normalized}px) {\n  /* Add responsive declarations here */\n}`;
  const after = before.includes(marker)
    ? `${before.trimEnd()}\n\n${block}\n`
    : `${before.trimEnd()}\n\n${marker}\n${block}\n`;
  return { path, before, after, label: `Create ${mode}-width ${normalized}px breakpoint` };
}
