import { useEffect, useMemo, useState } from "react";
import type { PreviewConsoleEntry } from "../types/designer";
import type { RuntimeStatus } from "../types/runtime";
import type { TerminalSessionStatus } from "../types/terminal";
import type { EditorDiagnostic } from "../types/diagnostics";
import type { ProjectTask, TaskStatus, TestHistoryEntry, TestRunReport } from "../types/tasks";
import type { LanguageHierarchyItem, LanguageServerInfo, LanguageServerLogEntry, LanguageServerStatus, LanguageSymbol } from "../types/languageServices";
import type { ProjectLanguageSnapshot } from "../types/intelligence";
import type { TestCaseRunState, TestFramework } from "../types/tests";
import type { BrowserDebugEvent, BrowserDebugStatus, DebugBreakpoint, DebugBrowserInfo, DebugConfiguration } from "../types/debug";
import { discoverProjectTests, primaryTestTask } from "../lib/testExplorer";
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n/messages";
import type { BuiltinThemeId } from "../types/settings";
import { XtermTerminalSurface } from "./XtermTerminalSurface";
import { DebugPanel } from "./DebugPanel";

type Props = {
  open: boolean;
  uiTheme: BuiltinThemeId;
  onToggle: () => void;
  log: string[];
  runtimeLog: string[];
  consoleEntries: PreviewConsoleEntry[];
  diagnostics: EditorDiagnostic[];
  runtimeStatus: RuntimeStatus;
  projectCanRun: boolean;
  projectCanBuild: boolean;
  dependenciesInstalled: boolean;
  productionPreviewAvailable: boolean;
  productionPreviewActive: boolean;
  terminalAllowed: boolean;
  terminalSessions: TerminalSessionStatus[];
  activeTerminalId: string;
  terminalOutput: Record<string, string>;
  tasks: ProjectTask[];
  taskStatus: TaskStatus;
  taskLog: string[];
  testReport: TestRunReport | null;
  testHistory: TestHistoryEntry[];
  languageSnapshot: ProjectLanguageSnapshot | null;
  languageServers: LanguageServerInfo[];
  languageServerStatus: LanguageServerStatus;
  languageDiagnosticsCount: number;
  languageServerLogs: LanguageServerLogEntry[];
  activePath: string;
  cursorLine: number;
  cursorColumn: number;
  debugBrowsers: DebugBrowserInfo[];
  debugStatus: BrowserDebugStatus;
  debugEvents: BrowserDebugEvent[];
  debugConfigurations: DebugConfiguration[];
  debugBreakpoints: DebugBreakpoint[];
  debugWorkspaceKey: string;
  onRunTask: (taskId: string) => void;
  onRunTestFile: (taskId: string, relativePath: string) => void;
  onRunTestCase: (taskId: string, relativePath: string, testName: string, framework: string) => void;
  onRunTestCoverage: (taskId: string) => void;
  onRerunFailedTests: (taskId: string) => void;
  onClearTestHistory: () => void;
  onOpenTestLocation: (relativePath: string, line: number) => void;
  onStopTask: () => void;
  onStartLanguageServer: (serverId: string) => void;
  onStartAllLanguageServers: () => void;
  onStopLanguageServer: (serverId?: string) => void;
  onLoadDocumentSymbols: (relativePath: string) => Promise<LanguageSymbol[]>;
  onSearchWorkspaceSymbols: (query: string) => Promise<LanguageSymbol[]>;
  onPrepareHierarchy: (kind: "prepareCall" | "prepareType", relativePath: string, line: number, column: number) => Promise<LanguageHierarchyItem[]>;
  onExpandHierarchy: (kind: "incomingCalls" | "outgoingCalls" | "supertypes" | "subtypes", item: LanguageHierarchyItem) => Promise<LanguageHierarchyItem[]>;
  onOpenLanguageHierarchyItem: (item: LanguageHierarchyItem) => void;
  onOpenLanguageSymbol: (symbol: LanguageSymbol, fallbackPath?: string) => void;
  onRefreshProjectTools: () => void;
  onStartRuntime: () => void;
  onBuild: () => void;
  onOpenProductionPreview: () => void;
  onUseSourcePreview: () => void;
  onSetTerminalAccess: (allowed: boolean) => void;
  onNewTerminal: () => void;
  onSelectTerminal: (sessionId: string) => void;
  onCloseTerminal: (sessionId: string) => void;
  onTerminalInput: (sessionId: string, data: string) => void;
  onTerminalResize: (sessionId: string, cols: number, rows: number) => void;
  onInstallDependencies: () => void;
  onStopRuntime: () => void;
  onOpenConsoleLocation: (entry: PreviewConsoleEntry) => void;
  onClearConsole: () => void;
  onOpenDiagnostic: (diagnostic: EditorDiagnostic) => void;
  onStartBrowserDebug: (browserId: string, url: string) => void;
  onStopBrowserDebug: () => void;
  onBrowserDebugAction: (action: string, options?: { expression?: string; url?: string; line?: number; column?: number; callFrameId?: string; objectId?: string; breakpointId?: string }) => Promise<unknown>;
  onOpenDebugLocation: (url: string, line: number, column: number) => void;
  onToggleDebugBreakpoint: (path: string, line: number, column: number) => void;
  onAddDebugConfiguration: () => void;
  onRemoveDebugConfiguration: (id: string) => void;
};

