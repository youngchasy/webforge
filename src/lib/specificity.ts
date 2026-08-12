export type CssSpecificity = [number, number, number];

function splitTopLevel(value: string, delimiter = ","): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote = "";
  let paren = 0;
  let bracket = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(") paren += 1;
    else if (char === ")" && paren > 0) paren -= 1;
    else if (char === "[") bracket += 1;
    else if (char === "]" && bracket > 0) bracket -= 1;
    else if (char === delimiter && paren === 0 && bracket === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function compareSpecificity(a: CssSpecificity, b: CssSpecificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function maxSpecificity(values: CssSpecificity[]): CssSpecificity {
  return values.reduce((best, current) => compareSpecificity(current, best) > 0 ? current : best, [0, 0, 0] as CssSpecificity);
}

function consumeFunctionalPseudo(selector: string, start: number): { end: number; name: string; body: string } | null {
  const nameMatch = /^:([\w-]+)\(/.exec(selector.slice(start));
  if (!nameMatch) return null;
  const name = nameMatch[1].toLowerCase();
  const bodyStart = start + nameMatch[0].length;
  let depth = 1;
  let quote = "";
  for (let index = bodyStart; index < selector.length; index += 1) {
    const char = selector[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return { end: index + 1, name, body: selector.slice(bodyStart, index) };
    }
  }
  return null;
}

export function calculateSpecificity(selector: string): CssSpecificity {
  let ids = 0;
  let classes = 0;
  let types = 0;
  let index = 0;
  const text = selector.replace(/\/\*[\s\S]*?\*\//g, "");

  while (index < text.length) {
    const char = text[index];
    if (/\s|[>+~,*]/.test(char)) { index += 1; continue; }
    if (char === "#") {
      const match = /^#[\w-]+/.exec(text.slice(index));
      if (match) { ids += 1; index += match[0].length; continue; }
    }
    if (char === ".") {
      const match = /^\.[\w-]+/.exec(text.slice(index));
      if (match) { classes += 1; index += match[0].length; continue; }
    }
    if (char === "[") {
      let end = index + 1;
      let quote = "";
      while (end < text.length) {
        const current = text[end];
        if (quote) {
          if (current === "\\") end += 2;
          else { if (current === quote) quote = ""; end += 1; }
          continue;
        }
        if (current === '"' || current === "'") { quote = current; end += 1; continue; }
        if (current === "]") { end += 1; break; }
        end += 1;
      }
      classes += 1;
      index = end;
      continue;
    }
    if (char === ":") {
      if (text[index + 1] === ":") {
        const match = /^::[\w-]+/.exec(text.slice(index));
        types += 1;
        index += match?.[0].length ?? 2;
        continue;
      }
      const functional = consumeFunctionalPseudo(text, index);
      if (functional) {
        if (functional.name === "where") {
          index = functional.end;
          continue;
        }
        if (["is", "not", "has"].includes(functional.name)) {
          const nested = maxSpecificity(splitTopLevel(functional.body).map(calculateSpecificity));
          ids += nested[0]; classes += nested[1]; types += nested[2];
          index = functional.end;
          continue;
        }
        classes += 1;
        index = functional.end;
        continue;
      }
      const match = /^:[\w-]+/.exec(text.slice(index));
      if (match) { classes += 1; index += match[0].length; continue; }
    }
    const typeMatch = /^(?:[a-zA-Z][\w-]*|\|[a-zA-Z][\w-]*|[a-zA-Z][\w-]*\|[a-zA-Z][\w-]*)/.exec(text.slice(index));
    if (typeMatch) { types += 1; index += typeMatch[0].length; continue; }
    index += 1;
  }
  return [ids, classes, types];
}

export function specificityLabel(value: CssSpecificity): string {
  return value.join("·");
}

export function compareCssSpecificity(a: CssSpecificity, b: CssSpecificity): number {
  return compareSpecificity(a, b);
}

export function strongestSpecificity(selectorText: string): CssSpecificity {
  return maxSpecificity(splitTopLevel(selectorText).map(calculateSpecificity));
}
