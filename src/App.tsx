import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityBar, type SidebarSection } from "./components/ActivityBar";
import { CommandPalette, type CommandPaletteAction } from "./components/CommandPalette";
import { EditorTabs } from "./components/EditorTabs";
import { Explorer } from "./components/Explorer";
import { PreviewPane, type PreviewPreset, type PreviewStyleCommand, type PreviewStyleCommit } from "./components/PreviewPane";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { useI18n } from "./i18n";
import { usePersistentState } from "./hooks/usePersistentState";
import { useWorkspace } from "./hooks/useWorkspace";
import { useIdeSettings } from "./hooks/useIdeSettings";
import { displayShortcut, shortcutMatches } from "./lib/settings";
import { appendDesignerAnimation, appendDesignerContainerQuery, applyStyleToCss, listCssVariables, patchCssVariable, resolveCssRuleSources } from "./lib/designer";
import { buildPreviewDocument } from "./lib/preview";
import { createResponsiveBreakpoint, listResponsiveBreakpoints, patchResponsiveBreakpoint, type ResponsiveBreakpoint, type ResponsiveBreakpointMode } from "./lib/responsive";
import { deleteHtmlNode, duplicateHtmlNode, insertHtmlSnippet, moveHtmlNode, setHtmlAttribute, setHtmlInlineStyle, sourceLocation, type HtmlSourcePatch } from "./lib/htmlSource";
import { deleteFrameworkNode, duplicateFrameworkNode, frameworkSourceEditable, frameworkStructuralEditable, frameworkTextEditable, insertFrameworkSnippet, moveFrameworkNode, parseFrameworkSourceId, resolveFrameworkSelection, setFrameworkAttribute, setFrameworkClasses, setFrameworkText, type FrameworkSourceKind } from "./lib/frameworkSource";
import { adapterFor } from "./project-adapters";
import type { CssPseudoState, CssRuleMatch, CssVariableEntry, DesignerHistoryEntry, DomTreeNode, InspectorSelection, PreviewConsoleEntry } from "./types/designer";
import type { EditorDiagnostic } from "./types/diagnostics";
import type { DebugBreakpoint, DebugBreakpointCommandResult, DebugConfiguration, DebugLaunchConfiguration, DebugLaunchFile } from "./types/debug";
import type { ExtensionThemeSummary } from "./types/extensions";
import type { DevToolsNetworkEntry, DevToolsPerformanceSnapshot, DevToolsStorageSnapshot, PreviewDevToolsCommand, RuntimeAccessibilitySnapshot } from "./types/devtools";
import { clearSourceMapCache, generatedToOriginalLocation, originalToGeneratedLocation } from "./lib/sourceMaps";
import { createWorkspaceDirectory, createWorkspaceFile, readWorkspaceFile, writeWorkspaceFile } from "./lib/tauri";
import type { CodeEditorHandle } from "./components/CodeEditor";

const BottomPanel = lazy(() => import("./components/BottomPanel").then((module) => ({ default: module.BottomPanel })));
const CodeEditor = lazy(() => import("./components/CodeEditor").then((module) => ({ default: module.CodeEditor })));
const InspectorPanel = lazy(() => import("./components/InspectorPanel").then((module) => ({ default: module.InspectorPanel })));
const ProjectWizard = lazy(() => import("./components/ProjectWizard").then((module) => ({ default: module.ProjectWizard })));
const SettingsDialog = lazy(() => import("./components/SettingsDialog").then((module) => ({ default: module.SettingsDialog })));
const SearchPanel = lazy(() => import("./components/SearchPanel").then((module) => ({ default: module.SearchPanel })));
const SourceControlPanel = lazy(() => import("./components/SourceControlPanel").then((module) => ({ default: module.SourceControlPanel })));
const PackageManagerPanel = lazy(() => import("./components/PackageManagerPanel").then((module) => ({ default: module.PackageManagerPanel })));
const AssetManagerPanel = lazy(() => import("./components/AssetManagerPanel").then((module) => ({ default: module.AssetManagerPanel })));
const ProjectHealthPanel = lazy(() => import("./components/ProjectHealthPanel").then((module) => ({ default: module.ProjectHealthPanel })));
const ExtensionsPanel = lazy(() => import("./components/ExtensionsPanel").then((module) => ({ default: module.ExtensionsPanel })));
const ComponentMarketplacePanel = lazy(() => import("./components/ComponentMarketplacePanel").then((module) => ({ default: module.ComponentMarketplacePanel })));
const DevToolsPanel = lazy(() => import("./components/DevToolsPanel").then((module) => ({ default: module.DevToolsPanel })));
const DeployPanel = lazy(() => import("./components/DeployPanel").then((module) => ({ default: module.DeployPanel })));

