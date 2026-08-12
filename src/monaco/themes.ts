import * as monaco from "monaco-editor";
import type { BuiltinThemeId } from "../types/settings";

let registered = false;

export function ensureWebForgeMonacoThemes() {
  if (registered) return;
  registered = true;
  const darkRules: monaco.editor.ITokenThemeRule[] = [
    { token: "comment", foreground: "7f8a97", fontStyle: "italic" },
    { token: "keyword", foreground: "9fb9ef" },
    { token: "string", foreground: "9fc89b" },
    { token: "number", foreground: "d7a87d" },
    { token: "type", foreground: "78b7c8" },
  ];
  monaco.editor.defineTheme("webforge-midnight", { base: "vs-dark", inherit: true, rules: darkRules, colors: { "editor.background": "#13161b", "editor.foreground": "#d8dce5", "editorLineNumber.foreground": "#59616d", "editorLineNumber.activeForeground": "#aeb8c5", "editor.selectionBackground": "#34527e88", "editor.lineHighlightBackground": "#1a2028" } });
  monaco.editor.defineTheme("webforge-graphite", { base: "vs-dark", inherit: true, rules: darkRules, colors: { "editor.background": "#202020", "editor.foreground": "#dedede", "editorLineNumber.foreground": "#707070", "editorLineNumber.activeForeground": "#c4c4c4", "editor.selectionBackground": "#485f7d88", "editor.lineHighlightBackground": "#292929", "editorGutter.background": "#202020" } });
  monaco.editor.defineTheme("webforge-slate", { base: "vs-dark", inherit: true, rules: darkRules, colors: { "editor.background": "#34383d", "editor.foreground": "#e1e5ea", "editorLineNumber.foreground": "#858c95", "editorLineNumber.activeForeground": "#e3e7ec", "editor.selectionBackground": "#577ca677", "editor.lineHighlightBackground": "#3c4147", "editorGutter.background": "#34383d" } });
  monaco.editor.defineTheme("webforge-glass", { base: "vs-dark", inherit: true, rules: darkRules, colors: { "editor.background": "#252b33", "editor.foreground": "#e2e7ef", "editorLineNumber.foreground": "#778292", "editorLineNumber.activeForeground": "#dfe7f3", "editor.selectionBackground": "#5c81b788", "editor.lineHighlightBackground": "#303741", "editorGutter.background": "#252b33" } });
  const lightRules: monaco.editor.ITokenThemeRule[] = [
    { token: "comment", foreground: "6b747d", fontStyle: "italic" },
    { token: "keyword", foreground: "315f9a" },
    { token: "string", foreground: "397749" },
    { token: "number", foreground: "9a5b2a" },
    { token: "type", foreground: "176b78" },
  ];
  monaco.editor.defineTheme("webforge-light", { base: "vs", inherit: true, rules: lightRules, colors: { "editor.background": "#ffffff", "editor.foreground": "#262b31", "editorLineNumber.foreground": "#9aa1a8", "editorLineNumber.activeForeground": "#4b525a", "editor.selectionBackground": "#b9d3f288", "editor.lineHighlightBackground": "#f3f6f9", "editorGutter.background": "#ffffff" } });
  monaco.editor.defineTheme("webforge-paper", { base: "vs", inherit: true, rules: [
    { token: "comment", foreground: "7b746b", fontStyle: "italic" },
    { token: "keyword", foreground: "66518d" },
    { token: "string", foreground: "4e744e" },
    { token: "number", foreground: "986338" },
    { token: "type", foreground: "4d7184" },
  ], colors: { "editor.background": "#fffdf8", "editor.foreground": "#38342f", "editorLineNumber.foreground": "#aaa095", "editorLineNumber.activeForeground": "#625b54", "editor.selectionBackground": "#d9ceeaaa", "editor.lineHighlightBackground": "#f7f1e8", "editorGutter.background": "#fffdf8" } });
}

export function monacoThemeFor(theme: BuiltinThemeId): string {
  return `webforge-${theme}`;
}
