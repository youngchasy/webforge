#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const artifactArg = process.argv.find((arg) => arg.startsWith("--dir="));
const dir = resolve(root, artifactArg?.slice(6) || "src-tauri/target/release/bundle");
if (!existsSync(dir)) throw new Error(`bundle directory does not exist: ${dir}`);
const files = [];
const walk = (base) => {
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const full = join(base, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (!entry.name.endsWith(".sig")) {
      const bytes = readFileSync(full);
      files.push({ path: relative(dir, full).replaceAll("\\", "/"), size: statSync(full).size, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  }
};
walk(dir);
files.sort((a, b) => a.path.localeCompare(b.path));
const manifest = { schemaVersion: 1, product: "WebForge", version: pkg.version, generatedAt: new Date().toISOString(), files };
const out = join(dir, "webforge-release-manifest.json");
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${out} (${files.length} artifacts)`);
