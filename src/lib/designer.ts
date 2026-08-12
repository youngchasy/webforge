import { listHtmlDependencies } from "./preview";
import { contextKey, cssLineAt, normalizeCssSelector, parseCssStylesheet, type CssAtRuleContext, type CssAstRule } from "./cssAst";
import type { CssPseudoState, CssRuleMatch, CssVariableEntry, InspectorSelection } from "../types/designer";

export type CssPatch = {
  path: string;
  before: string;
  after: string;
  selector: string;
  source: "matched-rule" | "generated-rule" | "variable";
};

function patchDeclarationBody(body: string, property: string, value: string): string {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`(^|[;\\n\\r])([ \\t\\r\\n]*)${escaped}\\s*:\\s*([^;}]*)\\s*;?`, "i");
  const normalizedValue = value.trim();
  if (matcher.test(body)) {
    if (!normalizedValue) return body.replace(matcher, (_full, prefix: string, spacing: string) => `${prefix}${spacing}`);
    return body.replace(matcher, (_full, prefix: string, spacing: string) => `${prefix}${spacing}${property}: ${normalizedValue};`);
  }
  if (!normalizedValue) return body;
  const trimmed = body.trimEnd();
  const separator = trimmed && !trimmed.endsWith(";") ? ";" : "";
  const indentMatch = body.match(/\n([ \t]+)[\w-]+\s*:/);
  const indent = indentMatch?.[1] ?? "  ";
  if (body.includes("\n")) return `${trimmed}${separator}\n${indent}${property}: ${normalizedValue};\n`;
  return `${trimmed}${separator}${trimmed ? " " : ""}${property}: ${normalizedValue};`;
}

function declarationMatchScore(actual: Record<string, string>, expected?: Record<string, string>): number {
  if (!expected || !Object.keys(expected).length) return 0;
  return Object.entries(expected).reduce((score, [name, value]) => (
    actual[name]?.replace(/\s+/g, " ").trim() === value.replace(/\s+/g, " ").trim() ? score + 1 : score
  ), 0);
}

function contextMatch(actual: CssAtRuleContext[], expected?: CssAtRuleContext[]): boolean {
  if (!expected?.length) return true;
  return contextKey(actual) === contextKey(expected);
}

function selectorMatches(rule: CssAstRule, target: string): boolean {
  if (normalizeCssSelector(rule.selector) === target) return true;
  return rule.selectors.some((candidate) => normalizeCssSelector(candidate) === target);
}

export function patchCssRule(
  content: string,
  selector: string,
  property: string,
  value: string,
  expectedDeclarations?: Record<string, string>,
  expectedContexts?: CssAtRuleContext[],
  expectedSourceStart?: number | null,
): string | null {
  const target = normalizeCssSelector(selector);
  const ast = parseCssStylesheet(content);
  const contextual = ast.rules
    .filter((rule) => selectorMatches(rule, target))
    .filter((rule) => contextMatch(rule.contexts, expectedContexts));
  const exact = expectedSourceStart === null || expectedSourceStart === undefined
    ? []
    : contextual.filter((rule) => rule.headerStart === expectedSourceStart);
  const candidates = (exact.length ? exact : contextual)
    .map((rule) => ({ rule, score: declarationMatchScore(rule.declarations, expectedDeclarations) }));
  if (!candidates.length) return null;
  const selected = candidates.reduce((best, candidate) => candidate.score > best.score ? candidate : best, candidates[0]).rule;
  const body = content.slice(selected.bodyStart, selected.bodyEnd);
  const nextBody = patchDeclarationBody(body, property, value);
  return `${content.slice(0, selected.bodyStart)}${nextBody}${content.slice(selected.bodyEnd)}`;
}

function linkedCssPaths(files: Record<string, string>, htmlPath: string): string[] {
  const html = files[htmlPath] ?? "";
  const linked = listHtmlDependencies(htmlPath, html).filter((path) => /\.css$/i.test(path) && files[path] !== undefined);
  const fallback = Object.keys(files).filter((path) => /\.css$/i.test(path));
  return [...new Set([...linked, ...fallback])];
}

function localRule(selection: InspectorSelection, preferred: CssRuleMatch | null | undefined, pseudo: CssPseudoState): CssRuleMatch | null {
  if (preferred === null) return null;
  if (preferred?.sourcePath) return preferred;
  return selection.cssRules.find((rule) => Boolean(rule.sourcePath) && rule.pseudo === pseudo) ?? null;
}

export function selectorWithPseudo(selector: string, pseudo: CssPseudoState): string {
  return pseudo === "normal" ? selector : `${selector}:${pseudo}`;
}

export function applyStyleToCss(
  files: Record<string, string>,
  htmlPath: string,
  selection: InspectorSelection,
  property: string,
  value: string,
  preferredRule?: CssRuleMatch | null,
  pseudo: CssPseudoState = "normal",
): CssPatch | null {
  const rule = localRule(selection, preferredRule, pseudo);
  if (rule?.sourcePath && files[rule.sourcePath] !== undefined) {
    const before = files[rule.sourcePath];
    const after = patchCssRule(before, rule.selector, property, value, rule.declarations, rule.contexts, rule.sourceStart);
    if (after !== null && after !== before) {
      return { path: rule.sourcePath, before, after, selector: rule.selector, source: "matched-rule" };
    }
  }

  const cssPath = linkedCssPaths(files, htmlPath)[0];
  if (!cssPath) return null;
  const before = files[cssPath];
  const selector = selectorWithPseudo(selection.selector, pseudo);
  const normalizedValue = value.trim();
  if (!normalizedValue) return null;
  const marker = "/* WebForge visual rules */";
  const ruleText = `${selector} {\n  ${property}: ${normalizedValue};\n}`;
  const after = before.includes(marker)
    ? `${before.trimEnd()}\n\n${ruleText}\n`
    : `${before.trimEnd()}\n\n${marker}\n${ruleText}\n`;
  return { path: cssPath, before, after, selector, source: "generated-rule" };
}

