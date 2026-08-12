import { SourceMapConsumer } from "source-map-js";
import type { DebugScript } from "../types/debug";

const MAX_SOURCE_MAP_CHARS = 8 * 1024 * 1024;
const mapCache = new Map<string, Promise<SourceMapConsumer | null>>();

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function normalizePath(value: string): string {
  let path = value.replaceAll("\\", "/");
  try { path = decodeURIComponent(path); } catch { /* keep raw path */ }
  path = path.replace(/^webpack:\/\//, "").replace(/^vite:\/\//, "");
  path = path.replace(/^file:\/\//, "");
  path = path.replace(/^\/@fs\//, "/");
  path = path.replace(/^\/+/, "");
  while (path.startsWith("../")) path = path.slice(3);
  return path;
}

function sourceMatches(source: string | null, relativePath: string): boolean {
  if (!source) return false;
  const left = normalizePath(source);
  const right = normalizePath(relativePath);
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

async function fetchText(url: string): Promise<string | null> {
  if (!isLoopbackUrl(url)) return null;
  const response = await fetch(url, { credentials: "omit", cache: "no-store" });
  if (!response.ok) return null;
  const text = await response.text();
  return text.length <= MAX_SOURCE_MAP_CHARS ? text : null;
}

function decodeInlineMap(value: string): string | null {
  if (!value.startsWith("data:")) return null;
  const comma = value.indexOf(",");
  if (comma < 0) return null;
  const meta = value.slice(0, comma);
  const body = value.slice(comma + 1);
  try {
    const decoded = meta.includes(";base64") ? atob(body) : decodeURIComponent(body);
    return decoded.length <= MAX_SOURCE_MAP_CHARS ? decoded : null;
  } catch {
    return null;
  }
}

async function consumerForScript(script: DebugScript): Promise<SourceMapConsumer | null> {
  const sourceMapUrl = script.sourceMapUrl;
  if (!sourceMapUrl) return null;
  const cacheKey = `${script.url}\n${sourceMapUrl}`;
  const cached = mapCache.get(cacheKey);
  if (cached) return cached;
  const pending = (async () => {
    let raw: string | null = decodeInlineMap(sourceMapUrl);
    if (!raw && isLoopbackUrl(script.url)) {
      try {
        const absolute = new URL(sourceMapUrl, script.url).toString();
        raw = await fetchText(absolute);
      } catch { raw = null; }
    }
    if (!raw) return null;
    try {
      return new SourceMapConsumer(JSON.parse(raw));
    } catch {
      return null;
    }
  })();
  mapCache.set(cacheKey, pending);
  return pending;
}

export function clearSourceMapCache() {
  mapCache.clear();
}

export async function originalToGeneratedLocation(
  scripts: DebugScript[],
  relativePath: string,
  line: number,
  column: number,
): Promise<{ url: string; line: number; column: number } | null> {
  for (const script of scripts) {
    const consumer = await consumerForScript(script);
    if (!consumer) continue;
    const source = consumer.sources.find((item) => sourceMatches(item, relativePath));
    if (!source) continue;
    const generated = consumer.generatedPositionFor({ source, line: Math.max(1, line), column: Math.max(0, column - 1) });
    if (generated.line != null) {
      return { url: script.url, line: generated.line, column: (generated.column ?? 0) + 1 };
    }
  }
  return null;
}

export async function generatedToOriginalLocation(
  scripts: DebugScript[],
  runtimeUrl: string,
  line: number,
  column: number,
): Promise<{ path: string; line: number; column: number } | null> {
  const script = scripts.find((item) => item.url === runtimeUrl);
  if (!script) return null;
  const consumer = await consumerForScript(script);
  if (!consumer) return null;
  const original = consumer.originalPositionFor({ line: Math.max(1, line), column: Math.max(0, column - 1) });
  if (!original.source || original.line == null) return null;
  return {
    path: normalizePath(original.source),
    line: original.line,
    column: (original.column ?? 0) + 1,
  };
}
