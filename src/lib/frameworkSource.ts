import type { HtmlInsertPosition, HtmlSourcePatch } from "./htmlSource";
import type { InspectorSelection } from "../types/designer";

export type FrameworkSourceKind = "react" | "vue" | "svelte";

type FrameworkNode = {
  sourceId: string;
  path: string;
  start: number;
  startTagEnd: number;
  endTagStart: number | null;
  end: number;
  tagName: string;
  selfClosing: boolean;
  parentId: string | null;
};

type AttributeSpan = {
  name: string;
  start: number;
  end: number;
  valueStart: number | null;
  valueEnd: number | null;
  quote: string | null;
  expression: boolean;
};

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TAGS = new Set(["script", "style"]);
const HTML_TAGS = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base", "bdi", "bdo", "blockquote", "body", "br", "button", "canvas", "caption", "cite", "code", "col", "colgroup", "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt", "em", "embed", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html", "i", "iframe", "img", "input", "ins", "kbd", "label", "legend", "li", "link", "main", "map", "mark", "menu", "meta", "meter", "nav", "noscript", "object", "ol", "optgroup", "option", "output", "p", "picture", "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "script", "search", "section", "select", "slot", "small", "source", "span", "strong", "style", "sub", "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr",
  "svg", "path", "circle", "ellipse", "g", "line", "polygon", "polyline", "rect", "text", "defs", "linearGradient", "radialGradient", "stop", "use", "symbol", "clipPath", "mask", "foreignObject",
]);

const REACT_ATTRIBUTE_NAMES: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  colspan: "colSpan",
  rowspan: "rowSpan",
  contenteditable: "contentEditable",
  autocomplete: "autoComplete",
  autofocus: "autoFocus",
  crossorigin: "crossOrigin",
  datetime: "dateTime",
  srcset: "srcSet",
};

function isNameChar(char: string): boolean {
  return /[A-Za-z0-9:_-]/.test(char);
}

function lineColumnToIndex(content: string, line: number, column: number): number | null {
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1) return null;
  let index = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const newline = content.indexOf("\n", index);
    if (newline < 0) return null;
    index = newline + 1;
  }
  return Math.min(content.length, index + column - 1);
}

function indexToLineColumn(content: string, index: number): { line: number; column: number } {
  const safe = Math.max(0, Math.min(content.length, index));
  const prefix = content.slice(0, safe);
  const lines = prefix.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

export function parseFrameworkSourceId(sourceId: string): { path: string; line: number; column: number } | null {
  if (!sourceId.startsWith("f:")) return null;
  const match = /^f:(.*):(\d+):(\d+)$/.exec(sourceId);
  if (!match || !match[1]) return null;
  const line = Number(match[2]);
  const column = Number(match[3]);
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1) return null;
  return { path: match[1].replace(/\\/g, "/").replace(/^\/+/, ""), line, column };
}

export function frameworkSourceId(path: string, content: string, index: number): string {
  const location = indexToLineColumn(content, index);
  return `f:${path.replace(/\\/g, "/").replace(/^\/+/, "")}:${location.line}:${location.column}`;
}

function findMarkupRegion(content: string, kind: FrameworkSourceKind): { start: number; end: number } {
  if (kind !== "vue") return { start: 0, end: content.length };
  const open = /<template(?:\s[^>]*)?>/i.exec(content);
  if (!open || open.index === undefined) return { start: 0, end: content.length };
  const start = open.index + open[0].length;
  const close = content.toLowerCase().indexOf("</template", start);
  return { start, end: close >= 0 ? close : content.length };
}

function findTagEnd(content: string, start: number): number {
  let quote = "";
  let braces = 0;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (char === "\\") { index += 1; continue; }
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (char === "{") { braces += 1; continue; }
    if (char === "}" && braces > 0) { braces -= 1; continue; }
    if (char === ">" && braces === 0) return index;
  }
  return content.length - 1;
}

function validMarkupTag(tagName: string, kind: FrameworkSourceKind): boolean {
  if (kind === "react") return HTML_TAGS.has(tagName) || HTML_TAGS.has(tagName.toLowerCase());
  return /^[a-z][A-Za-z0-9:_-]*$/.test(tagName);
}

