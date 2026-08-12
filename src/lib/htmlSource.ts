export type HtmlInsertPosition = "before" | "inside" | "after";

export type HtmlSourceNode = {
  sourceId: string;
  start: number;
  startTagEnd: number;
  endTagStart: number | null;
  end: number;
  tagName: string;
  selfClosing: boolean;
  parentId: string | null;
};

export type HtmlSourcePatch = {
  before: string;
  after: string;
  label: string;
  selectedSourceId?: string | null;
};

type AttributeSpan = {
  name: string;
  start: number;
  end: number;
  valueStart: number | null;
  valueEnd: number | null;
  quote: string | null;
};

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
]);
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);
const PROTECTED_TAGS = new Set(["html", "head", "body"]);

export const componentPalette = [
  { id: "section", label: "Section", category: "Layout", snippet: `<section class="section">\n  <div class="container">\n    <h2>Section title</h2>\n    <p>Start writing your content here.</p>\n  </div>\n</section>` },
  { id: "container", label: "Container", category: "Layout", snippet: `<div class="container">\n  <p>Container content</p>\n</div>` },
  { id: "grid", label: "Grid", category: "Layout", snippet: `<div class="grid">\n  <div>Column 1</div>\n  <div>Column 2</div>\n</div>` },
  { id: "heading", label: "Heading", category: "Content", snippet: `<h2>Heading</h2>` },
  { id: "paragraph", label: "Paragraph", category: "Content", snippet: `<p>Paragraph text</p>` },
  { id: "button", label: "Button", category: "Content", snippet: `<button type="button" class="button">Button</button>` },
  { id: "image", label: "Image", category: "Media", snippet: `<img src="images/placeholder.jpg" alt="Description">` },
  { id: "card", label: "Card", category: "Components", snippet: `<article class="card">\n  <h3>Card title</h3>\n  <p>Card description.</p>\n  <a href="#">Learn more</a>\n</article>` },
  { id: "nav", label: "Navigation", category: "Components", snippet: `<nav class="nav" aria-label="Primary navigation">\n  <a href="#">Home</a>\n  <a href="#">About</a>\n  <a href="#">Contact</a>\n</nav>` },
  { id: "form", label: "Form", category: "Forms", snippet: `<form class="form">\n  <label>\n    Name\n    <input type="text" name="name">\n  </label>\n  <button type="submit">Submit</button>\n</form>` },
] as const;

function isNameChar(char: string): boolean {
  return /[A-Za-z0-9:_-]/.test(char);
}

function findTagEnd(content: string, start: number): number {
  let quote = "";
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === ">") return index;
  }
  return content.length - 1;
}

function utf8LengthForCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

export function sourceIdToIndex(content: string, sourceId: string): number | null {
  const match = /^b(\d+)$/.exec(sourceId);
  if (!match) return null;
  const targetBytes = Number(match[1]);
  if (!Number.isSafeInteger(targetBytes) || targetBytes < 0) return null;
  let bytes = 0;
  for (let index = 0; index < content.length;) {
    if (bytes === targetBytes) return index;
    const codePoint = content.codePointAt(index);
    if (codePoint === undefined) break;
    bytes += utf8LengthForCodePoint(codePoint);
    index += codePoint > 0xffff ? 2 : 1;
    if (bytes > targetBytes) return null;
  }
  return bytes === targetBytes ? content.length : null;
}

export function indexToSourceId(content: string, index: number): string {
  const safeIndex = Math.max(0, Math.min(content.length, index));
  let bytes = 0;
  for (let cursor = 0; cursor < safeIndex;) {
    const codePoint = content.codePointAt(cursor);
    if (codePoint === undefined) break;
    bytes += utf8LengthForCodePoint(codePoint);
    cursor += codePoint > 0xffff ? 2 : 1;
  }
  return `b${bytes}`;
}

