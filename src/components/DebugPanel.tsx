import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { usePersistentState } from "../hooks/usePersistentState";
import type {
  BrowserDebugEvent,
  BrowserDebugStatus,
  DebugBreakpoint,
  DebugBrowserInfo,
  DebugConfiguration,
  DebugProperty,
  DebugRemoteValue,
} from "../types/debug";

type DebugActionOptions = {
  expression?: string;
  url?: string;
  line?: number;
  column?: number;
  callFrameId?: string;
  objectId?: string;
  breakpointId?: string;
};

type Props = {
  workspaceKey: string;
  terminalAllowed: boolean;
  browsers: DebugBrowserInfo[];
  status: BrowserDebugStatus;
  events: BrowserDebugEvent[];
  configurations: DebugConfiguration[];
  breakpoints: DebugBreakpoint[];
  activePath: string;
  cursorLine: number;
  cursorColumn: number;
  onStart: (browserId: string, url: string) => void;
  onStop: () => void;
  onAction: (action: string, options?: DebugActionOptions) => Promise<unknown>;
  onOpenLocation: (url: string, line: number, column: number) => void;
  onToggleBreakpoint: (path: string, line: number, column: number) => void;
  onAddConfiguration: () => void;
  onRemoveConfiguration: (id: string) => void;
};

function remoteValueText(value: DebugRemoteValue | null | undefined): string {
  if (!value) return "undefined";
  if (value.unserializableValue) return value.unserializableValue;
  if ("value" in value && value.value !== undefined) {
    if (typeof value.value === "string") return JSON.stringify(value.value);
    try { return JSON.stringify(value.value); } catch { return String(value.value); }
  }
  return value.description ?? value.className ?? value.subtype ?? value.type ?? "value";
}

function actionResultValue(result: unknown): DebugRemoteValue | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const value = record.result;
  return value && typeof value === "object" ? value as DebugRemoteValue : null;
}

function PropertyTree({ properties, depth, onExpand }: { properties: DebugProperty[]; depth: number; onExpand: (objectId: string, depth: number) => Promise<DebugProperty[]> }) {
  const [expanded, setExpanded] = useState<Record<string, DebugProperty[]>>({});
  return <div className="debug-properties">{properties.slice(0, 300).map((property, index) => {
    const objectId = property.value?.objectId ?? null;
    const key = `${property.name}:${index}`;
    const children = expanded[key];
    return <div className="debug-property" key={key}>
      <button className="debug-property-row" onClick={() => {
        if (!objectId || depth >= 2) return;
        if (children) { setExpanded((current) => { const next = { ...current }; delete next[key]; return next; }); return; }
        void onExpand(objectId, depth + 1).then((items) => setExpanded((current) => ({ ...current, [key]: items })));
      }}>
        <span className="debug-expand">{objectId && depth < 2 ? (children ? "⌄" : "›") : ""}</span>
        <span className="debug-property-name">{property.name}</span>
        <code>{remoteValueText(property.value)}</code>
      </button>
      {children && <div className="debug-property-children"><PropertyTree properties={children} depth={depth + 1} onExpand={onExpand} /></div>}
    </div>;
  })}</div>;
}

