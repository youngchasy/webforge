# WebForge v1.0.0

> Кроссплатформенная desktop IDE для современной веб-разработки на Tauri 2, Rust, React, TypeScript и Monaco Editor.

## Русский

### О проекте

**WebForge** — самостоятельная настольная среда разработки для веб-проектов. Она объединяет редактор кода, терминал, Git, языковые серверы, тестирование, browser debugging, Preview, визуальное редактирование интерфейсов, инструменты проекта, DevTools, расширения и deployment в одном локальном desktop-приложении.

**WebForge v1.0.0 — первая публичная версия проекта.** Все возможности ниже относятся к единому релизу v1.0.0; публичных версий WebForge до него не было.

### Возможности

#### Редактор и workspace

- Monaco Editor с вкладками, dirty-state, Save/Save All и защитой от внешних изменений файлов;
- Explorer с созданием, переименованием, удалением и открытием файлов/каталогов;
- настраиваемые font size, line-height, indentation, word wrap, minimap и format-on-save;
- autosave с задержкой;
- Command Palette и настраиваемые keybindings;
- session restore и Hot Exit для открытых вкладок и несохранённых буферов;
- native filesystem watcher;
- Rust-based workspace search index с `.gitignore`, resource limits и incremental updates;
- Search/Replace по проекту, где несохранённый Monaco buffer имеет приоритет над disk index.

#### LSP и интеллектуальные функции

WebForge одновременно управляет несколькими language server'ами и направляет запрос в сервер, соответствующий текущему типу файла.

Поддерживаются:

- TypeScript / JavaScript через `typescript-language-server`;
- Vue через `vue-language-server`;
- Svelte через `svelteserver`;
- completion, hover, definition, references, rename;
- signature help и code actions;
- Document/Workspace Symbols;
- Semantic Tokens;
- Inlay Hints;
- formatting;
- CodeLens;
- document/workspace diagnostics;
- Call Hierarchy и Type Hierarchy;
- bounded server logs;
- controlled restart после crash.

#### Терминал, Tasks и Test Explorer

- native PTY на Rust + `xterm.js`;
- несколько terminal tabs и search по scrollback;
- запуск `package.json` scripts;
- Test Explorer для Vitest, Jest и Playwright;
- machine-readable результаты тестов;
- passed/failed/skipped, duration, stack trace и source location;
- rerun failed tests;
- bounded test history;
- coverage summary для поддерживаемых runners.

#### Run / Debug

Встроенный browser debugger работает через Chrome DevTools Protocol и использует isolated temporary browser profile и loopback remote-debugging port.

Доступны:

- `.webforge/launch.json`;
- Monaco gutter breakpoints;
- pause / resume;
- step over / into / out;
- call stack и выбор frame;
- Local / Closure / Script / Global scopes;
- bounded variables;
- Watch expressions;
- frame-aware Debug Console;
- source-map mapping;
- resync breakpoint'ов после reload/restart.

#### Preview и Visual Designer

Режимы Preview:

- Static HTML/CSS/JS preview;
- supervised Vite dev preview с HMR;
- raw production `dist` preview без development bridge.

Visual Designer поддерживает Static HTML, React, Vue и Svelte. Framework preview использует dev-only DOM → source mapping и перед каждым изменением повторно проверяет текущий source buffer.

Инструменты Designer:

- DOM Tree и Inspector;
- DOM → source navigation;
- безопасное редактирование static classes/props/attributes;
- редактирование простого static text;
- insert / duplicate / delete;
- conservative drag & drop / reorder;
- Component Library и Component Marketplace;
- source-backed resize handles прямо в Preview;
- box-model overlays;
- Flex/Grid editor;
- typography;
- gradients, shadows, borders и opacity;
- transforms, overflow и z-index;
- transitions и animation properties;
- bounded keyframe generation;
- container queries;
- responsive ruler, breakpoints и Multi View;
- Tailwind-aware и Bootstrap-aware editing для static class lists;
- CSS variables, pseudo states, cascade, specificity и inheritance inspection;
- Designer undo/redo.

