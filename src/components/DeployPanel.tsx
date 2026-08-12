import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  clearDeployCredential,
  deployProject,
  generateGitHubPagesWorkflow,
  getDeployConfig,
  getDeployProviders,
  saveDeployConfig,
  storeDeployCredential,
} from "../lib/tauri";
import type { DeployConfig, DeployProviderConfig, DeployProviderId, DeployProviderState, DeployResult } from "../types/deploy";

const emptyProvider = (): DeployProviderConfig => ({ outputDir: "dist", projectName: "", accountId: "", siteId: "", production: true });
const emptyConfig = (): DeployConfig => ({ githubPages: emptyProvider(), cloudflare: emptyProvider(), netlify: emptyProvider(), vercel: emptyProvider() });

const providerKey: Record<DeployProviderId, keyof DeployConfig> = {
  "github-pages": "githubPages",
  cloudflare: "cloudflare",
  netlify: "netlify",
  vercel: "vercel",
};

export function DeployPanel({ native, workspacePath, trusted, terminalAllowed, outputDir }: { native: boolean; workspacePath: string; trusted: boolean; terminalAllowed: boolean; outputDir?: string | null }) {
  const { t } = useI18n();
  const [provider, setProvider] = useState<DeployProviderId>("github-pages");
  const [config, setConfig] = useState<DeployConfig>(emptyConfig);
  const [providers, setProviders] = useState<DeployProviderState[]>([]);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const secretRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    if (!native || !workspacePath) return;
    try {
      const [nextConfig, nextProviders] = await Promise.all([getDeployConfig(), getDeployProviders()]);
      if (outputDir) {
        for (const key of Object.values(providerKey)) if (!nextConfig[key].outputDir) nextConfig[key].outputDir = outputDir;
      }
      setConfig(nextConfig);
      setProviders(nextProviders);
      setError("");
    } catch (err) { setError(String(err)); }
  }, [native, outputDir, workspacePath]);

  useEffect(() => { void refresh(); }, [refresh]);

  const state = providers.find((item) => item.id === provider) ?? null;
  const current = config[providerKey[provider]];
  const direct = provider !== "github-pages";
  const canExecute = native && Boolean(workspacePath) && trusted && (!direct || terminalAllowed);

  const patch = (values: Partial<DeployProviderConfig>) => {
    setConfig((currentConfig) => ({ ...currentConfig, [providerKey[provider]]: { ...currentConfig[providerKey[provider]], ...values } }));
  };

  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try { await saveDeployConfig(config); setNotice(t("deploy.configSaved")); }
    catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };

  const storeSecret = async () => {
    const secret = secretRef.current?.value.trim() ?? "";
    if (!secret) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await storeDeployCredential(provider, secret);
      if (secretRef.current) secretRef.current.value = "";
      await refresh();
      setNotice(t("deploy.credentialStored"));
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };

  const clearSecret = async () => {
    if (!window.confirm(t("deploy.credentialRemoveConfirm"))) return;
    setBusy(true); setError("");
    try { await clearDeployCredential(provider); await refresh(); setNotice(t("deploy.credentialRemoved")); }
    catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };

  const deploy = async () => {
    setBusy(true); setError(""); setNotice(""); setResult(null);
    try {
      await saveDeployConfig(config);
      if (provider === "github-pages") {
        const path = await generateGitHubPagesWorkflow(current.outputDir || outputDir || "dist");
        setNotice(t("deploy.workflowCreated", { path }));
      } else {
        const next = await deployProject(provider, current);
        setResult(next);
        if (!next.success) setError(t("deploy.failed"));
      }
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };

  const providerTabs = useMemo(() => (["github-pages", "cloudflare", "netlify", "vercel"] as DeployProviderId[]), []);

  if (!native) return <div className="sidebar-feature"><div className="panel-heading"><span>{t("deploy.title")}</span></div><div className="sidebar-empty">{t("deploy.desktopRequired")}</div></div>;
  if (!workspacePath) return <div className="sidebar-feature"><div className="panel-heading"><span>{t("deploy.title")}</span></div><div className="sidebar-empty">{t("deploy.openWorkspace")}</div></div>;

  return <div className="sidebar-feature tool-sidebar deploy-panel">
    <div className="panel-heading"><span>{t("deploy.title")}</span><button onClick={() => void refresh()} title={t("common.refresh")}>↻</button></div>
    <div className="tool-sidebar-scroll">
      <div className="deploy-tabs">{providerTabs.map((id) => <button key={id} className={provider === id ? "active" : ""} onClick={() => { setProvider(id); setResult(null); setError(""); }}>{t(`deploy.provider.${id}`)}</button>)}</div>
      <div className="tool-summary-card">
        <strong>{t(`deploy.provider.${provider}`)}</strong>
        <span>{provider === "github-pages" ? t("deploy.githubWorkflowHint") : (state?.cliAvailable ? `${t("deploy.cliReady")}${state.cliVersion ? ` · ${state.cliVersion}` : ""}` : t("deploy.cliMissing"))}</span>
      </div>

      {!trusted ? <div className="tool-warning">{t("deploy.trustRequired")}</div> : null}
      {direct && !terminalAllowed ? <div className="tool-warning">{t("deploy.terminalRequired")}</div> : null}

      <section className="tool-section">
        <div className="tool-section-title">{t("deploy.output")}</div>
        <input className="tool-search-input" value={current.outputDir} onChange={(event) => patch({ outputDir: event.target.value })} placeholder={outputDir || "dist"} />
        {provider === "cloudflare" && <>
          <label className="deploy-field"><span>{t("deploy.projectName")}</span><input value={current.projectName} onChange={(event) => patch({ projectName: event.target.value })} /></label>
          <label className="deploy-field"><span>{t("deploy.accountId")}</span><input value={current.accountId} onChange={(event) => patch({ accountId: event.target.value })} /></label>
        </>}
        {provider === "netlify" && <label className="deploy-field"><span>{t("deploy.siteId")}</span><input value={current.siteId} onChange={(event) => patch({ siteId: event.target.value })} /></label>}
        {provider !== "github-pages" && <label className="tool-check"><input type="checkbox" checked={current.production} onChange={(event) => patch({ production: event.target.checked })} /> {t("deploy.production")}</label>}
        <button disabled={busy || !trusted} onClick={() => void save()}>{t("deploy.saveConfig")}</button>
      </section>

      {direct && <section className="tool-section">
        <div className="tool-section-heading"><span>{t("deploy.credential")}</span><span className={state?.credentialStored ? "trust-text trusted" : "trust-text restricted"}>{state?.credentialStored ? t("deploy.stored") : t("deploy.notStored")}</span></div>
        <div className="tool-inline-input"><input ref={secretRef} type="password" autoComplete="off" placeholder={t("deploy.tokenPlaceholder")} /><button disabled={busy || !trusted} onClick={() => void storeSecret()}>✓</button></div>
        {state?.credentialStored ? <button className="danger-action" disabled={busy || !trusted} onClick={() => void clearSecret()}>{t("deploy.forgetCredential")}</button> : null}
        <div className="deploy-security-note">{t("deploy.secretBoundary")}</div>
      </section>}

      <section className="tool-section">
        <button className="primary-button deploy-primary" disabled={busy || !canExecute || (direct && (!state?.cliAvailable || !state.credentialStored))} onClick={() => void deploy()}>{provider === "github-pages" ? t("deploy.generateWorkflow") : t("deploy.deployNow")}</button>
        {direct && !state?.cliAvailable ? <div className="sidebar-empty compact-empty">{t("deploy.installCli", { cli: provider === "cloudflare" ? "wrangler" : provider })}</div> : null}
      </section>

      {notice ? <div className="tool-success">{notice}</div> : null}
      {result ? <section className="tool-section"><div className="tool-section-title">{result.success ? t("deploy.done") : t("deploy.failed")}</div><code className="tool-command">{result.command}</code>{result.url ? <a className="deploy-url" href={result.url} target="_blank" rel="noreferrer">{result.url}</a> : null}<pre className="tool-output">{result.output || t("packages.noOutput")}</pre></section> : null}
      {busy ? <div className="tool-progress">{t("common.loading")}</div> : null}
      {error ? <div className="tool-error">{error}</div> : null}
    </div>
  </div>;
}
