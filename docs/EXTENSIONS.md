# WebForge v1.0.0 Extension API

## Русский

### Модель

WebForge использует **декларативный** extension host. Он позволяет добавлять команды, панели, компоненты, templates и descriptors без arbitrary JavaScript/native execution внутри основного окна IDE.

### Файлы

```text
.webforge/extensions/<extension-id>/webforge-extension.json
.webforge/extensions-state.json
```

Manifest/state валидируются native Rust layer; symlinked extension paths отклоняются.

### Capabilities

```text
workspace.read
workspace.write
editor.commands
ui.panels
designer.components
project.templates
editor.theme
project.adapters
diagnostics.contribute
formatters.contribute
languages.contribute
```

Requested capability не grant'ится автоматически. Extension должна быть включена, workspace должен удовлетворять trust requirements, а пользователь должен подтвердить grant.

### Пример manifest

```json
{
  "id": "example.web-tools",
  "name": "Example Web Tools",
  "version": "1.0.0",
  "publisher": "example",
  "description": "Example declarative extension",
  "capabilities": ["editor.commands", "designer.components"],
  "contributes": {
    "commands": [
      {
        "id": "example.openReadme",
        "title": "Open README",
        "action": { "type": "openFile", "path": "README.md" }
      }
    ],
    "components": [
      {
        "packId": "example-basic",
        "id": "notice",
        "label": "Notice",
        "category": "Content",
        "snippet": "<aside class=\"notice\">Notice</aside>"
      }
    ]
  }
}
```

### Commands

Allowlisted actions:

- `showMessage`;
- workspace-relative `openFile`;
- workspace-relative `createFile`.

Extension command не может вызвать arbitrary Tauri command, shell, CDP или LSP method.

### Panels

Panels отображаются как inert declarative text/content, а не как arbitrary HTML/JS execution surface.

### Component packs

Component snippets объединяются с Component Marketplace/Designer picker. Snippet остаётся subject to обычной source-safety model Designer.

### Project templates

Template может создать bounded набор workspace-relative файлов. Проверяются traversal, file count и total bytes. Post-create arbitrary shell hook отсутствует.

### Themes

Extension theme меняет только allowlisted WebForge color tokens. Произвольный CSS manifest'ом не внедряется.

Встроенные Graphite/Slate/Cloud Light/Warm Paper/Frosted Glass/Midnight независимы от extension host.

### Descriptors

Manifest может декларативно описывать project adapters, linters, formatters и languages. Descriptor сам по себе не является permission на запуск стороннего binary.

### Marketplace

v1.0.0 содержит offline-first bundled catalog. Будущий remote registry должен сохранить manifest/capability/path validation и не превращать WebView в unrestricted code host.

### Execution boundary

v1.0.0 не содержит arbitrary executable plugin runtime. Если такой host появится в будущем, ему нужна отдельная sandboxed/signed process/WASM boundary.

---

## English

### Model

WebForge uses a **declarative** extension host. It allows commands, panels, components, templates, and descriptors without arbitrary JavaScript/native execution inside the main IDE window.

### Files

```text
.webforge/extensions/<extension-id>/webforge-extension.json
.webforge/extensions-state.json
```

Manifest/state data is validated by the native Rust layer; symlinked extension paths are rejected.

### Capabilities

```text
workspace.read
workspace.write
editor.commands
ui.panels
designer.components
project.templates
editor.theme
project.adapters
diagnostics.contribute
formatters.contribute
languages.contribute
```

Requested capabilities are never granted automatically. The extension must be enabled, workspace trust requirements must be satisfied, and the user must grant the capability.

### Manifest example

```json
{
  "id": "example.web-tools",
  "name": "Example Web Tools",
  "version": "1.0.0",
  "publisher": "example",
  "description": "Example declarative extension",
  "capabilities": ["editor.commands", "designer.components"],
  "contributes": {
    "commands": [
      {
        "id": "example.openReadme",
        "title": "Open README",
        "action": { "type": "openFile", "path": "README.md" }
      }
    ],
    "components": [
      {
        "packId": "example-basic",
        "id": "notice",
        "label": "Notice",
        "category": "Content",
        "snippet": "<aside class=\"notice\">Notice</aside>"
      }
    ]
  }
}
```

### Commands

Allowlisted actions are `showMessage`, workspace-relative `openFile`, and workspace-relative `createFile`. Extension commands cannot invoke arbitrary Tauri commands, shell, CDP, or LSP methods.

### Panels

Panels render as inert declarative text/content rather than arbitrary HTML/JavaScript execution surfaces.

### Component packs

Component snippets merge into the Component Marketplace/Designer picker and remain subject to the Designer source-safety model.

### Project templates

Templates can create a bounded set of workspace-relative files. Traversal, file count, and total bytes are validated. There is no arbitrary post-create shell hook.

### Themes

Extension themes modify allowlisted WebForge color tokens only. Arbitrary CSS is not injected through manifests. Built-in themes are independent from the extension host.

### Descriptors

Manifests may declaratively describe project adapters, linters, formatters, and language integrations. A descriptor alone does not authorize third-party binary execution.

### Marketplace

v1.0.0 includes an offline-first bundled catalog. Any future remote registry must preserve manifest/capability/path validation and must not turn the WebView into an unrestricted code host.

### Execution boundary

v1.0.0 has no arbitrary executable plugin runtime. A future native/WASM/process host should use a separate sandboxed/signed boundary.
