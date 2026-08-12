#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";

const NODE_VERSION = "24.19.0";
const root = fileURLToPath(new URL("..", import.meta.url));
const runtimeDir = join(root, "src-tauri", "runtime");
const outDir = join(runtimeDir, "bin");
const cacheDir = join(root, ".webforge-cache", "node-runtime");

const targets = {
  "windows-x64": { artifact: `node-v${NODE_VERSION}-win-x64.zip`, folder: `node-v${NODE_VERSION}-win-x64`, node: "node.exe", os: "windows", arch: "x64" },
  "linux-x64": { artifact: `node-v${NODE_VERSION}-linux-x64.tar.xz`, folder: `node-v${NODE_VERSION}-linux-x64`, node: "bin/node", os: "linux", arch: "x64" },
  "macos-x64": { artifact: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, folder: `node-v${NODE_VERSION}-darwin-x64`, node: "bin/node", os: "macos", arch: "x64" },
  "macos-arm64": { artifact: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, folder: `node-v${NODE_VERSION}-darwin-arm64`, node: "bin/node", os: "macos", arch: "arm64" },
};

function defaultTarget() {
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
  if (process.platform === "darwin" && process.arch === "x64") return "macos-x64";
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
  throw new Error(`Unsupported runtime target ${process.platform}/${process.arch}`);
}

const args = process.argv.slice(2);
const targetArg = args.includes("--target") ? args[args.indexOf("--target") + 1] : defaultTarget();
const dryRun = args.includes("--dry-run");
const target = targets[targetArg];
if (!target) throw new Error(`Unknown --target ${targetArg}. Expected ${Object.keys(targets).join(", ")}`);

const base = `https://nodejs.org/download/release/v${NODE_VERSION}`;
if (dryRun) {
  console.log(JSON.stringify({ nodeVersion: NODE_VERSION, target: targetArg, artifact: target.artifact, url: `${base}/${target.artifact}` }, null, 2));
  process.exit(0);
}

async function download(url, path) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Download failed ${response.status}: ${url}`);
  await pipeline(response.body, createWriteStream(path));
}

await mkdir(cacheDir, { recursive: true });
const sumsPath = join(cacheDir, `SHASUMS256-v${NODE_VERSION}.txt`);
const archivePath = join(cacheDir, target.artifact);
await download(`${base}/SHASUMS256.txt`, sumsPath);
await download(`${base}/${target.artifact}`, archivePath);
const sums = await readFile(sumsPath, "utf8");
const expected = sums.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).find((parts) => parts.at(-1) === target.artifact)?.[0];
if (!expected) throw new Error(`Official SHASUMS256.txt does not contain ${target.artifact}`);
const actual = createHash("sha256").update(await readFile(archivePath)).digest("hex");
if (actual !== expected) throw new Error(`SHA-256 mismatch for ${target.artifact}`);

const extractDir = join(cacheDir, `extract-${targetArg}`);
await rm(extractDir, { recursive: true, force: true });
await mkdir(extractDir, { recursive: true });
if (target.artifact.endsWith(".zip")) {
  const command = process.platform === "win32" ? "powershell" : "unzip";
  const params = process.platform === "win32"
    ? ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${extractDir.replaceAll("'", "''")}' -Force`]
    : ["-q", archivePath, "-d", extractDir];
  const result = spawnSync(command, params, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Unable to extract ${target.artifact}`);
} else {
  const result = spawnSync("tar", ["-xf", archivePath, "-C", extractDir], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Unable to extract ${target.artifact}`);
}

const dist = join(extractDir, target.folder);
await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, "node_modules"), { recursive: true });
await cp(join(dist, target.node), join(outDir, target.os === "windows" ? "node.exe" : "node"));
await cp(join(dist, "node_modules", "npm"), join(outDir, "node_modules", "npm"), { recursive: true });
if (target.os === "windows") {
  await cp(join(dist, "npm.cmd"), join(outDir, "npm.cmd"));
  await cp(join(dist, "npx.cmd"), join(outDir, "npx.cmd"));
} else {
  const npm = `#!/bin/sh\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$DIR/node" "$DIR/node_modules/npm/bin/npm-cli.js" "$@"\n`;
  const npx = `#!/bin/sh\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$DIR/node" "$DIR/node_modules/npm/bin/npx-cli.js" "$@"\n`;
  await writeFile(join(outDir, "npm"), npm); await chmod(join(outDir, "npm"), 0o755);
  await writeFile(join(outDir, "npx"), npx); await chmod(join(outDir, "npx"), 0o755);
  await chmod(join(outDir, "node"), 0o755);
}

const manifest = {
  schemaVersion: 1,
  prepared: true,
  nodeVersion: NODE_VERSION,
  npmBundled: true,
  target: targetArg,
  platform: target.os,
  arch: target.arch,
  artifact: basename(archivePath),
  sha256: actual,
  source: `${base}/${target.artifact}`,
};
await writeFile(join(runtimeDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared verified Node.js v${NODE_VERSION} runtime for ${targetArg}.`);