export function parseHtmlSource(content: string): HtmlSourceNode[] {
  const nodes: HtmlSourceNode[] = [];
  const stack: HtmlSourceNode[] = [];
  const lower = content.toLowerCase();
  let index = 0;

  while (index < content.length) {
    const lt = content.indexOf("<", index);
    if (lt < 0) break;
    if (content.startsWith("<!--", lt)) {
      const end = content.indexOf("-->", lt + 4);
      index = end < 0 ? content.length : end + 3;
      continue;
    }
    if (content.startsWith("<![CDATA[", lt)) {
      const end = content.indexOf("]]>", lt + 9);
      index = end < 0 ? content.length : end + 3;
      continue;
    }
    const next = content[lt + 1] ?? "";
    if (next === "!" || next === "?") {
      const end = findTagEnd(content, lt + 2);
      index = end + 1;
      continue;
    }
    if (next === "/") {
      let cursor = lt + 2;
      while (/\s/.test(content[cursor] ?? "")) cursor += 1;
      const nameStart = cursor;
      while (isNameChar(content[cursor] ?? "")) cursor += 1;
      const tagName = content.slice(nameStart, cursor).toLowerCase();
      const end = findTagEnd(content, cursor);
      let matchIndex = stack.length - 1;
      while (matchIndex >= 0 && stack[matchIndex].tagName !== tagName) matchIndex -= 1;
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
    const tagName = content.slice(nameStart, cursor).toLowerCase();
    const end = findTagEnd(content, cursor);
    const tail = content.slice(Math.max(cursor, end - 2), end + 1);
    const selfClosing = /\/\s*>$/.test(tail) || VOID_TAGS.has(tagName);
    const node: HtmlSourceNode = {
      sourceId: indexToSourceId(content, lt),
      start: lt,
      startTagEnd: end + 1,
      endTagStart: null,
      end: end + 1,
      tagName,
      selfClosing,
      parentId: stack.at(-1)?.sourceId ?? null,
    };
    nodes.push(node);

    if (!selfClosing && RAW_TEXT_TAGS.has(tagName)) {
      const closeStart = lower.indexOf(`</${tagName}`, end + 1);
      if (closeStart >= 0) {
        const closeEnd = findTagEnd(content, closeStart + tagName.length + 2);
        node.endTagStart = closeStart;
        node.end = closeEnd + 1;
        index = closeEnd + 1;
      } else {
        node.end = content.length;
        index = content.length;
      }
      continue;
    }

    if (!selfClosing) stack.push(node);
    index = end + 1;
  }

  for (const node of stack) node.end = content.length;
  return nodes;
}

export function nodeForSourceId(content: string, sourceId: string): HtmlSourceNode | null {
  const start = sourceIdToIndex(content, sourceId);
  if (start === null) return null;
  return parseHtmlSource(content).find((node) => node.start === start) ?? null;
}

function parseAttributes(content: string, node: HtmlSourceNode): AttributeSpan[] {
  const spans: AttributeSpan[] = [];
  let cursor = node.start + 1 + node.tagName.length;
  const limit = node.startTagEnd - 1;
  while (cursor < limit) {
    while (/\s/.test(content[cursor] ?? "")) cursor += 1;
    if (cursor >= limit || content[cursor] === "/") break;
    const start = cursor;
    while (cursor < limit && !/[\s=/>]/.test(content[cursor])) cursor += 1;
    const name = content.slice(start, cursor);
    if (!name) { cursor += 1; continue; }
    while (/\s/.test(content[cursor] ?? "")) cursor += 1;
    let valueStart: number | null = null;
    let valueEnd: number | null = null;
    let quote: string | null = null;
    if (content[cursor] === "=") {
      cursor += 1;
      while (/\s/.test(content[cursor] ?? "")) cursor += 1;
      if (content[cursor] === '"' || content[cursor] === "'") {
        quote = content[cursor]; cursor += 1; valueStart = cursor;
        while (cursor < limit && content[cursor] !== quote) cursor += 1;
        valueEnd = cursor;
        if (content[cursor] === quote) cursor += 1;
      } else {
        valueStart = cursor;
        while (cursor < limit && !/[\s>]/.test(content[cursor])) cursor += 1;
        valueEnd = cursor;
      }
    }
    spans.push({ name, start, end: cursor, valueStart, valueEnd, quote });
  }
  return spans;
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

export function setHtmlAttribute(content: string, sourceId: string, name: string, value: string | null): HtmlSourcePatch | null {
  const node = nodeForSourceId(content, sourceId);
  if (!node || !name.trim() || name.startsWith("data-webforge-")) return null;
  const normalizedName = name.trim();
  const attributes = parseAttributes(content, node);
  const existing = attributes.find((attribute) => attribute.name.toLowerCase() === normalizedName.toLowerCase());
  let after = content;
  if (value === null || (normalizedName.toLowerCase() === "class" && !value.trim())) {
    if (!existing) return null;
    after = removeAttributeRange(content, existing);
  } else if (existing) {
    const quote = existing.quote ?? '"';
    const replacement = `${normalizedName}=${quote}${escapeAttribute(value, quote)}${quote}`;
    after = `${content.slice(0, existing.start)}${replacement}${content.slice(existing.end)}`;
  } else {
    const insertAt = node.startTagEnd - (content.slice(node.start, node.startTagEnd).match(/\/\s*>$/) ? 2 : 1);
    const replacement = ` ${normalizedName}="${escapeAttribute(value, '"')}"`;
    after = `${content.slice(0, insertAt)}${replacement}${content.slice(insertAt)}`;
  }
  if (after === content) return null;
  return { before: content, after, label: value === null ? `Remove attribute ${normalizedName}` : `Set attribute ${normalizedName}` };
}

function parseStyleDeclarations(value: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const declaration of value.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon <= 0) continue;
    const name = declaration.slice(0, colon).trim();
    const declarationValue = declaration.slice(colon + 1).trim();
    if (name) result.set(name, declarationValue);
  }
  return result;
}

