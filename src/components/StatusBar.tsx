import type { EditorFile } from "../types/workspace";
import { useI18n } from "../i18n";

type Props = {
  workspaceKind: string;
  projectLabel: string;
  trusted: boolean;
  native: boolean;
  runtimeState: string;
  activeFile?: EditorFile;
  dirtyCount: number;
  externalChangeCount: number;
  errorCount: number;
  warningCount: number;
  gitBranch?: string | null;
  intelligenceFiles?: number;
  intelligenceTruncated?: boolean;
  nativeWatcherActive?: boolean;
  languageServerLabel?: string | null;
};

export function StatusBar({ workspaceKind, projectLabel, trusted, native, runtimeState, activeFile, dirtyCount, externalChangeCount, errorCount, warningCount, gitBranch, intelligenceFiles = 0, intelligenceTruncated = false, nativeWatcherActive = false, languageServerLabel = null }: Props) {
  const { t } = useI18n();
  return (
    <footer className="statusbar">
      <div className="status-left">
        <span>⑂ {gitBranch ?? "—"}{dirtyCount ? "*" : ""}</span>
        <span>× {errorCount}</span>
        <span>△ {warningCount}</span>
        {externalChangeCount > 0 && <span>↻ {t("common.externalCount", { count: externalChangeCount })}</span>}
        <span>{projectLabel}</span>
      </div>
      <div className="status-right">
        {intelligenceFiles > 0 && <span title={t("status.intelligenceTitle")}>◇ {intelligenceFiles}{intelligenceTruncated ? "+" : ""}</span>}
        {languageServerLabel && <span title={t("status.languageServerTitle")}>LSP {languageServerLabel}</span>}
        {native && <span title={t(nativeWatcherActive ? "status.nativeWatcher" : "status.pollWatcher")}>{nativeWatcherActive ? "⚡FS" : "↻FS"}</span>}
        <span>{runtimeState}</span>
        <span className={trusted ? "status-trust trusted" : "status-trust restricted"}>{native ? (trusted ? t("common.trusted") : t("common.restricted")) : t("common.demo")}</span>
        <span>{dirtyCount ? t("common.unsavedCount", { count: dirtyCount }) : t("common.saved")}</span>
        <span>{activeFile?.language ?? t("status.noFile")}</span>
        <span>UTF-8</span>
        <span>{workspaceKind}</span>
      </div>
    </footer>
  );
}