Dynamic React expressions, Vue `v-bind`, Svelte `bind:` и неоднозначные structural boundaries не перезаписываются статическими значениями: Designer работает по принципу **fail closed**.

#### Git

Source Control включает:

- repository init, status и diff;
- stage / unstage / commit;
- local и remote branches;
- fetch / pull / push;
- branch creation/switching;
- commit history и graph;
- file history и line blame;
- stash create/apply/pop/drop;
- annotated tags;
- rebase / continue / abort;
- cherry-pick / continue / abort;
- conflict navigation;
- Monaco 3-way merge editor с Base/Ours/Theirs/Result;
- sanitized credential-state без передачи token/password в WebView.

Fetch/Pull/Push требуют отдельного session-only Git Network Access.

#### Package Manager

Панель Packages поддерживает npm, pnpm, yarn и bun:

- dependencies/devDependencies;
- scripts;
- install/remove/update/update all;
- outdated packages;
- security audit;
- package-manager/lockfile detection;
- lifecycle scripts отключены по умолчанию для package mutations WebForge;
- включение lifecycle scripts требует явного подтверждения.

WebView не получает generic shell bridge: команды формируются нативным слоем как ограниченные argument vectors.

#### Asset Manager

- inventory изображений, SVG, fonts, audio и video;
- preview assets;
- file size и reference count;
- поиск потенциально unused assets;
- copy relative path;
- открытие SVG в Monaco;
- conservative SVG optimization;
- exclusion vendor/build directories и symlink.

#### Project Health, SEO и Accessibility

Source audit проверяет, среди прочего:

- `<html lang>`;
- `<title>` и meta description;
- canonical;
- Open Graph / Twitter-X metadata;
- favicon;
- JSON-LD;
- `robots.txt` и `sitemap.xml`;
- H1 и heading hierarchy;
- image `alt`;
- labels/ARIA для form controls;
- positive `tabindex`;
- local broken links.

Каждый finding ведёт к `file:line`.

Runtime Accessibility в DevTools дополнительно проверяет rendered DOM, accessible names, duplicate IDs, heading order, tabindex и computed contrast. Проверка диагностическая и не заявляет полную эквивалентность Lighthouse/axe.

#### DevTools

Development Preview предоставляет:

- Network Inspector для Fetch/XHR/resources;
- request/response headers, body и timing с bounded capture;
- Local Storage и Session Storage;
- cookie metadata;
- IndexedDB database metadata;
- Navigation/Paint/LCP/CLS/Long Task/resource metrics;
- runtime Accessibility audit;
- native Bundle Analyzer для production output.

Чувствительные headers, cookie values и secret-like storage values редактируются **до** передачи в основной WebView.

#### Extensions и Component Marketplace

WebForge v1.0.0 содержит декларативный capability-isolated extension host.

Workspace extensions:

```text
.webforge/extensions/<extension-id>/webforge-extension.json
```

Поддерживаются contributions:

- commands;
- safe text panels;
- component packs;
- project templates;
- token themes;
- project adapters;
- linter/formatter descriptors;
- language descriptors.

Extension manifest не может внедрить arbitrary JavaScript, HTML, Tauri command или shell command в основное окно.

#### Project Templates

New Project Wizard поддерживает встроенные и extension-provided templates для Static Web, React, Vue, Svelte/Vite и других декларативно описанных project layouts.

#### Deploy Center

Поддерживаются:

- GitHub Pages;
- Cloudflare Pages;
- Netlify;
- Vercel.

GitHub Pages использует генерируемый Actions workflow. Direct deploy использует уже установленные provider CLI. Cloudflare/Netlify/Vercel tokens хранятся через OS credential manager и не возвращаются в WebView.

#### Bundled Node.js / npm

Production installers могут содержать platform-specific Node.js 24 + npm runtime. Runtime загружается из официального Node distribution, сверяется с SHA-256 manifest и только после успешной проверки попадает в Tauri resources.