export function setHtmlInlineStyle(content: string, sourceId: string, property: string, value: string): HtmlSourcePatch | null {
  const node = nodeForSourceId(content, sourceId);
  if (!node) return null;
  const styleAttribute = parseAttributes(content, node).find((attribute) => attribute.name.toLowerCase() === "style");
  const current = styleAttribute?.valueStart !== null && styleAttribute?.valueStart !== undefined && styleAttribute.valueEnd !== null
    ? content.slice(styleAttribute.valueStart, styleAttribute.valueEnd)
    : "";
  const declarations = parseStyleDeclarations(current);
  if (value.trim()) declarations.set(property, value.trim()); else declarations.delete(property);
  const nextValue = [...declarations].map(([name, declarationValue]) => `${name}: ${declarationValue}`).join("; ");
  return setHtmlAttribute(content, sourceId, "style", nextValue || null);
}

function lineStart(content: string, index: number): number {
  const newline = content.lastIndexOf("\n", Math.max(0, index - 1));
  return newline < 0 ? 0 : newline + 1;
}

function lineEnd(content: string, index: number): number {
  const newline = content.indexOf("\n", index);
  return newline < 0 ? content.length : newline + 1;
}

function whitespaceOnly(value: string): boolean {
  return /^[\t ]*$/.test(value);
}

function standaloneRange(content: string, node: HtmlSourceNode): { start: number; end: number } {
  const start = lineStart(content, node.start);
  const end = lineEnd(content, node.end);
  const prefix = content.slice(start, node.start);
  const suffix = content.slice(node.end, end).replace(/\r?\n$/, "");
  if (whitespaceOnly(prefix) && whitespaceOnly(suffix)) return { start, end };
  return { start: node.start, end: node.end };
}

function indentationAt(content: string, index: number): string {
  const start = lineStart(content, index);
  return content.slice(start, index).match(/^[\t ]*/)?.[0] ?? "";
}

function reindentFragment(fragment: string, indent: string): string {
  const trimmed = fragment.replace(/^\s*\r?\n/, "").replace(/\r?\n\s*$/, "");
  const lines = trimmed.split(/\r?\n/);
  const nonEmpty = lines.filter((line) => line.trim());
  const common = nonEmpty.length ? Math.min(...nonEmpty.map((line) => line.match(/^[\t ]*/)?.[0].length ?? 0)) : 0;
  return lines.map((line) => line.trim() ? `${indent}${line.slice(common)}` : "").join("\n");
}

function adjustedIndex(index: number, removedStart: number, removedEnd: number): number {
  return index >= removedEnd ? index - (removedEnd - removedStart) : index;
}

function insertionBoundary(content: string, index: number, position: "before" | "after"): number {
  if (position === "before") {
    const start = lineStart(content, index);
    return whitespaceOnly(content.slice(start, index)) ? start : index;
  }
  const end = lineEnd(content, index);
  const suffix = content.slice(index, end).replace(/\r?\n$/, "");
  return whitespaceOnly(suffix) ? end : index;
}

function insertPoint(content: string, target: HtmlSourceNode, position: HtmlInsertPosition): { index: number; indent: string; block: boolean } | null {
  const targetIndent = indentationAt(content, target.start);
  if (position === "inside") {
    if (target.selfClosing || VOID_TAGS.has(target.tagName)) return null;
    const closingIndex = target.endTagStart ?? target.startTagEnd;
    const closingLineStart = lineStart(content, closingIndex);
    const index = whitespaceOnly(content.slice(closingLineStart, closingIndex)) ? closingLineStart : closingIndex;
    return { index, indent: `${targetIndent}  `, block: true };
  }
  if (PROTECTED_TAGS.has(target.tagName)) return null;
  if (position === "before") return { index: target.start, indent: targetIndent, block: true };
  return { index: target.end, indent: targetIndent, block: true };
}