function parseFrameworkNodes(content: string, path: string, kind: FrameworkSourceKind): FrameworkNode[] {
  const nodes: FrameworkNode[] = [];
  const stack: FrameworkNode[] = [];
  const region = findMarkupRegion(content, kind);
  let index = region.start;

  while (index < region.end) {
    const lt = content.indexOf("<", index);
    if (lt < 0 || lt >= region.end) break;
    if (content.startsWith("<!--", lt)) {
      const end = content.indexOf("-->", lt + 4);
      index = end < 0 ? region.end : end + 3;
      continue;
    }
    if (content.startsWith("{/*", lt)) { index = lt + 1; continue; }
    const next = content[lt + 1] ?? "";
    if (next === "!" || next === "?" || next === ">") { index = findTagEnd(content, lt + 2) + 1; continue; }
    if (next === "/") {
      let cursor = lt + 2;
      while (/\s/.test(content[cursor] ?? "")) cursor += 1;
      const nameStart = cursor;
      while (isNameChar(content[cursor] ?? "")) cursor += 1;
      const tagName = content.slice(nameStart, cursor);
      const end = findTagEnd(content, cursor);
      let matchIndex = stack.length - 1;
      while (matchIndex >= 0 && stack[matchIndex].tagName.toLowerCase() !== tagName.toLowerCase()) matchIndex -= 1;
      if (matchIndex >= 0) {
        const node = stack[matchIndex];
        node.endTagStart = lt;
        node.end = end + 1;
        stack.splice(matchIndex);
      }
      index = end + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(next)) { index = lt + 1; continue; }

    let cursor = lt + 1;
    const nameStart = cursor;
    while (isNameChar(content[cursor] ?? "")) cursor += 1;
    const tagName = content.slice(nameStart, cursor);
    if (!validMarkupTag(tagName, kind)) { index = lt + 1; continue; }
    const end = findTagEnd(content, cursor);
    const selfClosing = /\/\s*>$/.test(content.slice(lt, end + 1)) || (kind !== "react" && VOID_TAGS.has(tagName.toLowerCase()));
    const node: FrameworkNode = {
      sourceId: frameworkSourceId(path, content, lt), path, start: lt, startTagEnd: end + 1,
      endTagStart: null, end: end + 1, tagName, selfClosing, parentId: stack.at(-1)?.sourceId ?? null,
    };
    nodes.push(node);

    if (!selfClosing && RAW_TAGS.has(tagName.toLowerCase())) {
      const closeStart = content.toLowerCase().indexOf(`</${tagName.toLowerCase()}`, end + 1);
      if (closeStart >= 0) {
        const closeEnd = findTagEnd(content, closeStart + tagName.length + 2);
        node.endTagStart = closeStart;
        node.end = closeEnd + 1;
        index = closeEnd + 1;
      } else index = region.end;
      continue;
    }
    if (!selfClosing) stack.push(node);
    index = end + 1;
  }
  return nodes;
}

function nodeForSourceId(content: string, sourceId: string, kind: FrameworkSourceKind): FrameworkNode | null {
  const source = parseFrameworkSourceId(sourceId);
  if (!source) return null;
  const target = lineColumnToIndex(content, source.line, source.column);
  if (target === null) return null;
  const nodes = parseFrameworkNodes(content, source.path, kind);
  return nodes.find((node) => node.start === target)
    ?? nodes.find((node) => Math.abs(node.start - target) <= 2)
    ?? null;
}

