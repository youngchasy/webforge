# Bundled Node runtime · WebForge 2.6

WebForge 2.6 release builds bundle a verified Node.js + npm runtime so an end user does not need a separate Node installation for npm/Vite workflows.

`node scripts/prepare-node-runtime.mjs --target <target>` downloads the official Node.js v24.19.0 distribution, downloads the release `SHASUMS256.txt`, verifies SHA-256 before extraction, and prepares `runtime/bin` for Tauri resources.

Supported release targets:

- `windows-x64`
- `linux-x64`
- `macos-x64`
- `macos-arm64`

Source archives intentionally keep only the manifest and preparation script; CI prepares the platform runtime immediately before the Tauri bundle step. The prepared binaries are generated artifacts and must not be committed.