function LazyFallback({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return <div className={compact ? "lazy-fallback compact" : "lazy-fallback"} role="status" aria-live="polite">{t("common.loading")}</div>;
}

export default function App() {
  const { locale, t } = useI18n();
  const ideSettings = useIdeSettings();
  const workspace = useWorkspace(ideSettings.settings);

  useEffect(() => {
    document.documentElement.dataset.theme = ideSettings.settings.appearance.theme;
  }, [ideSettings.settings.appearance.theme]);
  const [bottomOpen, setBottomOpen] = usePersistentState("webforge.ui.bottomOpen", true);
  const [previewPreset, setPreviewPreset] = usePersistentState<PreviewPreset>("webforge.ui.previewPreset", "desktop");
  const [previewCustomWidth, setPreviewCustomWidth] = usePersistentState("webforge.ui.previewCustomWidth", 1024);
  const [multiViewport, setMultiViewport] = usePersistentState("webforge.ui.multiViewport", false);
  const [previewVisible, setPreviewVisible] = usePersistentState("webforge.ui.previewVisible", true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarSection, setSidebarSection] = usePersistentState<SidebarSection>("webforge.ui.sidebarSection", "explorer");
  const [extensionThemeKey, setExtensionThemeKey] = usePersistentState("webforge.ui.extensionTheme", "");
  const [diagnostics, setDiagnostics] = useState<EditorDiagnostic[]>([]);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = usePersistentState("webforge.ui.inspectorOpen", false);
  const [inspectorEnabled, setInspectorEnabled] = useState(false);
  const [selection, setSelection] = useState<InspectorSelection | null>(null);
  const [designerSelector, setDesignerSelector] = useState<string | null>(null);
  const [designerSourceId, setDesignerSourceId] = useState<string | null>(null);
  const [domTree, setDomTree] = useState<DomTreeNode | null>(null);
  const [styleCommand, setStyleCommand] = useState<PreviewStyleCommand | null>(null);
  const [designerPast, setDesignerPast] = useState<DesignerHistoryEntry[]>([]);
  const [designerFuture, setDesignerFuture] = useState<DesignerHistoryEntry[]>([]);
  const [consoleEntries, setConsoleEntries] = useState<PreviewConsoleEntry[]>([]);
  const [devToolsReady, setDevToolsReady] = useState(false);
  const [devToolsNetwork, setDevToolsNetwork] = useState<DevToolsNetworkEntry[]>([]);
  const [devToolsStorage, setDevToolsStorage] = useState<DevToolsStorageSnapshot | null>(null);
  const [devToolsPerformance, setDevToolsPerformance] = useState<DevToolsPerformanceSnapshot | null>(null);
  const [devToolsAccessibility, setDevToolsAccessibility] = useState<RuntimeAccessibilitySnapshot | null>(null);
  const [devToolsCommand, setDevToolsCommand] = useState<PreviewDevToolsCommand | null>(null);
  const devToolsToken = useRef(0);
  const [editorCursor, setEditorCursor] = useState({ line: 1, column: 1 });
  const [breakpointsByWorkspace, setBreakpointsByWorkspace] = usePersistentState<Record<string, DebugBreakpoint[]>>("webforge.debug.breakpoints", {});
  const [launchConfigurations, setLaunchConfigurations] = useState<DebugLaunchConfiguration[]>([]);
  const breakpointSyncRef = useRef(new Set<string>());
  const consoleId = useRef(0);
  const editorHandleRef = useRef<CodeEditorHandle>(null);
  const sessionRestoreAttemptedRef = useRef(false);
  const externalLspLoadedRef = useRef(false);

  const activeFile = workspace.activeFile;
  const previewEntryPath = activeFile && /\.html?$/i.test(activeFile.relativePath)
    ? activeFile.relativePath
    : workspace.defaultPreviewPath;
  const previewHtml = useMemo(
    () => previewVisible ? buildPreviewDocument(workspace.filesByPath, previewEntryPath) : "",
    [previewVisible, workspace.filesByPath, previewEntryPath],
  );
  const cssVariables = useMemo(
    () => previewEntryPath ? listCssVariables(workspace.filesByPath, previewEntryPath) : [],
    [previewEntryPath, workspace.filesByPath],
  );
  const responsiveBreakpoints = useMemo(
    () => previewEntryPath ? listResponsiveBreakpoints(workspace.filesByPath, previewEntryPath) : [],
    [previewEntryPath, workspace.filesByPath],
  );
  const hasRunningLanguageServer = workspace.languageServerStatus.servers.some((server) => server.running);
  const lspSourceFiles = useMemo(() => {
    if (!hasRunningLanguageServer) return {};
    const snapshotFiles = Object.fromEntries((workspace.languageSnapshot?.files ?? []).filter((file) => !file.declaration).map((file) => [file.relativePath, file.content]));
    return { ...snapshotFiles, ...workspace.filesByPath };
  }, [hasRunningLanguageServer, workspace.filesByPath, workspace.languageSnapshot]);
  const externalChangeCount = workspace.openFiles.filter((file) => file.externalChange).length;
  const combinedDiagnostics = useMemo<EditorDiagnostic[]>(() => {
    const external = workspace.languageDiagnostics.map((item, index) => ({
      id: `lsp:${item.path}:${item.line}:${item.column}:${index}`,
      path: item.path,
      message: item.message,
      severity: (item.severity === "error" || item.severity === "warning" || item.severity === "hint" ? item.severity : "info") as EditorDiagnostic["severity"],
      line: item.line,
      column: item.column,
      endLine: item.endLine,
      endColumn: item.endColumn,
      code: item.code,
      owner: item.source ?? workspace.languageServerStatus.label ?? "LSP",
    }));
    const seen = new Set<string>();
    return [...diagnostics, ...external].filter((item) => {
      const key = `${item.path}:${item.line}:${item.column}:${item.severity}:${item.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [diagnostics, workspace.languageDiagnostics, workspace.languageServerStatus.label]);
  const diagnosticErrorCount = combinedDiagnostics.filter((item) => item.severity === "error").length;
  const diagnosticWarningCount = combinedDiagnostics.filter((item) => item.severity === "warning").length;
  const projectAdapter = adapterFor(workspace.projectInfo);
  const extensionThemes = useMemo(() => workspace.extensions.flatMap((extension) => extension.themes), [workspace.extensions]);
  const activeExtensionTheme = useMemo(() => workspace.isTrusted ? extensionThemes.find((theme) => `${theme.extensionId}:${theme.id}` === extensionThemeKey) ?? null : null, [extensionThemeKey, extensionThemes, workspace.isTrusted]);
  const designerComponents = useMemo(() => [
    ...workspace.workspaceComponents,
    ...(workspace.isTrusted ? workspace.extensionComponents : []).map((component) => ({
      id: `extension:${component.extensionId}:${component.packId}:${component.id}`,
      label: component.label,
      category: component.category,
      snippet: component.snippet,
      userDefined: false,
    })),
  ], [workspace.extensionComponents, workspace.isTrusted, workspace.workspaceComponents]);
  const frameworkKind: FrameworkSourceKind | null = workspace.projectInfo.framework === "React" ? "react" : workspace.projectInfo.framework === "Vue" ? "vue" : workspace.projectInfo.framework === "Svelte" ? "svelte" : null;
  const projectCanRun = workspace.isNative && projectAdapter.devServer && workspace.projectInfo.devServerSupported && Boolean(workspace.projectInfo.devScript);
  const projectCanBuild = workspace.isNative && workspace.projectInfo.buildSupported && Boolean(workspace.projectInfo.buildScript);
  const inspectorSupported = workspace.isNative && !workspace.productionPreviewActive && (!projectAdapter.devServer || (workspace.runtimeStatus.ready && workspace.runtimeStatus.mode === "dev"));
  const runtimeState = workspace.runtimeStatus.running
    ? workspace.runtimeStatus.ready
      ? t("status.runtimeReady", { manager: workspace.runtimeStatus.packageManager ?? "runtime" })
      : t("status.runtimeStarting", { mode: workspace.runtimeStatus.mode ?? "runtime" })
    : workspace.runtimeStatus.exitCode !== null
      ? t("status.runtimeExit", { code: workspace.runtimeStatus.exitCode })
      : t("status.runtimeIdle");

  const sourcePreviewUrl = useMemo(() => {
    if (!workspace.previewBaseUrl) return "";
    try { return new URL(previewEntryPath || "", workspace.previewBaseUrl).toString(); } catch { return workspace.previewBaseUrl; }
  }, [previewEntryPath, workspace.previewBaseUrl]);
  const debugWorkspaceKey = workspace.workspacePath || "browser-demo";
  const debugBreakpoints = breakpointsByWorkspace[debugWorkspaceKey] ?? [];
  const sourceUrlForPath = useCallback((path: string) => {
    const base = projectAdapter.devServer ? workspace.runtimeStatus.previewUrl : workspace.previewBaseUrl;
    if (!base) return "";
    try { return new URL(path.replace(/^\/+/, ""), base.endsWith("/") ? base : `${base}/`).toString(); } catch { return ""; }
  }, [projectAdapter.devServer, workspace.previewBaseUrl, workspace.runtimeStatus.previewUrl]);

  const debugConfigurations = useMemo<DebugConfiguration[]>(() => {
    const builtins: DebugConfiguration[] = [
      { id: "source", label: t("debug.configSource"), url: projectAdapter.devServer ? (workspace.runtimeStatus.previewUrl ?? "") : sourcePreviewUrl, available: projectAdapter.devServer ? Boolean(workspace.runtimeStatus.ready && workspace.runtimeStatus.mode === "dev" && workspace.runtimeStatus.previewUrl) : Boolean(sourcePreviewUrl), target: "dev" },
      { id: "dist", label: t("debug.configDist"), url: workspace.productionPreviewUrl, available: Boolean(workspace.productionPreviewUrl), target: "dist" },
    ];
    const custom = launchConfigurations.slice(0, 40).map<DebugConfiguration>((config) => {
      const target = config.target ?? (config.url ? "url" : "dev");
      const url = target === "dev" ? builtins[0].url : target === "dist" ? builtins[1].url : (config.url ?? "");
      let available = Boolean(url);
      if (target === "url") {
        try { const parsed = new URL(url); available = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) && ["http:", "https:"].includes(parsed.protocol); } catch { available = false; }
      }
      return { id: config.id, label: config.name, url, available, browser: config.browser, target, custom: true };
    });
    return [...builtins, ...custom];
  }, [launchConfigurations, projectAdapter.devServer, sourcePreviewUrl, t, workspace.productionPreviewUrl, workspace.runtimeStatus.mode, workspace.runtimeStatus.previewUrl, workspace.runtimeStatus.ready]);

  const persistLaunchConfigurations = useCallback(async (items: DebugLaunchConfiguration[]) => {
    setLaunchConfigurations(items);
    if (!workspace.isNative || !workspace.workspacePath) return;
    const payload: DebugLaunchFile = { version: 1, configurations: items.slice(0, 40) };
    const raw = `${JSON.stringify(payload, null, 2)}\n`;
    await createWorkspaceDirectory(".webforge").catch(() => undefined);
    try { await writeWorkspaceFile(".webforge/launch.json", raw); }
    catch {
      try { await createWorkspaceFile(".webforge/launch.json", raw); }
      catch { await writeWorkspaceFile(".webforge/launch.json", raw); }
    }
  }, [workspace.isNative, workspace.workspacePath]);

  useEffect(() => {
    clearSourceMapCache();
    if (!workspace.isNative || !workspace.workspacePath) { setLaunchConfigurations([]); return; }
    let disposed = false;
    void readWorkspaceFile(".webforge/launch.json").then((raw) => {
      if (disposed) return;
      try {
        const parsed = JSON.parse(raw) as Partial<DebugLaunchFile>;
        const items = Array.isArray(parsed.configurations) ? parsed.configurations.filter((item): item is DebugLaunchConfiguration => Boolean(item && typeof item.id === "string" && typeof item.name === "string" && item.type === "browser")).slice(0, 40) : [];
        setLaunchConfigurations(items);
      } catch { setLaunchConfigurations([]); }
    }).catch(() => { if (!disposed) setLaunchConfigurations([]); });
    return () => { disposed = true; };
  }, [workspace.isNative, workspace.workspacePath]);

  const addDebugConfiguration = useCallback(() => {
    const name = window.prompt(t("debug.configNamePrompt"), "Local app")?.trim();
    if (!name) return;
    const url = window.prompt(t("debug.configUrlPrompt"), workspace.runtimeStatus.previewUrl || "http://localhost:5173")?.trim();
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol) || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)) throw new Error("loopback only");
    } catch { window.alert(t("debug.configUrlInvalid")); return; }
    const next = [...launchConfigurations, { id: `custom-${Date.now().toString(36)}`, name, type: "browser" as const, target: "url" as const, url }].slice(-40);
    void persistLaunchConfigurations(next);
  }, [launchConfigurations, persistLaunchConfigurations, t, workspace.runtimeStatus.previewUrl]);

  const removeDebugConfiguration = useCallback((id: string) => {
    void persistLaunchConfigurations(launchConfigurations.filter((item) => item.id !== id));
  }, [launchConfigurations, persistLaunchConfigurations]);

  const updateDebugBreakpoints = useCallback((updater: (current: DebugBreakpoint[]) => DebugBreakpoint[]) => {
    setBreakpointsByWorkspace((current) => ({ ...current, [debugWorkspaceKey]: updater(current[debugWorkspaceKey] ?? []) }));
  }, [debugWorkspaceKey, setBreakpointsByWorkspace]);

  const toggleDebugBreakpoint = useCallback((path: string, line: number, column: number) => {
    const existing = debugBreakpoints.find((item) => item.path === path && item.line === line);
    if (existing) {
      if (existing.remoteId && workspace.debugStatus.connected) void workspace.runBrowserDebugAction("removeBreakpoint", { breakpointId: existing.remoteId }).catch(() => undefined);
      updateDebugBreakpoints((current) => current.filter((item) => item.id !== existing.id));
      return;
    }
    const item: DebugBreakpoint = { id: `${path}:${line}:${Date.now().toString(36)}`, path, line, column: Math.max(1, column || 1), enabled: true, resolved: false, remoteId: null, runtimeUrl: null };
    updateDebugBreakpoints((current) => [...current, item].slice(-500));
  }, [debugBreakpoints, updateDebugBreakpoints, workspace.debugStatus.connected, workspace.runBrowserDebugAction]);

  const resetRemoteBreakpoints = useCallback(() => {
    breakpointSyncRef.current.clear();
    updateDebugBreakpoints((current) => current.map((item) => ({ ...item, resolved: false, remoteId: null, runtimeUrl: null })));
  }, [updateDebugBreakpoints]);

  const startDebugSession = useCallback((browserId: string, url: string) => {
    resetRemoteBreakpoints();
    void workspace.startBrowserDebugger(browserId, url);
  }, [resetRemoteBreakpoints, workspace.startBrowserDebugger]);
  const stopDebugSession = useCallback(() => {
    void workspace.stopBrowserDebugger().finally(resetRemoteBreakpoints);
  }, [resetRemoteBreakpoints, workspace.stopBrowserDebugger]);

  useEffect(() => {
    if (!workspace.debugStatus.connected || !debugBreakpoints.length) return;
    let disposed = false;
    for (const breakpoint of debugBreakpoints) {
      if (!breakpoint.enabled || breakpoint.remoteId || breakpointSyncRef.current.has(breakpoint.id)) continue;
      breakpointSyncRef.current.add(breakpoint.id);
      void (async () => {
        const mapped = await originalToGeneratedLocation(workspace.debugStatus.scripts, breakpoint.path, breakpoint.line, breakpoint.column).catch(() => null);
        const runtimeUrl = mapped?.url || sourceUrlForPath(breakpoint.path);
        if (!runtimeUrl) return;
        const result = await workspace.runBrowserDebugAction("setBreakpoint", { url: runtimeUrl, line: mapped?.line ?? breakpoint.line, column: mapped?.column ?? breakpoint.column }) as DebugBreakpointCommandResult;
        if (disposed) return;
        updateDebugBreakpoints((current) => current.map((item) => item.id === breakpoint.id ? { ...item, remoteId: result.breakpointId ?? null, runtimeUrl, resolved: Boolean(result.locations?.length) } : item));
      })().catch(() => undefined).finally(() => breakpointSyncRef.current.delete(breakpoint.id));
    }
    return () => { disposed = true; };
  }, [debugBreakpoints, sourceUrlForPath, updateDebugBreakpoints, workspace.debugStatus.connected, workspace.debugStatus.scripts, workspace.runBrowserDebugAction]);

  useEffect(() => {
    const resolvedIds = new Set(workspace.debugEvents.filter((event) => event.kind === "breakpointResolved" && event.text.startsWith("Resolved ")).map((event) => event.text.slice("Resolved ".length)));
    if (!resolvedIds.size) return;
    updateDebugBreakpoints((current) => current.map((item) => item.remoteId && resolvedIds.has(item.remoteId) ? { ...item, resolved: true } : item));
  }, [updateDebugBreakpoints, workspace.debugEvents]);

  const openDebugLocation = useCallback((url: string, line: number, column: number) => {
    void (async () => {
      const mapped = await generatedToOriginalLocation(workspace.debugStatus.scripts, url, line, column).catch(() => null);
      if (mapped) { await workspace.openFileAt(mapped.path, mapped.line, mapped.column); return; }
      try {
        const parsed = new URL(url);
        let path = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
        if (path.startsWith("@fs/")) path = path.slice(4).replace(/^\/+/, "");
        if (path) await workspace.openFileAt(path, line, column);
      } catch { /* runtime URLs without workspace paths are not navigable */ }
    })();
  }, [workspace.debugStatus.scripts, workspace.openFileAt]);

  const handleEditorCursorChange = useCallback((line: number, column: number) => {
    setEditorCursor((current) => current.line === line && current.column === column ? current : { line, column });
  }, []);

  const updateDiagnostics = useCallback((next: EditorDiagnostic[]) => {
    setDiagnostics(next);
  }, []);

  useEffect(() => {
    const hasRunningServer = hasRunningLanguageServer;
    if (!hasRunningServer && !externalLspLoadedRef.current) return;
    let cancelled = false;
    void import("./monaco/lsp").then(({ configureExternalLsp }) => {
      if (cancelled) return;
      externalLspLoadedRef.current = true;
      configureExternalLsp(
        workspace.workspacePath,
        workspace.languageServerStatus.servers,
        lspSourceFiles,
        workspace.applyLanguageBufferEdit,
      );
    });
    return () => { cancelled = true; };
  }, [hasRunningLanguageServer, lspSourceFiles, workspace.applyLanguageBufferEdit, workspace.languageServerStatus.servers, workspace.workspacePath]);

  const addConsoleEntry = useCallback((entry: Omit<PreviewConsoleEntry, "id" | "timestamp">) => {
    const next: PreviewConsoleEntry = {
      ...entry,
      id: ++consoleId.current,
      timestamp: new Date().toLocaleTimeString(locale === "ru" ? "ru-RU" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
    setConsoleEntries((current) => [...current.slice(-499), next]);
    if (entry.level === "error") setBottomOpen(true);
  }, [locale, setBottomOpen]);

  const selectElement = useCallback((next: InspectorSelection) => {
    const frameworkResolution = next.sourceKind === "framework" && frameworkKind
      ? resolveFrameworkSelection(workspace.filesByPath, next, frameworkKind)
      : null;
    const frameworkEditable = next.sourceKind === "framework" && frameworkKind
      ? Boolean(frameworkResolution && frameworkSourceEditable(workspace.filesByPath, frameworkResolution.sourceId, frameworkKind))
      : next.editableSource;
    const resolved = {
      ...next,
      sourceId: frameworkResolution?.sourceId ?? next.sourceId,
      sourcePath: frameworkResolution?.path ?? next.sourcePath,
      sourceLine: frameworkResolution?.line ?? next.sourceLine,
      sourceColumn: frameworkResolution?.column ?? next.sourceColumn,
      sourceConfidence: frameworkResolution ? "exact" as const : next.sourceConfidence,
      sourceOrigin: frameworkResolution?.origin ?? next.sourceOrigin,
      editableSource: Boolean(frameworkEditable),
      structuralEditable: next.sourceKind === "framework" && frameworkKind && frameworkResolution
        ? frameworkStructuralEditable(workspace.filesByPath, frameworkResolution.sourceId, frameworkKind)
        : next.editableSource,
      textEditable: next.sourceKind === "framework" && frameworkKind && frameworkResolution
        ? frameworkTextEditable(workspace.filesByPath, frameworkResolution.sourceId, frameworkKind)
        : false,
      cssRules: resolveCssRuleSources(workspace.filesByPath, next.cssRules),
      ancestors: next.ancestors.map((ancestor) => ({
        ...ancestor,
        cssRules: resolveCssRuleSources(workspace.filesByPath, ancestor.cssRules),
      })),
    };
    setSelection(resolved);
    setDesignerSourceId(resolved.sourceId);
    setDesignerSelector(resolved.selector);
    setInspectorOpen(true);
  }, [frameworkKind, setInspectorOpen, workspace.filesByPath]);

  const changeInspectorEnabled = useCallback((enabled: boolean) => {
    setInspectorEnabled(enabled);
    if (enabled) setInspectorOpen(true);
  }, [setInspectorOpen]);

  const commitDesignerEdit = useCallback((entry: DesignerHistoryEntry) => {
    if (entry.before === entry.after) return;
    setDesignerPast((current) => [...current.slice(-79), entry]);
    setDesignerFuture([]);
    workspace.updateFile(entry.path, entry.after);
  }, [workspace.updateFile]);

  const commitHtmlPatch = useCallback((patch: HtmlSourcePatch | null) => {
    if (!patch || !previewEntryPath) return;
    commitDesignerEdit({ path: previewEntryPath, before: patch.before, after: patch.after, label: patch.label });
    if (patch.selectedSourceId !== undefined) setDesignerSourceId(patch.selectedSourceId);
    setDesignerSelector(null);
  }, [commitDesignerEdit, previewEntryPath]);

  const commitFrameworkPatch = useCallback((path: string, patch: HtmlSourcePatch | null) => {
    if (!patch) return;
    commitDesignerEdit({ path, before: patch.before, after: patch.after, label: patch.label });
    if (patch.selectedSourceId !== undefined) setDesignerSourceId(patch.selectedSourceId);
    setDesignerSelector(null);
  }, [commitDesignerEdit]);

  const activeHtmlSource = useCallback(() => previewEntryPath ? workspace.filesByPath[previewEntryPath] : undefined, [previewEntryPath, workspace.filesByPath]);

  const frameworkTarget = useCallback((sourceId: string) => {
    if (!frameworkKind) return null;
    const source = parseFrameworkSourceId(sourceId);
    if (!source) return null;
    const content = workspace.filesByPath[source.path];
    return content === undefined ? null : { ...source, content, kind: frameworkKind };
  }, [frameworkKind, workspace.filesByPath]);

  const applyInspectorStyle = useCallback((property: string, value: string, preferredRule: CssRuleMatch | null, pseudo: CssPseudoState) => {
    if (!selection?.editableSource || !previewEntryPath) return;
    const patch = applyStyleToCss(workspace.filesByPath, previewEntryPath, selection, property, value, preferredRule, pseudo);
    if (!patch) {
      if (pseudo === "normal") {
        const html = activeHtmlSource();
        if (html !== undefined) commitHtmlPatch(setHtmlInlineStyle(html, selection.sourceId, property, value));
      }
      return;
    }
    if (pseudo === "normal") setStyleCommand({ sourceId: selection.sourceId, selector: selection.selector, property, value, token: Date.now() });
    commitDesignerEdit({ path: patch.path, before: patch.before, after: patch.after, label: `${property} → ${patch.selector}` });
  }, [activeHtmlSource, commitDesignerEdit, commitHtmlPatch, previewEntryPath, selection, workspace.filesByPath]);

  const applyInlineStyle = useCallback((property: string, value: string) => {
    if (!selection?.editableSource) return;
    if (selection.sourceKind === "framework") {
      // Framework inline styles may be expressions/objects. Keep source edits safe by writing through authored CSS rules instead.
      const patch = previewEntryPath ? applyStyleToCss(workspace.filesByPath, previewEntryPath, selection, property, value, null, "normal") : null;
      if (patch) commitDesignerEdit({ path: patch.path, before: patch.before, after: patch.after, label: `${property} → ${patch.selector}` });
      return;
    }
    const html = activeHtmlSource();
    if (html === undefined) return;
    commitHtmlPatch(setHtmlInlineStyle(html, selection.sourceId, property, value));
  }, [activeHtmlSource, commitDesignerEdit, commitHtmlPatch, previewEntryPath, selection, workspace.filesByPath]);

  const commitPreviewStyleBatch = useCallback((commit: PreviewStyleCommit) => {
    if (!selection?.editableSource || !previewEntryPath || commit.sourceId !== selection.sourceId) return;
    let virtualFiles = { ...workspace.filesByPath };
    const changes = new Map<string, { before: string; after: string }>();
    for (const [property, value] of Object.entries(commit.declarations)) {
      const patch = applyStyleToCss(virtualFiles, previewEntryPath, selection, property, value, null, "normal");
      if (!patch) continue;
      const previous = changes.get(patch.path);
      changes.set(patch.path, { before: previous?.before ?? patch.before, after: patch.after });
      virtualFiles = { ...virtualFiles, [patch.path]: patch.after };
    }
    if (changes.size) {
      for (const [path, change] of changes) commitDesignerEdit({ path, before: change.before, after: change.after, label: `Resize ${selection.selector}` });
      return;
    }
    if (selection.sourceKind === "framework") return;
    let html = activeHtmlSource();
    if (html === undefined) return;
    const before = html;
    for (const [property, value] of Object.entries(commit.declarations)) {
      const patch = setHtmlInlineStyle(html, selection.sourceId, property, value);
      if (patch) html = patch.after;
    }
    if (html !== before) commitDesignerEdit({ path: previewEntryPath, before, after: html, label: `Resize ${selection.selector}` });
  }, [activeHtmlSource, commitDesignerEdit, previewEntryPath, selection, workspace.filesByPath]);

  const createAnimationPreset = useCallback((preset: "fade" | "slide" | "pulse") => {
    if (!selection?.editableSource || !previewEntryPath) return;
    const patch = appendDesignerAnimation(workspace.filesByPath, previewEntryPath, selection, preset);
    if (patch) commitDesignerEdit({ path: patch.path, before: patch.before, after: patch.after, label: `Animation ${preset} → ${selection.selector}` });
  }, [commitDesignerEdit, previewEntryPath, selection, workspace.filesByPath]);

  const createContainerQuery = useCallback((mode: "min" | "max", width: number, property: string, value: string) => {
    if (!selection?.editableSource || !previewEntryPath) return;
    const patch = appendDesignerContainerQuery(workspace.filesByPath, previewEntryPath, selection, mode, width, property, value);
    if (patch) commitDesignerEdit({ path: patch.path, before: patch.before, after: patch.after, label: `@container ${mode}-width ${width}px` });
  }, [commitDesignerEdit, previewEntryPath, selection, workspace.filesByPath]);

  const setClasses = useCallback((classes: string[]) => {
    if (!selection?.editableSource) return;
    if (selection.sourceKind === "framework") {
      const target = frameworkTarget(selection.sourceId);
      if (target) commitFrameworkPatch(target.path, setFrameworkClasses(target.content, selection.sourceId, target.kind, classes));
      return;
    }
    const html = activeHtmlSource();
    if (html !== undefined) commitHtmlPatch(setHtmlAttribute(html, selection.sourceId, "class", classes.join(" ")));
  }, [activeHtmlSource, commitFrameworkPatch, commitHtmlPatch, frameworkTarget, selection]);

  const setAttribute = useCallback((name: string, value: string) => {
    if (!selection?.editableSource) return;
    if (selection.sourceKind === "framework") {
      const target = frameworkTarget(selection.sourceId);
      if (target) commitFrameworkPatch(target.path, setFrameworkAttribute(target.content, selection.sourceId, target.kind, name, value));
      return;
    }
    const html = activeHtmlSource();
    if (html !== undefined) commitHtmlPatch(setHtmlAttribute(html, selection.sourceId, name, value));
  }, [activeHtmlSource, commitFrameworkPatch, commitHtmlPatch, frameworkTarget, selection]);

  const removeAttribute = useCallback((name: string) => {
    if (!selection?.editableSource) return;
    if (selection.sourceKind === "framework") {
      const target = frameworkTarget(selection.sourceId);
      if (target) commitFrameworkPatch(target.path, setFrameworkAttribute(target.content, selection.sourceId, target.kind, name, null));
      return;
    }
    const html = activeHtmlSource();
    if (html !== undefined) commitHtmlPatch(setHtmlAttribute(html, selection.sourceId, name, null));
  }, [activeHtmlSource, commitFrameworkPatch, commitHtmlPatch, frameworkTarget, selection]);

  const setText = useCallback((value: string) => {
    if (!selection?.editableSource || selection.sourceKind !== "framework") return;
    const target = frameworkTarget(selection.sourceId);
    if (target) commitFrameworkPatch(target.path, setFrameworkText(target.content, selection.sourceId, target.kind, value));
  }, [commitFrameworkPatch, frameworkTarget, selection]);

  const moveNode = useCallback((sourceId: string, targetSourceId: string, position: "before" | "inside" | "after") => {
    const frameworkSource = frameworkTarget(sourceId);
    const frameworkDestination = frameworkTarget(targetSourceId);
    if (frameworkSource && frameworkDestination && frameworkSource.path === frameworkDestination.path) {
      commitFrameworkPatch(frameworkSource.path, moveFrameworkNode(frameworkSource.content, sourceId, targetSourceId, frameworkSource.kind, position));
      return;
    }
    const html = activeHtmlSource();
    if (html !== undefined) commitHtmlPatch(moveHtmlNode(html, sourceId, targetSourceId, position));
  }, [activeHtmlSource, commitFrameworkPatch, commitHtmlPatch, frameworkTarget]);

  const deleteNode = useCallback(() => {
    if (!selection?.editableSource || !window.confirm(t("confirm.deleteNode", { tag: selection.tagName }))) return;
    if (selection.sourceKind === "framework") {
      const target = frameworkTarget(selection.sourceId);
      if (target) commitFrameworkPatch(target.path, deleteFrameworkNode(target.content, selection.sourceId, target.kind));
    } else {
      const html = activeHtmlSource();
      if (html !== undefined) commitHtmlPatch(deleteHtmlNode(html, selection.sourceId));
    }
    setSelection(null);
  }, [activeHtmlSource, commitFrameworkPatch, commitHtmlPatch, frameworkTarget, selection, t]);

  const duplicateNode = useCallback(() => {
    if (!selection?.editableSource) return;
    if (selection.sourceKind === "framework") {
      const target = frameworkTarget(selection.sourceId);
      if (target) commitFrameworkPatch(target.path, duplicateFrameworkNode(target.content, selection.sourceId, target.kind));
      return;
    }
    const html = activeHtmlSource();
    if (html !== undefined) commitHtmlPatch(duplicateHtmlNode(html, selection.sourceId));
  }, [activeHtmlSource, commitFrameworkPatch, commitHtmlPatch, frameworkTarget, selection]);

  const insertComponent = useCallback((snippet: string, label: string, position: "before" | "inside" | "after") => {
    if (selection && !selection.editableSource) return;
    const targetSourceId = selection?.sourceId ?? domTree?.sourceId;
    if (!targetSourceId) return;
    const framework = frameworkTarget(targetSourceId);
    if (framework) {
      commitFrameworkPatch(framework.path, insertFrameworkSnippet(framework.content, targetSourceId, framework.kind, position, snippet, label));
      return;
    }
    const html = activeHtmlSource();
    if (html !== undefined) commitHtmlPatch(insertHtmlSnippet(html, targetSourceId, position, snippet, label));
  }, [activeHtmlSource, commitFrameworkPatch, commitHtmlPatch, domTree?.sourceId, frameworkTarget, selection]);

  const revealSource = useCallback(() => {
    if (!selection) return;
    if (selection.sourcePath) {
      void workspace.openFileAt(selection.sourcePath, selection.sourceLine ?? 1, selection.sourceColumn ?? 1);
      return;
    }
    if (!previewEntryPath) return;
    const html = activeHtmlSource();
    if (html === undefined) return;
    const location = sourceLocation(html, selection.sourceId);
    if (location) void workspace.openFileAt(previewEntryPath, location.line, location.column);
  }, [activeHtmlSource, previewEntryPath, selection, workspace.openFileAt]);

  const setCssVariable = useCallback((variable: CssVariableEntry, value: string) => {
    const patch = patchCssVariable(workspace.filesByPath, variable, value);
    if (!patch) return;
    commitDesignerEdit({ path: patch.path, before: patch.before, after: patch.after, label: `${variable.name} → ${patch.selector}` });
  }, [commitDesignerEdit, workspace.filesByPath]);

  const updateBreakpoint = useCallback((breakpoint: ResponsiveBreakpoint, width: number) => {
    const patch = patchResponsiveBreakpoint(workspace.filesByPath, breakpoint, width);
    if (!patch) return;
    commitDesignerEdit({ path: patch.path, before: patch.before, after: patch.after, label: patch.label });
  }, [commitDesignerEdit, workspace.filesByPath]);

  const createBreakpoint = useCallback((width: number, mode: ResponsiveBreakpointMode) => {
    if (!previewEntryPath) return;
    const patch = createResponsiveBreakpoint(workspace.filesByPath, previewEntryPath, width, mode);
    if (!patch) return;
    commitDesignerEdit({ path: patch.path, before: patch.before, after: patch.after, label: patch.label });
  }, [commitDesignerEdit, previewEntryPath, workspace.filesByPath]);

  const revealBreakpoint = useCallback((breakpoint: ResponsiveBreakpoint) => {
    void workspace.openFileAt(breakpoint.path, breakpoint.line, 1);
  }, [workspace.openFileAt]);
  const undoDesigner = useCallback(() => {
    setDesignerPast((current) => {
      const entry = current.at(-1);
      if (!entry) return current;
      workspace.updateFile(entry.path, entry.before);
      setSelection(null); setDesignerSourceId(null); setDesignerSelector(null);
      setDesignerFuture((future) => [entry, ...future].slice(0, 80));
      return current.slice(0, -1);
    });
  }, [workspace.updateFile]);

  const redoDesigner = useCallback(() => {
    setDesignerFuture((current) => {
      const entry = current[0];
      if (!entry) return current;
      workspace.updateFile(entry.path, entry.after);
      setSelection(null); setDesignerSourceId(null); setDesignerSelector(null);
      setDesignerPast((past) => [...past.slice(-79), entry]);
      return current.slice(1);
    });
  }, [workspace.updateFile]);

  useEffect(() => {
    setSelection(null);
    setDesignerSelector(null);
    setDesignerSourceId(null);
    setDomTree(null);
    setInspectorEnabled(false);
    setConsoleEntries([]);
    setDesignerPast([]);
    setDesignerFuture([]);
    setDiagnostics([]);
    setGitBranch(null);
  }, [workspace.workspacePath]);

  useEffect(() => {
    if (!workspace.gitRevision) return;
    setSelection(null);
    setDesignerSelector(null);
    setDesignerSourceId(null);
    setDomTree(null);
    setDesignerPast([]);
    setDesignerFuture([]);
  }, [workspace.gitRevision]);

  useEffect(() => {
    if (!workspace.isNative || !workspace.workspacePath) { setGitBranch(null); return; }
    let disposed = false;
    const refreshBranch = async () => {
      try {
        const status = await workspace.gitStatus();
        if (!disposed) setGitBranch(status.repository ? status.branch : null);
      } catch { if (!disposed) setGitBranch(null); }
    };
    void refreshBranch();
    const timer = window.setInterval(() => void refreshBranch(), 4000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [workspace.gitStatus, workspace.isNative, workspace.workspacePath]);

  const executeExtensionCommand = useCallback(async (extensionId: string, commandId: string) => {
    try {
      const action = await workspace.extensionRunCommand(extensionId, commandId);
      if (action.type === "showMessage") { window.alert(action.message); return; }
      if (action.type === "openFile") { await workspace.openFileAt(action.path, action.line ?? 1, action.column ?? 1); return; }
      if (action.type === "createFile") {
        await createWorkspaceFile(action.path, action.content);
        await workspace.refreshTree();
        await workspace.openFile(action.path);
      }
    } catch (error) {
      window.alert(t("extensions.commandFailed", { error: String(error) }));
    }
  }, [t, workspace]);

  const applyExtensionTheme = useCallback((theme: ExtensionThemeSummary | null) => {
    setExtensionThemeKey(theme ? `${theme.extensionId}:${theme.id}` : "");
  }, [setExtensionThemeKey]);

  const saveActiveWithFormatting = useCallback(async () => {
    let formatted: string | undefined;
    if (workspace.effectiveSettings.editor.formatOnSave && workspace.activeFile) {
      formatted = (await editorHandleRef.current?.formatDocument()) ?? undefined;
      if (formatted !== undefined) workspace.updateFile(workspace.activeFile.relativePath, formatted);
    }
    await workspace.saveActiveFile(formatted);
  }, [workspace.activeFile, workspace.effectiveSettings.editor.formatOnSave, workspace.saveActiveFile, workspace.updateFile]);

  const saveAllWithFormatting = useCallback(async () => {
    if (workspace.activeFile && workspace.effectiveSettings.editor.formatOnSave) await saveActiveWithFormatting();
    await workspace.saveAllFiles();
  }, [saveActiveWithFormatting, workspace.activeFile, workspace.effectiveSettings.editor.formatOnSave, workspace.saveAllFiles]);

  useEffect(() => {
    if (sessionRestoreAttemptedRef.current || !workspace.isNative || workspace.workspacePath || !workspace.effectiveSettings.files.restoreSession) return;
    sessionRestoreAttemptedRef.current = true;
    const recent = workspace.recentPaths[0];
    if (recent) void workspace.openRecent(recent);
  }, [workspace.effectiveSettings.files.restoreSession, workspace.isNative, workspace.openRecent, workspace.recentPaths, workspace.workspacePath]);

  const issueDevToolsCommand = useCallback((action: PreviewDevToolsCommand["action"]) => {
    setDevToolsCommand({ action, token: ++devToolsToken.current });
  }, []);
  const addDevToolsNetwork = useCallback((entry: DevToolsNetworkEntry) => {
    setDevToolsNetwork((current) => {
      const index = current.findIndex((item) => item.id === entry.id);
      const next = index >= 0 ? current.map((item, itemIndex) => itemIndex === index ? entry : item) : [...current, entry];
      return next.slice(-400);
    });
  }, []);

  const commandPaletteActions = useMemo<CommandPaletteAction[]>(() => [
    { id: "project.new", label: t("palette.projectNew"), detail: t("palette.projectNewDetail"), shortcut: displayShortcut(workspace.effectiveSettings.keybindings.newProject), keywords: ["wizard", "create", "создать", "проект"], run: () => setWizardOpen(true) },
    { id: "workspace.open", label: t("palette.workspaceOpen"), shortcut: displayShortcut(workspace.effectiveSettings.keybindings.openFolder), keywords: ["folder", "папка"], run: () => void workspace.openFolder() },
    { id: "workspace.search", label: t("palette.workspaceSearch"), shortcut: displayShortcut(workspace.effectiveSettings.keybindings.search), keywords: ["search", "replace", "поиск", "замена"], run: () => setSidebarSection("search") },
    { id: "git.sourceControl", label: t("palette.sourceControl"), shortcut: displayShortcut(workspace.effectiveSettings.keybindings.sourceControl), keywords: ["git", "commit", "stage", "контроль версий"], run: () => setSidebarSection("sourceControl") },
    { id: "project.packages", label: t("palette.packages"), keywords: ["npm", "pnpm", "yarn", "bun", "dependencies", "пакеты"], run: () => setSidebarSection("packages") },
    { id: "project.assets", label: t("palette.assets"), keywords: ["images", "svg", "fonts", "media", "ресурсы"], run: () => setSidebarSection("assets") },
    { id: "project.health", label: t("palette.health"), keywords: ["seo", "accessibility", "a11y", "audit", "аудит"], run: () => setSidebarSection("health") },
    { id: "project.devtools", label: t("palette.devtools"), keywords: ["network", "storage", "performance", "bundle", "devtools", "сеть", "производительность"], run: () => setSidebarSection("devtools") },
    { id: "project.deploy", label: t("palette.deploy"), keywords: ["deploy", "pages", "cloudflare", "netlify", "vercel", "деплой"], run: () => setSidebarSection("deploy") },
    { id: "project.components", label: t("palette.components"), keywords: ["components", "snippets", "marketplace", "компоненты"], run: () => setSidebarSection("components") },
    { id: "project.extensions", label: t("palette.extensions"), keywords: ["plugins", "extensions", "capabilities", "расширения"], run: () => setSidebarSection("extensions") },
    { id: "intelligence.reload", label: t("palette.reloadIntelligence"), disabled: !workspace.isNative || !workspace.workspacePath, keywords: ["typescript", "intellisense", "types", "типы", "подсказки"], run: () => void workspace.reloadProjectIntelligence() },
    { id: "file.save", label: t("palette.fileSave"), shortcut: displayShortcut(workspace.effectiveSettings.keybindings.save), disabled: !activeFile?.dirty, run: () => void saveActiveWithFormatting() },
    { id: "file.saveAll", label: t("palette.fileSaveAll"), shortcut: displayShortcut(workspace.effectiveSettings.keybindings.saveAll), disabled: workspace.dirtyCount === 0, run: () => void saveAllWithFormatting() },
    { id: "view.preview", label: previewVisible ? t("palette.hidePreview") : t("palette.showPreview"), run: () => setPreviewVisible((value) => !value) },
    { id: "view.multi", label: multiViewport ? t("palette.disableMulti") : t("palette.enableMulti"), keywords: ["device", "viewport", "адаптив"], run: () => setMultiViewport((value) => !value) },
    { id: "view.designer", label: inspectorOpen ? t("palette.closeInspector") : t("palette.openInspector"), disabled: !inspectorSupported, keywords: ["dom", "css", "inspect", "дизайн"], run: () => setInspectorOpen((value) => !value) },
    { id: "runtime.toggle", label: workspace.runtimeStatus.running ? t("palette.runtimeStop") : t("palette.runtimeStart"), shortcut: displayShortcut(workspace.effectiveSettings.keybindings.runProject), disabled: !projectCanRun, keywords: ["dev server", "vite"], run: () => { if (workspace.runtimeStatus.running) void workspace.stopRuntime(); else void workspace.startDevServer(); } },
    { id: "build.production", label: t("palette.buildProduction"), disabled: !projectCanBuild || workspace.runtimeStatus.running, keywords: ["vite", "dist", "production", "сборка"], run: () => void workspace.startBuild() },
    { id: "preview.dist", label: workspace.productionPreviewActive ? t("palette.previewSource") : t("palette.previewDist"), disabled: !projectCanBuild || (!workspace.productionPreviewUrl && workspace.runtimeStatus.mode === "build" && workspace.runtimeStatus.running), keywords: ["production", "build", "dist", "предпросмотр"], run: () => { if (workspace.productionPreviewActive) workspace.useSourcePreview(); else void workspace.openProductionPreview(); } },
    { id: "terminal.access", label: workspace.terminalAllowed ? t("palette.terminalDisable") : t("palette.terminalEnable"), disabled: !workspace.isNative || !workspace.isTrusted, keywords: ["shell", "pty", "security", "терминал"], run: () => void workspace.setTerminalAccess(!workspace.terminalAllowed) },
    { id: "terminal.new", label: t("palette.terminalNew"), disabled: !workspace.terminalAllowed, keywords: ["shell", "tab", "pty", "терминал"], run: () => void workspace.newTerminal() },
    { id: "release.check", label: workspace.updateChecking ? t("palette.releaseChecking") : t("palette.releaseCheck"), disabled: !workspace.releaseUpdateConfig?.configured || workspace.updateChecking, keywords: ["updater", "release", "signed", "обновления"], run: () => void workspace.checkForUpdates() },
    { id: "designer.undo", label: t("palette.designerUndo"), shortcut: "⌘Z", disabled: designerPast.length === 0, run: undoDesigner },
    { id: "designer.redo", label: t("palette.designerRedo"), shortcut: "⇧⌘Z", disabled: designerFuture.length === 0, run: redoDesigner },
    ...workspace.extensions.flatMap((extension) => extension.commands.map((command) => ({
      id: `extension:${extension.id}:${command.id}`,
      label: command.title,
      detail: command.detail || `${extension.name} · ${extension.id}`,
      keywords: ["extension", "plugin", extension.name, extension.id],
      disabled: !workspace.isTrusted || !command.available,
      run: () => void executeExtensionCommand(extension.id, command.id),
    }))),
    { id: "preferences.settings", label: t("palette.openSettings"), shortcut: displayShortcut(workspace.effectiveSettings.keybindings.settings), keywords: ["language", "settings", "язык", "настройки"], run: () => setSettingsOpen(true) },
  ], [activeFile?.dirty, designerFuture.length, designerPast.length, executeExtensionCommand, inspectorOpen, inspectorSupported, multiViewport, previewVisible, projectCanBuild, projectCanRun, redoDesigner, saveActiveWithFormatting, saveAllWithFormatting, t, undoDesigner, workspace]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const target = event.target instanceof Element ? event.target : null;
      const editingText = Boolean(target?.closest("input, textarea, [contenteditable='true'], .monaco-editor"));
      if (shortcutMatches(event, workspace.effectiveSettings.keybindings.commandPalette)) {
        event.preventDefault();
        setCommandPaletteOpen((value) => !value);
        return;
      }
      if (event.key === "F1") {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (shortcutMatches(event, workspace.effectiveSettings.keybindings.search)) {
        event.preventDefault();
        setSidebarSection("search");
        return;
      }
      if (shortcutMatches(event, workspace.effectiveSettings.keybindings.sourceControl)) {
        event.preventDefault();
        setSidebarSection("sourceControl");
        return;
      }
      if (shortcutMatches(event, workspace.effectiveSettings.keybindings.settings)) {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (shortcutMatches(event, workspace.effectiveSettings.keybindings.saveAll)) {
        event.preventDefault();
        void saveAllWithFormatting();
        return;
      }
      if (shortcutMatches(event, workspace.effectiveSettings.keybindings.save)) {
        event.preventDefault();
        void saveActiveWithFormatting();
        return;
      }
      if (shortcutMatches(event, workspace.effectiveSettings.keybindings.openFolder)) {
        event.preventDefault();
        void workspace.openFolder();
        return;
      }
      if (shortcutMatches(event, workspace.effectiveSettings.keybindings.newProject)) {
        event.preventDefault();
        setWizardOpen(true);
        return;
      }
      if (shortcutMatches(event, workspace.effectiveSettings.keybindings.runProject) && projectCanRun) {
        event.preventDefault();
        if (workspace.runtimeStatus.running) void workspace.stopRuntime();
        else void workspace.startDevServer();
        return;
      }
      if (modifier && !editingText && inspectorOpen && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoDesigner(); else undoDesigner();
      }
      if (modifier && !editingText && inspectorOpen && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoDesigner();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inspectorOpen, projectCanRun, redoDesigner, saveActiveWithFormatting, saveAllWithFormatting, undoDesigner, workspace.effectiveSettings.keybindings, workspace.openFolder, workspace.runtimeStatus.running, workspace.startDevServer, workspace.stopRuntime]);

  return (
    <div className="app-shell" style={activeExtensionTheme?.tokens as React.CSSProperties | undefined}>
      <TopBar
        workspaceName={workspace.workspaceName}
        recentPaths={workspace.recentPaths}
        projectInfo={workspace.projectInfo}
        runtimeEnvironment={workspace.runtimeEnvironment}
        runtimeStatus={workspace.runtimeStatus}
        trusted={workspace.isTrusted}
        terminalAllowed={workspace.terminalAllowed}
        productionPreviewActive={workspace.productionPreviewActive}
        productionPreviewAvailable={Boolean(workspace.productionPreviewUrl)}
        native={workspace.isNative}
        updateConfig={workspace.releaseUpdateConfig}
        updateInfo={workspace.releaseUpdate}
        updateChecking={workspace.updateChecking}
        onCheckUpdates={() => void workspace.checkForUpdates()}
        onInstallUpdate={() => void workspace.installUpdate()}
        onNewProject={() => setWizardOpen(true)}
        onOpenFolder={() => void workspace.openFolder()}
        onOpenRecent={(path) => void workspace.openRecent(path)}
        onSave={() => void saveActiveWithFormatting()}
        onSaveAll={() => void saveAllWithFormatting()}
        onTogglePreview={() => setPreviewVisible((value) => !value)}
        previewVisible={previewVisible}
        onSetTrusted={(trusted) => void workspace.setTrusted(trusted)}
        onStartDevServer={() => void workspace.startDevServer()}
        onBuild={() => void workspace.startBuild()}
        onOpenProductionPreview={() => void workspace.openProductionPreview()}
        onUseSourcePreview={workspace.useSourcePreview}
        onSetTerminalAccess={(allowed) => void workspace.setTerminalAccess(allowed)}
        onInstallDependencies={() => void workspace.installDependencies()}
        onStopRuntime={() => void workspace.stopRuntime()}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="workspace-shell">
        <ActivityBar active={sidebarSection} onChange={setSidebarSection} onOpenSettings={() => setSettingsOpen(true)} />

        <aside className="explorer-panel panel-surface">
          <Suspense fallback={<LazyFallback compact />}>
          {sidebarSection === "explorer" ? (
            <Explorer
              root={workspace.tree}
              activePath={activeFile?.relativePath}
              onOpenFile={(path) => void workspace.openFile(path)}
              workspaceName={workspace.workspaceName}
              onCreateFile={(parent, name) => void workspace.createFile(parent, name)}
              onCreateFolder={(parent, name) => void workspace.createDirectory(parent, name)}
              onRename={(path, name) => void workspace.renameEntry(path, name)}
              onDelete={(path) => void workspace.deleteEntry(path)}
              onRefresh={() => void workspace.refreshTree()}
            />
          ) : sidebarSection === "search" ? (
            <SearchPanel workspaceName={workspace.workspaceName} defaultExclude={workspace.effectiveSettings.search.defaultExclude} maxResults={workspace.effectiveSettings.search.maxResults} onSearch={workspace.searchWorkspaceText} onReplaceAll={workspace.replaceWorkspaceText} onOpenResult={(path, line, column) => void workspace.openFileAt(path, line, column)} />
          ) : sidebarSection === "sourceControl" ? (
            <SourceControlPanel workspacePath={workspace.workspacePath} activePath={workspace.activePath} trusted={workspace.isTrusted} terminalAllowed={workspace.terminalAllowed} gitNetworkAllowed={workspace.gitNetworkAllowed} dirtyPaths={workspace.dirtyPaths} getStatus={workspace.gitStatus} getDiff={workspace.gitDiff} getBranches={workspace.gitBranches} getRemoteBranches={workspace.gitRemoteBranches} getOperationState={workspace.gitOperationState} getHistory={workspace.gitHistory} getGraph={workspace.gitGraph} getFileHistory={workspace.gitFileHistory} getBlame={workspace.gitBlame} getStashes={workspace.gitStashes} getTags={workspace.gitTags} getCredentialState={workspace.gitCredentialState} getRemotes={workspace.gitRemotes} getConflict={workspace.gitConflict} stage={workspace.gitStage} unstage={workspace.gitUnstage} commit={workspace.gitCommit} init={workspace.gitInit} switchBranch={workspace.gitSwitch} createBranch={workspace.gitCreateBranch} mergeBranch={workspace.gitMerge} mergeContinue={workspace.gitMergeContinue} mergeAbort={workspace.gitMergeAbort} rebaseBranch={workspace.gitRebase} rebaseContinue={workspace.gitRebaseContinue} rebaseAbort={workspace.gitRebaseAbort} cherryPick={workspace.gitCherryPick} cherryPickContinue={workspace.gitCherryPickContinue} cherryPickAbort={workspace.gitCherryPickAbort} stashPush={workspace.gitStashPush} stashApply={workspace.gitStashApply} stashDrop={workspace.gitStashDrop} createTag={workspace.gitCreateTag} deleteTag={workspace.gitDeleteTag} setGitNetworkAccess={workspace.setGitNetworkAccess} fetchRemote={workspace.gitFetch} pullRemote={workspace.gitPull} pushRemote={workspace.gitPush} applyConflictResult={workspace.applyGitConflictResult} resolveConflict={workspace.resolveGitConflict} openFile={(path) => void workspace.openFile(path)} />
          ) : sidebarSection === "packages" ? (
            <PackageManagerPanel native={workspace.isNative} workspacePath={workspace.workspacePath} trusted={workspace.isTrusted} terminalAllowed={workspace.terminalAllowed} getManifest={workspace.packageManifest} installPackage={workspace.packageInstall} removePackage={workspace.packageRemove} updatePackage={workspace.packageUpdate} getOutdated={workspace.packageOutdated} runAudit={workspace.packageAudit} />
          ) : sidebarSection === "assets" ? (
            <AssetManagerPanel native={workspace.isNative} workspacePath={workspace.workspacePath} trusted={workspace.isTrusted} previewBaseUrl={workspace.previewBaseUrl} getAssets={workspace.workspaceAssets} optimizeSvg={workspace.optimizeAssetSvg} openFile={(path) => void workspace.openFile(path)} />
          ) : sidebarSection === "health" ? (
            <ProjectHealthPanel native={workspace.isNative} workspacePath={workspace.workspacePath} runAudit={workspace.projectAudit} openFileAt={(path, line, column) => void workspace.openFileAt(path, line, column)} />
          ) : sidebarSection === "devtools" ? (
            <DevToolsPanel
              previewReady={devToolsReady}
              network={devToolsNetwork}
              storage={devToolsStorage}
              performance={devToolsPerformance}
              accessibility={devToolsAccessibility}
              outputDir={workspace.projectInfo.buildOutputDir}
              onCommand={issueDevToolsCommand}
              onClearNetwork={() => setDevToolsNetwork([])}
            />
          ) : sidebarSection === "deploy" ? (
            <DeployPanel native={workspace.isNative} workspacePath={workspace.workspacePath} trusted={workspace.isTrusted} terminalAllowed={workspace.terminalAllowed} outputDir={workspace.projectInfo.buildOutputDir} />
          ) : sidebarSection === "components" ? (
            <ComponentMarketplacePanel workspaceComponents={workspace.workspaceComponents} extensionComponents={workspace.isTrusted ? workspace.extensionComponents : []} onDeleteWorkspaceComponent={workspace.deleteWorkspaceComponent} onOpenExtensions={() => setSidebarSection("extensions")} />
          ) : (
            <ExtensionsPanel native={workspace.isNative} workspacePath={workspace.workspacePath} trusted={workspace.isTrusted} extensions={workspace.extensions} catalog={workspace.extensionCatalog} onRefresh={workspace.refreshExtensions} onInstall={workspace.extensionInstall} onUninstall={workspace.extensionUninstall} onSetEnabled={workspace.extensionSetEnabled} onSetCapability={workspace.extensionSetCapability} onApplyTheme={applyExtensionTheme} />
          )}
          </Suspense>
        </aside>

        <main className={previewVisible ? "workbench with-preview" : "workbench"}>
          <section className="editor-pane panel-surface">
            <EditorTabs
              tabs={workspace.openFiles}
              activePath={activeFile?.relativePath}
              onSelect={workspace.setActivePath}
              onClose={workspace.closeFile}
            />
            <div className="editor-stage">
              {activeFile ? (
                <Suspense fallback={<LazyFallback />}>
                <CodeEditor
                  ref={editorHandleRef}
                  file={activeFile}
                  target={workspace.editorTarget}
                  onChange={(value) => workspace.updateFile(activeFile.relativePath, value)}
                  onDiagnosticsChange={updateDiagnostics}
                  onCursorChange={handleEditorCursorChange}
                  breakpoints={debugBreakpoints}
                  onToggleBreakpoint={toggleDebugBreakpoint}
                  editorSettings={workspace.effectiveSettings.editor}
                  uiTheme={workspace.effectiveSettings.appearance.theme}
                />
                </Suspense>
              ) : (
                <div className="empty-state">
                  <div className="empty-mark">&lt;/&gt;</div>
                  <h2>WebForge</h2>
                  <p>{t("empty.chooseFile")}</p>
                  <div className="empty-actions"><button className="primary-button" onClick={() => setWizardOpen(true)}>{t("empty.newProject")}</button><button onClick={() => void workspace.openFolder()}>{t("empty.openFolder")}</button></div>
                </div>
              )}
            </div>
          </section>

          {previewVisible && (
            <div className={inspectorOpen ? "preview-workspace inspector-open" : "preview-workspace"}>
              <PreviewPane
                html={previewHtml}
                baseUrl={workspace.previewBaseUrl}
                entryPath={previewEntryPath}
                revision={workspace.previewRevision}
                preset={previewPreset}
                onPresetChange={setPreviewPreset}
                customWidth={previewCustomWidth}
                onCustomWidthChange={setPreviewCustomWidth}
                multiViewport={multiViewport}
                onMultiViewportChange={setMultiViewport}
                breakpoints={responsiveBreakpoints}
                onUpdateBreakpoint={updateBreakpoint}
                onCreateBreakpoint={createBreakpoint}
                onRevealBreakpoint={revealBreakpoint}
                workspacePath={workspace.workspacePath}
                runtimeUrl={workspace.runtimeStatus.previewUrl}
                runtimeRunning={workspace.runtimeStatus.running && workspace.runtimeStatus.mode === "dev"}
                runtimeReady={workspace.runtimeStatus.ready && workspace.runtimeStatus.mode === "dev"}
                requiresRuntime={workspace.isNative && projectAdapter.devServer}
                runtimeSupported={workspace.projectInfo.devServerSupported}
                onStartRuntime={projectCanRun ? () => void workspace.startDevServer() : undefined}
                unsavedRuntimeChanges={workspace.runtimeStatus.ready && workspace.dirtyCount > 0}
                productionUrl={workspace.productionPreviewUrl}
                productionActive={workspace.productionPreviewActive}
                productionOutputDir={workspace.projectInfo.buildOutputDir}
                onUseSourcePreview={workspace.useSourcePreview}
                onUseProductionPreview={() => void workspace.openProductionPreview()}
                inspectorEnabled={inspectorEnabled}
                onInspectorEnabledChange={changeInspectorEnabled}
                onInspectSelection={selectElement}
                onDomTree={setDomTree}
                onConsoleEntry={addConsoleEntry}
                onDesignerStyleCommit={commitPreviewStyleBatch}
                styleCommand={styleCommand}
                selectedSourceId={designerSourceId}
                selectedSelector={designerSelector}
                devToolsCommand={devToolsCommand}
                onDevToolsReady={setDevToolsReady}
                onDevToolsNetwork={addDevToolsNetwork}
                onDevToolsStorage={setDevToolsStorage}
                onDevToolsPerformance={setDevToolsPerformance}
                onDevToolsAccessibility={setDevToolsAccessibility}
              />
              {(inspectorOpen || inspectorEnabled) && <Suspense fallback={null}><InspectorPanel
                open={inspectorOpen}
                supported={inspectorSupported}
                selection={selection}
                domTree={domTree}
                cssVariables={cssVariables}
                canUndo={designerPast.length > 0}
                canRedo={designerFuture.length > 0}
                onUndo={undoDesigner}
                onRedo={redoDesigner}
                onClose={() => { setInspectorOpen(false); setInspectorEnabled(false); }}
                onSelectNode={(sourceId, selector) => { setDesignerSourceId(sourceId); setDesignerSelector(selector); setInspectorEnabled(false); }}
                onMoveNode={moveNode}
                onApplyStyle={applyInspectorStyle}
                onApplyInlineStyle={applyInlineStyle}
                onSetClasses={setClasses}
                onSetText={setText}
                onSetAttribute={setAttribute}
                onRemoveAttribute={removeAttribute}
                onDeleteNode={deleteNode}
                onDuplicateNode={duplicateNode}
                onInsertComponent={insertComponent}
                onRevealSource={revealSource}
                onSetCssVariable={setCssVariable}
                onCreateAnimationPreset={createAnimationPreset}
                onCreateContainerQuery={createContainerQuery}
                projectCssFrameworks={workspace.projectInfo.cssFrameworks}
                userComponents={designerComponents}
                onAddUserComponent={(component) => void workspace.addWorkspaceComponent(component)}
                onDeleteUserComponent={(id) => void workspace.deleteWorkspaceComponent(id)}
              /></Suspense>}
            </div>
          )}
        </main>

        <section className={bottomOpen ? "bottom-panel panel-surface" : "bottom-panel collapsed panel-surface"}>
          <Suspense fallback={<LazyFallback compact />}><BottomPanel
            open={bottomOpen}
            uiTheme={workspace.effectiveSettings.appearance.theme}
            onToggle={() => setBottomOpen((value) => !value)}
            log={workspace.log}
            runtimeLog={workspace.runtimeLog}
            consoleEntries={consoleEntries}
            diagnostics={combinedDiagnostics}
            runtimeStatus={workspace.runtimeStatus}
            projectCanRun={projectCanRun}
            projectCanBuild={projectCanBuild}
            dependenciesInstalled={!workspace.projectInfo.packageJson || workspace.projectInfo.dependenciesInstalled}
            productionPreviewAvailable={Boolean(workspace.productionPreviewUrl)}
            productionPreviewActive={workspace.productionPreviewActive}
            terminalAllowed={workspace.terminalAllowed}
            terminalSessions={workspace.terminalSessions}
            activeTerminalId={workspace.activeTerminalId}
            terminalOutput={workspace.terminalOutput}
            tasks={workspace.projectTasks}
            taskStatus={workspace.taskStatus}
            taskLog={workspace.taskLog}
            testReport={workspace.testReport}
            testHistory={workspace.testHistory}
            languageSnapshot={workspace.languageSnapshot}
            languageServers={workspace.languageServers}
            languageServerStatus={workspace.languageServerStatus}
            languageDiagnosticsCount={workspace.languageDiagnostics.length}
            languageServerLogs={workspace.languageServerLogs}
            activePath={workspace.activePath}
            cursorLine={editorCursor.line}
            cursorColumn={editorCursor.column}
            debugBrowsers={workspace.debugBrowsers}
            debugStatus={workspace.debugStatus}
            debugEvents={workspace.debugEvents}
            debugConfigurations={debugConfigurations}
            debugBreakpoints={debugBreakpoints}
            debugWorkspaceKey={debugWorkspaceKey}
            onRunTask={(taskId) => void workspace.runProjectTask(taskId)}
            onRunTestFile={(taskId, relativePath) => void workspace.runProjectTestFile(taskId, relativePath)}
            onRunTestCase={(taskId, relativePath, testName, framework) => void workspace.runProjectTestCase(taskId, relativePath, testName, framework)}
            onRunTestCoverage={(taskId) => void workspace.runProjectTestCoverage(taskId)}
            onRerunFailedTests={(taskId) => void workspace.rerunFailedTests(taskId)}
            onClearTestHistory={() => void workspace.clearTestHistory()}
            onOpenTestLocation={(relativePath, line) => void workspace.openFileAt(relativePath, line, 1)}
            onStopTask={() => void workspace.stopTask()}
            onStartLanguageServer={(serverId) => void workspace.startProjectLanguageServer(serverId)}
            onStartAllLanguageServers={() => void workspace.startAllProjectLanguageServers()}
            onStopLanguageServer={(serverId) => void workspace.stopProjectLanguageServer(serverId)}
            onLoadDocumentSymbols={workspace.languageDocumentSymbols}
            onSearchWorkspaceSymbols={workspace.languageWorkspaceSymbols}
            onPrepareHierarchy={workspace.languagePrepareHierarchy}
            onExpandHierarchy={workspace.languageExpandHierarchy}
            onOpenLanguageHierarchyItem={(item) => void workspace.openLanguageHierarchyItem(item)}
            onOpenLanguageSymbol={(symbol, fallbackPath) => void workspace.openLanguageSymbol(symbol, fallbackPath)}
            onRefreshProjectTools={() => void workspace.refreshProjectTools()}
            onStartRuntime={() => void workspace.startDevServer()}
            onBuild={() => void workspace.startBuild()}
            onOpenProductionPreview={() => void workspace.openProductionPreview()}
            onUseSourcePreview={workspace.useSourcePreview}
            onSetTerminalAccess={(allowed) => void workspace.setTerminalAccess(allowed)}
            onNewTerminal={() => void workspace.newTerminal()}
            onSelectTerminal={workspace.selectTerminal}
            onCloseTerminal={(sessionId) => void workspace.closeTerminal(sessionId)}
            onTerminalInput={(sessionId, data) => void workspace.sendTerminalInput(sessionId, data)}
            onTerminalResize={(sessionId, cols, rows) => void workspace.resizeTerminal(sessionId, cols, rows)}
            onInstallDependencies={() => void workspace.installDependencies()}
            onStopRuntime={() => void workspace.stopRuntime()}
            onOpenConsoleLocation={(entry) => { if (entry.sourcePath) void workspace.openFileAt(entry.sourcePath, entry.line ?? 1, entry.column ?? 1); }}
            onClearConsole={() => setConsoleEntries([])}
            onOpenDiagnostic={(diagnostic) => void workspace.openFileAt(diagnostic.path, diagnostic.line, diagnostic.column)}
            onStartBrowserDebug={startDebugSession}
            onStopBrowserDebug={stopDebugSession}
            onBrowserDebugAction={workspace.runBrowserDebugAction}
            onOpenDebugLocation={openDebugLocation}
            onToggleDebugBreakpoint={toggleDebugBreakpoint}
            onAddDebugConfiguration={addDebugConfiguration}
            onRemoveDebugConfiguration={removeDebugConfiguration}
          /></Suspense>
        </section>
      </div>

      <StatusBar
        workspaceKind={workspace.isNative ? t("status.tauriDesktop") : t("status.browserDemo")}
        projectLabel={workspace.projectInfo.label}
        trusted={workspace.isTrusted}
        native={workspace.isNative}
        runtimeState={runtimeState}
        activeFile={activeFile}
        dirtyCount={workspace.dirtyCount}
        externalChangeCount={externalChangeCount}
        errorCount={diagnosticErrorCount}
        warningCount={diagnosticWarningCount}
        gitBranch={gitBranch}
        intelligenceFiles={workspace.languageSnapshot?.files.length ?? 0}
        intelligenceTruncated={workspace.languageSnapshot?.truncated ?? false}
        nativeWatcherActive={workspace.nativeWatcherActive}
        languageServerLabel={workspace.languageServerStatus.running ? workspace.languageServerStatus.label : null}
      />

      <Suspense fallback={null}>{wizardOpen && <ProjectWizard open={wizardOpen} native={workspace.isNative} extensionTemplates={workspace.isTrusted ? workspace.extensionTemplates : []} onClose={() => setWizardOpen(false)} onCreate={workspace.createNewProject} />}</Suspense>
      <CommandPalette open={commandPaletteOpen} actions={commandPaletteActions} onClose={() => setCommandPaletteOpen(false)} />
      <Suspense fallback={null}>{settingsOpen && <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={ideSettings.settings} workspaceSettings={workspace.workspaceSettings} effectiveSettings={workspace.effectiveSettings} workspaceAvailable={Boolean(workspace.workspacePath)} indexStatus={workspace.workspaceIndexStatus} onChangeSettings={ideSettings.setSettings} onChangeWorkspaceSettings={workspace.updateWorkspaceSettings} onResetSettings={ideSettings.resetSettings} onRebuildIndex={workspace.rebuildSearchIndexNow} />}</Suspense>
    </div>
  );
}