function parseAttributes(content: string, node: FrameworkNode): AttributeSpan[] {
  const spans: AttributeSpan[] = [];
  let cursor = node.start + 1 + node.tagName.length;
  const limit = node.startTagEnd - 1;
  while (cursor < limit) {
    while (/\s/.test(content[cursor] ?? "")) cursor += 1;
    if (cursor >= limit || content[cursor] === "/") break;
    if (content[cursor] === "{") {
      let depth = 1; const start = cursor; cursor += 1;
      while (cursor < limit && depth > 0) { if (content[cursor] === "{") depth += 1; else if (content[cursor] === "}") depth -= 1; cursor += 1; }
      spans.push({ name: content.slice(start, cursor), start, end: cursor, valueStart: null, valueEnd: null, quote: null, expression: true });
      continue;
    }
    const start = cursor;
    while (cursor < limit && !/[\s=/>]/.test(content[cursor])) cursor += 1;
    const name = content.slice(start, cursor);
    if (!name) { cursor += 1; continue; }
    while (/\s/.test(content[cursor] ?? "")) cursor += 1;
    let valueStart: number | null = null;
    let valueEnd: number | null = null;
    let quote: string | null = null;
    let expression = false;
    if (content[cursor] === "=") {
      cursor += 1;
      while (/\s/.test(content[cursor] ?? "")) cursor += 1;
      if (content[cursor] === '"' || content[cursor] === "'") {
        quote = content[cursor]; cursor += 1; valueStart = cursor;
        while (cursor < limit && content[cursor] !== quote) { if (content[cursor] === "\\") cursor += 1; cursor += 1; }
        valueEnd = cursor;
        if (content[cursor] === quote) cursor += 1;
      } else if (content[cursor] === "{") {
        expression = true; const valueStartBrace = cursor; let depth = 1; cursor += 1;
        let nestedQuote = "";
        while (cursor < limit && depth > 0) {
          const char = content[cursor];
          if (nestedQuote) { if (char === "\\") cursor += 1; else if (char === nestedQuote) nestedQuote = ""; cursor += 1; continue; }
          if (char === '"' || char === "'" || char === "`") { nestedQuote = char; cursor += 1; continue; }
          if (char === "{") depth += 1; else if (char === "}") depth -= 1;
          cursor += 1;
        }
        valueStart = valueStartBrace; valueEnd = cursor;
      } else {
        valueStart = cursor;
        while (cursor < limit && !/[\s>]/.test(content[cursor])) cursor += 1;
        valueEnd = cursor;
      }
    }
    spans.push({ name, start, end: cursor, valueStart, valueEnd, quote, expression });
  }
  return spans;
}

function reactAttributeName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith("aria-") || lower.startsWith("data-")) return lower;
  return REACT_ATTRIBUTE_NAMES[lower] ?? name;
}

function sourceAttributeName(kind: FrameworkSourceKind, name: string): string {
  return kind === "react" ? reactAttributeName(name) : name;
}

