import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { PackageCommandResult, PackageManifest } from "../types/packages";

type Props = {
  native: boolean;
  workspacePath: string;
  trusted: boolean;
  terminalAllowed: boolean;
  getManifest: () => Promise<PackageManifest>;
  installPackage: (name: string, dev: boolean, allowLifecycleScripts: boolean) => Promise<PackageCommandResult>;
  removePackage: (name: string, allowLifecycleScripts: boolean) => Promise<PackageCommandResult>;
  updatePackage: (name: string | null, allowLifecycleScripts: boolean) => Promise<PackageCommandResult>;
  getOutdated: () => Promise<PackageCommandResult>;
  runAudit: () => Promise<PackageCommandResult>;
};

export function PackageManagerPanel({ native, workspacePath, trusted, terminalAllowed, getManifest, installPackage, removePackage, updatePackage, getOutdated, runAudit }: Props) {
  const { t } = useI18n();
  const [manifest, setManifest] = useState<PackageManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [packageName, setPackageName] = useState("");
  const [dev, setDev] = useState(false);
  const [allowScripts, setAllowScripts] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<PackageCommandResult | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!native || !workspacePath) { setManifest(null); return; }
    try { setManifest(await getManifest()); setError(""); }
    catch (err) { setError(String(err)); }
  }, [getManifest, native, workspacePath]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (action: () => Promise<PackageCommandResult>, refreshAfter = false) => {
    if (allowScripts && !window.confirm(t("packages.lifecycleConfirm"))) return;
    setLoading(true); setError("");
    try {
      const next = await action();
      setResult(next);
      if (refreshAfter) await refresh();
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (manifest?.dependencies ?? []).filter((item) => !normalized || item.name.toLowerCase().includes(normalized));
  }, [manifest, query]);

  if (!native) return <div className="sidebar-feature"><div className="panel-heading"><span>{t("packages.title")}</span></div><div className="sidebar-empty">{t("packages.desktopRequired")}</div></div>;
  if (!workspacePath) return <div className="sidebar-feature"><div className="panel-heading"><span>{t("packages.title")}</span></div><div className="sidebar-empty">{t("packages.openWorkspace")}</div></div>;

  return <div className="sidebar-feature tool-sidebar">
    <div className="panel-heading"><span>{t("packages.title")}</span><button onClick={() => void refresh()} title={t("common.refresh")}>↻</button></div>
    <div className="tool-sidebar-scroll">
      {!manifest?.available ? <div className="sidebar-empty compact-empty">{t("packages.noPackageJson")}</div> : <>
        <div className="tool-summary-card">
          <strong>{manifest.manager ?? t("common.unavailable")}</strong>
          <span>{manifest.lockfile ?? t("packages.noLockfile")}</span>
          {manifest.packageManagerField ? <code>{manifest.packageManagerField}</code> : null}
        </div>

        {!trusted || !terminalAllowed ? <div className="tool-warning">{t("packages.executionBlocked")}</div> : null}

        <section className="tool-section">
          <div className="tool-section-title">{t("packages.install")}</div>
          <div className="tool-inline-input"><input value={packageName} onChange={(event) => setPackageName(event.target.value)} placeholder={t("packages.packagePlaceholder")} /><button disabled={loading || !terminalAllowed || !packageName.trim()} onClick={() => void run(() => installPackage(packageName, dev, allowScripts), true)}>+</button></div>
          <label className="tool-check"><input type="checkbox" checked={dev} onChange={(event) => setDev(event.target.checked)} /> {t("packages.devDependency")}</label>
          <label className="tool-check warning-check"><input type="checkbox" checked={allowScripts} onChange={(event) => setAllowScripts(event.target.checked)} /> {t("packages.allowLifecycle")}</label>
        </section>

        <section className="tool-section">
          <div className="tool-section-heading"><span>{t("packages.dependencies", { count: manifest.dependencies.length })}</span><div><button disabled={loading || !terminalAllowed} onClick={() => void run(() => getOutdated())}>{t("packages.outdated")}</button><button disabled={loading || !terminalAllowed} onClick={() => void run(() => runAudit())}>{t("packages.audit")}</button></div></div>
          <input className="tool-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("packages.filter")} />
          <div className="package-list">
            {filtered.map((item) => <div className="package-row" key={`${item.kind}:${item.name}`}>
              <div><strong>{item.name}</strong><span>{item.requested}</span><small>{item.kind === "devDependency" ? "dev" : "prod"}</small></div>
              <div><button disabled={loading || !terminalAllowed} title={t("common.update")} onClick={() => void run(() => updatePackage(item.name, allowScripts), true)}>↑</button><button className="danger-action" disabled={loading || !terminalAllowed} title={t("common.remove")} onClick={() => void run(() => removePackage(item.name, allowScripts), true)}>×</button></div>
            </div>)}
          </div>
        </section>

        <section className="tool-section">
          <div className="tool-section-heading"><span>{t("packages.scripts", { count: manifest.scripts.length })}</span><button disabled={loading || !terminalAllowed} onClick={() => void run(() => updatePackage(null, allowScripts), true)}>{t("packages.updateAll")}</button></div>
          <div className="script-list">{manifest.scripts.map((script) => <div key={script.name}><strong>{script.name}</strong><code>{script.command}</code></div>)}</div>
        </section>

        {result?.outdated.length ? <section className="tool-section"><div className="tool-section-title">{t("packages.outdatedResults")}</div><div className="package-list">{result.outdated.map((item) => <div className="package-row" key={item.name}><div><strong>{item.name}</strong><span>{item.current ?? "?"} → {item.latest ?? item.wanted ?? "?"}</span></div></div>)}</div></section> : null}
        {result ? <section className="tool-section"><div className="tool-section-title">{result.success ? t("packages.commandDone") : t("packages.commandFailed")}</div><code className="tool-command">{result.command}</code><pre className="tool-output">{result.output || t("packages.noOutput")}</pre></section> : null}
      </>}
      {loading ? <div className="tool-progress">{t("common.loading")}</div> : null}
      {error ? <div className="tool-error">{error}</div> : null}
    </div>
  </div>;
}