export function deleteHtmlNode(content: string, sourceId: string): HtmlSourcePatch | null {
  const node = nodeForSourceId(content, sourceId);
  if (!node || PROTECTED_TAGS.has(node.tagName)) return null;
  const range = standaloneRange(content, node);
  const after = `${content.slice(0, range.start)}${content.slice(range.end)}`;
  return after === content ? null : { before: content, after, label: `Delete <${node.tagName}>`, selectedSourceId: node.parentId };
}

export function duplicateHtmlNode(content: string, sourceId: string): HtmlSourcePatch | null {
  const node = nodeForSourceId(content, sourceId);
  if (!node || PROTECTED_TAGS.has(node.tagName)) return null;
  const range = standaloneRange(content, node);
  const fragment = content.slice(range.start, range.end);
  const after = `${content.slice(0, range.end)}${fragment}${content.slice(range.end)}`;
  const duplicateStart = range.end + Math.max(0, node.start - range.start);
  return { before: content, after, label: `Duplicate <${node.tagName}>`, selectedSourceId: indexToSourceId(after, duplicateStart) };
}

export function moveHtmlNode(content: string, sourceId: string, targetSourceId: string, position: HtmlInsertPosition): HtmlSourcePatch | null {
  const source = nodeForSourceId(content, sourceId);
  const target = nodeForSourceId(content, targetSourceId);
  if (!source || !target || source.sourceId === target.sourceId || PROTECTED_TAGS.has(source.tagName)) return null;
  if (target.start >= source.start && target.end <= source.end) return null;
  const targetPoint = insertPoint(content, target, position);
  if (!targetPoint) return null;

  const sourceRange = standaloneRange(content, source);
  const rawFragment = content.slice(source.start, source.end);
  const fragment = reindentFragment(rawFragment, targetPoint.indent);
  const without = `${content.slice(0, sourceRange.start)}${content.slice(sourceRange.end)}`;
  let insertionIndex = adjustedIndex(targetPoint.index, sourceRange.start, sourceRange.end);
  if (position === "before" || position === "after") insertionIndex = insertionBoundary(without, insertionIndex, position);

  const prefix = insertionIndex > 0 && without[insertionIndex - 1] !== "\n" ? "\n" : "";
  const suffix = insertionIndex < without.length && without[insertionIndex] !== "\n" ? "\n" : "";
  const insertion = `${prefix}${fragment}${suffix}`;
  const after = `${without.slice(0, insertionIndex)}${insertion}${without.slice(insertionIndex)}`;
  const selectedStart = insertionIndex + prefix.length + Math.max(0, fragment.indexOf("<"));
  return { before: content, after, label: `Move <${source.tagName}>`, selectedSourceId: indexToSourceId(after, selectedStart) };
}

export function insertHtmlSnippet(content: string, targetSourceId: string, position: HtmlInsertPosition, snippet: string, label: string): HtmlSourcePatch | null {
  const target = nodeForSourceId(content, targetSourceId);
  if (!target) return null;
  const point = insertPoint(content, target, position);
  if (!point) return null;
  let insertionIndex = point.index;
  if (position === "before" || position === "after") insertionIndex = insertionBoundary(content, insertionIndex, position);
  const fragment = reindentFragment(snippet, point.indent);
  const prefix = insertionIndex > 0 && content[insertionIndex - 1] !== "\n" ? "\n" : "";
  const suffix = insertionIndex < content.length && content[insertionIndex] !== "\n" ? "\n" : "";
  const insertion = `${prefix}${fragment}${suffix}`;
  const after = `${content.slice(0, insertionIndex)}${insertion}${content.slice(insertionIndex)}`;
  const selectedStart = insertionIndex + prefix.length + Math.max(0, fragment.indexOf("<"));
  return { before: content, after, label, selectedSourceId: indexToSourceId(after, selectedStart) };
}

export function sourceLocation(content: string, sourceId: string): { line: number; column: number } | null {
  const index = sourceIdToIndex(content, sourceId);
  if (index === null) return null;
  const before = content.slice(0, index);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

export function protectedSourceNode(content: string, sourceId: string): boolean {
  const node = nodeForSourceId(content, sourceId);
  return Boolean(node && PROTECTED_TAGS.has(node.tagName));
}
