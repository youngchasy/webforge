# Настройки WebForge v1.0.0 / WebForge v1.0.0 Settings

## Русский

### Scopes

WebForge использует:

- **User settings** — локальные настройки приложения;
- **Workspace settings** — overrides в `.webforge/settings.json`.

Effective settings = User + Workspace overrides.

### Appearance

| ID | UI name | Описание |
| --- | --- | --- |
| `graphite` | Graphite | neutral dark-gray default |
| `slate` | Slate | brighter gray dark theme |
| `light` | Cloud Light | cool light |
| `paper` | Warm Paper | warm light |
| `glass` | Frosted Glass | translucent dark panels |
| `midnight` | Midnight | deep blue-black |

Тема применяется к workbench, Monaco и terminal. Frosted Glass создаёт translucency/blur внутренних panels и не гарантирует прозрачность native OS window.

### Editor

```json
{
  "editor": {
    "fontSize": 14,
    "lineHeight": 22,
    "tabSize": 2,
    "insertSpaces": true,
    "wordWrap": "off",
    "minimap": true,
    "formatOnSave": false
  }
}
```

Monaco options обновляются через `editor.updateOptions()` без recreation editor instance.

### Files

```json
{
  "files": {
    "autoSave": "off",
    "autoSaveDelay": 1000,
    "restoreSession": true,
    "hotExit": true
  }
}
```

`autoSave`: `off` или `afterDelay`.

Autosave не обходит external-change conflict protection.

### Search

```json
{
  "search": {
    "useNativeIndex": true,
    "defaultExclude": "",
    "maxResults": 500
  }
}
```

Native index сохраняет собственные hard resource limits. В Settings доступен explicit rebuild.

### Keybindings

Настраиваются:

```text
commandPalette
openFolder
search
sourceControl
settings
save
saveAll
newProject
runProject
```

Command Palette показывает effective binding.

### Полный workspace example

```json
{
  "editor": {
    "fontSize": 15,
    "lineHeight": 23,
    "tabSize": 2,
    "insertSpaces": true,
    "wordWrap": "on",
    "minimap": false,
    "formatOnSave": true
  },
  "files": {
    "autoSave": "afterDelay",
    "autoSaveDelay": 1200,
    "restoreSession": true,
    "hotExit": true
  },
  "search": {
    "useNativeIndex": true,
    "defaultExclude": "**/generated/**",
    "maxResults": 800
  },
  "keybindings": {
    "search": "Ctrl+Shift+F",
    "sourceControl": "Ctrl+Shift+G"
  }
}
```

### Session restore и Hot Exit

При `restoreSession` WebForge может восстановить последний workspace/tabs.

При `hotExit` bounded dirty buffers сохраняются в OS app-data. Recovery не является скрытым write-to-project. Если disk file изменился, restore создаёт external-change conflict вместо автоматической перезаписи.

### Security

`.webforge/settings.json` имеет фиксированное расположение, size limits и symlink checks. Settings не могут grant'ить Workspace Trust, Terminal Access, Git Network Access или extension capabilities.

---

## English

### Scopes

WebForge uses local **User settings** plus **Workspace settings** overrides in `.webforge/settings.json`.

Effective settings = User + Workspace overrides.

### Appearance

| ID | UI name | Description |
| --- | --- | --- |
| `graphite` | Graphite | neutral dark-gray default |
| `slate` | Slate | brighter gray dark theme |
| `light` | Cloud Light | cool light |
| `paper` | Warm Paper | warm light |
| `glass` | Frosted Glass | translucent dark panels |
| `midnight` | Midnight | deep blue-black |

Themes apply to the workbench, Monaco, and terminal. Frosted Glass uses translucent/blurred internal panels and does not guarantee a transparent native OS window.

### Editor

Workspace editor settings include font size, line height, tab size, spaces/tabs, word wrap, minimap, and format-on-save. Monaco applies option changes through `editor.updateOptions()` without recreating the editor.

### Files

File settings include autosave (`off` / `afterDelay`), autosave delay, session restore, and Hot Exit. Autosave does not bypass external-change conflict protection.

### Search

Search settings control native-index use, default excludes, and max results. The native index keeps independent hard resource limits and can be explicitly rebuilt from Settings.

### Keybindings

Core commands include Command Palette, Open Folder, Search, Source Control, Settings, Save, Save All, New Project, and Run Project. The Command Palette shows effective bindings.

### Session restore and Hot Exit

With session restore enabled, WebForge can reopen the previous workspace/tabs. Hot Exit stores bounded dirty buffers in OS app-data. Recovery is not a hidden project write; changed disk content becomes an external-change conflict instead of being silently overwritten.

### Security

`.webforge/settings.json` has a fixed location, size limits, and symlink checks. Settings cannot grant Workspace Trust, Terminal Access, Git Network Access, or extension capabilities.
