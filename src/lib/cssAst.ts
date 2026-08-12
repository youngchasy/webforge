export type CssAtRuleContext = {
  name: string;
  prelude: string;
};

export type CssAstRule = {
  selector: string;
  selectors: string[];
  headerStart: number;
  headerEnd: number;
  bodyStart: number;
  bodyEnd: number;
  end: number;
  declarations: Record<string, string>;
  contexts: CssAtRuleContext[];
};

export type CssAstAtRule = {
  name: string;
  prelude: string;
  headerStart: number;
  headerEnd: number;
  preludeStart: number;
  preludeEnd: number;
  bodyStart: number;
  bodyEnd: number;
  end: number;
  contexts: CssAtRuleContext[];
};

export type CssAstStylesheet = {
  rules: CssAstRule[];
  atRules: CssAstAtRule[];
};

function isWhitespace(value: string): boolean {
  return /\s/.test(value);
}

function skipWhitespaceAndComments(content: string, start: number, end: number): number {
  let index = start;
  while (index < end) {
    if (isWhitespace(content[index])) {
      index += 1;
      continue;
    }
    if (content[index] === "/" && content[index + 1] === "*") {
      const close = content.indexOf("*/", index + 2);
      index = close < 0 ? end : close + 2;
      continue;
    }
    break;
  }
  return index;
}

function scanToBoundary(content: string, start: number, end: number): { index: number; char: "{" | ";" | "}" | "" } {
  let quote: string | null = null;
  let paren = 0;
  let bracket = 0;
  let index = start;
  while (index < end) {
    const char = content[index];
    const next = content[index + 1];
    if (quote) {
      if (char === "\\") index += 2;
      else if (char === quote) { quote = null; index += 1; }
      else index += 1;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; index += 1; continue; }
    if (char === "/" && next === "*") {
      const close = content.indexOf("*/", index + 2);
      index = close < 0 ? end : close + 2;
      continue;
    }
    if (char === "(") paren += 1;
    else if (char === ")" && paren > 0) paren -= 1;
    else if (char === "[") bracket += 1;
    else if (char === "]" && bracket > 0) bracket -= 1;
    else if (paren === 0 && bracket === 0 && (char === "{" || char === ";" || char === "}")) {
      return { index, char: char as "{" | ";" | "}" };
    }
    index += 1;
  }
  return { index: end, char: "" };
}

