import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { ExtensionCatalogEntry, ExtensionCapability, ExtensionRecord, ExtensionThemeSummary } from "../types/extensions";

type Props = {
  native: boolean;
  workspacePath: string;
  trusted: boolean;
  extensions: ExtensionRecord[];
  catalog: ExtensionCatalogEntry[];
  onRefresh: () => Promise<void>;
  onInstall: (extensionId: string) => Promise<void>;
  onUninstall: (extensionId: string) => Promise<void>;
  onSetEnabled: (extensionId: string, enabled: boolean) => Promise<void>;
  onSetCapability: (extensionId: string, capability: ExtensionCapability, granted: boolean) => Promise<void>;
  onApplyTheme: (theme: ExtensionThemeSummary | null) => void;
};

function contributionText(extension: ExtensionRecord | ExtensionCatalogEntry): string {
  const entries = Object.entries(extension.contributions).filter(([, value]) => value > 0);
  return entries.map(([key, value]) => `${key}:${value}`).join(" · ");
}

export function ExtensionsPanel({ native, workspacePath, trusted, extensions, catalog, onRefresh, onInstall, onUninstall, onSetEnabled, onSetCapability, onApplyTheme }: Props) {
  const { t } = useI18n();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const installedIds = useMemo(() => new Set(extensions.map((extension) => extension.id)), [extensions]);

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError("");
    try { await action(); } catch (reason) { setError(String(reason)); } finally { setBusy(""); }
  };

  if (!native) return <div className="sidebar-feature"><div className="panel-heading"><span>{t("activity.extensions")}</span></div><div className="sidebar-empty">{t("extensions.desktopOnly")}</div></div>;
  if (!workspacePath) return <div className="sidebar-feature"><div className="panel-heading"><span>{t("activity.extensions")}</span></div><div className="sidebar-empty">{t("extensions.openWorkspace")}</div></div>;

  return (
    <div className="sidebar-feature tool-sidebar extensions-panel">
      <div className="panel-heading"><span>{t("extensions.title")}</span><button title={t("common.refresh")} onClick={() => void run("refresh", onRefresh)}>↻</button></div>
      <div className={trusted ? "extension-security trusted" : "extension-security restricted"}>
        <strong>{trusted ? t("extensions.trustedHost") : t("extensions.restrictedHost")}</strong>
        <small>{t("extensions.securityNote")}</small>
      </div>
      {error && <div className="tool-error">{error}</div>}
      <div className="extension-scroll">
        <section className="extension-section">
          <div className="extension-section-title"><strong>{t("extensions.installed")}</strong><span>{extensions.length}</span></div>
          {!extensions.length && <div className="sidebar-empty compact">{t("extensions.noneInstalled")}</div>}
          {extensions.map((extension) => (
            <article className={extension.enabled ? "extension-card enabled" : "extension-card"} key={extension.id}>
              <header>
                <span><strong>{extension.name}</strong><small>{extension.publisher || extension.id} · {extension.version}</small></span>
                <label className="extension-switch" title={t("extensions.enable")}> <input type="checkbox" checked={extension.enabled} disabled={!trusted || Boolean(busy)} onChange={(event) => void run(`enable:${extension.id}`, () => onSetEnabled(extension.id, event.target.checked))} /><span /></label>
              </header>
              <p>{extension.description || t("extensions.noDescription")}</p>
              <code>{extension.id}</code>
              <small className="extension-contributions">{contributionText(extension) || t("extensions.noContributions")}</small>
              {!!extension.requestedCapabilities.length && <div className="extension-capabilities">
                <strong>{t("extensions.capabilities")}</strong>
                {extension.requestedCapabilities.map((capability) => {
                  const granted = extension.grantedCapabilities.includes(capability);
                  return <label key={capability} title={t("extensions.capabilityHelp", { capability })}><input type="checkbox" checked={granted} disabled={!trusted || !extension.enabled || Boolean(busy)} onChange={(event) => void run(`cap:${extension.id}:${capability}`, () => onSetCapability(extension.id, capability, event.target.checked))} /><span>{capability}</span></label>;
                })}
              </div>}
              {trusted && !!extension.panels.length && <div className="extension-panels">
                {extension.panels.map((panel) => <details key={panel.id}><summary>{panel.title}</summary><pre>{panel.body}</pre></details>)}
              </div>}
              {!!extension.themes.length && <div className="extension-theme-actions">
                {extension.themes.map((theme) => <button key={theme.id} disabled={!trusted || !extension.enabled} onClick={() => onApplyTheme(theme)}>{t("extensions.applyTheme", { theme: theme.label })}</button>)}
                <button onClick={() => onApplyTheme(null)}>{t("extensions.resetTheme")}</button>
              </div>}
              <footer><button className="danger-lite" disabled={!trusted || Boolean(busy)} onClick={() => { if (window.confirm(t("extensions.uninstallConfirm", { name: extension.name }))) void run(`remove:${extension.id}`, () => onUninstall(extension.id)); }}>{t("extensions.uninstall")}</button></footer>
            </article>
          ))}
        </section>

        <section className="extension-section marketplace-section">
          <div className="extension-section-title"><strong>{t("extensions.marketplace")}</strong><span>{t("extensions.bundledCatalog")}</span></div>
          <div className="extension-marketplace-note">{t("extensions.marketplaceNote")}</div>
          {catalog.map((entry) => {
            const installed = entry.installed || installedIds.has(entry.id);
            return <article className="extension-card catalog" key={entry.id}>
              <header><span><strong>{entry.name}</strong><small>{entry.publisher} · {entry.version}</small></span><span className={installed ? "extension-installed-badge" : "extension-catalog-badge"}>{installed ? t("extensions.installedBadge") : t("extensions.catalogBadge")}</span></header>
              <p>{entry.description}</p>
              <small className="extension-contributions">{contributionText(entry)}</small>
              {!!entry.capabilities.length && <div className="extension-requested-list">{entry.capabilities.map((capability) => <code key={capability}>{capability}</code>)}</div>}
              <footer><button className="primary-button" disabled={installed || !trusted || Boolean(busy)} onClick={() => void run(`install:${entry.id}`, () => onInstall(entry.id))}>{installed ? t("extensions.installedBadge") : t("extensions.install")}</button></footer>
            </article>;
          })}
        </section>
      </div>
    </div>
  );
}
