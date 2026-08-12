import { useI18n } from "../i18n";
import { projectStackLabel } from "../project-adapters";
import type { ProjectInfo, RuntimeEnvironment, RuntimeStatus } from "../types/runtime";
import type { ReleaseUpdateConfig, ReleaseUpdateInfo } from "../types/terminal";

type Props = {
  workspaceName: string;
  recentPaths: string[];
  projectInfo: ProjectInfo;
  runtimeEnvironment: RuntimeEnvironment | null;
  runtimeStatus: RuntimeStatus;
  trusted: boolean;
  terminalAllowed: boolean;
  productionPreviewActive: boolean;
  productionPreviewAvailable: boolean;
  native: boolean;
  updateConfig: ReleaseUpdateConfig | null;
  updateInfo: ReleaseUpdateInfo | null;
  updateChecking: boolean;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  onNewProject: () => void;
  onOpenFolder: () => void;
  onOpenRecent: (path: string) => void;
  onSave: () => void;
  onSaveAll: () => void;
  onTogglePreview: () => void;
  previewVisible: boolean;
  onSetTrusted: (trusted: boolean) => void;
  onStartDevServer: () => void;
  onBuild: () => void;
  onOpenProductionPreview: () => void;
  onUseSourcePreview: () => void;
  onSetTerminalAccess: (allowed: boolean) => void;
  onInstallDependencies: () => void;
  onStopRuntime: () => void;
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
};

function runtimeVersion(environment: RuntimeEnvironment | null, manager: string | null): string {
  if (!environment || !manager) return "";
  const tool = environment[manager as keyof RuntimeEnvironment];
  return tool?.version ? ` ${tool.version}${tool.source ? ` · ${tool.source}` : ""}` : "";
}

