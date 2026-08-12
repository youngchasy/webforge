# WebForge v1.0.0 — безопасность / Security

## Русский

### 1. Основной принцип

WebForge рассматривает любой открытый workspace как **потенциально недоверенный код**. Открытие папки само по себе не означает разрешение запускать shell-команды, package scripts, Git hooks/filters, language servers, browser debugger или сторонние CLI.

Чтение проекта и выполнение проекта разделены на разные уровни полномочий.

### 2. WebView и Rust boundary

UI работает в Tauri WebView, чувствительные операции — в Rust native core через явные Tauri commands.

Основной WebView:

- не имеет generic shell permission;
- не получает arbitrary filesystem access вне выбранного workspace;
- не может отправить произвольный CDP method;
- не имеет универсального LSP RPC tunnel;
- не получает Git/Deploy credentials;
- не может запускать arbitrary native command через extension manifest.

Каждая native-команда ограничивает тип операции, payload, path и необходимые разрешения.

### 3. Workspace boundary

Где применимо, WebForge:

- normalizes/canonicalizes пути;
- отклоняет path traversal;
- проверяет принадлежность target выбранному workspace root;
- отклоняет symlink для чувствительных операций;
- ограничивает размеры файлов, списков, reports и IPC payloads.

Неизвестные workspace открываются в Restricted mode.

### 4. Workspace Trust

Workspace Trust разрешает чувствительные изменения проекта, но не предоставляет автоматически execution authority.

Trust используется для native write workflows, extension activation/capability grants, package mutations и других операций, где проект может измениться или активировать более широкие возможности.

### 5. Terminal Access

**Terminal Access** — отдельное session-only разрешение на запуск проектного кода и процессов.

Оно требуется для:

- PTY terminal;
- Tasks и package scripts;
- tests/coverage;
- external language servers;
- browser debugger launch/evaluation;
- Git operations, способных активировать repository machinery;
- direct deploy через provider CLI.

При отзыве Terminal Access WebForge завершает управляемые PTY/LSP/debugger processes.

### 6. Git Network Access

`fetch`, `pull` и `push` требуют отдельного session-only **Git Network Access**.

Managed Git:

- не передаёт token/password в WebView;
- sanitizes remote URLs;
- отключает interactive credential prompts для managed commands;
- не предоставляет generic force-push/refspec surface;
- показывает только безопасное credential capability-state.

Секреты остаются в Git credential helper, SSH agent или OS credential storage.

### 7. Git worktree mutations

Rebase, cherry-pick, stash apply/pop и merge-related операции могут активировать Git filters/merge drivers/repository machinery, поэтому остаются за execution boundary.

WebForge дополнительно ограничивает аргументы, отключает interactive editor для managed workflows и не использует recursive submodule traversal как неявную часть обычной операции.

### 8. PTY и process supervision

WebForge не предоставляет WebView универсальную функцию `exec(commandString)`.

PTY, language servers, test runners, debugger и deploy CLI запускаются специализированными supervisors/adapters с собственными проверками.

### 9. Browser Debugger

Debugger принимает только поддерживаемые loopback HTTP(S) targets.

Защиты:

- isolated temporary browser profile;
- loopback remote-debugging port;
- allowlisted debugger actions;
- отсутствие arbitrary CDP bridge;
- bounded script/event/variable state;
- Debug Console находится за Terminal Access;
- temporary profile удаляется при teardown.

### 10. Preview и DevTools

Development Preview может содержать Inspector/Designer/DevTools bridge. Production Dist preview остаётся bridge-free.

Перед передачей Network/Storage данных в основной WebView:

- `Authorization`, `Cookie`, `Set-Cookie`, proxy-auth и API-key-like headers редактируются;
- cookie values не передаются;
- HttpOnly cookies недоступны browser bridge;
- token/secret/password/auth/session-like storage values редактируются;
- request/response body ограничен по размеру;
- количество network/performance records ограничено.

Storage clear действует только для активного preview origin.

### 11. Framework Visual Designer

Designer для React/Vue/Svelte получает write access только в supervised development runtime.

Правила:

- DOM → source hints существуют только для development instrumentation;
- runtime DOM не сериализуется обратно в framework source;
- source mapping проверяется заново перед каждым write;
- запись разрешается только для однозначно сопоставленного native markup node;
- expression-backed React props не заменяются static values;
- Vue `v-bind` и Svelte `bind:` не перезаписываются static attributes;
- ambiguous structural edits завершаются отказом;
- production build не должен содержать WebForge source-hint bridge.