Это позволяет npm/Vite workflows работать без обязательной отдельной установки Node.js конечным пользователем.

### Темы интерфейса

В v1.0.0 встроены шесть тем:

| Тема | Описание |
| --- | --- |
| **Graphite** | нейтральная тёмно-серая тема по умолчанию |
| **Slate** | более светлая серая тёмная тема |
| **Cloud Light** | холодная светлая тема |
| **Warm Paper** | тёплая светлая тема |
| **Frosted Glass** | полупрозрачные панели с blur/glass эффектом |
| **Midnight** | глубокая тёмно-синяя тема |

Выбранная тема синхронно применяется к workbench, Monaco Editor и integrated terminal.

### Настройки

User settings хранятся локально. Workspace overrides находятся в:

```text
.webforge/settings.json
```

Workspace settings не могут выдавать себе Workspace Trust, Terminal Access, Git Network Access или extension capabilities.

### Архитектура

```text
React / TypeScript WebView
        │
        │ typed Tauri invoke/events
        ▼
Rust / Tauri native core
        │
        ├─ workspace/filesystem/watcher/search
        ├─ PTY/process supervision
        ├─ Git
        ├─ LSP
        ├─ browser debugger
        ├─ tests/packages/assets/audit/devtools
        ├─ settings/recovery
        ├─ extensions
        ├─ deploy/credentials
        └─ bundled runtime/release helpers
```

Основной WebView не имеет generic shell permission. Чувствительные операции доступны через узкие Tauri commands и отдельные permission gates.

Подробнее: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) и [`SECURITY.md`](SECURITY.md).

### Модель доверия

Неизвестный workspace открывается в Restricted mode.

Уровни authority:

1. **Workspace access** — операции внутри выбранного root;
2. **Workspace Trust** — sensitive project mutations;
3. **Terminal Access** — PTY, Tasks/tests, LSP, debugger и executable workflows;
4. **Git Network Access** — отдельный grant для fetch/pull/push;
5. **Extension capabilities** — grants отдельно для каждого extension.

### Сборка из исходников

Требуются Node.js 24, npm, Rust stable и системные зависимости Tauri.

```bash
npm ci
npm run verify:source
npm run check
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
npm run production:verify
npm run tauri -- dev
```

Rust tests:

```bash
npm run test:rust
```

### Команды разработки

```bash
npm run dev
npm run tauri -- dev
npm run check
npm run build
npm run production:verify
npm run verify:source
npm run test:rust
npm run runtime:prepare
```

### Горячие клавиши

| Сочетание | Действие |
| --- | --- |
| `Ctrl/Cmd+Shift+N` | новый проект |
| `Ctrl/Cmd+O` | открыть workspace |
| `Ctrl/Cmd+S` | сохранить активный файл |
| `Ctrl/Cmd+Shift+S` | сохранить все dirty buffers |
| `Ctrl/Cmd+Shift+F` | Search / Replace |
| `Ctrl/Cmd+Shift+G` | Source Control |
| `Ctrl/Cmd+Shift+R` | start/stop поддерживаемого runtime |
| `Ctrl/Cmd+K` / `F1` | Command Palette |
| `Ctrl/Cmd+,` | Settings |
| `Ctrl+F` в Terminal | search scrollback |

Основные bindings можно изменить в Settings.

### Документация

- [`SECURITY.md`](SECURITY.md) — security model;
- [`docs/SETTINGS.md`](docs/SETTINGS.md) — settings/themes/recovery;
- [`docs/EXTENSIONS.md`](docs/EXTENSIONS.md) — extension API;

---

## English

### About

**WebForge** is a standalone desktop IDE for web projects. It combines code editing, a native terminal, Git, language servers, testing, browser debugging, Preview, visual UI editing, project tooling, DevTools, extensions, and deployment in one local desktop application.

**WebForge v1.0.0 is the first public release.** Every capability below belongs to the single v1.0.0 release; no earlier public WebForge versions existed.

### Capabilities

#### Editor and workspace