export function DebugPanel({ workspaceKey, terminalAllowed, browsers, status, events, configurations, breakpoints, activePath, cursorLine, cursorColumn, onStart, onStop, onAction, onOpenLocation, onToggleBreakpoint, onAddConfiguration, onRemoveConfiguration }: Props) {
  const { t } = useI18n();
  const [browserId, setBrowserId] = useState("");
  const [configId, setConfigId] = useState("");
  const [selectedFrameId, setSelectedFrameId] = useState("");
  const [scopeProperties, setScopeProperties] = useState<Record<string, DebugProperty[]>>({});
  const [expression, setExpression] = useState("");
  const [evaluation, setEvaluation] = useState("");
  const [watchInput, setWatchInput] = useState("");
  const [watchesByWorkspace, setWatchesByWorkspace] = usePersistentState<Record<string, string[]>>("webforge.debug.watches", {});
  const [watchValues, setWatchValues] = useState<Record<string, string>>({});
  const watches = watchesByWorkspace[workspaceKey] ?? [];
  const selectedFrame = status.callFrames.find((frame) => frame.callFrameId === selectedFrameId) ?? status.callFrames[0] ?? null;

  useEffect(() => {
    if (!browserId || !browsers.some((item) => item.id === browserId && item.available)) setBrowserId(browsers.find((item) => item.available)?.id ?? "");
  }, [browserId, browsers]);
  useEffect(() => {
    if (!configId || !configurations.some((item) => item.id === configId && item.available)) setConfigId(configurations.find((item) => item.available)?.id ?? configurations[0]?.id ?? "");
  }, [configId, configurations]);
  useEffect(() => {
    const configuredBrowser = configurations.find((item) => item.id === configId)?.browser;
    if (configuredBrowser && browsers.some((item) => item.id === configuredBrowser && item.available)) setBrowserId(configuredBrowser);
  }, [browsers, configId, configurations]);
  useEffect(() => {
    if (!status.paused || !status.callFrames.length) { setSelectedFrameId(""); setScopeProperties({}); return; }
    if (!status.callFrames.some((frame) => frame.callFrameId === selectedFrameId)) setSelectedFrameId(status.callFrames[0].callFrameId);
  }, [selectedFrameId, status.callFrames, status.paused]);

  const loadProperties = async (objectId: string): Promise<DebugProperty[]> => {
    const raw = await onAction("getProperties", { objectId });
    if (!raw || typeof raw !== "object") return [];
    const result = (raw as { result?: unknown }).result;
    return Array.isArray(result) ? result as DebugProperty[] : [];
  };

  useEffect(() => {
    if (!status.paused || !selectedFrame) { setScopeProperties({}); return; }
    let disposed = false;
    void Promise.all(selectedFrame.scopes.map(async (scope) => [scope.objectId ?? scope.type, scope.objectId ? await loadProperties(scope.objectId).catch(() => []) : []] as const)).then((entries) => {
      if (!disposed) setScopeProperties(Object.fromEntries(entries));
    });
    return () => { disposed = true; };
  }, [selectedFrame?.callFrameId, status.paused]);

  useEffect(() => {
    if (!status.paused || !selectedFrame || !watches.length) { setWatchValues({}); return; }
    let disposed = false;
    void Promise.all(watches.map(async (watch) => {
      try {
        const result = await onAction("evaluate", { expression: watch, callFrameId: selectedFrame.callFrameId });
        return [watch, remoteValueText(actionResultValue(result))] as const;
      } catch (error) { return [watch, String(error)] as const; }
    })).then((values) => { if (!disposed) setWatchValues(Object.fromEntries(values)); });
    return () => { disposed = true; };
  }, [selectedFrame?.callFrameId, status.paused, watches.join("\n")]);

  const activeConfiguration = configurations.find((item) => item.id === configId) ?? null;
  const evaluate = async () => {
    if (!expression.trim()) return;
    try {
      const result = await onAction("evaluate", { expression: expression.trim(), callFrameId: status.paused ? selectedFrame?.callFrameId : undefined });
      setEvaluation(remoteValueText(actionResultValue(result)) || JSON.stringify(result, null, 2));
    } catch (error) { setEvaluation(String(error)); }
  };
  const addWatch = () => {
    const value = watchInput.trim();
    if (!value || watches.includes(value) || watches.length >= 32) return;
    setWatchesByWorkspace((current) => ({ ...current, [workspaceKey]: [...watches, value] }));
    setWatchInput("");
  };
  const removeWatch = (watch: string) => setWatchesByWorkspace((current) => ({ ...current, [workspaceKey]: watches.filter((item) => item !== watch) }));
  const resolvedCount = useMemo(() => breakpoints.filter((item) => item.resolved).length, [breakpoints]);

  return <div className="debug-panel debug-workbench">
    <div className="tasks-toolbar"><div><strong>{t("debug.title")}</strong><span>{t("debug.description")}</span></div><div className="tasks-toolbar-actions">{status.running && <button className="danger-soft" onClick={onStop}>■ {t("debug.stop")}</button>}</div></div>
    {!terminalAllowed && <div className="tasks-security-note">{t("debug.terminalRequired")}</div>}
    <div className="debug-toolbar">
      <select value={browserId} onChange={(event) => setBrowserId(event.target.value)} disabled={status.running}>{browsers.map((browser) => <option key={browser.id} value={browser.id} disabled={!browser.available}>{browser.label}{browser.available ? "" : ` · ${t("debug.notFound")}`}</option>)}</select>
      <select value={configId} onChange={(event) => setConfigId(event.target.value)} disabled={status.running}>{configurations.map((config) => <option key={config.id} value={config.id} disabled={!config.available}>{config.label}</option>)}</select>
      <button onClick={onAddConfiguration} disabled={status.running}>＋ {t("debug.addConfiguration")}</button>
      {activeConfiguration?.custom && <button onClick={() => onRemoveConfiguration(activeConfiguration.id)} disabled={status.running}>−</button>}
      {!status.running && <button className="primary-button" disabled={!terminalAllowed || !browserId || !activeConfiguration?.available} onClick={() => activeConfiguration && onStart(browserId, activeConfiguration.url)}>▶ {t("debug.start")}</button>}
    </div>
    {status.error && <div className="sidebar-error">{status.error}</div>}
    {status.running && <>
      <div className="debug-controls">
        <button onClick={() => void onAction(status.paused ? "resume" : "pause")}>{status.paused ? `▶ ${t("debug.resume")}` : `Ⅱ ${t("debug.pause")}`}</button>
        <button disabled={!status.paused} onClick={() => void onAction("stepOver")}>↷ {t("debug.stepOver")}</button>
        <button disabled={!status.paused} onClick={() => void onAction("stepInto")}>↓ {t("debug.stepInto")}</button>
        <button disabled={!status.paused} onClick={() => void onAction("stepOut")}>↑ {t("debug.stepOut")}</button>
        <button onClick={() => void onAction("reload")}>↻ {t("debug.reload")}</button>
        <button disabled={!activePath} onClick={() => onToggleBreakpoint(activePath, cursorLine, cursorColumn)}>● {t("debug.breakpoint")}</button>
        <span className="debug-state">{status.paused ? t("debug.paused") : status.connected ? t("debug.connected") : t("common.running")} · {status.scriptCount} {t("debug.scriptCount")}</span>
      </div>
      <div className="debug-workbench-grid">
        <section className="debug-pane">
          <strong>{t("debug.callStack")}</strong>
          <div className="debug-frame-list">{status.callFrames.length ? status.callFrames.map((frame) => <button className={frame.callFrameId === selectedFrame?.callFrameId ? "active" : ""} key={frame.callFrameId} onClick={() => { setSelectedFrameId(frame.callFrameId); if (frame.url) onOpenLocation(frame.url, frame.line, frame.column); }}><span>{frame.functionName || "(anonymous)"}</span><small>{frame.url ? `${frame.url.split("/").pop()}:${frame.line}:${frame.column}` : `${frame.line}:${frame.column}`}</small></button>) : <div className="sidebar-empty">{status.paused ? t("debug.noFrames") : t("debug.notPaused")}</div>}</div>
          <strong>{t("debug.breakpoints")} <small>{resolvedCount}/{breakpoints.length}</small></strong>
          <div className="debug-breakpoint-list">{breakpoints.length ? breakpoints.map((item) => <button key={item.id} onClick={() => onToggleBreakpoint(item.path, item.line, item.column)}><span className={item.resolved ? "resolved" : "pending"}>●</span><span>{item.path}:{item.line}</span><small>×</small></button>) : <div className="sidebar-empty">{t("debug.noBreakpoints")}</div>}</div>
        </section>
        <section className="debug-pane debug-variables-pane">
          <strong>{t("debug.variables")}</strong>
          {selectedFrame?.scopes.length ? selectedFrame.scopes.map((scope, index) => {
            const key = scope.objectId ?? scope.type;
            const props = scopeProperties[key] ?? [];
            return <details key={`${key}:${index}`} open={index < 2}><summary>{scope.name || scope.type}</summary>{props.length ? <PropertyTree properties={props} depth={0} onExpand={loadProperties} /> : <div className="sidebar-empty">{t("debug.emptyScope")}</div>}</details>;
          }) : <div className="sidebar-empty">{t("debug.notPaused")}</div>}
          <strong>{t("debug.watch")}</strong>
          <div className="debug-watch-add"><input value={watchInput} onChange={(event) => setWatchInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addWatch(); }} placeholder={t("debug.watchPlaceholder")} /><button onClick={addWatch}>＋</button></div>
          <div className="debug-watch-list">{watches.map((watch) => <div key={watch}><button onClick={() => removeWatch(watch)}>×</button><code>{watch}</code><span>{watchValues[watch] ?? "—"}</span></div>)}</div>
        </section>
        <section className="debug-pane debug-console-pane">
          <strong>{t("debug.console")}</strong>
          <div className="debug-evaluate"><input value={expression} onChange={(event) => setExpression(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void evaluate(); }} placeholder={t("debug.evaluatePlaceholder")} /><button onClick={() => void evaluate()}>{t("debug.evaluate")}</button></div>
          {evaluation && <pre>{evaluation}</pre>}
          <div className="debug-events">{events.slice(-160).map((entry) => <button key={entry.cursor} disabled={!entry.url} onClick={() => entry.url && onOpenLocation(entry.url, entry.line ?? 1, entry.column ?? 1)}><span>{entry.kind}</span><code>{entry.text}</code></button>)}</div>
        </section>
      </div>
    </>}
  </div>;
}
