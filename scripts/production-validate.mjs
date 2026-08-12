#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const json = (path) => JSON.parse(read(path));
const fail = (message) => { throw new Error(`[production] ${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };

const pkg = json("package.json");
const tauri = json("src-tauri/tauri.conf.json");
const releaseConfig = json("src-tauri/tauri.release.conf.json");
const runtime = json("src-tauri/runtime/manifest.json");
const cargo = read("src-tauri/Cargo.toml");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

assert(pkg.version === "1.0.0", `package version must be 1.0.0, got ${pkg.version}`);
assert(tauri.version === pkg.version, "Tauri version does not match package.json");
assert(cargoVersion === pkg.version, "Cargo version does not match package.json");
assert(releaseConfig.bundle?.createUpdaterArtifacts === false, "v1.0.0 must not claim updater artifacts before signing/feed setup");
assert(runtime.schemaVersion === 1 && runtime.npmBundled === true, "bundled Node runtime manifest is invalid");
assert(/^24\./.test(runtime.nodeVersion), "WebForge v1.0 runtime must stay on the tested Node 24 LTS line");

for (const name of ["csp", "devCsp"]) {
  const value = String(tauri.app?.security?.[name] ?? "");
  assert(value && !value.includes("'unsafe-eval'"), `${name} must not enable unsafe-eval`);
  assert(value.includes("object-src 'none'"), `${name} must deny object-src`);
  assert(value.includes("base-uri 'self'"), `${name} must pin base-uri`);
  assert(value.includes("form-action 'none'"), `${name} must deny form-action`);
  assert(!/default-src\s+\*/.test(value), `${name} must not use a wildcard default-src`);
}

const forbiddenReleaseSecrets = [
  /TAURI_SIGNING_PRIVATE_KEY\s*[:=]\s*["'][^-\s]/i,
  /NETLIFY_AUTH_TOKEN\s*[:=]\s*["'][^$\s]/i,
  /VERCEL_TOKEN\s*[:=]\s*["'][^$\s]/i,
  /CLOUDFLARE_API_TOKEN\s*[:=]\s*["'][^$\s]/i,
];
for (const path of ["src", "src-tauri/src", "scripts", ".github/workflows"]) {
  const base = join(root, path);
  const stack = existsSync(base) ? [base] : [];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue; }
      if (!/\.(?:ts|tsx|js|mjs|rs|ya?ml|json|toml|md)$/i.test(entry.name)) continue;
      const source = readFileSync(full, "utf8");
      for (const pattern of forbiddenReleaseSecrets) assert(!pattern.test(source), `possible embedded secret in ${relative(root, full)}`);
    }
  }
}

const distDir = join(root, "dist");
if (existsSync(distDir)) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full); else files.push(full);
    }
  };
  walk(distDir);
  const total = files.reduce((sum, file) => sum + statSync(file).size, 0);
  const maps = files.filter((file) => file.endsWith(".map"));
  assert(maps.length === 0, `production frontend must not ship source maps (${maps.length} found)`);
  assert(total <= 18 * 1024 * 1024, `frontend dist exceeds the 18 MiB production budget (${Math.round(total / 1024 / 1024)} MiB)`);
  const html = readFileSync(join(distDir, "index.html"), "utf8");
  assert(!html.includes("data-webforge-source-map"), "production index contains Designer source hints");
  assert(!html.includes("webforge-preview-error"), "production index contains source-preview bridge code");
  const initialScripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  const initialBytes = initialScripts.reduce((sum, src) => {
    const full = join(distDir, src.replace(/^\//, ""));
    return sum + (existsSync(full) ? statSync(full).size : 0);
  }, 0);
  assert(initialBytes <= 1_500_000, `initial JavaScript exceeds 1.5 MB budget (${initialBytes} bytes)`);
}

console.log(`WebForge ${pkg.version} production validation passed${existsSync(distDir) ? " with dist budgets" : " (static gates)"}.`);
