export type MergeLineKind = "same" | "added" | "removed" | "changed";
export type MergeLine = { line: string; kind: MergeLineKind; number: number };

function lcsPairs(base: string[], next: string[]): Array<[number, number]> {
  if (base.length * next.length > 160_000) return [];
  const rows = Array.from({ length: base.length + 1 }, () => new Uint16Array(next.length + 1));
  for (let i = base.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      rows[i][j] = base[i] === next[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0; let j = 0;
  while (i < base.length && j < next.length) {
    if (base[i] === next[j]) { pairs.push([i, j]); i += 1; j += 1; }
    else if (rows[i + 1][j] >= rows[i][j + 1]) i += 1;
    else j += 1;
  }
  return pairs;
}

export function classifyMergeLines(baseText: string, targetText: string): MergeLine[] {
  const base = baseText.replace(/\r\n/g, "\n").split("\n");
  const target = targetText.replace(/\r\n/g, "\n").split("\n");
  const pairs = lcsPairs(base, target);
  if (!pairs.length && (base.length > 1 || target.length > 1)) {
    return target.map((line, index) => ({ line, number: index + 1, kind: base[index] === line ? "same" : "changed" }));
  }
  const matchedTarget = new Set(pairs.map(([, right]) => right));
  const matchedBase = new Set(pairs.map(([left]) => left));
  return target.map((line, index) => {
    if (matchedTarget.has(index)) return { line, number: index + 1, kind: "same" as const };
    const nearbyBaseChanged = [index - 1, index, index + 1].some((candidate) => candidate >= 0 && candidate < base.length && !matchedBase.has(candidate));
    return { line, number: index + 1, kind: nearbyBaseChanged ? "changed" as const : "added" as const };
  });
}

export function changedLineCount(baseText: string, targetText: string): number {
  return classifyMergeLines(baseText, targetText).filter((line) => line.kind !== "same").length;
}
