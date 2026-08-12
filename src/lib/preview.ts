function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolveRelative(baseFile: string, assetPath: string): string {
  if (/^(https?:|data:|blob:|#|\/\/)/i.test(assetPath)) return assetPath;
  if (assetPath.startsWith("/")) return normalizePath(assetPath.slice(1));
  const baseParts = normalizePath(baseFile).split("/");
  baseParts.pop();
  return normalizePath([...baseParts, assetPath].join("/"));
}


function isLocalReference(value: string): boolean {
  return !/^(https?:|data:|blob:|#|\/\/)/i.test(value);
}

export function listHtmlDependencies(htmlPath: string, html: string): string[] {
  const dependencies = new Set<string>();
  const patterns = [
    /<link\b[^>]*?href=["']([^"']+)["'][^>]*>/gi,
    /<script\b[^>]*?src=["']([^"']+)["'][^>]*>/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const reference = match[1];
      if (isLocalReference(reference)) dependencies.add(resolveRelative(htmlPath, reference));
    }
  }

  return [...dependencies];
}

function escapeClosingStyle(value: string): string {
  return value.replace(/<\/style/gi, "<\\/style");
}

function escapeClosingScript(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

export function buildPreviewDocument(
  files: Record<string, string>,
  activePath?: string,
): string {
  const htmlPath = activePath?.match(/\.html?$/i)
    ? activePath
    : files["index.html"] !== undefined
      ? "index.html"
      : Object.keys(files).find((path) => /\.html?$/i.test(path));

  if (!htmlPath || files[htmlPath] === undefined) {
    return `<!doctype html><html><body style="font-family:system-ui;background:#0f1116;color:#8992a3;display:grid;place-items:center;height:100vh;margin:0"><p>Open an HTML file to preview it.</p></body></html>`;
  }

  let html = files[htmlPath];

  html = html.replace(
    /<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi,
    (full, before: string, href: string, after: string) => {
      const attributes = `${before} ${after}`;
      if (!/rel\s*=\s*["']?stylesheet/i.test(attributes)) return full;
      const resolved = resolveRelative(htmlPath, href);
      const css = files[resolved];
      if (css === undefined) return full;
      return `<style data-webforge-source="${resolved}">${escapeClosingStyle(css)}</style>`;
    },
  );

  html = html.replace(
    /<script\b([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (full, before: string, src: string, after: string) => {
      const resolved = resolveRelative(htmlPath, src);
      const script = files[resolved];
      if (script === undefined) return full;
      return `<script ${before} ${after} data-webforge-source="${resolved}">${escapeClosingScript(script)}<\/script>`;
    },
  );

  const bridge = `<script>
window.addEventListener('error', (event) => {
  parent.postMessage({ type: 'webforge-preview-error', message: event.message }, '*');
});
<\/script>`;

  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${bridge}</body>`);
  return `${html}${bridge}`;
}