export function TopBar({
  workspaceName,
  recentPaths,
  projectInfo,
  runtimeEnvironment,
  runtimeStatus,
  trusted,
  terminalAllowed,
  productionPreviewActive,
  productionPreviewAvailable,
  native,
  updateConfig,
  updateInfo,
  updateChecking,
  onCheckUpdates,
  onInstallUpdate,
  onNewProject,
  onOpenFolder,
  onOpenRecent,
  onSave,
  onSaveAll,
  onTogglePreview,
  previewVisible,
  onSetTrusted,
  onStartDevServer,
  onBuild,
  onOpenProductionPreview,
  onUseSourcePreview,
  onSetTerminalAccess,
  onInstallDependencies,
  onStopRuntime,
  onOpenCommandPalette,
  onOpenSettings,
}: Props) {
  const { locale, t } = useI18n();
  const canRun = native && projectInfo.vite && projectInfo.devServerSupported && Boolean(projectInfo.devScript);
  const canBuild = native && projectInfo.buildSupported && Boolean(projectInfo.buildScript);
  const busy = runtimeStatus.running;

  return (
    <header className="topbar">
      <div className="brand-lockup"><span className="brand-mark">W</span><span className="brand-name">WebForge</span></div>
      <nav className="top-menu" aria-label={t("top.aria")}>
        <button onClick={onNewProject}>{t("top.new")}</button>
        <button onClick={onOpenFolder}>{t("top.open")}</button>
        <details className="recent-menu">
          <summary>{t("top.recent")}</summary>
          <div className="recent-popover">
            {recentPaths.length ? recentPaths.map((path) => <button key={path} onClick={() => onOpenRecent(path)} title={path}>{path}</button>) : <span>{t("top.noRecent")}</span>}
          </div>
        </details>
        <button onClick={onSave}>{t("common.save")}</button>
        <button onClick={onSaveAll}>{t("common.saveAll")}</button>
        <button>{t("top.edit")}</button>
        <details className="project-menu">
          <summary>{t("top.project")}</summary>
          <div className="project-popover">
            <div className="project-popover-title"><strong>{projectInfo.label}</strong><span>{projectStackLabel(projectInfo)}</span></div>
            <div className="project-facts">
              <span>{t("top.adapter")}</span><strong>{projectInfo.adapter}</strong>
              <span>{t("top.packageManager")}</span><strong>{projectInfo.preferredPackageManager ?? "—"}{runtimeVersion(runtimeEnvironment, projectInfo.preferredPackageManager)}</strong>
              <span>{t("top.dependencies")}</span><strong>{projectInfo.packageJson ? (projectInfo.dependenciesInstalled ? t("common.installed") : t("common.missing")) : t("common.notRequired")}</strong>
              <span>{t("top.devScript")}</span><strong>{projectInfo.devScript ? `${projectInfo.devScript}${projectInfo.devServerSupported ? " · Vite" : ` · ${t("common.unsupported")}`}` : "—"}</strong>
              <span>{t("top.build")}</span><strong>{projectInfo.buildScript ? `${projectInfo.buildScript}${projectInfo.buildSupported ? ` → ${projectInfo.buildOutputDir ?? "dist"}/` : ` · ${t("common.unsupported")}`}` : "—"}</strong>
              <span>{t("top.workspace")}</span><strong className={trusted ? "trust-text trusted" : "trust-text restricted"}>{native ? (trusted ? t("common.trusted") : t("common.restricted")) : t("common.demo")}</strong>
              <span>{t("top.terminal")}</span><strong className={terminalAllowed ? "trust-text trusted" : "trust-text restricted"}>{native ? (terminalAllowed ? t("top.allowedSession") : t("common.blocked")) : t("common.unavailable")}</strong>
            </div>
            {projectInfo.cssFrameworks.length > 0 && <div className="project-tags">{projectInfo.cssFrameworks.map((framework) => <span key={framework}>{framework}</span>)}</div>}
            <div className="project-actions-menu">
              {native && <button onClick={() => onSetTrusted(!trusted)}>{trusted ? t("top.enableRestricted") : t("top.trustWorkspace")}</button>}
              {native && trusted && <button onClick={() => onSetTerminalAccess(!terminalAllowed)}>{terminalAllowed ? t("top.disableTerminal") : t("top.enableTerminal")}</button>}
              {projectInfo.packageJson && !projectInfo.dependenciesInstalled && <button onClick={onInstallDependencies}>{t("top.installDependencies")}</button>}
              {canRun && !busy && <button onClick={onStartDevServer}>{t("top.startDevServer")}</button>}
              {canBuild && !busy && <button onClick={onBuild}>{t("top.buildProduction")}</button>}
              {productionPreviewAvailable && <button onClick={productionPreviewActive ? onUseSourcePreview : onOpenProductionPreview}>{productionPreviewActive ? t("top.returnSourcePreview") : t("top.previewOutput", { dir: projectInfo.buildOutputDir ?? "dist" })}</button>}
              {busy && <button onClick={onStopRuntime}>{t("top.stopRuntime")}</button>}
              {updateConfig?.configured && <button disabled={updateChecking} onClick={onCheckUpdates}>{updateChecking ? t("top.checkingUpdates") : t("top.checkUpdates", { channel: updateConfig.channel })}</button>}
              {updateInfo?.available && <button className="primary-button" onClick={onInstallUpdate}>{t("top.installUpdate", { version: updateInfo.version })}</button>}
              <button onClick={onOpenSettings}>{t("top.settings")}</button>
            </div>
          </div>
        </details>
        <button onClick={onOpenCommandPalette}>{t("top.tools")}</button>
      </nav>
      <div className="workspace-title" title={workspaceName}>{workspaceName}</div>
      <div className="top-actions">
        {canRun && <button className={`run-button ${runtimeStatus.running && runtimeStatus.mode === "dev" ? "running" : ""}`} onClick={runtimeStatus.running ? onStopRuntime : onStartDevServer} title={runtimeStatus.running ? t("top.stopProjectRuntime") : t("top.startVite")}>{runtimeStatus.running ? "■" : "▶"}</button>}
        {canBuild && !runtimeStatus.running && <button className="build-button" onClick={onBuild} title={t("top.buildDir", { dir: projectInfo.buildOutputDir ?? "dist" })}>◆</button>}
        <span className={`trust-badge ${trusted ? "trusted" : "restricted"}`} title={native ? t("top.executionPolicy") : t("top.browserDemo")}>{(native ? (trusted ? t("common.trusted") : t("common.restricted")) : t("common.demo")).toUpperCase()}</span>
        {terminalAllowed && <span className="terminal-access-badge" title={t("top.terminalEnabled")}>TERM</span>}
        {updateInfo?.available && <button className="update-badge" onClick={onInstallUpdate} title={t("top.updateReady")}>{t("common.update").toUpperCase()} {updateInfo.version}</button>}
        {productionPreviewActive && <span className="dist-badge" title={t("top.productionPreview", { dir: projectInfo.buildOutputDir ?? "dist" })}>DIST</span>}
        <span className="project-badge" title={projectStackLabel(projectInfo)}>{projectInfo.framework ?? (projectInfo.vite ? "Vite" : "HTML")}</span>
        <button className="language-badge" onClick={onOpenSettings} title={t("settings.language")}>{locale.toUpperCase()}</button>
        <button className={previewVisible ? "icon-button active" : "icon-button"} onClick={onTogglePreview} title={t("top.togglePreview")}>◫</button>
        <span className="dev-badge">{t("app.versionBadge")}</span>
      </div>
    </header>
  );
}
