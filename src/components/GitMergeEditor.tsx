import { useEffect, useRef } from "react";
import "../monaco/setup";
import * as monaco from "monaco-editor";
import { languageFromPath } from "../lib/language";
import type { GitConflictSnapshot } from "../types/git";
import { useI18n } from "../i18n";
import { ensureWebForgeMonacoThemes, monacoThemeFor } from "../monaco/themes";
import { normalizeBuiltinTheme } from "../lib/themes";

function mergeUri(path: string, role: string) {
  const safe = path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/[^a-zA-Z0-9._/-]/g, "_");
  return monaco.Uri.parse(`inmemory://webforge-git-merge/${role}/${safe}`);
}

type Props = {
  conflict: GitConflictSnapshot;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onApply: () => void;
  onResolve: () => void;
  onAcceptOurs: () => void;
  onAcceptTheirs: () => void;
  onAcceptBoth: () => void;
  canResolve: boolean;
};

export function GitMergeEditor({ conflict, value, onChange, onClose, onApply, onResolve, onAcceptOurs, onAcceptTheirs, onAcceptBoth, canResolve }: Props) {
  const { t } = useI18n();
  const oursRef = useRef<HTMLDivElement>(null);
  const theirsRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const resultEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const changeRef = useRef(onChange);

  useEffect(() => { changeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!oursRef.current || !theirsRef.current || !resultRef.current) return;
    const language = languageFromPath(conflict.path);
    ensureWebForgeMonacoThemes();
    const uiTheme = normalizeBuiltinTheme(document.documentElement.dataset.theme);
    monaco.editor.setTheme(monacoThemeFor(uiTheme));
    const baseModel = monaco.editor.createModel(conflict.base ?? "", language, mergeUri(conflict.path, "base"));
    const oursModel = monaco.editor.createModel(conflict.ours ?? "", language, mergeUri(conflict.path, "ours"));
    const theirsModel = monaco.editor.createModel(conflict.theirs ?? "", language, mergeUri(conflict.path, "theirs"));
    const resultModel = monaco.editor.createModel(value, language, mergeUri(conflict.path, "result"));
    const sharedOptions: monaco.editor.IDiffEditorConstructionOptions = {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      renderOverviewRuler: true,
      minimap: { enabled: false },
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontSize: 12,
      lineHeight: 19,
      scrollBeyondLastLine: false,
      originalEditable: false,
    };
    const oursEditor = monaco.editor.createDiffEditor(oursRef.current, sharedOptions);
    oursEditor.setModel({ original: baseModel, modified: oursModel });
    const theirsEditor = monaco.editor.createDiffEditor(theirsRef.current, sharedOptions);
    theirsEditor.setModel({ original: baseModel, modified: theirsModel });
    const resultEditor = monaco.editor.create(resultRef.current, {
      model: resultModel,
      theme: monacoThemeFor(uiTheme),
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontSize: 12,
      lineHeight: 19,
      scrollBeyondLastLine: false,
      wordWrap: "off",
      padding: { top: 8, bottom: 12 },
    });
    resultEditorRef.current = resultEditor;
    const subscription = resultEditor.onDidChangeModelContent(() => changeRef.current(resultEditor.getValue()));

    return () => {
      subscription.dispose();
      oursEditor.dispose();
      theirsEditor.dispose();
      resultEditor.dispose();
      resultEditorRef.current = null;
      resultModel.dispose();
      theirsModel.dispose();
      oursModel.dispose();
      baseModel.dispose();
    };
  }, [conflict.path, conflict.base, conflict.ours, conflict.theirs]);

  useEffect(() => {
    const editor = resultEditorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  return <div className="git-merge-overlay" role="dialog" aria-modal="true" aria-label={t("git.mergeEditorTitle", { path: conflict.path })}>
    <div className="git-merge-shell">
      <header className="git-merge-header">
        <div><strong>{t("git.mergeEditorTitle", { path: conflict.path })}</strong><small>{t("git.mergeEditorHint")}</small></div>
        <button onClick={onClose} aria-label={t("common.close")}>×</button>
      </header>
      <div className="git-merge-comparisons">
        <section><div className="git-merge-label">{t("git.baseVsOurs")}</div><div ref={oursRef} className="git-merge-diff-host" /></section>
        <section><div className="git-merge-label">{t("git.baseVsTheirs")}</div><div ref={theirsRef} className="git-merge-diff-host" /></section>
      </div>
      <div className="git-merge-result-toolbar">
        <strong>{t("git.mergeResult")}</strong>
        <div>
          <button onClick={onAcceptOurs}>{t("git.acceptOurs")}</button>
          <button onClick={onAcceptTheirs}>{t("git.acceptTheirs")}</button>
          <button onClick={onAcceptBoth}>{t("git.acceptBoth")}</button>
          <button onClick={onApply}>{t("git.applyToEditor")}</button>
          <button className="primary-button" disabled={!canResolve} onClick={onResolve}>{t("git.resolveAndStage")}</button>
        </div>
      </div>
      <div ref={resultRef} className="git-merge-result-host" />
    </div>
  </div>;
}
