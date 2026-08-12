export function languageFromPath(path: string): string {
  const fileName = path.toLowerCase();
  const extension = fileName.includes(".") ? fileName.split(".").pop() ?? "" : "";

  const map: Record<string, string> = {
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    less: "less",
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    md: "markdown",
    svg: "html",
    xml: "xml",
    vue: "html",
    svelte: "html",
  };

  return map[extension] ?? "plaintext";
}