### 12. Visual style mutations

Resize/Flex/Grid/Typography/Animation tools передают только bounded style/class mutations.

- resize commit связан с выбранным source ID;
- CSS properties/generated rules валидируются;
- container-query values ограничиваются;
- Tailwind/Bootstrap tools меняют только static class lists;
- config/plugins этих frameworks не выполняются Designer'ом;
- generated CSS добавляется только в допустимый stylesheet внутри workspace.

### 13. Tests и reports

Test discovery read-only. Выполнение tests/coverage требует Terminal Access.

Machine-readable report files:

- используют ограниченные temporary paths;
- имеют лимиты размера/числа cases;
- разбираются после завершения supervised process;
- не превращают stdout/stderr в доверенный структурный protocol.

### 14. LSP

External language servers запускаются как отдельные supervised processes.

Ограничиваются:

- document routing по file type;
- JSON payload sizes;
- logs;
- restart attempts;
- workspace-edit application;
- `workspace/executeCommand` только commands, ранее выданными CodeLens текущего server instance.

WebView не получает arbitrary LSP method bridge.

### 15. Package Manager

Package Manager использует fixed native commands и argument vectors.

- package specifiers валидируются;
- arbitrary shell string не eval'ится;
- mutations требуют Workspace Trust + Terminal Access;
- lifecycle scripts отключены по умолчанию, где package manager это поддерживает;
- включение lifecycle scripts требует явного подтверждения.

### 16. Assets и Project Health

Asset/audit scans:

- остаются внутри workspace;
- игнорируют common vendor/build directories;
- не следуют по symlink;
- имеют size/count caps;
- SVG optimization требует canonical workspace path;
- audit findings содержат только source/path metadata проекта.

### 17. Settings

Workspace settings имеют фиксированный путь:

```text
.webforge/settings.json
```

Settings:

- ограничены по размеру;
- не принимаются через symlinked target;
- не могут grant'ить Workspace Trust;
- не могут grant'ить Terminal Access;
- не могут grant'ить Git Network Access;
- не могут автоматически grant'ить extension capabilities.

### 18. Hot Exit и recovery

Dirty buffers хранятся в OS application-data WebForge, а не внутри repository.

Recovery:

- bounded по size/buffer count;
- связан с конкретным workspace;
- восстанавливает paths через обычную workspace boundary;
- не является скрытым autosave;
- не перезаписывает автоматически файл, изменившийся на диске;
- при divergence создаёт external-change conflict.

### 19. Native Search Index

Индекс:

- читает bounded UTF-8 files только внутри workspace;
- не индексирует symlink;
- игнорирует generated/vendor directories;
- применяет root `.gitignore`;
- ограничен по file count/per-file size/total bytes;
- не имеет execution authority.

### 20. Extensions

Extension host v1.0.0 является **декларативным**, а не arbitrary-code runtime.

```text
.webforge/extensions/<id>/webforge-extension.json
```

Manifest валидируется Rust-слоем до активации contributions.

Extensions:

- disabled/no capabilities by default;
- требуют enable + explicit grants;
- не выполняют arbitrary JS/Rust/native code;
- не вызывают generic Tauri command;
- не вызывают shell;
- не отправляют arbitrary CDP/LSP requests;
- panels отображаются как inert content;
- theme contributions ограничены allowlisted tokens;
- paths/snippets/templates имеют traversal/size validation.

### 21. Deploy credentials

Cloudflare, Netlify и Vercel tokens хранятся native-слоем через platform credential manager.

- `.webforge/deploy.json` содержит только non-secret config;
- stored token не возвращается в WebView;
- secrets передаются provider CLI через environment, а не command-line argument;
- direct deploy требует Trusted Workspace + Terminal Access;
- output directory должен canonicalize внутри workspace;
- symlink output отклоняется.

### 22. Bundled Node runtime

Release workflow загружает platform-specific Node.js runtime из официального distribution и проверяет archive SHA-256 по официальному manifest до включения в installer.

Непроверенный runtime не должен попадать в release bundle.

### 23. Production CSP и capabilities

Production frontend использует явный Tauri capability allowlist и CSP. Production validation проверяет отсутствие запрещённых dev bridge/source-map artifacts в `dist`.

### 24. Release signing credentials

GitHub Actions может использовать repository secrets для:

