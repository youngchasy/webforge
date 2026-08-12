import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import "../monaco/setup";
import * as monaco from "monaco-editor";
import type { EditorTarget } from "../types/designer";
import type { EditorFile } from "../types/workspace";
import type { EditorDiagnostic } from "../types/diagnostics";
import type { DebugBreakpoint } from "../types/debug";
import type { BuiltinThemeId, IdeSettings } from "../types/settings";
import { ensureWebForgeMonacoThemes, monacoThemeFor } from "../monaco/themes";
import { collectMonacoDiagnostics, configureMonacoIntelligence } from "../monaco/intelligence";

type Props = {
  file: EditorFile;
  onChange: (value: string) => void;
  target?: EditorTarget | null;
  onDiagnosticsChange?: (diagnostics: EditorDiagnostic[]) => void;
  onCursorChange?: (line: number, column: number) => void;
  breakpoints?: DebugBreakpoint[];
  onToggleBreakpoint?: (path: string, line: number, column: number) => void;
  editorSettings?: IdeSettings["editor"];
  uiTheme?: BuiltinThemeId;
};

export type CodeEditorHandle = {
  formatDocument: () => Promise<string | null>;
  focus: () => void;
};

function uriFor(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  return monaco.Uri.parse(`file:///${normalized}`);
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor({ file, onChange, target, onDiagnosticsChange, onCursorChange, breakpoints = [], onToggleBreakpoint, editorSettings, uiTheme = "graphite" }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const changeRef = useRef(onChange);
  const diagnosticsRef = useRef(onDiagnosticsChange);
  const cursorRef = useRef(onCursorChange);
  const toggleBreakpointRef = useRef(onToggleBreakpoint);

  useImperativeHandle(ref, () => ({
    async formatDocument() {
      const editor = editorRef.current;
      if (!editor) return null;
      const action = editor.getAction("editor.action.formatDocument");
      if (action) await action.run();
      return editor.getValue();
    },
    focus() { editorRef.current?.focus(); },
  }), []);

  useEffect(() => { changeRef.current = onChange; }, [onChange]);
  useEffect(() => { diagnosticsRef.current = onDiagnosticsChange; }, [onDiagnosticsChange]);
  useEffect(() => { cursorRef.current = onCursorChange; }, [onCursorChange]);
  useEffect(() => { toggleBreakpointRef.current = onToggleBreakpoint; }, [onToggleBreakpoint]);

  useEffect(() => {
    configureMonacoIntelligence();
    ensureWebForgeMonacoThemes();
    if (!hostRef.current) return;

    const uri = uriFor(file.relativePath);
    const existing = monaco.editor.getModel(uri);
    const model = existing ?? monaco.editor.createModel(file.content, file.language, uri);
    if (model.getLanguageId() !== file.language) monaco.editor.setModelLanguage(model, file.language);

    const editor = monaco.editor.create(hostRef.current, {
      model,
      theme: monacoThemeFor(uiTheme),
      automaticLayout: true,
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontSize: editorSettings?.fontSize ?? 13,
      lineHeight: editorSettings?.lineHeight ?? 21,
      minimap: { enabled: editorSettings?.minimap ?? true, scale: 1, showSlider: "mouseover" },
      glyphMargin: true,
      smoothScrolling: true,
      padding: { top: 12, bottom: 20 },
      renderLineHighlight: "all",
      scrollBeyondLastLine: false,
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      wordWrap: editorSettings?.wordWrap ?? "off",
      tabSize: editorSettings?.tabSize ?? 2,
      insertSpaces: editorSettings?.insertSpaces ?? true,
      quickSuggestions: { other: true, comments: false, strings: true },
      suggest: { preview: true, showStatusBar: true, snippetsPreventQuickSuggestions: false },
      parameterHints: { enabled: true, cycle: true },
      inlayHints: { enabled: "on" },
      codeLens: true,
    });

    editorRef.current = editor;
    decorationsRef.current = editor.createDecorationsCollection();
    const subscription = editor.onDidChangeModelContent(() => changeRef.current(editor.getValue()));
    const publishDiagnostics = () => diagnosticsRef.current?.(collectMonacoDiagnostics());
    const markerSubscription = monaco.editor.onDidChangeMarkers(() => publishDiagnostics());
    const cursorSubscription = editor.onDidChangeCursorPosition((event) => cursorRef.current?.(event.position.lineNumber, event.position.column));
    const mouseSubscription = editor.onMouseDown((event) => {
      if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !event.target.position) return;
      toggleBreakpointRef.current?.(file.relativePath, event.target.position.lineNumber, 1);
    });
    const initialPosition = editor.getPosition();
    if (initialPosition) cursorRef.current?.(initialPosition.lineNumber, initialPosition.column);
    window.setTimeout(publishDiagnostics, 0);

    return () => {
      mouseSubscription.dispose();
      cursorSubscription.dispose();
      markerSubscription.dispose();
      subscription.dispose();
      decorationsRef.current?.clear();
      decorationsRef.current = null;
      editor.dispose();
      editorRef.current = null;
    };
  }, [file.relativePath, file.language]);


  useEffect(() => {
    ensureWebForgeMonacoThemes();
    monaco.editor.setTheme(monacoThemeFor(uiTheme));
  }, [uiTheme]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      fontSize: editorSettings?.fontSize ?? 13,
      lineHeight: editorSettings?.lineHeight ?? 21,
      wordWrap: editorSettings?.wordWrap ?? "off",
      tabSize: editorSettings?.tabSize ?? 2,
      insertSpaces: editorSettings?.insertSpaces ?? true,
      minimap: { enabled: editorSettings?.minimap ?? true },
    });
  }, [editorSettings?.fontSize, editorSettings?.insertSpaces, editorSettings?.lineHeight, editorSettings?.minimap, editorSettings?.tabSize, editorSettings?.wordWrap]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model && model.getValue() !== file.content) model.setValue(file.content);
  }, [file.content]);

  useEffect(() => {
    const collection = decorationsRef.current;
    if (!collection) return;
    collection.set(breakpoints.filter((item) => item.path === file.relativePath && item.enabled).map((item) => ({
      range: new monaco.Range(item.line, 1, item.line, 1),
      options: {
        isWholeLine: true,
        className: item.resolved ? "debug-breakpoint-line" : "debug-breakpoint-line debug-breakpoint-line-pending",
        glyphMarginClassName: item.resolved ? "debug-breakpoint-glyph" : "debug-breakpoint-glyph debug-breakpoint-glyph-pending",
        glyphMarginHoverMessage: { value: item.resolved ? "Breakpoint" : "Breakpoint pending" },
      },
    })));
  }, [breakpoints, file.relativePath]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !target || target.path !== file.relativePath) return;
    const lineNumber = Math.max(1, target.line || 1);
    const column = Math.max(1, target.column || 1);
    editor.setPosition({ lineNumber, column });
    editor.revealLineInCenter(lineNumber);
    editor.focus();
  }, [file.relativePath, target?.token]);

  return <div className="code-editor" ref={hostRef} />;
});