export function listCssVariables(files: Record<string, string>, htmlPath: string): CssVariableEntry[] {
  const entries: CssVariableEntry[] = [];
  for (const path of linkedCssPaths(files, htmlPath)) {
    const content = files[path];
    if (content === undefined) continue;
    const ast = parseCssStylesheet(content);
    for (const rule of ast.rules) {
      for (const [name, value] of Object.entries(rule.declarations)) {
        if (name.startsWith("--")) entries.push({ path, selector: rule.selector, name, value, contexts: rule.contexts, sourceStart: rule.headerStart });
      }
    }
  }
  const deduped = new Map<string, CssVariableEntry>();
  for (const entry of entries) deduped.set(`${entry.path}:${contextKey(entry.contexts)}:${entry.selector}:${entry.name}`, entry);
  return [...deduped.values()].slice(0, 100);
}

export function patchCssVariable(files: Record<string, string>, variable: CssVariableEntry, value: string): CssPatch | null {
  const before = files[variable.path];
  if (before === undefined) return null;
  const after = patchCssRule(before, variable.selector, variable.name, value, { [variable.name]: variable.value }, variable.contexts, variable.sourceStart);
  if (after === null || after === before) return null;
  return { path: variable.path, before, after, selector: variable.selector, source: "variable" };
}

function bestSourceRule(content: string, match: CssRuleMatch): CssAstRule | null {
  const target = normalizeCssSelector(match.selector);
  const candidates = parseCssStylesheet(content).rules
    .filter((rule) => selectorMatches(rule, target))
    .filter((rule) => contextMatch(rule.contexts, match.contexts))
    .map((rule) => ({ rule, score: declarationMatchScore(rule.declarations, match.declarations) }));
  if (!candidates.length) return null;
  return candidates.reduce((best, candidate) => candidate.score > best.score ? candidate : best, candidates[0]).rule;
}

export function resolveCssRuleSources(files: Record<string, string>, rules: CssRuleMatch[]): CssRuleMatch[] {
  return rules.map((match) => {
    if (!match.sourcePath) return match;
    const content = files[match.sourcePath];
    if (content === undefined) return match;
    const source = bestSourceRule(content, match);
    if (!source) return match;
    return {
      ...match,
      sourceLine: cssLineAt(content, source.headerStart),
      sourceStart: source.headerStart,
      sourceEnd: source.end,
    };
  });
}

export function boxStyleProperties(): string[] {
  return [
    "width", "height",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
  ];
}

export type DesignerAnimationPreset = "fade" | "slide" | "pulse";

function generatedCssTarget(files: Record<string, string>, htmlPath: string): { path: string; content: string } | null {
  const path = linkedCssPaths(files, htmlPath)[0];
  if (!path || files[path] === undefined) return null;
  return { path, content: files[path] };
}

function safeAnimationName(selector: string, preset: DesignerAnimationPreset): string {
  const slug = selector.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "element";
  return `webforge-${preset}-${slug}`;
}

export function appendDesignerAnimation(
  files: Record<string, string>,
  htmlPath: string,
  selection: InspectorSelection,
  preset: DesignerAnimationPreset,
): CssPatch | null {
  const target = generatedCssTarget(files, htmlPath);
  if (!target) return null;
  const animationName = safeAnimationName(selection.selector, preset);
  const frames = preset === "fade"
    ? `@keyframes ${animationName} {\n  from { opacity: 0; }\n  to { opacity: 1; }\n}`
    : preset === "slide"
      ? `@keyframes ${animationName} {\n  from { opacity: 0; transform: translateY(18px); }\n  to { opacity: 1; transform: translateY(0); }\n}`
      : `@keyframes ${animationName} {\n  0%, 100% { transform: scale(1); }\n  50% { transform: scale(1.04); }\n}`;
  const duration = preset === "pulse" ? "1.8s" : ".45s";
  const iteration = preset === "pulse" ? "infinite" : "1";
  const rule = `${selection.selector} {\n  animation-name: ${animationName};\n  animation-duration: ${duration};\n  animation-timing-function: ease;\n  animation-iteration-count: ${iteration};\n  animation-fill-mode: both;\n}`;
  const marker = "/* WebForge Designer 2.0 motion */";
  const after = `${target.content.trimEnd()}\n\n${marker}\n${frames}\n\n${rule}\n`;
  return { path: target.path, before: target.content, after, selector: selection.selector, source: "generated-rule" };
}

export function appendDesignerContainerQuery(
  files: Record<string, string>,
  htmlPath: string,
  selection: InspectorSelection,
  mode: "min" | "max",
  width: number,
  property: string,
  value: string,
): CssPatch | null {
  const target = generatedCssTarget(files, htmlPath);
  if (!target || !/^[a-z-]+$/i.test(property) || !value.trim()) return null;
  const safeWidth = Math.max(1, Math.min(5000, Math.round(width || 0)));
  const marker = "/* WebForge Designer 2.0 container queries */";
  const block = `@container (${mode}-width: ${safeWidth}px) {\n  ${selection.selector} {\n    ${property}: ${value.trim()};\n  }\n}`;
  const after = `${target.content.trimEnd()}\n\n${marker}\n${block}\n`;
  return { path: target.path, before: target.content, after, selector: selection.selector, source: "generated-rule" };
}
