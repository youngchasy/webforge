import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { AuditCategory, AuditSeverity, ProjectAuditSummary } from "../types/audit";

type Props = {
  native: boolean;
  workspacePath: string;
  runAudit: () => Promise<ProjectAuditSummary>;
  openFileAt: (path: string, line: number, column: number) => void;
};

export function ProjectHealthPanel({ native, workspacePath, runAudit, openFileAt }: Props) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<ProjectAuditSummary | null>(null);
  const [category, setCategory] = useState<AuditCategory | "all">("all");
  const [severity, setSeverity] = useState<AuditSeverity | "all">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!native || !workspacePath) { setSummary(null); return; }
    setLoading(true);
    try { setSummary(await runAudit()); setError(""); }
    catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }, [native, runAudit, workspacePath]);

  useEffect(() => { void refresh(); }, [refresh]);

  const findings = useMemo(() => (summary?.findings ?? []).filter((item) => (category === "all" || item.category === category) && (severity === "all" || item.severity === severity)), [category, severity, summary]);

  if (!native) return <div className="sidebar-feature"><div className="panel-heading"><span>{t("health.title")}</span></div><div className="sidebar-empty">{t("health.desktopRequired")}</div></div>;
  if (!workspacePath) return <div className="sidebar-feature"><div className="panel-heading"><span>{t("health.title")}</span></div><div className="sidebar-empty">{t("health.openWorkspace")}</div></div>;

  return <div className="sidebar-feature tool-sidebar">
    <div className="panel-heading"><span>{t("health.title")}</span><button onClick={() => void refresh()} title={t("health.runAudit")}>↻</button></div>
    <div className="tool-sidebar-scroll">
      <div className="health-score-grid"><div className="error"><strong>{summary?.errors ?? 0}</strong><span>{t("health.errors")}</span></div><div className="warning"><strong>{summary?.warnings ?? 0}</strong><span>{t("health.warnings")}</span></div><div><strong>{summary?.infos ?? 0}</strong><span>{t("health.info")}</span></div></div>
      <div className="tool-summary-card"><strong>{t("health.staticAudit")}</strong><span>{t("health.filesScanned", { count: summary?.filesScanned ?? 0 })}</span><small>{t("health.auditScope")}</small></div>
      <div className="health-filters">
        <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="all">{t("health.allCategories")}</option><option value="seo">SEO</option><option value="accessibility">A11y</option><option value="links">{t("health.links")}</option></select>
        <select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}><option value="all">{t("health.allSeverities")}</option><option value="error">{t("health.errors")}</option><option value="warning">{t("health.warnings")}</option><option value="info">{t("health.info")}</option></select>
      </div>
      <div className="health-findings">
        {findings.map((item) => <button key={item.id} className={`health-finding ${item.severity}`} onClick={() => item.path && openFileAt(item.path, item.line, 1)} disabled={!item.path}>
          <div><span className="health-severity">{item.severity === "error" ? "×" : item.severity === "warning" ? "!" : "i"}</span><strong>{item.rule}</strong><em>{item.category}</em></div>
          <p>{item.message}</p>
          {item.path ? <code>{item.path}:{item.line}</code> : null}
          {item.suggestion ? <small>{item.suggestion}</small> : null}
        </button>)}
        {!findings.length && !loading ? <div className="sidebar-empty compact-empty">{t("health.noFindings")}</div> : null}
      </div>
      <div className="tool-warning subtle">{t("health.runtimeNote")}</div>
      {loading ? <div className="tool-progress">{t("health.running")}</div> : null}
      {error ? <div className="tool-error">{error}</div> : null}
    </div>
  </div>;
}
