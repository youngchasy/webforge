import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { AssetInventory, AssetOptimizeResult } from "../types/assets";

type Props = {
  native: boolean;
  workspacePath: string;
  trusted: boolean;
  previewBaseUrl: string;
  getAssets: () => Promise<AssetInventory>;
  optimizeSvg: (path: string) => Promise<AssetOptimizeResult>;
  openFile: (path: string) => void;
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function AssetManagerPanel({ native, workspacePath, trusted, previewBaseUrl, getAssets, optimizeSvg, openFile }: Props) {
  const { t } = useI18n();
  const [inventory, setInventory] = useState<AssetInventory | null>(null);
  const [query, setQuery] = useState("");
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    if (!native || !workspacePath) { setInventory(null); return; }
    setLoading(true);
    try {
      const next = await getAssets();
      setInventory(next);
      setSelectedPath((current) => current && next.assets.some((item) => item.path === current) ? current : next.assets[0]?.path ?? "");
      setError("");
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }, [getAssets, native, workspacePath]);

  useEffect(() => { void refresh(); }, [refresh]);

  const assets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (inventory?.assets ?? []).filter((item) => (!unusedOnly || item.unused) && (!normalized || item.path.toLowerCase().includes(normalized)));
  }, [inventory, query, unusedOnly]);
  const selected = inventory?.assets.find((item) => item.path === selectedPath) ?? null;
  const assetUrl = useMemo(() => {
    if (!selected || !previewBaseUrl) return "";
    try { return new URL(selected.path.split("/").map(encodeURIComponent).join("/"), previewBaseUrl).toString(); }
    catch { return ""; }
  }, [previewBaseUrl, selected]);

  const copyPath = async () => {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.path); setNotice(t("assets.pathCopied")); }
    catch { setNotice(selected.path); }
  };

  const optimize = async () => {
    if (!selected || selected.kind !== "svg") return;
    setLoading(true); setError("");
    try {
      const result = await optimizeSvg(selected.path);
      setNotice(t("assets.optimized", { bytes: result.savedBytes }));
      await refresh();
    } catch (err) { setError(String(err)); setLoading(false); }
  };

  if (!native) return <div className="sidebar-feature"><div className="panel-heading"><span>{t("assets.title")}</span></div><div className="sidebar-empty">{t("assets.desktopRequired")}</div></div>;
  if (!workspacePath) return <div className="sidebar-feature"><div className="panel-heading"><span>{t("assets.title")}</span></div><div className="sidebar-empty">{t("assets.openWorkspace")}</div></div>;

  return <div className="sidebar-feature tool-sidebar">
    <div className="panel-heading"><span>{t("assets.title")}</span><button onClick={() => void refresh()} title={t("common.refresh")}>↻</button></div>
    <div className="tool-sidebar-scroll">
      <div className="tool-summary-card"><strong>{t("assets.count", { count: inventory?.assets.length ?? 0 })}</strong><span>{formatBytes(inventory?.totalBytes ?? 0)}</span><small>{t("assets.scanned", { count: inventory?.scannedTextFiles ?? 0 })}</small></div>
      <div className="asset-filters"><input className="tool-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("assets.filter")} /><label className="tool-check"><input type="checkbox" checked={unusedOnly} onChange={(event) => setUnusedOnly(event.target.checked)} /> {t("assets.unusedOnly")}</label></div>
      <div className="asset-list">
        {assets.map((asset) => <button key={asset.path} className={`asset-row ${asset.path === selectedPath ? "active" : ""}`} onClick={() => setSelectedPath(asset.path)} title={asset.path}>
          <span className="asset-kind">{asset.kind === "image" || asset.kind === "svg" ? "▧" : asset.kind === "font" ? "Aa" : asset.kind === "video" ? "▶" : asset.kind === "audio" ? "♪" : "•"}</span>
          <span><strong>{asset.name}</strong><small>{formatBytes(asset.sizeBytes)} · {t("assets.references", { count: asset.references })}</small></span>
          {asset.unused ? <em>{t("assets.unused")}</em> : null}
        </button>)}
        {!assets.length && !loading ? <div className="sidebar-empty compact-empty">{t("assets.empty")}</div> : null}
      </div>
      {selected ? <section className="tool-section asset-detail">
        <div className="tool-section-title">{selected.path}</div>
        {assetUrl && (selected.kind === "image" || selected.kind === "svg") ? <div className="asset-preview"><img src={assetUrl} alt="" /></div> : null}
        {assetUrl && selected.kind === "audio" ? <audio controls src={assetUrl} /> : null}
        {assetUrl && selected.kind === "video" ? <video controls src={assetUrl} /> : null}
        <div className="asset-actions"><button onClick={() => void copyPath()}>{t("assets.copyPath")}</button>{selected.kind === "svg" ? <button disabled={!trusted || loading} onClick={() => void optimize()}>{t("assets.optimizeSvg")}</button> : null}{selected.kind === "svg" ? <button onClick={() => openFile(selected.path)}>{t("common.open")}</button> : null}</div>
        {!trusted && selected.kind === "svg" ? <div className="tool-warning">{t("assets.trustToOptimize")}</div> : null}
      </section> : null}
      {notice ? <div className="tool-notice">{notice}</div> : null}
      {loading ? <div className="tool-progress">{t("common.loading")}</div> : null}
      {error ? <div className="tool-error">{error}</div> : null}
    </div>
  </div>;
}