type PanelTab = "problems" | "output" | "console" | "runtime" | "terminal" | "tasks" | "language" | "debug";

function matchesPassedStatus(status: string) { return status === "passed" || status === "expected"; }
function matchesFailedStatus(status: string) { return ["failed", "timedOut", "unexpected", "interrupted"].includes(status); }

function symbolKindGlyph(kind: number): string {
  if ([5, 23].includes(kind)) return "◇";
  if ([6, 12].includes(kind)) return "ƒ";
  if ([7, 8, 13, 14].includes(kind)) return "▣";
  if ([2, 3, 4].includes(kind)) return "◆";
  return "•";
}

function SymbolTree({ items, onOpen, depth = 0 }: { items: LanguageSymbol[]; onOpen: (symbol: LanguageSymbol) => void; depth?: number }) {
  return <div className="language-symbol-list">{items.slice(0, 400).map((symbol, index) => <div key={`${symbol.name}:${index}`}><button style={{ paddingLeft: `${8 + depth * 12}px` }} onClick={() => onOpen(symbol)}><span>{symbolKindGlyph(symbol.kind)}</span><strong>{symbol.name}</strong>{symbol.detail && <small>{symbol.detail}</small>}</button>{symbol.children?.length ? <SymbolTree items={symbol.children} onOpen={onOpen} depth={depth + 1} /> : null}</div>)}</div>;
}

