import type { IdeSettings, WebForgeCommandId, WorkspaceSettings } from "../types/settings";
import { normalizeBuiltinTheme } from "./themes";

export const DEFAULT_IDE_SETTINGS: IdeSettings = {
  appearance: {
    theme: "graphite",
  },
  editor: {
    fontSize: 13,
    lineHeight: 21,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: "off",
    minimap: true,
    formatOnSave: false,
  },
  files: {
    autoSave: "off",
    autoSaveDelay: 1000,
    restoreSession: true,
    hotExit: true,
  },
  search: {
    useNativeIndex: true,
    defaultExclude: "",
    maxResults: 2000,
  },
  keybindings: {
    commandPalette: "Ctrl+K",
    openFolder: "Ctrl+O",
    search: "Ctrl+Shift+F",
    sourceControl: "Ctrl+Shift+G",
    settings: "Ctrl+,",
    save: "Ctrl+S",
    saveAll: "Ctrl+Shift+S",
    newProject: "Ctrl+Shift+N",
    runProject: "Ctrl+Shift+R",
  },
};

const clamp = (value: unknown, fallback: number, min: number, max: number) => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const bool = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;
const text = (value: unknown, fallback: string, max = 512) => typeof value === "string" ? value.slice(0, max) : fallback;

export function normalizeIdeSettings(value: unknown): IdeSettings {
  const raw = value && typeof value === "object" ? value as Record<string, any> : {};
  const appearance = raw.appearance ?? {};
  const editor = raw.editor ?? {};
  const files = raw.files ?? {};
  const search = raw.search ?? {};
  const keybindings = raw.keybindings ?? {};
  const defaults = DEFAULT_IDE_SETTINGS;
  const keys = Object.keys(defaults.keybindings) as WebForgeCommandId[];
  return {
    appearance: { theme: normalizeBuiltinTheme(appearance.theme ?? defaults.appearance.theme) },
    editor: {
      fontSize: clamp(editor.fontSize, defaults.editor.fontSize, 9, 32),
      lineHeight: clamp(editor.lineHeight, defaults.editor.lineHeight, 14, 48),
      tabSize: clamp(editor.tabSize, defaults.editor.tabSize, 1, 8),
      insertSpaces: bool(editor.insertSpaces, defaults.editor.insertSpaces),
      wordWrap: editor.wordWrap === "on" ? "on" : "off",
      minimap: bool(editor.minimap, defaults.editor.minimap),
      formatOnSave: bool(editor.formatOnSave, defaults.editor.formatOnSave),
    },
    files: {
      autoSave: files.autoSave === "afterDelay" ? "afterDelay" : "off",
      autoSaveDelay: clamp(files.autoSaveDelay, defaults.files.autoSaveDelay, 250, 10000),
      restoreSession: bool(files.restoreSession, defaults.files.restoreSession),
      hotExit: bool(files.hotExit, defaults.files.hotExit),
    },
    search: {
      useNativeIndex: bool(search.useNativeIndex, defaults.search.useNativeIndex),
      defaultExclude: text(search.defaultExclude, defaults.search.defaultExclude, 2000),
      maxResults: clamp(search.maxResults, defaults.search.maxResults, 100, 10000),
    },
    keybindings: Object.fromEntries(keys.map((key) => [key, text(keybindings[key], defaults.keybindings[key], 48)])) as IdeSettings["keybindings"],
  };
}

export function mergeIdeSettings(base: IdeSettings, workspace: WorkspaceSettings | null | undefined): IdeSettings {
  return normalizeIdeSettings({
    appearance: base.appearance,
    editor: { ...base.editor, ...(workspace?.editor ?? {}) },
    files: { ...base.files, ...(workspace?.files ?? {}) },
    search: { ...base.search, ...(workspace?.search ?? {}) },
    keybindings: { ...base.keybindings, ...(workspace?.keybindings ?? {}) },
  });
}

export function shortcutMatches(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+").map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return false;
  const key = parts.at(-1) ?? "";
  const ctrl = parts.includes("ctrl") || parts.includes("cmd") || parts.includes("meta");
  const shift = parts.includes("shift");
  const alt = parts.includes("alt") || parts.includes("option");
  const modifierDown = event.ctrlKey || event.metaKey;
  const normalizedKey = event.key.toLowerCase();
  return modifierDown === ctrl && event.shiftKey === shift && event.altKey === alt && normalizedKey === key;
}

export function displayShortcut(shortcut: string): string {
  return shortcut.replace(/Ctrl/gi, navigator.platform?.toLowerCase().includes("mac") ? "⌘" : "Ctrl").replace(/Shift/gi, "⇧").replace(/Alt/gi, navigator.platform?.toLowerCase().includes("mac") ? "⌥" : "Alt").replaceAll("+", "");
}