- Windows Authenticode;
- Apple Developer ID;
- Apple notarization.

Secrets не коммитятся в repository, workspace или release archive и не передаются приложению как пользовательские данные.

Если signing secrets не настроены, Windows build может быть unsigned, а macOS build — ad-hoc signed; SmartScreen/Gatekeeper могут предупреждать пользователя.

### 25. Updater

В v1.0.0 публичный auto-update feed намеренно не активирован. Updater следует включать только после подготовки устойчивого HTTPS endpoint, public key и подписанных update artifacts.

### 26. Сообщение об уязвимости

Не публикуйте реальные secrets, private project data или exploit payload против реальных пользователей в публичном issue.

Хороший отчёт содержит:

- затронутый компонент;
- ОС/платформу;
- воспроизводимые шаги;
- ожидаемую и фактическую security boundary;
- минимальный proof of concept без чужих секретов;
- impact assessment.

Если repository поддерживает GitHub Private Vulnerability Reporting, используйте его для чувствительных отчётов.

---

## English

### 1. Core principle

WebForge treats every opened workspace as **potentially untrusted code**. Opening a folder does not automatically authorize shell commands, package scripts, Git hooks/filters, language servers, browser debugging, or third-party CLIs.

Reading a project and executing a project are separate authority levels.

### 2. WebView and Rust boundary

The UI runs inside a Tauri WebView while sensitive operations execute in the Rust native core through explicit Tauri commands.

The main WebView:

- has no generic shell permission;
- has no arbitrary filesystem access outside the selected workspace;
- cannot submit arbitrary CDP methods;
- has no universal LSP RPC tunnel;
- never receives Git/Deploy credentials;
- cannot execute arbitrary native commands through extension manifests.

Each native command constrains its operation type, payload, path, and required permissions.

### 3. Workspace boundary

Where applicable WebForge normalizes/canonicalizes paths, rejects traversal, checks that targets stay within the workspace root, rejects symlinks for sensitive operations, and caps file/list/report/IPC sizes.

Unknown workspaces open in Restricted mode.

### 4. Workspace Trust

Workspace Trust permits sensitive project mutations but does not automatically grant execution authority. It is used for native write workflows, extension activation/capability grants, package mutations, and other privileged operations.

### 5. Terminal Access

**Terminal Access** is a separate session-only grant for executing project code/processes.

It is required for PTY terminal sessions, Tasks/package scripts, tests/coverage, external language servers, browser debugger launch/evaluation, Git operations that may activate repository machinery, and direct deployment through provider CLIs.

Revoking Terminal Access tears down managed PTY/LSP/debugger processes.

### 6. Git Network Access

`fetch`, `pull`, and `push` require a separate session-only **Git Network Access** grant.

Managed Git does not expose passwords/tokens to the WebView, sanitizes remote URLs, disables interactive credential prompts, exposes no generic force-push/refspec surface, and reports only safe credential capability state.

Secrets remain in Git credential helpers, SSH agents, or OS credential storage.

### 7. Git worktree mutations

Rebase, cherry-pick, stash apply/pop, and merge-related operations may activate Git filters/merge drivers/repository machinery, so they remain behind the execution boundary. Managed workflows constrain arguments, disable interactive editors, and avoid implicit recursive submodule traversal.

### 8. PTY and process supervision

WebForge exposes no universal `exec(commandString)` function to the WebView. PTY sessions, language servers, test runners, debugger processes, and deployment CLIs use specialized supervisors/adapters with dedicated validation.

### 9. Browser Debugger

The debugger accepts only supported loopback HTTP(S) targets. It uses an isolated temporary browser profile, loopback remote-debugging port, allowlisted debugger actions, bounded state, and no arbitrary CDP bridge. Debug Console is behind Terminal Access, and temporary profiles are removed during teardown.

### 10. Preview and DevTools

Development Preview may contain Inspector/Designer/DevTools bridges. Production Dist preview remains bridge-free.

Before Network/Storage data reaches the main WebView, sensitive headers are redacted, cookie values are not forwarded, HttpOnly cookies remain inaccessible, secret-like storage values are redacted, body sizes are bounded, and telemetry record counts are capped. Storage clearing is scoped to the active preview origin.

### 11. Framework Visual Designer

React/Vue/Svelte Designer write access exists only inside supervised development runtimes.