- Monaco Editor with tabs, dirty-state, Save/Save All, and external-change protection;
- Explorer CRUD for files and directories;
- configurable font size, line height, indentation, word wrap, minimap, and format-on-save;
- delayed autosave;
- Command Palette and configurable keybindings;
- session restore and Hot Exit for tabs and dirty buffers;
- native filesystem watcher;
- Rust-based workspace search index with `.gitignore`, resource limits, and incremental updates;
- project Search/Replace where current unsaved Monaco buffers override disk-index content.

#### LSP and intelligence

WebForge supervises multiple language servers concurrently and routes editor requests to the server responsible for the active file type.

Supported capabilities include TypeScript/JavaScript via `typescript-language-server`, Vue via `vue-language-server`, Svelte via `svelteserver`, completion, hover, definition, references, rename, signature help, code actions, Document/Workspace Symbols, Semantic Tokens, Inlay Hints, formatting, CodeLens, document/workspace diagnostics, Call Hierarchy, Type Hierarchy, bounded logs, and controlled crash recovery.

#### Terminal, Tasks, and Test Explorer

- native Rust PTY with `xterm.js`;
- multiple terminal tabs and scrollback search;
- `package.json` scripts;
- Test Explorer for Vitest, Jest, and Playwright;
- machine-readable results with status, duration, stack trace, and source location;
- rerun failed tests;
- bounded history;
- coverage summaries.

#### Run / Debug

The browser debugger uses Chrome DevTools Protocol with an isolated temporary profile and loopback remote-debugging port. It provides `.webforge/launch.json`, Monaco breakpoints, pause/resume, stepping, call stack/frame selection, scopes/variables, Watch, frame-aware Debug Console, source-map mapping, and breakpoint resynchronization.

#### Preview and Visual Designer

Preview modes include Static HTML/CSS/JS, supervised Vite development preview with HMR, and raw production `dist` preview without the development bridge.

The Visual Designer supports Static HTML, React, Vue, and Svelte with development-only DOM → source mapping and source-buffer revalidation before writes.

It includes DOM Tree/Inspector, source navigation, safe static class/prop/attribute editing, simple text editing, insert/duplicate/delete, conservative drag/drop, Component Library/Marketplace, source-backed resize handles, box-model overlays, Flex/Grid controls, typography, gradients/shadows/borders/opacity, transforms/overflow/z-index, transitions/animations, bounded keyframes, container queries, responsive tools, Tailwind/Bootstrap-aware static-class editing, CSS variables/pseudo states/cascade/specificity/inheritance, and undo/redo.

Dynamic framework expressions and ambiguous structural boundaries fail closed instead of being rewritten.

#### Git

Source Control includes repository init, status/diff, stage/unstage/commit, local and remote branches, fetch/pull/push, branch switching, commit graph/history, file history, blame, stash, annotated tags, rebase, cherry-pick, conflict navigation, Monaco 3-way merge, and sanitized credential capability state.

Fetch/Pull/Push require a separate session-only Git Network Access grant.

#### Package Manager

Packages supports npm, pnpm, yarn, and bun with dependencies/devDependencies, scripts, install/remove/update/update-all, outdated, security audit, manager/lockfile detection, lifecycle scripts disabled by default, and explicit confirmation before enabling lifecycle scripts.

The WebView has no generic shell bridge; native code constructs constrained argument vectors.

#### Asset Manager

Asset inventory supports images, SVG, fonts, audio, and video with previews, sizes, reference counts, likely-unused discovery, relative-path copy, SVG editing/optimization, and vendor/build/symlink exclusion.

#### Project Health, SEO, and Accessibility

Source audits check language/title/description/canonical/social metadata/favicon/JSON-LD/robots/sitemap, heading hierarchy, image alt text, form labels/ARIA, positive tabindex, and local broken links with `file:line` navigation.

Runtime Accessibility additionally inspects rendered DOM, accessible names, duplicate IDs, heading order, tabindex, and computed contrast without claiming complete Lighthouse/axe parity.

#### DevTools