export function BottomPanel({
  open,
  uiTheme,
  onToggle,
  log,
  runtimeLog,
  consoleEntries,
  diagnostics,
  runtimeStatus,
  projectCanRun,
  projectCanBuild,
  dependenciesInstalled,
  productionPreviewAvailable,
  productionPreviewActive,
  terminalAllowed,
  terminalSessions,
  activeTerminalId,
  terminalOutput,
  tasks,
  taskStatus,
  taskLog,
  testReport,
  testHistory,
  languageSnapshot,
  languageServers,
  languageServerStatus,
  languageDiagnosticsCount,
  languageServerLogs,
  activePath,
  cursorLine,
  cursorColumn,
  debugBrowsers,
  debugStatus,
  debugEvents,
  debugConfigurations,
  debugBreakpoints,
  debugWorkspaceKey,
  onRunTask,
  onRunTestFile,
  onRunTestCase,
  onRunTestCoverage,
  onRerunFailedTests,
  onClearTestHistory,
  onOpenTestLocation,
  onStopTask,
  onStartLanguageServer,
  onStartAllLanguageServers,
  onStopLanguageServer,
  onLoadDocumentSymbols,
  onSearchWorkspaceSymbols,
  onPrepareHierarchy,
  onExpandHierarchy,
  onOpenLanguageHierarchyItem,
  onOpenLanguageSymbol,
  onRefreshProjectTools,
  onStartRuntime,
  onBuild,
  onOpenProductionPreview,
  onUseSourcePreview,
  onSetTerminalAccess,
  onNewTerminal,
  onSelectTerminal,
  onCloseTerminal,
  onTerminalInput,
  onTerminalResize,
  onInstallDependencies,
  onStopRuntime,
  onOpenConsoleLocation,
  onClearConsole,
  onOpenDiagnostic,
  onStartBrowserDebug,
  onStopBrowserDebug,
  onBrowserDebugAction,
  onOpenDebugLocation,
  onToggleDebugBreakpoint,
  onAddDebugConfiguration,
  onRemoveDebugConfiguration,
}: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<PanelTab>("output");
  const [testResults, setTestResults] = useState<Record<string, TestCaseRunState>>({});
  const [documentSymbols, setDocumentSymbols] = useState<LanguageSymbol[]>([]);
  const [workspaceSymbols, setWorkspaceSymbols] = useState<LanguageSymbol[]>([]);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [hierarchyRoot, setHierarchyRoot] = useState<LanguageHierarchyItem | null>(null);
  const [hierarchyParents, setHierarchyParents] = useState<LanguageHierarchyItem[]>([]);
  const [hierarchyChildren, setHierarchyChildren] = useState<LanguageHierarchyItem[]>([]);
  const [hierarchyMode, setHierarchyMode] = useState<"call" | "type">("call");
  const lines = tab === "runtime" ? runtimeLog : log;
  const latestConsole = consoleEntries[consoleEntries.length - 1];
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  const warningCount = diagnostics.filter((item) => item.severity === "warning").length;
  const activeTerminal = terminalSessions.find((session) => session.id === activeTerminalId) ?? terminalSessions[0] ?? null;
  const testFiles = useMemo(() => discoverProjectTests(languageSnapshot, tasks), [languageSnapshot, tasks]);
  const languageSourceLabel = (source: string | null): string => {
    if (source === "workspace") return t("language.sourceWorkspace");
    if (source === "system") return t("language.sourceSystem");
    return source ?? t("language.sourceSystem");
  };
  const activeServerId = activePath.endsWith(".vue") ? "vue" : activePath.endsWith(".svelte") ? "svelte" : /\.(?:[cm]?[jt]sx?)$/i.test(activePath) ? "typescript" : null;
  const activeLanguageServer = activeServerId ? languageServerStatus.servers.find((server) => server.serverId === activeServerId && server.running) ?? null : null;
  const taskCategoryKey = (category: string): TranslationKey => {
    switch (category) {
      case "test": return "tasks.category.test";
      case "lint": return "tasks.category.lint";
      case "typecheck": return "tasks.category.typecheck";
      case "build": return "tasks.category.build";
      case "format": return "tasks.category.format";
      default: return "tasks.category.other";
    }
  };

  useEffect(() => {
    if (latestConsole?.level === "error") setTab("console");
  }, [latestConsole?.id]);
  useEffect(() => {
    if (testReport?.cases?.length) {
      setTestResults((current) => {
        const next = { ...current };
        for (const item of testReport.cases) {
          const key = `${item.path || testReport.path}::${item.fullName || item.title}`;
          next[key] = matchesPassedStatus(item.status) ? "passed" : matchesFailedStatus(item.status) ? "failed" : "idle";
        }
        return next;
      });
      return;
    }
    if (!taskStatus.running && taskStatus.testPath && taskStatus.testName) {
      const key = `${taskStatus.testPath}::${taskStatus.testName}`;
      setTestResults((current) => ({ ...current, [key]: taskStatus.exitCode === null ? "idle" : taskStatus.exitCode === 0 ? "passed" : "failed" }));
    }
  }, [testReport, taskStatus.exitCode, taskStatus.running, taskStatus.testName, taskStatus.testPath]);

  useEffect(() => {
    if (!activeLanguageServer || !activePath) { setDocumentSymbols([]); return; }
    let disposed = false;
    void onLoadDocumentSymbols(activePath).then((items) => { if (!disposed) setDocumentSymbols(items); }).catch(() => { if (!disposed) setDocumentSymbols([]); });
    return () => { disposed = true; };
  }, [activeLanguageServer?.serverId, activePath, onLoadDocumentSymbols]);

  const runTestCase = (taskId: string, relativePath: string, testName: string, framework: string) => {
    const key = `${relativePath}::${testName}`;
    setTestResults((current) => ({ ...current, [key]: "running" }));
    onRunTestCase(taskId, relativePath, testName, framework);
  };

  const searchSymbols = async () => {
    if (!languageServerStatus.running) return;
    try { setWorkspaceSymbols(await onSearchWorkspaceSymbols(symbolQuery)); } catch { setWorkspaceSymbols([]); }
  };

  const loadHierarchy = async (mode: "call" | "type") => {
    if (!activePath || !activeLanguageServer) return;
    setHierarchyMode(mode);
    setHierarchyParents([]); setHierarchyChildren([]);
    try {
      const roots = await onPrepareHierarchy(mode === "call" ? "prepareCall" : "prepareType", activePath, cursorLine, cursorColumn);
      const root = roots[0] ?? null;
      setHierarchyRoot(root);
      if (!root) return;
      const [parents, children] = await Promise.all([
        onExpandHierarchy(mode === "call" ? "incomingCalls" : "supertypes", root),
        onExpandHierarchy(mode === "call" ? "outgoingCalls" : "subtypes", root),
      ]);
      setHierarchyParents(parents); setHierarchyChildren(children);
    } catch { setHierarchyRoot(null); setHierarchyParents([]); setHierarchyChildren([]); }
  };

  return (
    <div className="bottom-panel-inner">
      <div className="bottom-tabs">
        <button className={tab === "problems" ? "active" : ""} onClick={() => setTab("problems")}>{t("bottom.problems")} <span>{diagnostics.length}</span></button>
        <button className={tab === "output" ? "active" : ""} onClick={() => setTab("output")}>{t("bottom.output")}</button>
        <button className={tab === "console" ? "active" : ""} onClick={() => setTab("console")}>{t("bottom.console")} <span>{consoleEntries.length}</span></button>
        <button className={tab === "runtime" ? "active" : ""} onClick={() => setTab("runtime")}>{t("bottom.runtime")} {runtimeStatus.running ? <span className="runtime-live-dot" /> : null}</button>
        <button className={tab === "terminal" ? "active" : ""} onClick={() => setTab("terminal")}>{t("bottom.terminal")} {terminalSessions.some((session) => session.running) ? <span className="runtime-live-dot" /> : null}</button>
        <button className={tab === "tasks" ? "active" : ""} onClick={() => setTab("tasks")}>{t("bottom.tasks")} {taskStatus.running ? <span className="runtime-live-dot" /> : null}</button>
        <button className={tab === "language" ? "active" : ""} onClick={() => setTab("language")}>{t("bottom.language")} {languageServerStatus.running ? <span className="runtime-live-dot" /> : null}</button>
        <button className={tab === "debug" ? "active" : ""} onClick={() => setTab("debug")}>{t("bottom.debug")} {debugStatus.running ? <span className="runtime-live-dot" /> : null}</button>
        <div className="runtime-controls">
          {!dependenciesInstalled && <button onClick={onInstallDependencies}>{t("bottom.installDeps")}</button>}
          {projectCanRun && !runtimeStatus.running && <button onClick={onStartRuntime}>▶ {t("bottom.dev")}</button>}
          {projectCanBuild && !runtimeStatus.running && <button onClick={onBuild}>◆ {t("bottom.build")}</button>}
          {runtimeStatus.running && <button onClick={onStopRuntime}>■ {t("bottom.stop")}</button>}
          {productionPreviewAvailable && <button onClick={productionPreviewActive ? onUseSourcePreview : onOpenProductionPreview}>{productionPreviewActive ? t("common.source") : t("common.dist")}</button>}
          {runtimeStatus.mode && <span className="runtime-state-label">{runtimeStatus.ready ? t("common.ready") : runtimeStatus.running ? runtimeStatus.mode : t("common.exit", { code: runtimeStatus.exitCode ?? "—" })}</span>}
        </div>
        <div className="bottom-spacer" />
        {tab === "console" && <button onClick={onClearConsole} title={t("bottom.clearConsole")}>{t("bottom.clear")}</button>}
        <button onClick={onToggle}>{open ? "⌄" : "⌃"}</button>
        <button>×</button>
      </div>

      {open && tab === "problems" ? (
        <div className="problems-list">
          <div className="problems-summary">{t("problems.summary", { errors: errorCount, warnings: warningCount })}</div>
          {diagnostics.length ? diagnostics.map((diagnostic) => (
            <button key={diagnostic.id} className={`problem-row ${diagnostic.severity}`} onClick={() => onOpenDiagnostic(diagnostic)}>
              <span className="problem-icon">{diagnostic.severity === "error" ? "×" : diagnostic.severity === "warning" ? "△" : "i"}</span>
              <span className="problem-message">{diagnostic.message}<small>{diagnostic.owner ? `${diagnostic.owner}${diagnostic.code ? ` · ${diagnostic.code}` : ""}` : diagnostic.code ?? ""}</small></span>
              <span className="problem-source">{diagnostic.path}:{diagnostic.line}:{diagnostic.column}</span>
            </button>
          )) : <div className="empty-log">{t("problems.empty")}</div>}
        </div>
      ) : open && tab === "console" ? (
        <div className="browser-console">
          {consoleEntries.length ? consoleEntries.map((entry) => (
            <button key={entry.id} className={`console-row ${entry.level}`} onClick={() => onOpenConsoleLocation(entry)} disabled={!entry.sourcePath}>
              <span className="console-level">{entry.level.toUpperCase()}</span>
              <span className="console-message">{entry.text}</span>
              <span className="console-source">{entry.sourcePath ? `${entry.sourcePath}${entry.line ? `:${entry.line}${entry.column ? `:${entry.column}` : ""}` : ""}` : entry.timestamp}</span>
            </button>
          )) : <div className="empty-log">{t("bottom.consoleEmpty")}</div>}
        </div>
      ) : open && tab === "tasks" ? (
        <div className="tasks-panel">
          <div className="tasks-toolbar">
            <div><strong>{t("tasks.title")}</strong><span>{t("tasks.description")}</span></div>
            <div className="tasks-toolbar-actions"><button onClick={onRefreshProjectTools}>↻</button>{taskStatus.running && <button className="danger-soft" onClick={onStopTask}>■ {t("bottom.stop")}</button>}</div>
          </div>
          {!terminalAllowed && <div className="tasks-security-note">{t("tasks.terminalRequired")}</div>}
          <div className="tasks-layout">
            <div className="tasks-list">
              {testFiles.length > 0 && <div className="test-explorer">
                <div className="test-explorer-title"><strong>{t("tests.title")}</strong><span>{t("tests.summary", { files: testFiles.length, cases: testFiles.reduce((sum, file) => sum + file.cases.length, 0) })}</span></div>
                {testFiles.map((file) => {
                  const fileTask = primaryTestTask(tasks, file.framework);
                  return <details key={file.relativePath}>
                  <summary><span>◇</span><strong>{file.relativePath}</strong><small>{file.framework}</small>{fileTask && <button disabled={!terminalAllowed || taskStatus.running} onClick={(event) => { event.preventDefault(); onRunTestFile(fileTask.id, file.relativePath); }}>▶</button>}</summary>
                  <div className="test-case-list">{file.cases.length ? file.cases.map((item) => {
                    const fullName = item.suite ? `${item.suite} ${item.name}` : item.name;
                    const reported = testReport?.cases.find((result) => (result.path || testReport.path) === file.relativePath && (result.fullName === fullName || result.title === item.name));
                    const runState = reported ? (matchesPassedStatus(reported.status) ? "passed" : matchesFailedStatus(reported.status) ? "failed" : "idle") : testResults[`${file.relativePath}::${fullName}`] ?? "idle";
                    return <div className={`test-case-row ${runState}`} key={item.id}><button className="test-case-main" onClick={() => onOpenTestLocation(file.relativePath, reported?.line ?? item.line)} title={reported?.failureMessage ?? undefined}><span>{runState === "passed" ? "✓" : runState === "failed" ? "×" : runState === "running" ? "◌" : "○"}</span><span><strong>{item.name}</strong>{item.suite && <small>{item.suite}</small>}{reported?.durationMs != null && <small>{t("tests.duration", { duration: reported.durationMs })}</small>}</span><em>:{reported?.line ?? item.line}</em></button>{fileTask && file.framework !== "unknown" && <button className="test-case-run" disabled={!terminalAllowed || taskStatus.running} title={t("tests.runCase")} onClick={() => runTestCase(fileTask.id, file.relativePath, fullName, file.framework)}>▶</button>}</div>;
                  }) : <div className="sidebar-empty">{t("tests.noCases")}</div>}</div>
                </details>;
                })}
              </div>}
              <div className="task-script-heading">{t("tasks.packageScripts")}</div>
              {tasks.length ? tasks.map((task) => (
                <button key={task.id} className={`task-row ${taskStatus.taskId === task.id && taskStatus.running ? "running" : ""}`} disabled={!terminalAllowed || taskStatus.running} onClick={() => onRunTask(task.id)}>
                  <span className="task-category">{t(taskCategoryKey(task.category))}</span>
                  <span className="task-name"><strong>{task.name}</strong><small>{task.packageManager} run {task.name}</small></span>
                  <span>▶</span>
                </button>
              )) : <div className="empty-log">{t("tasks.empty")}</div>}
            </div>
            <div className="task-output">
              <div className="task-output-header"><strong>{taskStatus.name ?? t("tasks.output")}</strong>{taskStatus.exitCode !== null && <span>{t("common.exit", { code: taskStatus.exitCode })}</span>}</div>
              {testReport && <div className="test-report-summary">
                <div className="test-report-head"><strong>{t("tests.reportSummary", { passed: testReport.passed, failed: testReport.failed, skipped: testReport.skipped })}</strong>{testReport.durationMs != null && <span>{t("tests.duration", { duration: testReport.durationMs })}</span>}</div>
                {(() => { const reportTask = primaryTestTask(tasks, testReport.framework as TestFramework); return reportTask ? <div className="test-report-actions">{testReport.failed > 0 && <button disabled={!terminalAllowed || taskStatus.running} onClick={() => onRerunFailedTests(reportTask.id)}>↻ {t("tests.rerunFailed")}</button>}{["vitest", "jest"].includes(testReport.framework) && <button disabled={!terminalAllowed || taskStatus.running} onClick={() => onRunTestCoverage(reportTask.id)}>◴ {t("tests.coverage")}</button>}</div> : null; })()}
                {testReport.coverage && <div className="coverage-grid">
                  <div><span>{t("tests.coverageLines")}</span><strong>{testReport.coverage.lines.percent.toFixed(1)}%</strong></div>
                  <div><span>{t("tests.coverageStatements")}</span><strong>{testReport.coverage.statements.percent.toFixed(1)}%</strong></div>
                  <div><span>{t("tests.coverageFunctions")}</span><strong>{testReport.coverage.functions.percent.toFixed(1)}%</strong></div>
                  <div><span>{t("tests.coverageBranches")}</span><strong>{testReport.coverage.branches.percent.toFixed(1)}%</strong></div>
                </div>}
                {testReport.cases.filter((item) => matchesFailedStatus(item.status)).slice(0, 12).map((item) => { const path = item.path || testReport.path || activePath; return <button key={item.id} className="test-report-failure" disabled={!path} onClick={() => path && onOpenTestLocation(path, item.line ?? 1)}><strong>{item.fullName || item.title}</strong><small>{item.failureMessage ?? item.stack ?? t("tests.failed")}</small></button>; })}
              </div>}
              <div className="test-history">
                <div className="test-history-head"><strong>{t("tests.history")}</strong>{testHistory.length > 0 && <button onClick={onClearTestHistory}>{t("tests.clearHistory")}</button>}</div>
                {testHistory.length ? testHistory.slice(0, 12).map((entry) => <div className={`test-history-row ${entry.success ? "passed" : "failed"}`} key={`${entry.finishedAtMs}:${entry.framework}`}><span>{entry.success ? "✓" : "×"}</span><strong>{entry.passed}/{entry.total}</strong><small>{entry.framework} · {new Date(entry.finishedAtMs).toLocaleTimeString()}</small>{entry.durationMs != null && <em>{entry.durationMs} ms</em>}{entry.coverage && <em>{entry.coverage.lines.percent.toFixed(1)}%</em>}</div>) : <div className="sidebar-empty">{t("tests.noHistory")}</div>}
              </div>
              {taskLog.length ? taskLog.map((line, index) => <div key={`${index}-${line}`}><span className="log-prefix">›</span> {line}</div>) : <div className="empty-log">{t("tasks.outputEmpty")}</div>}
            </div>
          </div>
        </div>
      ) : open && tab === "language" ? (
        <div className="language-panel">
          <div className="tasks-toolbar">
            <div><strong>{t("language.title")}</strong><span>{t("language.description")}</span></div>
            <div className="tasks-toolbar-actions"><button onClick={onRefreshProjectTools}>↻</button><button disabled={!terminalAllowed || !languageServers.some((server) => server.available)} onClick={onStartAllLanguageServers}>▶ {t("language.startAll")}</button>{languageServerStatus.running && <button className="danger-soft" onClick={() => onStopLanguageServer()}>■ {t("language.stopAll")}</button>}</div>
          </div>
          {!terminalAllowed && <div className="tasks-security-note">{t("language.terminalRequired")}</div>}
          <div className="language-status-line">
            <span>{languageServerStatus.running ? t("language.runningMany", { count: languageServerStatus.servers.filter((server) => server.running).length }) : t("language.stopped")}</span>
            <span>{t("language.diagnostics", { count: languageDiagnosticsCount })}</span>
          </div>
          {languageServerStatus.error && <div className="sidebar-error">{languageServerStatus.error}</div>}
          <div className="language-server-list">
            {languageServers.map((server) => {
              const runtime = languageServerStatus.servers.find((item) => item.serverId === server.id);
              return <div className="language-server-row" key={server.id}>
                <span className={`language-server-dot ${runtime?.running ? "running" : server.available ? "available" : ""}`} />
                <span className="language-server-info"><strong>{server.label}</strong><small>{runtime?.running ? `${t("language.runningShort")} · PID ${runtime.pid ?? "?"}` : runtime?.error ? runtime.error : server.available ? `${t("language.available")} · ${languageSourceLabel(server.source)}` : t("language.notFound")}</small></span>
                {runtime?.running ? <button className="danger-soft" onClick={() => onStopLanguageServer(server.id)}>■ {t("language.stop")}</button> : <button disabled={!server.available || !terminalAllowed} onClick={() => onStartLanguageServer(server.id)}>▶ {t("language.start")}</button>}
              </div>;
            })}
          </div>
          {languageServerStatus.running && <div className="language-capability-grid">
            <span>{t("language.semanticTokens")}: {languageServerStatus.semanticTokenTypes.length ? "✓" : "—"}</span>
            <span>{t("language.inlayHints")}: {languageServerStatus.supportsInlayHints ? "✓" : "—"}</span>
            <span>{t("language.formatting")}: {languageServerStatus.supportsFormatting ? "✓" : "—"}</span>
            <span>{t("language.codeLens")}: {languageServerStatus.supportsCodeLens ? "✓" : "—"}</span>
            <span>{t("language.workspaceDiagnostics")}: {languageServerStatus.supportsWorkspaceDiagnostics ? "✓" : "—"}</span>
          </div>}
          {activeLanguageServer && <div className="language-symbol-explorer">
            <div className="language-symbol-section"><strong>{t("language.documentSymbols")}</strong><small>{activePath || t("language.noActiveDocument")}</small>{documentSymbols.length ? <SymbolTree items={documentSymbols} onOpen={(symbol) => onOpenLanguageSymbol(symbol, activePath)} /> : <div className="sidebar-empty">{t("language.noSymbols")}</div>}</div>
            <div className="language-symbol-section"><strong>{t("language.workspaceSymbols")}</strong><div className="language-symbol-search"><input value={symbolQuery} onChange={(event) => setSymbolQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchSymbols(); }} placeholder={t("language.symbolSearchPlaceholder")} /><button onClick={() => void searchSymbols()}>⌕</button></div>{workspaceSymbols.length ? <SymbolTree items={workspaceSymbols} onOpen={(symbol) => onOpenLanguageSymbol(symbol)} /> : <div className="sidebar-empty">{t("language.noWorkspaceSymbols")}</div>}</div>
          </div>}
          {activeLanguageServer && <div className="language-hierarchy">
            <div className="language-hierarchy-actions"><button disabled={!activePath || !activeLanguageServer.supportsCallHierarchy} onClick={() => void loadHierarchy("call")}>{t("language.callHierarchy")}</button><button disabled={!activePath || !activeLanguageServer.supportsTypeHierarchy} onClick={() => void loadHierarchy("type")}>{t("language.typeHierarchy")}</button><small>{activePath ? `${activePath}:${cursorLine}:${cursorColumn}` : t("language.noActiveDocument")}</small></div>
            {hierarchyRoot && <div className="language-hierarchy-grid"><section><strong>{hierarchyMode === "call" ? t("language.incomingCalls") : t("language.supertypes")}</strong>{hierarchyParents.length ? hierarchyParents.map((item, index) => <button key={`${item.uri}:${item.name}:${index}`} onClick={() => onOpenLanguageHierarchyItem(item)}><span>{symbolKindGlyph(item.kind)}</span><span>{item.name}<small>{item.detail ?? ""}</small></span></button>) : <small>{t("language.hierarchyEmpty")}</small>}</section><section className="root"><strong>{t("language.hierarchyRoot")}</strong><button onClick={() => onOpenLanguageHierarchyItem(hierarchyRoot)}><span>{symbolKindGlyph(hierarchyRoot.kind)}</span><span>{hierarchyRoot.name}<small>{hierarchyRoot.detail ?? ""}</small></span></button></section><section><strong>{hierarchyMode === "call" ? t("language.outgoingCalls") : t("language.subtypes")}</strong>{hierarchyChildren.length ? hierarchyChildren.map((item, index) => <button key={`${item.uri}:${item.name}:${index}`} onClick={() => onOpenLanguageHierarchyItem(item)}><span>{symbolKindGlyph(item.kind)}</span><span>{item.name}<small>{item.detail ?? ""}</small></span></button>) : <small>{t("language.hierarchyEmpty")}</small>}</section></div>}
          </div>}
          <div className="language-server-log"><strong>{t("language.serverLog")}</strong>{languageServerLogs.length ? languageServerLogs.slice(-80).map((entry, index) => <div key={`${entry.timestampMs}:${index}`} className={`language-log-${entry.level}`}><time>{new Date(entry.timestampMs).toLocaleTimeString()}</time><span>[{entry.serverId}]</span><code>{entry.message}</code></div>) : <div className="sidebar-empty">{t("language.noServerLogs")}</div>}</div>
          <div className="language-note">{t("language.note")}</div><div className="language-note">{t("language.features")}</div>
        </div>
       ) : open && tab === "debug" ? (
        <DebugPanel
          workspaceKey={debugWorkspaceKey}
          terminalAllowed={terminalAllowed}
          browsers={debugBrowsers}
          status={debugStatus}
          events={debugEvents}
          configurations={debugConfigurations}
          breakpoints={debugBreakpoints}
          activePath={activePath}
          cursorLine={cursorLine}
          cursorColumn={cursorColumn}
          onStart={onStartBrowserDebug}
          onStop={onStopBrowserDebug}
          onAction={onBrowserDebugAction}
          onOpenLocation={onOpenDebugLocation}
          onToggleBreakpoint={onToggleDebugBreakpoint}
          onAddConfiguration={onAddDebugConfiguration}
          onRemoveConfiguration={onRemoveDebugConfiguration}
        />
      ) : open && tab === "terminal" ? (
        <div className="terminal-panel">
          <div className="terminal-policy-bar">
            <div>
              <strong>{terminalAllowed ? t("bottom.terminalAccess") : t("bottom.terminalDisabled")}</strong>
              <span>{terminalAllowed ? t("bottom.terminalAllowedText") : t("bottom.terminalBlockedText")}</span>
            </div>
            <button className={terminalAllowed ? "danger-soft" : "primary-button"} onClick={() => onSetTerminalAccess(!terminalAllowed)}>{terminalAllowed ? t("bottom.disableAccess") : t("bottom.enableAccess")}</button>
          </div>
          {terminalAllowed && (
            <div className="terminal-session-tabs">
              {terminalSessions.map((session) => (
                <button key={session.id} className={session.id === activeTerminal?.id ? "active" : ""} onClick={() => onSelectTerminal(session.id)}>
                  <span className={session.running ? "terminal-session-dot running" : "terminal-session-dot"} />
                  <span>{session.title}</span>
                  {!session.running && session.exitCode !== null && <small>{session.exitCode}</small>}
                  <span className="terminal-close" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); onCloseTerminal(session.id); }}>×</span>
                </button>
              ))}
              <button className="terminal-new" onClick={onNewTerminal} title={t("bottom.newTerminal")}>＋</button>
            </div>
          )}
          <div className={`pty-terminal-surface ${terminalAllowed && activeTerminal ? "enabled" : "disabled"}`}>
            {terminalAllowed && activeTerminal ? (
              <XtermTerminalSurface
                key={activeTerminal.id}
                session={activeTerminal}
                uiTheme={uiTheme}
                output={terminalOutput[activeTerminal.id] ?? ""}
                onInput={onTerminalInput}
                onResize={onTerminalResize}
              />
            ) : (
              <div className="terminal-empty-state">{terminalAllowed ? t("bottom.terminalEmptyAllowed") : t("bottom.terminalEmptyBlocked")}</div>
            )}
          </div>
        </div>
      ) : open ? (
        <div className={`output-log ${tab === "runtime" ? "runtime-log" : ""}`}>
          {lines.length ? lines.map((line, index) => (
            <div key={`${index}-${line}`}><span className="log-prefix">›</span> {line}</div>
          )) : (
            <div className="empty-log">{tab === "runtime" ? t("bottom.runtimeEmpty") : t("bottom.outputEmpty")}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