Development-only DOM → source hints are revalidated before writes. Runtime DOM is never serialized back into framework source. Writes require uniquely mapped native markup nodes. Expression-backed React props, Vue `v-bind`, and Svelte `bind:` are not overwritten by static values. Ambiguous structural edits fail closed. Production builds must not contain WebForge source-hint bridge instrumentation.

### 12. Visual style mutations

Resize/Flex/Grid/Typography/Animation tooling emits bounded style/class mutations. Source IDs, CSS properties/generated rules, and container-query values are validated. Tailwind/Bootstrap tools modify static class lists only and do not execute framework config/plugins. Generated CSS is written only to an allowed stylesheet inside the workspace.

### 13. Tests and reports

Test discovery is read-only. Running tests/coverage requires Terminal Access. Machine-readable reports use bounded temporary paths, case/size limits, post-process parsing, and do not treat raw stdout/stderr as trusted structured protocols.

### 14. LSP

External language servers run as supervised processes. WebForge bounds document routing, JSON payloads, logs, restart attempts, workspace-edit application, and `workspace/executeCommand` to commands previously provided by CodeLens from the same server instance.

### 15. Package Manager

Package Manager uses fixed native commands and argument vectors. Package specifiers are validated, arbitrary shell strings are never evaluated, mutations require Workspace Trust + Terminal Access, lifecycle scripts are disabled by default where supported, and enabling them requires explicit confirmation.

### 16. Assets and Project Health

Asset/audit scans remain inside the workspace, skip common vendor/build directories, reject symlinks, use size/count caps, and require canonical workspace paths for SVG optimization. Audit results expose project source/path metadata only.

### 17. Settings

Workspace settings have one fixed path: `.webforge/settings.json`. They are size-bounded, reject symlinked targets, and cannot grant Workspace Trust, Terminal Access, Git Network Access, or extension capabilities.

### 18. Hot Exit and recovery

Dirty buffers are stored in WebForge OS application data, not inside the repository. Recovery is bounded, workspace-scoped, not a hidden autosave mechanism, and does not silently overwrite files changed on disk. Divergence becomes an external-change conflict.

### 19. Native Search Index

The index reads bounded UTF-8 files inside the workspace, rejects symlinks, skips generated/vendor directories, applies root `.gitignore`, limits file counts/sizes/total bytes, and has no execution authority.

### 20. Extensions

The v1.0.0 extension host is **declarative**, not an arbitrary-code runtime. Manifests under `.webforge/extensions/<id>/webforge-extension.json` are validated by Rust before contributions activate.

Extensions start disabled/ungranted, require enablement and explicit capability grants, cannot execute arbitrary JS/Rust/native code, cannot invoke generic Tauri/shell/CDP/LSP commands, render panels as inert content, restrict theme contributions to allowlisted tokens, and validate paths/snippets/templates.

### 21. Deploy credentials

Cloudflare, Netlify, and Vercel tokens are stored by the native layer through the platform credential manager. `.webforge/deploy.json` contains non-secret config only. Tokens are never returned to the WebView, are passed to provider CLIs through environment variables rather than command-line arguments, and direct deployment requires Trusted Workspace + Terminal Access. Output directories must stay canonical inside the workspace and symlink outputs are rejected.

### 22. Bundled Node runtime

The release workflow downloads platform-specific Node.js runtime archives from the official distribution and verifies SHA-256 against the official manifest before bundling. Unverified runtime archives must not enter release installers.

### 23. Production CSP and capabilities

The production frontend uses an explicit Tauri capability allowlist and CSP. Production validation checks `dist` for forbidden development bridge/source-map artifacts.

### 24. Release signing credentials

GitHub Actions may use repository secrets for Windows Authenticode, Apple Developer ID, and Apple notarization. These secrets are never committed into the repository/workspace/release source archive and are not exposed as application user data.

Without signing secrets, Windows builds may be unsigned and macOS builds may use ad-hoc signing, which can trigger SmartScreen/Gatekeeper warnings.

### 25. Updater

The public auto-update feed is intentionally inactive in v1.0.0. Updater distribution should be enabled only after a durable HTTPS endpoint, public key, and signed update artifacts are available.

### 26. Reporting a vulnerability

Do not publish real secrets, private project data, or exploit payloads targeting real users in a public issue.

A useful report includes the affected component, platform/OS, reproducible steps, expected vs actual boundary, a minimal proof of concept without third-party secrets, and impact assessment.

Use GitHub Private Vulnerability Reporting when available for sensitive reports.