function matchingBrace(content: string, open: number, end: number): number {
  let depth = 1;
  let quote: string | null = null;
  let index = open + 1;
  while (index < end) {
    const char = content[index];
    const next = content[index + 1];
    if (quote) {
      if (char === "\\") index += 2;
      else if (char === quote) { quote = null; index += 1; }
      else index += 1;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; index += 1; continue; }
    if (char === "/" && next === "*") {
      const close = content.indexOf("*/", index + 2);
      index = close < 0 ? end : close + 2;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return end;
}

function splitSelectors(header: string): string[] {
  const output: string[] = [];
  let start = 0;
  let quote: string | null = null;
  let paren = 0;
  let bracket = 0;
  for (let index = 0; index < header.length; index += 1) {
    const char = header[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(") paren += 1;
    else if (char === ")" && paren > 0) paren -= 1;
    else if (char === "[") bracket += 1;
    else if (char === "]" && bracket > 0) bracket -= 1;
    else if (char === "," && paren === 0 && bracket === 0) {
      output.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }
  output.push(header.slice(start).trim());
  return output.filter(Boolean);
}

export function declarationsFromCssBody(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  let start = 0;
  let quote: string | null = null;
  let paren = 0;
  const flush = (end: number) => {
    const chunk = body.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    start = end + 1;
    if (!chunk || chunk.startsWith("/*")) return;
    let colon = -1;
    let q: string | null = null;
    let p = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index];
      if (q) {
        if (char === "\\") index += 1;
        else if (char === q) q = null;
        continue;
      }
      if (char === '"' || char === "'") { q = char; continue; }
      if (char === "(") p += 1;
      else if (char === ")" && p > 0) p -= 1;
      else if (char === ":" && p === 0) { colon = index; break; }
    }
    if (colon <= 0) return;
    const name = chunk.slice(0, colon).trim();
    const value = chunk.slice(colon + 1).trim();
    if (/^(--[\w-]+|[a-zA-Z_-][\w-]*)$/.test(name)) result[name] = value;
  };
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(") paren += 1;
    else if (char === ")" && paren > 0) paren -= 1;
    else if (char === ";" && paren === 0) flush(index);
  }
  if (start < body.length) flush(body.length);
  return result;
}

function parseAtRuleHeader(header: string, absoluteStart: number): { name: string; prelude: string; preludeStart: number } {
  const match = header.match(/^\s*@([\w-]+)([\s\S]*)$/);
  if (!match) return { name: "unknown", prelude: "", preludeStart: absoluteStart };
  const name = match[1].toLowerCase();
  const atIndex = header.indexOf("@");
  const nameIndex = header.indexOf(match[1], atIndex + 1);
  const rawPreludeStart = nameIndex + match[1].length;
  const leading = header.slice(rawPreludeStart).match(/^\s*/)?.[0].length ?? 0;
  return {
    name,
    prelude: header.slice(rawPreludeStart + leading).trim(),
    preludeStart: absoluteStart + rawPreludeStart + leading,
  };
}

const CONTEXT_AT_RULES = new Set(["media", "supports", "container", "layer", "scope"]);
const RECURSIVE_AT_RULES = new Set(["media", "supports", "container", "layer", "scope", "document", "starting-style"]);

export function parseCssStylesheet(content: string): CssAstStylesheet {
  const rules: CssAstRule[] = [];
  const atRules: CssAstAtRule[] = [];

  const parseRange = (start: number, end: number, contexts: CssAtRuleContext[]) => {
    let cursor = start;
    while (cursor < end) {
      cursor = skipWhitespaceAndComments(content, cursor, end);
      if (cursor >= end || content[cursor] === "}") break;
      const boundary = scanToBoundary(content, cursor, end);
      if (!boundary.char) break;
      if (boundary.char === ";") { cursor = boundary.index + 1; continue; }
      if (boundary.char === "}") break;

      const headerStart = cursor;
      const headerEnd = boundary.index;
      const header = content.slice(headerStart, headerEnd).trim();
      const close = matchingBrace(content, boundary.index, end);
      const bodyStart = boundary.index + 1;
      const bodyEnd = Math.min(close, end);
      if (!header) { cursor = close + 1; continue; }

      if (header.startsWith("@")) {
        const parsed = parseAtRuleHeader(content.slice(headerStart, headerEnd), headerStart);
        const preludeEnd = headerEnd - (content.slice(headerStart, headerEnd).match(/\s*$/)?.[0].length ?? 0);
        const node: CssAstAtRule = {
          name: parsed.name,
          prelude: parsed.prelude,
          headerStart,
          headerEnd,
          preludeStart: parsed.preludeStart,
          preludeEnd,
          bodyStart,
          bodyEnd,
          end: Math.min(close + 1, content.length),
          contexts: [...contexts],
        };
        atRules.push(node);
        const childContexts = CONTEXT_AT_RULES.has(parsed.name)
          ? [...contexts, { name: parsed.name, prelude: parsed.prelude }]
          : contexts;
        if (RECURSIVE_AT_RULES.has(parsed.name)) parseRange(bodyStart, bodyEnd, childContexts);
      } else {
        const selector = content.slice(headerStart, headerEnd).trim();
        rules.push({
          selector,
          selectors: splitSelectors(selector),
          headerStart,
          headerEnd,
          bodyStart,
          bodyEnd,
          end: Math.min(close + 1, content.length),
          declarations: declarationsFromCssBody(content.slice(bodyStart, bodyEnd)),
          contexts: [...contexts],
        });
      }
      cursor = Math.min(close + 1, end);
    }
  };

  parseRange(0, content.length, []);
  return { rules, atRules };
}

export function normalizeCssSelector(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeAtRulePrelude(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*:\s*/g, ":")
    .replace(/\(\s*/g, "(")
    .replace(/\s*\)/g, ")")
    .replace(/\s*,\s*/g, ",")
    .trim();
}

export function contextKey(contexts: CssAtRuleContext[]): string {
  return contexts.map((context) => `@${context.name.toLowerCase()} ${normalizeAtRulePrelude(context.prelude)}`).join(" > ");
}

export function cssLineAt(content: string, index: number): number {
  return content.slice(0, Math.max(0, index)).split("\n").length;
}