Development Preview provides Network Inspector, bounded request/response headers/bodies/timing, Local/Session Storage, cookie metadata, IndexedDB metadata, Navigation/Paint/LCP/CLS/Long Task/resource metrics, runtime Accessibility, and a native Bundle Analyzer.

Sensitive headers, cookie values, and secret-like storage values are redacted **before** reaching the main WebView.

#### Extensions and Component Marketplace

WebForge v1.0.0 includes a declarative capability-isolated extension host at:

```text
.webforge/extensions/<extension-id>/webforge-extension.json
```

Contributions can provide commands, safe text panels, component packs, project templates, token themes, project adapters, linter/formatter descriptors, and language descriptors. Extension manifests cannot inject arbitrary JavaScript, HTML, Tauri commands, or shell commands into the main window.

#### Project Templates

The New Project Wizard supports built-in and extension-provided templates for Static Web, React, Vue, Svelte/Vite, and other declaratively described project layouts.

#### Deploy Center

GitHub Pages, Cloudflare Pages, Netlify, and Vercel are supported. GitHub Pages uses generated Actions workflows. Direct deployment uses already-installed provider CLIs, while Cloudflare/Netlify/Vercel tokens remain in the OS credential manager and are never returned to the WebView.

#### Bundled Node.js / npm

Production installers can include a platform-specific Node.js 24 + npm runtime. The runtime is downloaded from the official Node distribution, verified against the SHA-256 manifest, and only then added to Tauri resources. This allows normal npm/Vite workflows without a mandatory separate Node.js installation for end users.

### Appearance themes

| Theme | Description |
| --- | --- |
| **Graphite** | neutral dark-gray default |
| **Slate** | brighter gray dark theme |
| **Cloud Light** | cool light theme |
| **Warm Paper** | warm light theme |
| **Frosted Glass** | translucent panels with blur/glass effect |
| **Midnight** | deep blue-black theme |

Theme selection updates the workbench, Monaco Editor, and integrated terminal together.

### Settings

User settings are local. Workspace overrides live in `.webforge/settings.json`. Workspace settings cannot grant Workspace Trust, Terminal Access, Git Network Access, or extension capabilities.

### Architecture

```text
React / TypeScript WebView
        │ typed Tauri invoke/events
        ▼
Rust / Tauri native core
        ├─ workspace/filesystem/watcher/search
        ├─ PTY/process supervision
        ├─ Git
        ├─ LSP
        ├─ browser debugger
        ├─ tests/packages/assets/audit/devtools
        ├─ settings/recovery
        ├─ extensions
        ├─ deploy/credentials
        └─ bundled runtime/release helpers
```

The main WebView has no generic shell permission. Sensitive operations use narrow Tauri commands and explicit permission gates. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`SECURITY.md`](SECURITY.md).

### Trust model

Unknown workspaces open in Restricted mode. Authority layers are Workspace access, Workspace Trust, Terminal Access, Git Network Access, and per-extension capabilities.

### Build from source

Requires Node.js 24, npm, Rust stable, and platform Tauri system dependencies.

```bash
npm ci
npm run verify:source
npm run check
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
npm run production:verify
npm run tauri -- dev
```

Rust tests:

```bash
npm run test:rust
```

### Development commands

```bash
npm run dev
npm run tauri -- dev
npm run check
npm run build
npm run production:verify
npm run verify:source
npm run test:rust
npm run runtime:prepare
```

### Useful shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd+Shift+N` | new project |
| `Ctrl/Cmd+O` | open workspace |
| `Ctrl/Cmd+S` | save active file |
| `Ctrl/Cmd+Shift+S` | save all dirty buffers |
| `Ctrl/Cmd+Shift+F` | Search / Replace |
| `Ctrl/Cmd+Shift+G` | Source Control |
| `Ctrl/Cmd+Shift+R` | start/stop supported runtime |
| `Ctrl/Cmd+K` / `F1` | Command Palette |
| `Ctrl/Cmd+,` | Settings |
| `Ctrl+F` in Terminal | search scrollback |

Core bindings are configurable in Settings.