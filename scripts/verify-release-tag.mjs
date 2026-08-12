#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tagArg = process.argv.find((arg) => arg.startsWith("--tag="));
const tag = tagArg?.slice(6) || process.env.GITHUB_REF_NAME || "";
if (!tag) throw new Error("release tag is required via --tag= or GITHUB_REF_NAME");
const expected = `v${pkg.version}`;
if (tag !== expected) throw new Error(`tag ${tag} does not match ${expected}`);
process.stdout.write("stable\n");