function escapeAttribute(value: string, quote: string): string {
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return quote === "'" ? escaped.replace(/'/g, "&#39;") : escaped.replace(/"/g, "&quot;");
}

function removeAttributeRange(content: string, span: AttributeSpan): string {
  let start = span.start;
  while (start > 0 && (content[start - 1] === " " || content[start - 1] === "\t")) start -= 1;
  return `${content.slice(0, start)}${content.slice(span.end)}`;
}

export function setFrameworkAttribute(content: string, sourceId: string, kind: FrameworkSourceKind, name: string, value: string | null): HtmlSourcePatch | null {
  const node = nodeForSourceId(content, sourceId, kind);
  const normalized = name.trim();
  if (!node || !normalized || normalized.startsWith("data-webforge-")) return null;
  const authoredName = sourceAttributeName(kind, normalized);
  const candidates = new Set([normalized.toLowerCase(), authoredName.toLowerCase()]);
  const attributes = parseAttributes(content, node);
  const existing = attributes.find((attribute) => candidates.has(attribute.name.toLowerCase()));
  const lowerName = normalized.toLowerCase();
  if (!existing && kind === "vue" && lowerName !== "class" && lowerName !== "style") {
    const bound = attributes.some((attribute) => {
      const attributeName = attribute.name.toLowerCase();
      return attributeName === `:${lowerName}` || attributeName === `v-bind:${lowerName}`;
    });
    if (bound) return null;
  }
  if (!existing && kind === "svelte" && lowerName !== "class" && lowerName !== "style") {
    if (attributes.some((attribute) => attribute.name.toLowerCase() === `bind:${lowerName}`)) return null;
  }
  let after = content;
  if (value === null || ((normalized.toLowerCase() === "class" || authoredName === "className") && !value.trim())) {
    if (!existing) return null;
    after = removeAttributeRange(content, existing);
  } else if (existing) {
    if (existing.expression) return null;
    const quote = existing.quote ?? '"';
    after = `${content.slice(0, existing.start)}${authoredName}=${quote}${escapeAttribute(value, quote)}${quote}${content.slice(existing.end)}`;
  } else {
    const close = content.slice(node.start, node.startTagEnd).match(/\/\s*>$/);
    const insertAt = node.startTagEnd - (close ? close[0].length : 1);
    after = `${content.slice(0, insertAt)} ${authoredName}="${escapeAttribute(value, '"')}"${content.slice(insertAt)}`;
  }
  if (after === content) return null;
  return { before: content, after, label: value === null ? `Remove ${authoredName}` : `Set ${authoredName}`, selectedSourceId: frameworkSourceId(node.path, after, node.start) };
}

export function setFrameworkClasses(content: string, sourceId: string, kind: FrameworkSourceKind, classes: string[]): HtmlSourcePatch | null {
  return setFrameworkAttribute(content, sourceId, kind, "class", classes.join(" "));
}

export function setFrameworkText(content: string, sourceId: string, kind: FrameworkSourceKind, value: string): HtmlSourcePatch | null {
  const node = nodeForSourceId(content, sourceId, kind);
  if (!node || node.selfClosing || node.endTagStart === null) return null;
  const current = content.slice(node.startTagEnd, node.endTagStart);
  if (/[<{]/.test(current) || current.includes("{{")) return null;
  const leading = current.match(/^\s*/)?.[0] ?? "";
  const trailing = current.match(/\s*$/)?.[0] ?? "";
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(kind === "react" ? /{/g : /$^/, "&#123;");
  const after = `${content.slice(0, node.startTagEnd)}${leading}${escaped}${trailing}${content.slice(node.endTagStart)}`;
  if (after === content) return null;
  return { before: content, after, label: `Edit <${node.tagName}> text`, selectedSourceId: frameworkSourceId(node.path, after, node.start) };
}

function lineStart(content: string, index: number): number { const newline = content.lastIndexOf("\n", Math.max(0, index - 1)); return newline < 0 ? 0 : newline + 1; }
function lineEnd(content: string, index: number): number { const newline = content.indexOf("\n", index); return newline < 0 ? content.length : newline + 1; }
function whitespaceOnly(value: string): boolean { return /^[\t ]*$/.test(value); }
function indentationAt(content: string, index: number): string { return content.slice(lineStart(content, index), index).match(/^[\t ]*/)?.[0] ?? ""; }

function standaloneRange(content: string, node: FrameworkNode): { start: number; end: number } {
  const start = lineStart(content, node.start); const end = lineEnd(content, node.end);
  const prefix = content.slice(start, node.start); const suffix = content.slice(node.end, end).replace(/\r?\n$/, "");
  return whitespaceOnly(prefix) && whitespaceOnly(suffix) ? { start, end } : { start: node.start, end: node.end };
}

function reindentFragment(fragment: string, indent: string): string {
  const trimmed = fragment.replace(/^\s*\r?\n/, "").replace(/\r?\n\s*$/, "");
  const lines = trimmed.split(/\r?\n/); const nonEmpty = lines.filter((line) => line.trim());
  const common = nonEmpty.length ? Math.min(...nonEmpty.map((line) => line.match(/^[\t ]*/)?.[0].length ?? 0)) : 0;
  return lines.map((line) => line.trim() ? `${indent}${line.slice(common)}` : "").join("\n");
}

function insertionPoint(content: string, target: FrameworkNode, position: HtmlInsertPosition): { index: number; indent: string } | null {
  const indent = indentationAt(content, target.start);
  if (position === "inside") {
    if (target.selfClosing || target.endTagStart === null) return null;
    const closingLine = lineStart(content, target.endTagStart);
    const index = whitespaceOnly(content.slice(closingLine, target.endTagStart)) ? closingLine : target.endTagStart;
    return { index, indent: `${indent}  ` };
  }
  return { index: position === "before" ? target.start : target.end, indent };
}

function adaptSnippetForReact(snippet: string): string {
  let result = snippet.replace(/\bclass=/g, "className=").replace(/\bfor=/g, "htmlFor=");
  for (const tag of VOID_TAGS) {
    const expression = new RegExp(`<${tag}([^<>]*?)(?<!/)>(?!\\s*</${tag}>)`, "gi");
    result = result.replace(expression, `<${tag}$1 />`);
  }
  return result;
}


function previousSignificant(content: string, index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) if (!/\s/.test(content[cursor])) return content[cursor];
  return "";
}

function nextSignificant(content: string, index: number): string {
  for (let cursor = index; cursor < content.length; cursor += 1) if (!/\s/.test(content[cursor])) return content[cursor];
  return "";
}

function safeSiblingBoundary(content: string, node: FrameworkNode): boolean {
  const before = previousSignificant(content, node.start);
  const after = nextSignificant(content, node.end);
  return before === ">" && (after === "<" || after === "");
}

export function frameworkStructuralEditable(files: Record<string, string>, sourceId: string, kind: FrameworkSourceKind): boolean {
  const source = parseFrameworkSourceId(sourceId);
  if (!source) return false;
  const content = files[source.path];
  if (content === undefined) return false;
  const node = nodeForSourceId(content, sourceId, kind);
  return Boolean(node && safeSiblingBoundary(content, node));
}

export function deleteFrameworkNode(content: string, sourceId: string, kind: FrameworkSourceKind): HtmlSourcePatch | null {
  const node = nodeForSourceId(content, sourceId, kind);
  if (!node || !safeSiblingBoundary(content, node)) return null;
  const range = standaloneRange(content, node);
  const after = `${content.slice(0, range.start)}${content.slice(range.end)}`;
  return after === content ? null : { before: content, after, label: `Delete <${node.tagName}>`, selectedSourceId: node.parentId };
}

export function duplicateFrameworkNode(content: string, sourceId: string, kind: FrameworkSourceKind): HtmlSourcePatch | null {
  const node = nodeForSourceId(content, sourceId, kind);
  if (!node || !safeSiblingBoundary(content, node)) return null;
  const range = standaloneRange(content, node); const fragment = content.slice(range.start, range.end);
  const after = `${content.slice(0, range.end)}${fragment}${content.slice(range.end)}`;
  const duplicateStart = range.end + Math.max(0, node.start - range.start);
  return { before: content, after, label: `Duplicate <${node.tagName}>`, selectedSourceId: frameworkSourceId(node.path, after, duplicateStart) };
}

export function moveFrameworkNode(content: string, sourceId: string, targetSourceId: string, kind: FrameworkSourceKind, position: HtmlInsertPosition): HtmlSourcePatch | null {
  const sourceMeta = parseFrameworkSourceId(sourceId); const targetMeta = parseFrameworkSourceId(targetSourceId);
  if (!sourceMeta || !targetMeta || sourceMeta.path !== targetMeta.path) return null;
  const source = nodeForSourceId(content, sourceId, kind); const target = nodeForSourceId(content, targetSourceId, kind);
  if (!source || !target || !safeSiblingBoundary(content, source) || source.start === target.start || (target.start >= source.start && target.end <= source.end)) return null;
  if (position !== "inside" && !safeSiblingBoundary(content, target)) return null;
  const point = insertionPoint(content, target, position); if (!point) return null;
  const range = standaloneRange(content, source); const fragment = reindentFragment(content.slice(source.start, source.end), point.indent);
  const without = `${content.slice(0, range.start)}${content.slice(range.end)}`;
  let insertAt = point.index >= range.end ? point.index - (range.end - range.start) : point.index;
  const prefix = insertAt > 0 && without[insertAt - 1] !== "\n" ? "\n" : "";
  const suffix = insertAt < without.length && without[insertAt] !== "\n" ? "\n" : "";
  const insertion = `${prefix}${fragment}${suffix}`;
  const after = `${without.slice(0, insertAt)}${insertion}${without.slice(insertAt)}`;
  const selectedStart = insertAt + prefix.length + Math.max(0, fragment.indexOf("<"));
  return { before: content, after, label: `Move <${source.tagName}>`, selectedSourceId: frameworkSourceId(source.path, after, selectedStart) };
}

export function insertFrameworkSnippet(content: string, targetSourceId: string, kind: FrameworkSourceKind, position: HtmlInsertPosition, snippet: string, label: string): HtmlSourcePatch | null {
  const target = nodeForSourceId(content, targetSourceId, kind); if (!target) return null;
  if (position !== "inside" && !safeSiblingBoundary(content, target)) return null;
  const point = insertionPoint(content, target, position); if (!point) return null;
  const authoredSnippet = kind === "react" ? adaptSnippetForReact(snippet) : snippet;
  const fragment = reindentFragment(authoredSnippet, point.indent);
  const prefix = point.index > 0 && content[point.index - 1] !== "\n" ? "\n" : "";
  const suffix = point.index < content.length && content[point.index] !== "\n" ? "\n" : "";
  const insertion = `${prefix}${fragment}${suffix}`;
  const after = `${content.slice(0, point.index)}${insertion}${content.slice(point.index)}`;
  const selectedStart = point.index + prefix.length + Math.max(0, fragment.indexOf("<"));
  return { before: content, after, label, selectedSourceId: frameworkSourceId(target.path, after, selectedStart) };
}

export function frameworkSourceEditable(files: Record<string, string>, sourceId: string, kind: FrameworkSourceKind): boolean {
  const source = parseFrameworkSourceId(sourceId);
  if (!source) return false;
  const content = files[source.path];
  return content !== undefined && nodeForSourceId(content, sourceId, kind) !== null;
}

export function frameworkTextEditable(files: Record<string, string>, sourceId: string, kind: FrameworkSourceKind): boolean {
  const source = parseFrameworkSourceId(sourceId);
  if (!source) return false;
  const content = files[source.path];
  if (content === undefined) return false;
  const node = nodeForSourceId(content, sourceId, kind);
  if (!node || node.selfClosing || node.endTagStart === null) return false;
  const current = content.slice(node.startTagEnd, node.endTagStart);
  return !/[<{]/.test(current) && !current.includes("{{");
}


function staticAttributeValue(content: string, node: FrameworkNode, kind: FrameworkSourceKind, name: string): string | null {
  const authored = sourceAttributeName(kind, name);
  const candidates = new Set([name.toLowerCase(), authored.toLowerCase()]);
  const span = parseAttributes(content, node).find((entry) => candidates.has(entry.name.toLowerCase()));
  if (!span || span.expression || span.valueStart === null || span.valueEnd === null) return null;
  return content.slice(span.valueStart, span.valueEnd);
}

function staticDirectText(content: string, node: FrameworkNode): string {
  if (node.selfClosing || node.endTagStart === null) return "";
  const inner = content.slice(node.startTagEnd, node.endTagStart);
  if (/[<{]/.test(inner) || inner.includes("{{")) return "";
  return inner.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function resolveFrameworkSelection(
  files: Record<string, string>,
  selection: InspectorSelection,
  kind: FrameworkSourceKind,
): { sourceId: string; path: string; line: number; column: number; origin: string } | null {
  const direct = parseFrameworkSourceId(selection.sourceId);
  if (direct && files[direct.path] !== undefined && nodeForSourceId(files[direct.path], selection.sourceId, kind)) {
    return { sourceId: selection.sourceId, path: direct.path, line: direct.line, column: direct.column, origin: selection.sourceOrigin || "framework-source-id" };
  }

  const path = selection.sourcePath?.replace(/\\/g, "/").replace(/^\/+/, "") || direct?.path;
  if (!path) return null;
  const content = files[path];
  if (content === undefined) return null;
  const candidates = parseFrameworkNodes(content, path, kind).filter((node) => node.tagName.toLowerCase() === selection.tagName.toLowerCase());
  if (!candidates.length) return null;

  const wantedText = selection.text.replace(/\s+/g, " ").trim().slice(0, 180);
  const scored = candidates.map((node) => {
    let score = 0;
    const id = staticAttributeValue(content, node, kind, "id");
    if (selection.id) score += id === selection.id ? 12 : -8;
    const classes = (staticAttributeValue(content, node, kind, "class") || "").split(/\s+/).filter(Boolean);
    if (selection.classes.length) {
      const matched = selection.classes.filter((entry) => classes.includes(entry)).length;
      score += matched * 2;
      if (matched === selection.classes.length) score += 3;
    }
    const text = staticDirectText(content, node);
    if (wantedText && text) {
      if (text === wantedText) score += 8;
      else if (text.includes(wantedText) || wantedText.includes(text)) score += 4;
    }
    const location = indexToLineColumn(content, node.start);
    if ((selection.sourceLine ?? 0) > 1) {
      const distance = Math.abs(location.line - (selection.sourceLine ?? 1));
      score += distance === 0 ? 8 : distance <= 2 ? 5 : distance <= 5 ? 2 : 0;
    }
    return { node, score, location };
  }).sort((a, b) => b.score - a.score || a.node.start - b.node.start);

  const best = scored[0];
  const second = scored[1];
  const hasIdentity = Boolean(selection.id || selection.classes.length || wantedText || (selection.sourceLine ?? 0) > 1);
  if (!best || (hasIdentity ? best.score < 3 : candidates.length !== 1)) return null;
  if (second && best.score === second.score) return null;
  if (second && best.score - second.score < 2 && best.score < 8) return null;
  return {
    sourceId: frameworkSourceId(path, content, best.node.start),
    path,
    line: best.location.line,
    column: best.location.column,
    origin: "framework-source-resolver",
  };
}
