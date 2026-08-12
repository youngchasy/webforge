import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { analyzeProjectBundle, runningInTauri } from "../lib/tauri";
import type { BundleAnalysis, DevToolsNetworkEntry, DevToolsPerformanceSnapshot, DevToolsStorageSnapshot, PreviewDevToolsCommand, RuntimeAccessibilitySnapshot } from "../types/devtools";

type Props = {
  previewReady: boolean;
  network: DevToolsNetworkEntry[];
  storage: DevToolsStorageSnapshot | null;
  performance: DevToolsPerformanceSnapshot | null;
  accessibility: RuntimeAccessibilitySnapshot | null;
  outputDir?: string | null;
  onCommand: (command: PreviewDevToolsCommand["action"]) => void;
  onClearNetwork: () => void;
};

type Tab = "network" | "storage" | "performance" | "accessibility" | "bundle";

function bytes(value: number | null | undefined): string {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}

function ms(value: number | null | undefined): string { return value == null ? "—" : `${Math.round(value)} ms`; }
function urlLabel(value: string): string { try { const url = new URL(value); return `${url.pathname}${url.search}` || "/"; } catch { return value; } }

export function DevToolsPanel({ previewReady, network, storage, performance, accessibility, outputDir, onCommand, onClearNetwork }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("network");
  const [selectedId, setSelectedId] = useState("");
  const [bundle, setBundle] = useState<BundleAnalysis | null>(null);
  const [bundleBusy, setBundleBusy] = useState(false);
  const [bundleError, setBundleError] = useState("");
  const selected = network.find((item) => item.id === selectedId) ?? null;
  const failed = useMemo(() => network.filter((item) => item.error || (item.status != null && item.status >= 400)).length, [network]);

  useEffect(() => { if (previewReady) onCommand("refresh"); }, [previewReady]);

  const analyzeBundle = async () => {
    if (!runningInTauri()) return;
    setBundleBusy(true); setBundleError("");
    try { setBundle(await analyzeProjectBundle(outputDir ?? undefined)); }
    catch (error) { setBundleError(String(error)); }
    finally { setBundleBusy(false); }
  };

  return <div className="sidebar-content devtools-panel">
    <div className="sidebar-header devtools-header"><div><strong>{t("devtools.title")}</strong><span>{t("devtools.description")}</span></div><button onClick={() => onCommand("refresh")} disabled={!previewReady}>↻</button></div>
    {!previewReady && <div className="tasks-security-note">{t("devtools.previewRequired")}</div>}
    <div className="devtools-tabs">
      <button className={tab === "network" ? "active" : ""} onClick={() => setTab("network")}>{t("devtools.network")}</button>
      <button className={tab === "storage" ? "active" : ""} onClick={() => setTab("storage")}>{t("devtools.storage")}</button>
      <button className={tab === "performance" ? "active" : ""} onClick={() => setTab("performance")}>{t("devtools.performance")}</button>
      <button className={tab === "accessibility" ? "active" : ""} onClick={() => setTab("accessibility")}>{t("devtools.accessibility")}</button>
      <button className={tab === "bundle" ? "active" : ""} onClick={() => setTab("bundle")}>{t("devtools.bundle")}</button>
    </div>

    {tab === "network" && <div className="devtools-section">
      <div className="devtools-toolbar"><span>{network.length} {t("devtools.requests")} · {failed} {t("devtools.failed")}</span><button onClick={onClearNetwork}>{t("common.clear")}</button></div>
      <div className="devtools-network-list">{network.length ? [...network].reverse().map((item) => <button key={item.id} className={selectedId === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span className={`network-status ${item.error || (item.status ?? 0) >= 400 ? "bad" : ""}`}>{item.status ?? (item.error ? "ERR" : "•")}</span><strong>{item.method}</strong><span title={item.url}>{urlLabel(item.url)}</span><small>{ms(item.durationMs)}</small></button>) : <div className="sidebar-empty">{t("devtools.noRequests")}</div>}</div>
      {selected && <div className="devtools-network-detail">
        <strong>{selected.method} {selected.url}</strong>
        <div className="devtools-metrics"><span>{selected.status ?? "—"} {selected.statusText}</span><span>{ms(selected.durationMs)}</span><span>{bytes(selected.transferSize)}</span><span>{selected.resourceType}</span></div>
        {selected.error && <pre className="devtools-error">{selected.error}</pre>}
        <details open><summary>{t("devtools.requestHeaders")}</summary><pre>{selected.requestHeaders.map((h) => `${h.name}: ${h.value}`).join("\n") || "—"}</pre></details>
        {selected.requestBody && <details><summary>{t("devtools.requestBody")}</summary><pre>{selected.requestBody}</pre></details>}
        <details><summary>{t("devtools.responseHeaders")}</summary><pre>{selected.responseHeaders.map((h) => `${h.name}: ${h.value}`).join("\n") || "—"}</pre></details>
        {selected.responseBody && <details><summary>{t("devtools.responseBody")}</summary><pre>{selected.responseBody}</pre></details>}
      </div>}
    </div>}

    {tab === "storage" && <div className="devtools-section">
      <div className="devtools-toolbar"><span>{storage?.origin || t("devtools.noSnapshot")}</span><button disabled={!previewReady} onClick={() => onCommand("refresh")}>↻</button></div>
      <details open><summary>{t("devtools.cookies")} · {storage?.cookies.length ?? 0}</summary><div className="devtools-kv">{storage?.cookies.map((item) => <div key={item.name}><code>{item.name}</code><span>{item.value}</span></div>)}</div><button disabled={!previewReady} onClick={() => onCommand("clearCookies")}>{t("devtools.clearCookies")}</button></details>
      <details open><summary>localStorage · {storage?.localStorage.length ?? 0}</summary><div className="devtools-kv">{storage?.localStorage.map((item) => <div key={item.key}><code>{item.key}</code><span>{item.value}</span></div>)}</div><button disabled={!previewReady} onClick={() => onCommand("clearLocalStorage")}>{t("common.clear")}</button></details>
      <details><summary>sessionStorage · {storage?.sessionStorage.length ?? 0}</summary><div className="devtools-kv">{storage?.sessionStorage.map((item) => <div key={item.key}><code>{item.key}</code><span>{item.value}</span></div>)}</div><button disabled={!previewReady} onClick={() => onCommand("clearSessionStorage")}>{t("common.clear")}</button></details>
      <details><summary>IndexedDB · {storage?.indexedDb.length ?? 0}</summary><div className="devtools-kv">{storage?.indexedDb.map((item) => <div key={item.name}><code>{item.name}</code><span>v{item.version}</span></div>)}</div></details>
      <p className="devtools-note">{t("devtools.storageSecurity")}</p>
    </div>}

    {tab === "performance" && <div className="devtools-section">
      <div className="devtools-card-grid">
        <Metric label="DOMContentLoaded" value={ms(performance?.domContentLoadedMs)} />
        <Metric label="Load" value={ms(performance?.loadMs)} />
        <Metric label="FCP" value={ms(performance?.firstContentfulPaintMs)} />
        <Metric label="LCP" value={ms(performance?.largestContentfulPaintMs)} />
        <Metric label="CLS" value={performance ? performance.cumulativeLayoutShift.toFixed(3) : "—"} />
        <Metric label={t("devtools.longTasks")} value={performance ? `${performance.longTaskCount} · ${ms(performance.longTaskTimeMs)}` : "—"} />
        <Metric label={t("devtools.resources")} value={performance ? String(performance.resourceCount) : "—"} />
        <Metric label={t("devtools.transfer")} value={bytes(performance?.transferSize)} />
      </div>
      <p className="devtools-note">{t("devtools.performanceNote")}</p>
    </div>}

    {tab === "accessibility" && <div className="devtools-section">
      <div className="devtools-toolbar"><span>{accessibility?.checkedNodes ?? 0} {t("devtools.nodesChecked")} · {accessibility?.findings.length ?? 0} {t("devtools.findings")}</span><button disabled={!previewReady} onClick={() => onCommand("refresh")}>↻</button></div>
      <div className="devtools-findings">{accessibility?.findings.length ? accessibility.findings.map((finding) => <div key={finding.id} className={`health-finding ${finding.severity}`}><strong>{finding.rule}</strong><span>{finding.message}</span><code>{finding.selector}</code>{finding.contrastRatio != null && <small>{t("devtools.contrast")}: {finding.contrastRatio.toFixed(2)}:1</small>}</div>) : <div className="sidebar-empty">{accessibility ? t("devtools.noA11yFindings") : t("devtools.noSnapshot")}</div>}</div>
      <p className="devtools-note">{t("devtools.a11yNote")}</p>
    </div>}

    {tab === "bundle" && <div className="devtools-section">
      <div className="devtools-toolbar"><span>{outputDir || "dist / build"}</span><button disabled={!runningInTauri() || bundleBusy} onClick={() => void analyzeBundle()}>{bundleBusy ? t("common.loading") : t("devtools.analyzeBundle")}</button></div>
      {bundleError && <div className="sidebar-error">{bundleError}</div>}
      {bundle && !bundle.exists && <div className="sidebar-empty">{t("devtools.bundleMissing", { path: bundle.outputDir })}</div>}
      {bundle?.exists && <>
        <div className="devtools-card-grid"><Metric label={t("devtools.totalBundle")} value={bytes(bundle.totalBytes)} /><Metric label={t("devtools.files")} value={String(bundle.fileCount)} /><Metric label="Source maps" value={bytes(bundle.sourcemapBytes)} /></div>
        <strong>{t("devtools.groups")}</strong><div className="devtools-kv">{bundle.groups.map((group) => <div key={group.kind}><code>{group.kind}</code><span>{group.files} · {bytes(group.sizeBytes)}</span></div>)}</div>
        <strong>{t("devtools.largestFiles")}</strong><div className="devtools-kv">{bundle.largest.map((asset) => <div key={asset.path}><code>{asset.path}</code><span>{bytes(asset.sizeBytes)}</span></div>)}</div>
      </>}
    </div>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="devtools-metric"><span>{label}</span><strong>{value}</strong></div>; }
