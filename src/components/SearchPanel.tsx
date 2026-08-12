import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { WorkspaceReplacement, WorkspaceSearchOptions, WorkspaceSearchResponse } from "../types/search";

type Props = {
  workspaceName: string;
  onSearch: (options: WorkspaceSearchOptions) => Promise<WorkspaceSearchResponse>;
  onReplaceAll: (options: WorkspaceSearchOptions, replacement: string) => Promise<WorkspaceReplacement[]>;
  onOpenResult: (path: string, line: number, column: number) => void;
  defaultExclude?: string;
  maxResults?: number;
};

const initialOptions: WorkspaceSearchOptions = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  include: "",
  exclude: "",
  maxResults: 2_000,
};

export function SearchPanel({ workspaceName, onSearch, onReplaceAll, onOpenResult, defaultExclude = "", maxResults = 2_000 }: Props) {
  const { t } = useI18n();
  const [options, setOptions] = useState<WorkspaceSearchOptions>(() => ({ ...initialOptions, exclude: defaultExclude, maxResults }));
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [response, setResponse] = useState<WorkspaceSearchResponse>({ matches: [], filesScanned: 0, truncated: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const grouped = useMemo(() => {
    const map = new Map<string, WorkspaceSearchResponse["matches"]>();
    for (const match of response.matches) map.set(match.path, [...(map.get(match.path) ?? []), match]);
    return [...map.entries()];
  }, [response.matches]);

  useEffect(() => {
    setOptions((current) => ({ ...current, maxResults, exclude: current.exclude || defaultExclude }));
  }, [defaultExclude, maxResults]);

  useEffect(() => {
    if (!options.query.trim()) {
      setResponse({ matches: [], filesScanned: 0, truncated: false });
      setError("");
      return;
    }
    let disposed = false;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void onSearch(options).then((next) => {
        if (!disposed) { setResponse(next); setError(""); }
      }).catch((reason) => {
        if (!disposed) setError(String(reason));
      }).finally(() => { if (!disposed) setBusy(false); });
    }, 220);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [onSearch, options]);

  const replaceAll = async () => {
    if (!options.query.trim()) return;
    if (!window.confirm(t("search.replaceConfirm", { count: response.matches.length }))) return;
    setBusy(true);
    try {
      await onReplaceAll(options, replacement);
      setError("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sidebar-feature search-panel">
      <div className="panel-heading"><span>{t("search.title")}</span><span className="panel-heading-meta">{busy ? "…" : response.matches.length}</span></div>
      <div className="search-controls">
        <div className="search-input-row">
          <button className="mini-toggle" onClick={() => setShowReplace((value) => !value)} title={t("search.toggleReplace")}>{showReplace ? "⌄" : "›"}</button>
          <input autoFocus value={options.query} onChange={(event) => setOptions((current) => ({ ...current, query: event.target.value }))} placeholder={t("search.placeholder")} aria-label={t("search.placeholder")} />
        </div>
        {showReplace && <div className="search-input-row search-replace-row"><span className="replace-indent" /><input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder={t("search.replacePlaceholder")} /><button onClick={() => void replaceAll()} disabled={!response.matches.length || busy} title={t("search.replaceAll")}>⇄</button></div>}
        <div className="search-option-row">
          <button className={options.caseSensitive ? "active" : ""} onClick={() => setOptions((current) => ({ ...current, caseSensitive: !current.caseSensitive }))} title={t("search.matchCase")}>Aa</button>
          <button className={options.wholeWord ? "active" : ""} onClick={() => setOptions((current) => ({ ...current, wholeWord: !current.wholeWord }))} title={t("search.wholeWord")}>ab</button>
          <button className={options.regex ? "active" : ""} onClick={() => setOptions((current) => ({ ...current, regex: !current.regex }))} title={t("search.regex")}>.*</button>
          <span className="search-option-spacer" />
          <button className={showFilters ? "active" : ""} onClick={() => setShowFilters((value) => !value)} title={t("search.filters")}>⋯</button>
        </div>
        {showFilters && <div className="search-filters"><label>{t("search.include")}<input value={options.include} onChange={(event) => setOptions((current) => ({ ...current, include: event.target.value }))} placeholder="src/*, *.tsx" /></label><label>{t("search.exclude")}<input value={options.exclude} onChange={(event) => setOptions((current) => ({ ...current, exclude: event.target.value }))} placeholder="*.min.js, vendor/*" /></label></div>}
      </div>
      <div className="search-summary">{options.query ? t("search.summary", { count: response.matches.length, files: grouped.length }) : t("search.hint", { workspace: workspaceName })}{response.indexed ? ` · ${t("search.indexed", { files: response.indexedFiles ?? response.filesScanned, revision: response.indexRevision ?? 0 })}` : ""}{response.truncated ? ` · ${t("search.truncated")}` : ""}{response.indexTruncated ? ` · ${t("search.indexTruncated")}` : ""}</div>
      {error && <div className="sidebar-error">{error}</div>}
      <div className="search-results">
        {grouped.map(([path, matches]) => (
          <div className="search-file-group" key={path}>
            <div className="search-file-heading"><span>{path}</span><strong>{matches.length}</strong></div>
            {matches.map((match, index) => (
              <button key={`${match.line}:${match.column}:${index}`} className="search-result" onClick={() => onOpenResult(match.path, match.line, match.column)} title={`${match.path}:${match.line}:${match.column}`}>
                <span className="search-line">{match.line}</span><span className="search-preview">{match.preview || match.matched}</span>
              </button>
            ))}
          </div>
        ))}
        {options.query && !busy && !grouped.length && !error && <div className="sidebar-empty">{t("search.noResults")}</div>}
      </div>
    </div>
  );
}
