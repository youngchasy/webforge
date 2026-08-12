import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { demoFiles, demoTree } from "../data/demoProject";
import { useI18n } from "../i18n";
import { languageFromPath } from "../lib/language";
import { listHtmlDependencies } from "../lib/preview";
import {
  chooseWorkspace,
  createProject,
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  detectProject,
  installProjectDependencies,
  loadWorkspaceComponentLibrary,
  pollProjectRuntimeLogs,
  pollTerminalOutput,
  pollWorkspaceChanges,
  pollNativeWorkspaceChanges,
  startNativeWorkspaceWatch,
  probeRuntimeEnvironment,
  readWorkspaceFile,
  refreshWorkspace,
  renameWorkspaceEntry,
  runningInTauri,
  setPreviewOverlays,
  saveWorkspaceComponentLibrary,
  setTerminalPermission,
  setGitNetworkPermission,
  setWorkspaceRoot,
  setWorkspaceTrust,
  startBuildPreviewServer,
  startProjectBuild,
  startProjectDevServer,
  createTerminalSession,
  closeTerminalSession,
  getReleaseUpdateConfig,
  checkReleaseUpdate,
  installReleaseUpdate,
  resizeTerminalSession,
  startWorkspacePreview,
  stopBuildPreviewServer,
  stopProjectRuntime,
  writeTerminalInput,
  writeWorkspaceFile,
  writeWorkspaceFiles,
  searchWorkspace,
  previewWorkspaceReplace,
  getGitStatus,
  getGitDiff,
  stageGitPath,
  unstageGitPath,
  commitGit,
  initGitRepository,
  loadProjectLanguageFiles,
  listGitBranches,
  getGitHistory,
  switchGitBranch,
  createGitBranch,
  mergeGitBranch,
  continueGitMerge,
  abortGitMerge,
  listGitRemoteBranches,
  getGitOperationState,
  rebaseGitBranch,
  continueGitRebase,
  abortGitRebase,
  cherryPickGitCommit,
  continueGitCherryPick,
  abortGitCherryPick,
  listGitRemotes,
  getGitConflict,
  fetchGitRemote,
  pullGitRemote,
  pushGitRemote,
  listGitStashes,
  pushGitStash,
  applyGitStash,
  dropGitStash,
  listGitTags,
  createGitTag,
  deleteGitTag,
  getGitGraph,
  getGitFileHistory,
  getGitBlame,
  getGitCredentialState,
  listProjectTasks,
  startProjectTask,
  startProjectTestFile,
  startProjectTestCase,
  startProjectTestCoverage,
  rerunFailedProjectTests,
  getProjectTestHistory,
  clearProjectTestHistory,
  stopProjectTask,
  pollProjectTaskLogs,
  probeLanguageServers,
  startLanguageServer,
  stopLanguageServer,
  getLanguageServerStatus,
  getLanguageDiagnostics,
  refreshLanguageDiagnostics,
  getLanguageServerLogs,
  updateLanguageConfiguration,
  syncLanguageDocument,
  closeLanguageDocument,
  requestLanguageSymbols,
  requestLanguageHierarchy,
  getProjectTestReport,
  probeDebugBrowsers,
  startBrowserDebug,
  stopBrowserDebug,
  getBrowserDebugStatus,
  pollBrowserDebugEvents,
  browserDebugAction,
  getPackageManifest,
  installPackage,
  removePackage,
  updatePackage,
  getOutdatedPackages,
  runPackageSecurityAudit,
  listWorkspaceAssets,
  optimizeSvgAsset,
  runProjectAudit,
  listExtensions,
  listExtensionCatalog,
  installBundledExtension,
  uninstallExtension,
  setExtensionEnabled,
  setExtensionCapability,
  listExtensionComponents,
  listExtensionTemplates,
  runExtensionCommand,
  createExtensionProject,
  loadWorkspaceSettings,
  saveWorkspaceSettings,
  saveRecoverySnapshot,
  loadRecoverySnapshot,
  clearRecoverySnapshot,
  rebuildWorkspaceIndex,
  getWorkspaceIndexStatus,
} from "../lib/tauri";
import {
  addTreeEntry,
  baseName,
  findFirstHtml,
  joinPath,
  parentPath,
  pathIsInside,
  removeTreeEntry,
  renamePathPrefix,
  renameTreeEntry,
} from "../lib/tree";
import type { ComponentSnippet, EditorTarget } from "../types/designer";
import type { CreateProjectRequest } from "../types/project";
import type { ProjectInfo, RuntimeEnvironment, RuntimeStatus } from "../types/runtime";
import type { ReleaseUpdateConfig, ReleaseUpdateInfo, TerminalSessionStatus } from "../types/terminal";
import type { EditorFile, WorkspaceEntry } from "../types/workspace";
import type { WorkspaceIndexStatus, WorkspaceSearchOptions, WorkspaceSearchResponse, WorkspaceReplacement } from "../types/search";
import type { GitBlameLine, GitBranch, GitCommit, GitConflictSnapshot, GitCredentialState, GitGraphCommit, GitNetworkResult, GitOperationState, GitRemote, GitRemoteBranch, GitStashEntry, GitStatus, GitTag } from "../types/git";
import { replaceInMemory, searchInMemory } from "../lib/workspaceSearch";
import { applyProjectLanguageSnapshot, clearProjectIntelligence } from "../monaco/intelligence";
import type { ProjectLanguageSnapshot } from "../types/intelligence";
import type { LanguageDiagnostic, LanguageHierarchyItem, LanguageIncomingCall, LanguageOutgoingCall, LanguageServerInfo, LanguageServerLogEntry, LanguageServerStatus, LanguageSymbol } from "../types/languageServices";
import type { ProjectTask, TaskStatus, TestHistoryEntry, TestRunReport } from "../types/tasks";
import type { BrowserDebugEvent, BrowserDebugStatus, DebugBrowserInfo } from "../types/debug";
import type { PackageCommandResult, PackageManifest } from "../types/packages";
import type { AssetInventory, AssetOptimizeResult } from "../types/assets";
import type { ProjectAuditSummary } from "../types/audit";
import type { ExtensionCatalogEntry, ExtensionCommandAction, ExtensionComponentContribution, ExtensionRecord, ExtensionTemplateSummary } from "../types/extensions";
import type { IdeSettings, RecoverySnapshot, WorkspaceSettings } from "../types/settings";
import { mergeIdeSettings } from "../lib/settings";

const RECENTS_KEY = "webforge.recentWorkspaces";
const TRUSTED_KEY = "webforge.trustedWorkspaces";

const demoProjectInfo: ProjectInfo = {
  adapter: "static",
  label: "Static HTML/CSS/JS",
  framework: null,
  frameworkVersion: null,
  vite: false,
  viteConfigPath: null,
  typescript: false,
  packageJson: false,
  dependenciesInstalled: false,
  preferredPackageManager: null,
  devScript: null,
  devServerSupported: false,
  buildScript: null,
  buildSupported: false,
  buildOutputDir: null,
  scripts: [],
  cssFrameworks: [],
  entryPath: "index.html",
};

const idleRuntime: RuntimeStatus = {
  running: false,
  ready: false,
  mode: null,
  command: null,
  previewUrl: null,
  packageManager: null,
  exitCode: null,
};

const idleTaskStatus: TaskStatus = { running: false, taskId: null, name: null, category: null, command: null, packageManager: null, exitCode: null, testPath: null, testName: null, testFramework: null, coverage: false };
const idleLanguageStatus: LanguageServerStatus = {
  running: false, serverId: null, label: null, pid: null, error: null,
  semanticTokenTypes: [], semanticTokenModifiers: [],
  supportsCallHierarchy: false, supportsTypeHierarchy: false, supportsInlayHints: false,
  supportsFormatting: false, supportsCodeLens: false, supportsWorkspaceDiagnostics: false, servers: [],
};
const idleDebugStatus: BrowserDebugStatus = { running: false, connected: false, browserId: null, browserLabel: null, pid: null, port: null, targetId: null, targetTitle: null, targetUrl: null, paused: false, pauseReason: null, callFrames: [], scriptCount: 0, scripts: [], error: null };

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function createEditorFile(path: string, content: string): EditorFile {
  return {
    name: fileName(path),
    relativePath: path,
    language: languageFromPath(path),
    content,
    savedContent: content,
    dirty: false,
    externalChange: null,
  };
}

function cloneTree<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadStringList(key: string, limit?: number): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    const values = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    return typeof limit === "number" ? values.slice(0, limit) : values;
  } catch {
    return [];
  }
}

function saveStringList(key: string, values: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // Persistence is best-effort only.
  }
}

function rememberWorkspace(path: string, current: string[]): string[] {
  const next = [path, ...current.filter((item) => item !== path)].slice(0, 8);
  saveStringList(RECENTS_KEY, next);
  return next;
}

function rememberTrust(path: string, trusted: boolean): void {
  const current = loadStringList(TRUSTED_KEY);
  const next = trusted
    ? [path, ...current.filter((item) => item !== path)]
    : current.filter((item) => item !== path);
  saveStringList(TRUSTED_KEY, next);
}

function isRememberedTrusted(path: string): boolean {
  return loadStringList(TRUSTED_KEY).includes(path);
}

function validChildName(name: string): boolean {
  const trimmed = name.trim();
  return Boolean(trimmed) && trimmed !== "." && trimmed !== ".." && !/[\\/]/.test(trimmed);
}

function projectMetadataChanged(paths: string[]): boolean {
  const metadata = new Set([
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "tsconfig.json",
    "vite.config.js",
    "vite.config.ts",
    "vite.config.mjs",
  ]);
  return paths.some((path) => metadata.has(path));
}

function projectLanguageChanged(paths: string[]): boolean {
  return paths.some((path) => /(?:^|\/)(?:package\.json|tsconfig(?:\.[^/]+)?\.json)$|\.(?:[cm]?[jt]sx?|d\.[cm]?ts)$/i.test(path));
}

const initialFiles = Object.fromEntries(
  Object.entries(demoFiles).map(([path, content]) => [path, createEditorFile(path, content)]),
);

export function useWorkspace(userSettings: IdeSettings) {
  const { locale, t } = useI18n();
  const isNative = runningInTauri();
  const [tree, setTree] = useState<WorkspaceEntry>(() => cloneTree(demoTree));
  const [workspaceName, setWorkspaceName] = useState(demoTree.name);
  const [workspacePath, setWorkspacePath] = useState("");
  const [previewBaseUrl, setPreviewBaseUrl] = useState("");
  const [previewRevision, setPreviewRevision] = useState(0);
  const [recentPaths, setRecentPaths] = useState<string[]>(() => loadStringList(RECENTS_KEY, 8));
  const [editorFiles, setEditorFiles] = useState<Record<string, EditorFile>>(() => ({ ...initialFiles }));
  const [openPaths, setOpenPaths] = useState<string[]>(["index.html", "styles/main.css"]);
  const [activePath, setActivePathState] = useState<string>("index.html");
  const [projectInfo, setProjectInfo] = useState<ProjectInfo>(demoProjectInfo);
  const [isTrusted, setIsTrusted] = useState(!isNative);
  const [runtimeEnvironment, setRuntimeEnvironment] = useState<RuntimeEnvironment | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(idleRuntime);
  const [runtimeLog, setRuntimeLog] = useState<string[]>([]);
  const [productionPreviewUrl, setProductionPreviewUrl] = useState("");
  const [productionPreviewActive, setProductionPreviewActive] = useState(false);
  const [workspaceComponents, setWorkspaceComponents] = useState<ComponentSnippet[]>([]);
  const [extensions, setExtensions] = useState<ExtensionRecord[]>([]);
  const [extensionCatalog, setExtensionCatalog] = useState<ExtensionCatalogEntry[]>([]);
  const [extensionComponents, setExtensionComponents] = useState<ExtensionComponentContribution[]>([]);
  const [extensionTemplates, setExtensionTemplates] = useState<ExtensionTemplateSummary[]>([]);
  const [terminalAllowed, setTerminalAllowed] = useState(false);
  const [gitNetworkAllowed, setGitNetworkAllowed] = useState(false);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionStatus[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState("");
  const [terminalOutput, setTerminalOutput] = useState<Record<string, string>>({});
  const [releaseUpdateConfig, setReleaseUpdateConfig] = useState<ReleaseUpdateConfig | null>(null);
  const [releaseUpdate, setReleaseUpdate] = useState<ReleaseUpdateInfo | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [languageSnapshot, setLanguageSnapshot] = useState<ProjectLanguageSnapshot | null>(null);
  const [languageServers, setLanguageServers] = useState<LanguageServerInfo[]>([]);
  const [languageServerStatus, setLanguageServerStatus] = useState<LanguageServerStatus>(idleLanguageStatus);
  const [languageDiagnostics, setLanguageDiagnostics] = useState<LanguageDiagnostic[]>([]);
  const [languageServerLogs, setLanguageServerLogs] = useState<LanguageServerLogEntry[]>([]);
  const [languageDesiredServers, setLanguageDesiredServers] = useState<string[]>([]);
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>(idleTaskStatus);
  const [taskLog, setTaskLog] = useState<string[]>([]);
  const [testReport, setTestReport] = useState<TestRunReport | null>(null);
  const [testHistory, setTestHistory] = useState<TestHistoryEntry[]>([]);
  const [debugBrowsers, setDebugBrowsers] = useState<DebugBrowserInfo[]>([]);
  const [debugStatus, setDebugStatus] = useState<BrowserDebugStatus>(idleDebugStatus);
  const [debugEvents, setDebugEvents] = useState<BrowserDebugEvent[]>([]);
  const [nativeWatcherActive, setNativeWatcherActive] = useState(false);
  const [gitRevision, setGitRevision] = useState(0);
  const [workspaceSettings, setWorkspaceSettingsState] = useState<WorkspaceSettings>({});
  const [workspaceIndexStatus, setWorkspaceIndexStatus] = useState<WorkspaceIndexStatus>({ indexed: false, files: 0, totalBytes: 0, revision: 0, truncated: false });
  const [log, setLog] = useState<string[]>(() => [
    t("log.initialized"),
    isNative ? t("log.nativeDetected") : t("log.browserDemo"),
  ]);

  const editorFilesRef = useRef(editorFiles);
  const activePathRef = useRef(activePath);
  const runtimeCursorRef = useRef(0);
  const runtimeStatusRef = useRef(runtimeStatus);
  const taskCursorRef = useRef(0);
  const debugCursorRef = useRef(0);
  const languageVersionRef = useRef<Record<string, number>>({});
  const languageRestartRef = useRef<Record<string, { attempts: number; lastAttempt: number }>>({});
  const terminalCursorsRef = useRef<Record<string, number>>({});
  useEffect(() => { editorFilesRef.current = editorFiles; }, [editorFiles]);
  useEffect(() => { activePathRef.current = activePath; }, [activePath]);
  useEffect(() => { runtimeStatusRef.current = runtimeStatus; }, [runtimeStatus]);

  const effectiveSettings = useMemo(() => mergeIdeSettings(userSettings, workspaceSettings), [userSettings, workspaceSettings]);

  const appendLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString(locale === "ru" ? "ru-RU" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLog((current) => [...current.slice(-119), `[${timestamp}] ${message}`]);
  }, [locale, t]);

  const filesByPath = useMemo(
    () => Object.fromEntries(Object.entries(editorFiles).map(([path, file]) => [path, file.content])),
    [editorFiles],
  );

  const dirtyCount = useMemo(
    () => Object.values(editorFiles).filter((file) => file.dirty).length,
    [editorFiles],
  );

  const dirtyPaths = useMemo(
    () => Object.values(editorFiles).filter((file) => file.dirty).map((file) => file.relativePath),
    [editorFiles],
  );

  const defaultPreviewPath = useMemo(
    () => projectInfo.entryPath ?? findFirstHtml(tree) ?? "",
    [projectInfo.entryPath, tree],
  );

  const refreshProjectInfo = useCallback(async () => {
    if (!isNative || !workspacePath) return projectInfo;
    try {
      const next = await detectProject();
      setProjectInfo(next);
      return next;
    } catch (error) {
      appendLog(t("log.projectDetectionFailed", { error: String(error) }));
      return projectInfo;
    }
  }, [appendLog, isNative, projectInfo, workspacePath, t]);

  const refreshTree = useCallback(async () => {
    if (!isNative || !workspacePath) return;
    try {
      const next = await refreshWorkspace();
      setTree(next);
    } catch (error) {
      appendLog(t("log.refreshFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, workspacePath, t]);

  const reloadProjectIntelligence = useCallback(async () => {
    if (!isNative) return null;
    try {
      const snapshot = await loadProjectLanguageFiles();
      applyProjectLanguageSnapshot(snapshot);
      setLanguageSnapshot(snapshot);
      appendLog(t("log.intelligenceLoaded", { sources: snapshot.sourceCount, declarations: snapshot.declarationCount, size: Math.max(1, Math.round(snapshot.totalBytes / 1024)) }));
      return snapshot;
    } catch (error) {
      appendLog(t("log.intelligenceFailed", { error: String(error) }));
      return null;
    }
  }, [appendLog, isNative, t]);

  const loadNativeFile = useCallback(async (path: string): Promise<Record<string, EditorFile>> => {
    const content = await readWorkspaceFile(path);
    const loaded: Record<string, EditorFile> = { [path]: createEditorFile(path, content) };

    if (/\.html?$/i.test(path)) {
      const dependencies = listHtmlDependencies(path, content);
      const results = await Promise.allSettled(
        dependencies.map(async (dependency) => [dependency, await readWorkspaceFile(dependency)] as const),
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          const [dependency, dependencyContent] = result.value;
          loaded[dependency] = createEditorFile(dependency, dependencyContent);
        }
      }
    }
    return loaded;
  }, [t]);

  const hasDirtyFiles = useCallback(() => Object.values(editorFilesRef.current).some((file) => file.dirty), []);

  const openWorkspacePath = useCallback(async (selected: string, options?: { trusted?: boolean; skipDirtyPrompt?: boolean }) => {
    if (!isNative) return;
    if (!options?.skipDirtyPrompt && hasDirtyFiles() && !window.confirm(t("log.discardOpen"))) return;

    try {
      const nextTree = await setWorkspaceRoot(selected);
      const rememberedTrusted = options?.trusted ?? isRememberedTrusted(selected);
      if (rememberedTrusted) {
        await setWorkspaceTrust(true);
        rememberTrust(selected, true);
      }

      const [previewResult, projectResult, environmentResult, componentLibraryResult, extensionsResult, extensionCatalogResult, extensionComponentsResult, extensionTemplatesResult, watcherResult, tasksResult, languageServersResult, debugBrowsersResult, settingsResult, recoveryResult, indexResult] = await Promise.allSettled([
        startWorkspacePreview(),
        detectProject(),
        probeRuntimeEnvironment(),
        loadWorkspaceComponentLibrary(),
        listExtensions(),
        listExtensionCatalog(),
        listExtensionComponents(),
        listExtensionTemplates(),
        startNativeWorkspaceWatch(),
        listProjectTasks(),
        probeLanguageServers(),
        probeDebugBrowsers(),
        loadWorkspaceSettings(),
        loadRecoverySnapshot(),
        getWorkspaceIndexStatus(),
      ]);

      const nextProject = projectResult.status === "fulfilled" ? projectResult.value : {
        ...demoProjectInfo,
        entryPath: findFirstHtml(nextTree) ?? null,
      };
      const previewUrl = previewResult.status === "fulfilled" ? previewResult.value : "";
      const nextWorkspaceSettings = settingsResult.status === "fulfilled" ? settingsResult.value : {};
      const nextEffectiveSettings = mergeIdeSettings(userSettings, nextWorkspaceSettings);
      const recovery = recoveryResult.status === "fulfilled" ? recoveryResult.value : null;
      const initialPath = nextProject.entryPath ?? findFirstHtml(nextTree);
      let loaded: Record<string, EditorFile> = {};
      let restoredOpenPaths: string[] = [];
      let restoredActivePath = "";
      if (nextEffectiveSettings.files.restoreSession && (recovery?.version === 1 || recovery?.version === 2)) {
        const requestedPaths = [...new Set([...recovery.openPaths.slice(0, 40), ...recovery.dirtyBuffers.slice(0, 32).map((item) => item.path)])];
        const dirtyByPath = new Map(recovery.dirtyBuffers.map((item) => [item.path, item]));
        for (const path of requestedPaths) {
          try {
            const diskContent = await readWorkspaceFile(path);
            const dirty = nextEffectiveSettings.files.hotExit ? dirtyByPath.get(path) : undefined;
            loaded[path] = dirty ? {
              ...createEditorFile(path, diskContent),
              content: dirty.content,
              savedContent: diskContent,
              dirty: dirty.content !== diskContent,
              externalChange: diskContent !== dirty.savedContent ? "modified" : null,
            } : createEditorFile(path, diskContent);
            restoredOpenPaths.push(path);
          } catch { /* stale session entry */ }
        }
        restoredActivePath = restoredOpenPaths.includes(recovery.activePath) ? recovery.activePath : restoredOpenPaths[0] ?? "";
      }
      if (!restoredOpenPaths.length && initialPath) {
        try {
          loaded = await loadNativeFile(initialPath);
        } catch (error) {
          appendLog(t("log.previewPreloadFailed", { error: String(error) }));
        }
      }

      clearProjectIntelligence();
      setLanguageSnapshot(null);
      setLanguageServers(languageServersResult.status === "fulfilled" ? languageServersResult.value : []);
      setLanguageServerStatus(idleLanguageStatus);
      setLanguageDiagnostics([]);
      setLanguageServerLogs([]);
      setLanguageDesiredServers([]);
      languageRestartRef.current = {};
      languageVersionRef.current = {};
      setProjectTasks(tasksResult.status === "fulfilled" ? tasksResult.value : []);
      setTaskStatus(idleTaskStatus);
      setTaskLog([]);
      setTestReport(null);
      taskCursorRef.current = 0;
      setDebugBrowsers(debugBrowsersResult.status === "fulfilled" ? debugBrowsersResult.value : []);
      setDebugStatus(idleDebugStatus);
      setDebugEvents([]);
      debugCursorRef.current = 0;
      setNativeWatcherActive(watcherResult.status === "fulfilled");
      setWorkspaceSettingsState(nextWorkspaceSettings);
      setWorkspaceIndexStatus(indexResult.status === "fulfilled" ? indexResult.value : { indexed: false, files: 0, totalBytes: 0, revision: 0, truncated: false });
      setTree(nextTree);
      setWorkspaceName(nextTree.name || selected);
      setWorkspacePath(selected);
      setPreviewBaseUrl(previewUrl);
      setProjectInfo(nextProject);
      setRuntimeEnvironment(environmentResult.status === "fulfilled" ? environmentResult.value : null);
      setWorkspaceComponents(componentLibraryResult.status === "fulfilled" ? componentLibraryResult.value : []);
      setExtensions(extensionsResult.status === "fulfilled" ? extensionsResult.value : []);
      setExtensionCatalog(extensionCatalogResult.status === "fulfilled" ? extensionCatalogResult.value : []);
      setExtensionComponents(extensionComponentsResult.status === "fulfilled" ? extensionComponentsResult.value : []);
      setExtensionTemplates(extensionTemplatesResult.status === "fulfilled" ? extensionTemplatesResult.value : []);
      setIsTrusted(rememberedTrusted);
      setTerminalAllowed(false);
      setGitNetworkAllowed(false);
      setTerminalSessions([]);
      setActiveTerminalId("");
      setTerminalOutput({});
      terminalCursorsRef.current = {};
      setProductionPreviewUrl("");
      setProductionPreviewActive(false);
      setRuntimeStatus(idleRuntime);
      runtimeStatusRef.current = idleRuntime;
      runtimeCursorRef.current = 0;
      setRuntimeLog([]);
      setEditorTarget(null);
      setEditorFiles(loaded);
      setOpenPaths(restoredOpenPaths.length ? restoredOpenPaths : (initialPath ? [initialPath] : []));
      setActivePathState(restoredOpenPaths.length ? restoredActivePath : (initialPath ?? ""));
      setRecentPaths((current) => rememberWorkspace(selected, current));
      setPreviewRevision((value) => value + 1);
      appendLog(t("log.workspaceOpened", { path: selected }));
      if (restoredOpenPaths.length) appendLog(t("log.sessionRestored", { files: restoredOpenPaths.length, dirty: Object.values(loaded).filter((file) => file.dirty).length }));
      appendLog(t("log.projectDetected", { project: nextProject.label, typescript: nextProject.typescript ? " + TypeScript" : "" }));
      appendLog(rememberedTrusted ? t("log.trustRestored") : t("log.restrictedActive"));
      if (previewUrl) appendLog(t("log.staticPreviewServer", { url: previewUrl }));
      if (projectResult.status === "rejected") appendLog(t("log.projectDetectionWarning", { error: String(projectResult.reason) }));
      if (environmentResult.status === "rejected") appendLog(t("log.runtimeProbeWarning", { error: String(environmentResult.reason) }));
      if (componentLibraryResult.status === "rejected") appendLog(t("log.componentLibraryWarning", { error: String(componentLibraryResult.reason) }));
      if (extensionsResult.status === "rejected") appendLog(t("log.extensionsLoadFailed", { error: String(extensionsResult.reason) }));
      if (watcherResult.status === "rejected") appendLog(t("log.nativeWatcherFallback", { error: String(watcherResult.reason) }));
      else appendLog(t("log.nativeWatcherActive"));
      if (tasksResult.status === "rejected") appendLog(t("log.tasksProbeFailed", { error: String(tasksResult.reason) }));
      if (languageServersResult.status === "rejected") appendLog(t("log.languageServersProbeFailed", { error: String(languageServersResult.reason) }));
      void reloadProjectIntelligence();
    } catch (error) {
      appendLog(t("log.openWorkspaceFailed", { error: String(error) }));
    }
  }, [appendLog, hasDirtyFiles, isNative, loadNativeFile, reloadProjectIntelligence, t, userSettings]);

  const openFolder = useCallback(async () => {
    if (!isNative) {
      appendLog(t("log.openFolderDesktop"));
      return;
    }
    const selected = await chooseWorkspace(t("dialog.openWorkspace"));
    if (selected) await openWorkspacePath(selected);
  }, [appendLog, isNative, openWorkspacePath, t]);

  const openRecent = useCallback(async (path: string) => {
    await openWorkspacePath(path);
  }, [openWorkspacePath, t]);

  const updateWorkspaceSettings = useCallback(async (next: WorkspaceSettings) => {
    setWorkspaceSettingsState(next);
    if (isNative && workspacePath) {
      try {
        await saveWorkspaceSettings(next);
        appendLog(t("log.workspaceSettingsSaved"));
      } catch (error) {
        appendLog(t("log.workspaceSettingsFailed", { error: String(error) }));
        throw error;
      }
    }
  }, [appendLog, isNative, workspacePath, t]);

  const rebuildSearchIndexNow = useCallback(async () => {
    if (!isNative || !workspacePath) return workspaceIndexStatus;
    const status = await rebuildWorkspaceIndex();
    setWorkspaceIndexStatus(status);
    appendLog(t("log.searchIndexRebuilt", { files: status.files }));
    return status;
  }, [appendLog, isNative, workspaceIndexStatus, workspacePath, t]);

  const refreshExtensions = useCallback(async () => {
    if (!isNative || !workspacePath) {
      setExtensions([]);
      setExtensionCatalog([]);
      setExtensionComponents([]);
      setExtensionTemplates([]);
      return;
    }
    const [records, catalog, components, templates] = await Promise.all([
      listExtensions(),
      listExtensionCatalog(),
      listExtensionComponents(),
      listExtensionTemplates(),
    ]);
    setExtensions(records);
    setExtensionCatalog(catalog);
    setExtensionComponents(components);
    setExtensionTemplates(templates);
  }, [isNative, workspacePath]);

  const createNewProject = useCallback(async (request: CreateProjectRequest) => {
    if (!isNative) {
      appendLog(t("log.generationDesktop"));
      return;
    }
    if (hasDirtyFiles() && !window.confirm(t("log.discardCreate"))) return;
    try {
      let created: { path: string; filesCreated: number };
      let templateLabel: string;
      if (request.extensionTemplate) {
        created = await createExtensionProject(request.extensionTemplate.extensionId, request.extensionTemplate.templateId, request.parentPath, request.name);
        templateLabel = `${request.extensionTemplate.extensionId}/${request.extensionTemplate.templateId}`;
      } else {
        const coreProject = await createProject(request);
        created = coreProject;
        templateLabel = coreProject.template;
      }
      appendLog(t("log.projectCreatedDetailed", { template: templateLabel, path: created.path, count: created.filesCreated }));
      await openWorkspacePath(created.path, { trusted: true, skipDirtyPrompt: true });
    } catch (error) {
      appendLog(t("log.projectCreationFailed", { error: String(error) }));
      throw error;
    }
  }, [appendLog, hasDirtyFiles, isNative, openWorkspacePath, t]);

  const replaceWorkspaceComponents = useCallback(async (next: ComponentSnippet[]) => {
    if (!isNative || !workspacePath) {
      setWorkspaceComponents(next);
      return;
    }
    try {
      await saveWorkspaceComponentLibrary(next);
      setWorkspaceComponents(next);
      appendLog(t("log.componentLibrarySaved", { count: next.length }));
    } catch (error) {
      appendLog(t("log.componentLibrarySaveFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, workspacePath, t]);

  const addWorkspaceComponent = useCallback(async (component: ComponentSnippet) => {
    const next = [...workspaceComponents.filter((item) => item.id !== component.id), component].slice(-200);
    await replaceWorkspaceComponents(next);
  }, [replaceWorkspaceComponents, workspaceComponents, t]);

  const deleteWorkspaceComponent = useCallback(async (id: string) => {
    await replaceWorkspaceComponents(workspaceComponents.filter((item) => item.id !== id));
  }, [replaceWorkspaceComponents, workspaceComponents, t]);

  const extensionInstall = useCallback(async (extensionId: string) => {
    await installBundledExtension(extensionId);
    await refreshExtensions();
    appendLog(t("log.extensionInstalled", { id: extensionId }));
  }, [appendLog, refreshExtensions, t]);

  const extensionUninstall = useCallback(async (extensionId: string) => {
    await uninstallExtension(extensionId);
    await refreshExtensions();
    appendLog(t("log.extensionUninstalled", { id: extensionId }));
  }, [appendLog, refreshExtensions, t]);

  const extensionSetEnabled = useCallback(async (extensionId: string, enabled: boolean) => {
    await setExtensionEnabled(extensionId, enabled);
    await refreshExtensions();
    appendLog(t(enabled ? "log.extensionEnabled" : "log.extensionDisabled", { id: extensionId }));
  }, [appendLog, refreshExtensions, t]);

  const extensionSetCapability = useCallback(async (extensionId: string, capability: string, granted: boolean) => {
    await setExtensionCapability(extensionId, capability, granted);
    await refreshExtensions();
    appendLog(t(granted ? "log.extensionCapabilityGranted" : "log.extensionCapabilityRevoked", { id: extensionId, capability }));
  }, [appendLog, refreshExtensions, t]);

  const extensionRunCommand = useCallback(async (extensionId: string, commandId: string): Promise<ExtensionCommandAction> => {
    const action = await runExtensionCommand(extensionId, commandId);
    appendLog(t("log.extensionCommand", { id: extensionId, command: commandId }));
    return action;
  }, [appendLog, t]);

  const setTrusted = useCallback(async (trusted: boolean) => {
    if (!isNative || !workspacePath) return;
    try {
      const security = await setWorkspaceTrust(trusted);
      setIsTrusted(security.trusted);
      setTerminalAllowed(security.terminalAllowed);
      setGitNetworkAllowed(security.gitNetworkAllowed);
      rememberTrust(workspacePath, security.trusted);
      if (!security.trusted) {
        setRuntimeStatus(idleRuntime);
        runtimeStatusRef.current = idleRuntime;
        setTerminalSessions([]);
        setActiveTerminalId("");
        setTerminalOutput({});
        terminalCursorsRef.current = {};
        setTerminalAllowed(false);
        setGitNetworkAllowed(false);
        setTaskStatus(idleTaskStatus);
        setTaskLog([]);
        setLanguageServerStatus(idleLanguageStatus);
        setLanguageDiagnostics([]);
        setLanguageServerLogs([]);
        setLanguageDesiredServers([]);
        languageRestartRef.current = {};
        languageVersionRef.current = {};
        setDebugStatus(idleDebugStatus);
        setDebugEvents([]);
        debugCursorRef.current = 0;
        setProductionPreviewActive(false);
        setProductionPreviewUrl("");
        void stopBuildPreviewServer().catch(() => undefined);
        appendLog(t("log.restrictedEnabled"));
      } else {
        appendLog(t("log.trustedEnabled"));
      }
    } catch (error) {
      appendLog(t("log.trustChangeFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, workspacePath, t]);

  const newTerminal = useCallback(async (title?: string) => {
    if (!isNative || !workspacePath || !terminalAllowed) return null;
    try {
      const status = await createTerminalSession(title ?? t("log.terminalDefaultTitle", { number: terminalSessions.length + 1 }));
      terminalCursorsRef.current[status.id] = 0;
      setTerminalSessions((current) => [...current.filter((item) => item.id !== status.id), status]);
      setTerminalOutput((current) => ({ ...current, [status.id]: current[status.id] ?? "" }));
      setActiveTerminalId(status.id);
      appendLog(t("log.terminalOpened", { title: status.title, shell: status.shell }));
      return status;
    } catch (error) {
      appendLog(t("log.terminalOpenFailed", { error: String(error) }));
      return null;
    }
  }, [appendLog, isNative, terminalAllowed, terminalSessions.length, workspacePath, t]);

  const setTerminalAccess = useCallback(async (allowed: boolean) => {
    if (!isNative || !workspacePath) return;
    if (allowed && !isTrusted) {
      appendLog(t("log.terminalNeedsTrust"));
      return;
    }
    if (allowed && !window.confirm(t("log.terminalAccessConfirm"))) return;
    try {
      const security = await setTerminalPermission(allowed);
      setTerminalAllowed(security.terminalAllowed);
      setGitNetworkAllowed(security.gitNetworkAllowed);
      if (!security.terminalAllowed) {
        setGitNetworkAllowed(false);
        setTerminalSessions([]);
        setActiveTerminalId("");
        setTerminalOutput({});
        terminalCursorsRef.current = {};
        setTaskStatus(idleTaskStatus);
        setLanguageServerStatus(idleLanguageStatus);
        setLanguageDiagnostics([]);
        setLanguageServerLogs([]);
        setLanguageDesiredServers([]);
        languageRestartRef.current = {};
        languageVersionRef.current = {};
        setDebugStatus(idleDebugStatus);
        setDebugEvents([]);
        debugCursorRef.current = 0;
        appendLog(t("log.terminalDisabled"));
      } else {
        appendLog(t("log.terminalEnabled"));
        const status = await createTerminalSession(t("log.terminalDefaultTitle", { number: 1 }), 120, 30);
        terminalCursorsRef.current[status.id] = 0;
        setTerminalSessions([status]);
        setTerminalOutput({ [status.id]: "" });
        setActiveTerminalId(status.id);
      }
    } catch (error) {
      appendLog(t("log.terminalPermissionFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, isTrusted, workspacePath, t]);

  const setGitNetworkAccess = useCallback(async (allowed: boolean) => {
    if (!isNative || !workspacePath) return;
    if (allowed && (!isTrusted || !terminalAllowed)) {
      appendLog(t("log.gitNetworkNeedsTerminal"));
      return;
    }
    if (allowed && !window.confirm(t("git.networkEnableConfirm"))) return;
    try {
      const security = await setGitNetworkPermission(allowed);
      setGitNetworkAllowed(security.gitNetworkAllowed);
      appendLog(allowed ? t("log.gitNetworkEnabled") : t("log.gitNetworkDisabled"));
    } catch (error) {
      appendLog(t("log.gitNetworkPermissionFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, isTrusted, terminalAllowed, workspacePath, t]);

  const selectTerminal = useCallback((sessionId: string) => setActiveTerminalId(sessionId), []);

  const sendTerminalInput = useCallback(async (sessionId: string, data: string) => {
    if (!isNative || !terminalAllowed || !data) return;
    try {
      await writeTerminalInput(sessionId, data);
    } catch (error) {
      appendLog(t("log.terminalInputFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, terminalAllowed, t]);

  const resizeTerminal = useCallback(async (sessionId: string, cols: number, rows: number) => {
    if (!isNative || !terminalAllowed) return;
    try {
      const status = await resizeTerminalSession(sessionId, cols, rows);
      setTerminalSessions((current) => current.map((item) => item.id === sessionId ? status : item));
    } catch (error) {
      appendLog(t("log.terminalResizeFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, terminalAllowed, t]);

  const closeTerminal = useCallback(async (sessionId: string) => {
    if (!isNative) return;
    try {
      await closeTerminalSession(sessionId);
      setTerminalSessions((current) => {
        const next = current.filter((item) => item.id !== sessionId);
        setActiveTerminalId((active) => active === sessionId ? (next[0]?.id ?? "") : active);
        return next;
      });
      setTerminalOutput((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      delete terminalCursorsRef.current[sessionId];
    } catch (error) {
      appendLog(t("log.terminalCloseFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, t]);

  const checkForUpdates = useCallback(async () => {
    if (!isNative) return;
    setUpdateChecking(true);
    try {
      const info = await checkReleaseUpdate();
      setReleaseUpdate(info);
      appendLog(info.available && info.version ? t("log.updateAvailable", { version: info.version }) : t("log.upToDate"));
    } catch (error) {
      appendLog(t("log.updateCheckFailed", { error: String(error) }));
    } finally {
      setUpdateChecking(false);
    }
  }, [appendLog, isNative, t]);

  const installUpdate = useCallback(async () => {
    if (!isNative || !releaseUpdate?.available) return;
    if (!window.confirm(t("log.installUpdateConfirm", { version: releaseUpdate.version ?? "update" }))) return;
    try {
      await installReleaseUpdate();
    } catch (error) {
      appendLog(t("log.updateInstallFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, releaseUpdate, t]);

  const ensureTrustedForExecution = useCallback(async (): Promise<boolean> => {
    if (!isNative) return false;
    if (isTrusted) return true;
    if (!window.confirm(t("log.trustExecutionConfirm"))) return false;
    try {
      const security = await setWorkspaceTrust(true);
      setIsTrusted(security.trusted);
      setTerminalAllowed(security.terminalAllowed);
      setGitNetworkAllowed(security.gitNetworkAllowed);
      rememberTrust(workspacePath, security.trusted);
      appendLog(t("log.workspaceTrusted"));
      return security.trusted;
    } catch (error) {
      appendLog(t("log.workspaceTrustFailed", { error: String(error) }));
      return false;
    }
  }, [appendLog, isNative, isTrusted, workspacePath, t]);

  const startDevServer = useCallback(async () => {
    if (!isNative || !workspacePath) {
      appendLog(t("log.devDesktop"));
      return;
    }
    if (!await ensureTrustedForExecution()) return;
    try {
      setProductionPreviewActive(false);
      setProductionPreviewUrl("");
      void stopBuildPreviewServer().catch(() => undefined);
      runtimeCursorRef.current = 0;
      setRuntimeLog([]);
      const status = await startProjectDevServer();
      setRuntimeStatus(status);
      runtimeStatusRef.current = status;
      setPreviewRevision((value) => value + 1);
      appendLog(t("log.startDev", { project: projectInfo.label, manager: status.packageManager ?? t("log.packageManagerFallback") }));
    } catch (error) {
      appendLog(t("log.devStartFailed", { error: String(error) }));
    }
  }, [appendLog, ensureTrustedForExecution, isNative, projectInfo.label, workspacePath, t]);

  const installDependencies = useCallback(async () => {
    if (!isNative || !workspacePath) return;
    if (!await ensureTrustedForExecution()) return;
    if (!window.confirm(t("log.installConfirm"))) return;
    try {
      runtimeCursorRef.current = 0;
      setRuntimeLog([]);
      const status = await installProjectDependencies();
      setRuntimeStatus(status);
      runtimeStatusRef.current = status;
      appendLog(t("log.installing", { manager: status.packageManager ?? t("log.packageManagerFallback") }));
    } catch (error) {
      appendLog(t("log.installStartFailed", { error: String(error) }));
    }
  }, [appendLog, ensureTrustedForExecution, isNative, workspacePath, t]);

  const stopRuntime = useCallback(async () => {
    if (!isNative) return;
    try {
      const status = await stopProjectRuntime();
      setRuntimeStatus(status);
      runtimeStatusRef.current = status;
      setPreviewRevision((value) => value + 1);
      appendLog(t("log.runtimeStopped"));
    } catch (error) {
      appendLog(t("log.runtimeStopFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, t]);

  const openFile = useCallback(async (path: string) => {
    const existing = editorFilesRef.current[path];
    if (existing) {
      setOpenPaths((current) => (current.includes(path) ? current : [...current, path]));
      setActivePathState(path);
      return;
    }

    if (!isNative) {
      const demo = demoFiles[path];
      if (demo === undefined) return;
      setEditorFiles((current) => ({ ...current, [path]: createEditorFile(path, demo) }));
      setOpenPaths((current) => (current.includes(path) ? current : [...current, path]));
      setActivePathState(path);
      return;
    }

    try {
      const loaded = await loadNativeFile(path);
      setEditorFiles((current) => ({ ...current, ...loaded }));
      setOpenPaths((current) => (current.includes(path) ? current : [...current, path]));
      setActivePathState(path);
      appendLog(t("log.fileOpened", { path }));
    } catch (error) {
      appendLog(t("log.fileReadFailed", { path, error: String(error) }));
    }
  }, [appendLog, isNative, loadNativeFile, t]);

  const openFileAt = useCallback(async (path: string, line = 1, column = 1) => {
    await openFile(path);
    setEditorTarget({ path, line: Math.max(1, line), column: Math.max(1, column), token: Date.now() });
  }, [openFile, t]);

  const updateFile = useCallback((path: string, content: string) => {
    setEditorFiles((current) => {
      const file = current[path];
      if (!file || file.content === content) return current;
      return {
        ...current,
        [path]: {
          ...file,
          content,
          dirty: content !== file.savedContent,
        },
      };
    });
  }, [t]);

  const applyLanguageBufferEdit = useCallback((path: string, content: string, baseContent: string) => {
    setEditorFiles((current) => {
      const existing = current[path];
      if (existing) {
        if (existing.content === content) return current;
        return { ...current, [path]: { ...existing, content, dirty: content !== existing.savedContent } };
      }
      const file = createEditorFile(path, baseContent);
      return { ...current, [path]: { ...file, content, dirty: content !== baseContent } };
    });
  }, []);

  useEffect(() => {
    if (!isNative || !workspacePath) {
      setPreviewRevision((value) => value + 1);
      return;
    }

    const timer = window.setTimeout(() => {
      void setPreviewOverlays(filesByPath)
        .then(() => setPreviewRevision((value) => value + 1))
        .catch((error) => appendLog(t("log.previewSyncFailed", { error: String(error) })));
    }, 90);
    return () => window.clearTimeout(timer);
  }, [appendLog, filesByPath, isNative, workspacePath, t]);

  const confirmConflictOverwrite = useCallback((file: EditorFile): boolean => {
    if (!file.externalChange) return true;
    const action = file.externalChange === "deleted" ? t("log.overwriteActionDeleted") : t("log.overwriteActionNewer");
    return window.confirm(t("log.externalConflictConfirm", { path: file.relativePath, action }));
  }, [t]);

  const markSaved = useCallback((paths: string[]) => {
    const selected = new Set(paths);
    setEditorFiles((current) => Object.fromEntries(
      Object.entries(current).map(([path, file]) => [
        path,
        selected.has(path)
          ? { ...file, savedContent: file.content, dirty: false, externalChange: null }
          : file,
      ]),
    ));
  }, [t]);

  const saveActiveFile = useCallback(async (contentOverride?: string) => {
    const path = activePathRef.current;
    if (!path) return;
    const currentFile = editorFilesRef.current[path];
    if (!currentFile) return;
    const content = typeof contentOverride === "string" ? contentOverride : currentFile.content;
    const file = content === currentFile.content ? currentFile : { ...currentFile, content, dirty: content !== currentFile.savedContent };
    if (!file.dirty) return;
    if (!confirmConflictOverwrite(file)) return;

    try {
      if (isNative) {
        if (file.externalChange === "deleted") {
          await createWorkspaceFile(file.relativePath, content);
          await refreshTree();
        } else {
          await writeWorkspaceFile(file.relativePath, content);
        }
      }
      setEditorFiles((current) => current[path] ? { ...current, [path]: { ...current[path], content, savedContent: content, dirty: false, externalChange: null } } : current);
      if (path === "package.json" || path.endsWith("lock.yaml") || path.endsWith("lock.json") || path.endsWith("yarn.lock")) {
        void refreshProjectInfo();
      }
      appendLog(t(isNative ? "log.savedFile" : "log.demoSavedFile", { path: file.relativePath }));
    } catch (error) {
      appendLog(t("log.saveFailed", { path: file.relativePath, error: String(error) }));
    }
  }, [appendLog, confirmConflictOverwrite, isNative, refreshProjectInfo, refreshTree, t]);

  const saveAllFiles = useCallback(async (): Promise<boolean> => {
    const dirty = Object.values(editorFilesRef.current).filter((file) => file.dirty);
    if (!dirty.length) return true;
    const conflicts = dirty.filter((file) => file.externalChange);
    if (conflicts.length && !window.confirm(t("log.saveAllConflictConfirm", { count: conflicts.length }))) return false;

    try {
      if (isNative) {
        const deleted = dirty.filter((file) => file.externalChange === "deleted");
        for (const file of deleted) {
          await createWorkspaceFile(file.relativePath, file.content);
        }
        const writable = dirty.filter((file) => file.externalChange !== "deleted");
        if (writable.length) {
          await writeWorkspaceFiles(writable.map((file) => ({ relativePath: file.relativePath, content: file.content })));
        }
        if (deleted.length) await refreshTree();
      }
      markSaved(dirty.map((file) => file.relativePath));
      if (projectMetadataChanged(dirty.map((file) => file.relativePath))) {
        void refreshProjectInfo();
        if (isNative) {
          void listProjectTasks().then(setProjectTasks).catch(() => undefined);
          void probeLanguageServers().then(setLanguageServers).catch(() => undefined);
        }
      }
      appendLog(t(isNative ? "log.savedAll" : "log.demoSavedAll", { count: dirty.length }));
      return true;
    } catch (error) {
      appendLog(t("log.saveAllFailed", { error: String(error) }));
      return false;
    }
  }, [appendLog, isNative, markSaved, refreshProjectInfo, refreshTree, t]);

  useEffect(() => {
    if (effectiveSettings.files.autoSave !== "afterDelay") return;
    const dirty = Object.values(editorFiles).filter((file) => file.dirty);
    if (!dirty.length || dirty.some((file) => file.externalChange)) return;
    const timer = window.setTimeout(() => { void saveAllFiles(); }, effectiveSettings.files.autoSaveDelay);
    return () => window.clearTimeout(timer);
  }, [editorFiles, effectiveSettings.files.autoSave, effectiveSettings.files.autoSaveDelay, saveAllFiles]);

  const startBuild = useCallback(async () => {
    if (!isNative || !workspacePath) { appendLog(t("log.buildDesktop")); return; }
    if (!projectInfo.buildSupported || !projectInfo.buildScript) { appendLog(t("log.buildBlocked")); return; }
    if (hasDirtyFiles()) {
      if (!window.confirm(t("log.buildSaveConfirm"))) return;
      if (!await saveAllFiles()) return;
    }
    if (!await ensureTrustedForExecution()) return;
    try {
      setProductionPreviewActive(false);
      setProductionPreviewUrl("");
      await stopBuildPreviewServer().catch(() => undefined);
      runtimeCursorRef.current = 0;
      setRuntimeLog([]);
      const status = await startProjectBuild();
      setRuntimeStatus(status);
      runtimeStatusRef.current = status;
      appendLog(t("log.building", { project: projectInfo.label, manager: status.packageManager ?? t("log.packageManagerFallback") }));
    } catch (error) {
      appendLog(t("log.buildStartFailed", { error: String(error) }));
    }
  }, [appendLog, ensureTrustedForExecution, hasDirtyFiles, isNative, projectInfo.buildScript, projectInfo.buildSupported, projectInfo.label, saveAllFiles, workspacePath, t]);

  const openProductionPreview = useCallback(async () => {
    if (!isNative || !workspacePath || !projectInfo.buildOutputDir) return;
    try {
      const url = await startBuildPreviewServer(projectInfo.buildOutputDir);
      setProductionPreviewUrl(url);
      setProductionPreviewActive(true);
      setPreviewRevision((value) => value + 1);
      appendLog(t("log.productionPreview", { url, dir: projectInfo.buildOutputDir }));
    } catch (error) {
      appendLog(t("log.productionPreviewUnavailable", { error: String(error) }));
    }
  }, [appendLog, isNative, projectInfo.buildOutputDir, workspacePath, t]);

  const useSourcePreview = useCallback(() => {
    setProductionPreviewActive(false);
    setPreviewRevision((value) => value + 1);
  }, [t]);

  const closeFile = useCallback((path: string) => {
    const file = editorFilesRef.current[path];
    if (file?.dirty && !window.confirm(t("log.closeDirtyConfirm", { file: file.name }))) return;

    setOpenPaths((current) => {
      const next = current.filter((item) => item !== path);
      if (activePathRef.current === path) {
        const oldIndex = current.indexOf(path);
        setActivePathState(next[Math.min(oldIndex, next.length - 1)] ?? "");
      }
      return next;
    });

    if (isNative && workspacePath) void closeLanguageDocument(path).catch(() => undefined);

    if (file?.dirty || (isNative && file?.externalChange === "deleted")) {
      setEditorFiles((current) => {
        if (!current[path]) return current;
        if (isNative) {
          const next = { ...current };
          delete next[path];
          return next;
        }
        return { ...current, [path]: { ...current[path], content: current[path].savedContent, dirty: false, externalChange: null } };
      });
    }
  }, [isNative, workspacePath, t]);

  const createFile = useCallback(async (parent: string, name: string) => {
    if (!validChildName(name)) {
      appendLog(t("log.invalidFileName", { name }));
      return;
    }
    const path = joinPath(parent, name.trim());
    try {
      if (isNative) {
        await createWorkspaceFile(path, "");
        await refreshTree();
      } else {
        setTree((current) => addTreeEntry(current, parent, { name: name.trim(), relativePath: path, kind: "file" }));
      }
      setEditorFiles((current) => ({ ...current, [path]: createEditorFile(path, "") }));
      setOpenPaths((current) => [...current.filter((item) => item !== path), path]);
      setActivePathState(path);
      if (isNative) void refreshProjectInfo();
      appendLog(t("log.createdFile", { path }));
    } catch (error) {
      appendLog(t("log.createFileFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, refreshProjectInfo, refreshTree, t]);

  const createDirectory = useCallback(async (parent: string, name: string) => {
    if (!validChildName(name)) {
      appendLog(t("log.invalidFolderName", { name }));
      return;
    }
    const path = joinPath(parent, name.trim());
    try {
      if (isNative) {
        await createWorkspaceDirectory(path);
        await refreshTree();
      } else {
        setTree((current) => addTreeEntry(current, parent, { name: name.trim(), relativePath: path, kind: "directory", children: [] }));
      }
      appendLog(t("log.createdFolder", { path }));
    } catch (error) {
      appendLog(t("log.createFolderFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, refreshTree, t]);

  const renameEntry = useCallback(async (path: string, newName: string) => {
    if (!validChildName(newName)) {
      appendLog(t("log.invalidName", { name: newName }));
      return;
    }
    const nextPath = joinPath(parentPath(path), newName.trim());
    if (nextPath === path) return;

    try {
      if (isNative) {
        await renameWorkspaceEntry(path, nextPath);
        await refreshTree();
      } else {
        setTree((current) => renameTreeEntry(current, path, nextPath));
      }

      setEditorFiles((current) => {
        const next: Record<string, EditorFile> = {};
        for (const [filePath, file] of Object.entries(current)) {
          const renamedPath = renamePathPrefix(filePath, path, nextPath);
          next[renamedPath] = renamedPath === filePath ? file : {
            ...file,
            name: baseName(renamedPath),
            relativePath: renamedPath,
            language: languageFromPath(renamedPath),
          };
        }
        return next;
      });
      setOpenPaths((current) => current.map((item) => renamePathPrefix(item, path, nextPath)));
      setActivePathState((current) => renamePathPrefix(current, path, nextPath));
      if (isNative) void refreshProjectInfo();
      appendLog(t("log.renamed", { path, next: nextPath }));
    } catch (error) {
      appendLog(t("log.renameFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, refreshProjectInfo, refreshTree, t]);

  const deleteEntry = useCallback(async (path: string) => {
    const affectedDirty = Object.values(editorFilesRef.current).filter((file) => pathIsInside(file.relativePath, path) && file.dirty);
    const message = affectedDirty.length
      ? t("log.deleteDirtyCountConfirm", { path, count: affectedDirty.length })
      : t("log.deleteConfirm", { path });
    if (!window.confirm(message)) return;

    try {
      if (isNative) {
        await deleteWorkspaceEntry(path);
        await refreshTree();
      } else {
        setTree((current) => removeTreeEntry(current, path));
      }

      setEditorFiles((current) => Object.fromEntries(Object.entries(current).filter(([filePath]) => !pathIsInside(filePath, path))));
      setOpenPaths((current) => {
        const next = current.filter((filePath) => !pathIsInside(filePath, path));
        if (pathIsInside(activePathRef.current, path)) setActivePathState(next[0] ?? "");
        return next;
      });
      if (isNative) void refreshProjectInfo();
      appendLog(t("log.deleted", { path }));
    } catch (error) {
      appendLog(t("log.deleteFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, refreshProjectInfo, refreshTree, t]);

  useEffect(() => {
    if (!isNative || !workspacePath) return;
    let disposed = false;
    let polling = false;

    const poll = async () => {
      if (polling || disposed) return;
      polling = true;
      try {
        let changes = nativeWatcherActive ? await pollNativeWorkspaceChanges() : await pollWorkspaceChanges();
        if (changes.rescan) {
          const fallback = await pollWorkspaceChanges();
          changes = {
            created: [...new Set([...changes.created, ...fallback.created])],
            modified: [...new Set([...changes.modified, ...fallback.modified])],
            removed: [...new Set([...changes.removed, ...fallback.removed])],
            native: true,
            rescan: false,
          };
          appendLog(t("log.nativeWatcherRescan"));
        }
        if (disposed) return;
        const changedCount = changes.created.length + changes.modified.length + changes.removed.length;
        if (!changedCount) return;

        if (changes.created.length || changes.removed.length) {
          try { setTree(await refreshWorkspace()); } catch { /* next poll can retry */ }
        }

        for (const path of changes.removed) {
          setEditorFiles((current) => {
            const next = { ...current };
            for (const [filePath, file] of Object.entries(next)) {
              if (pathIsInside(filePath, path)) next[filePath] = { ...file, externalChange: "deleted" };
            }
            return next;
          });
        }

        const refreshPaths = [
          ...changes.modified,
          ...changes.created.filter((path) => Boolean(editorFilesRef.current[path])),
        ];
        const refreshed = await Promise.allSettled(
          [...new Set(refreshPaths)].map(async (path) => [path, await readWorkspaceFile(path)] as const),
        );
        for (const item of refreshed) {
          if (item.status !== "fulfilled") continue;
          const [path, content] = item.value;
          setEditorFiles((current) => {
            const file = current[path];
            if (!file) return current;
            if (file.dirty) return { ...current, [path]: { ...file, externalChange: "modified" } };
            return { ...current, [path]: createEditorFile(path, content) };
          });
        }

        const metadataPaths = [...changes.created, ...changes.modified, ...changes.removed];
        if (projectMetadataChanged(metadataPaths)) {
          void refreshProjectInfo();
          void listProjectTasks().then(setProjectTasks).catch(() => undefined);
          void probeLanguageServers().then(setLanguageServers).catch(() => undefined);
        }
        if (projectLanguageChanged(metadataPaths)) void reloadProjectIntelligence();
        if (metadataPaths.includes(".webforge/components.json")) {
          void loadWorkspaceComponentLibrary().then(setWorkspaceComponents).catch((error) => appendLog(t("log.libraryReloadFailed", { error: String(error) })));
        }
        if (metadataPaths.some((path) => path === ".webforge/extensions-state.json" || path.startsWith(".webforge/extensions/"))) {
          void refreshExtensions().catch((error) => appendLog(t("log.extensionsLoadFailed", { error: String(error) })));
        }

        setPreviewRevision((value) => value + 1);
        const pieces = [
          changes.created.length ? t("log.createdCount", { count: changes.created.length }) : "",
          changes.modified.length ? t("log.modifiedCount", { count: changes.modified.length }) : "",
          changes.removed.length ? t("log.removedCount", { count: changes.removed.length }) : "",
        ].filter(Boolean);
        appendLog(t("log.externalChanges", { summary: pieces.join(", ") }));
      } catch (error) {
        if (!disposed) appendLog(t("log.watcherFailed", { error: String(error) }));
      } finally {
        polling = false;
      }
    };

    const timer = window.setInterval(() => { void poll(); }, nativeWatcherActive ? 260 : 1500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [appendLog, isNative, nativeWatcherActive, refreshExtensions, refreshProjectInfo, reloadProjectIntelligence, workspacePath, t]);

  useEffect(() => {
    if (!isNative || !workspacePath) return;
    let disposed = false;
    let polling = false;

    const pollRuntime = async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        const previous = runtimeStatusRef.current;
        const batch = await pollProjectRuntimeLogs(runtimeCursorRef.current);
        if (disposed) return;
        runtimeCursorRef.current = batch.cursor;
        if (batch.lines.length) setRuntimeLog((current) => [...current, ...batch.lines].slice(-1000));
        setRuntimeStatus(batch.status);
        runtimeStatusRef.current = batch.status;

        if (!previous.ready && batch.status.ready && batch.status.previewUrl) {
          setPreviewRevision((value) => value + 1);
          appendLog(t("log.devReady", { url: batch.status.previewUrl }));
        }
        if (previous.running && !batch.status.running) {
          setPreviewRevision((value) => value + 1);
          if (previous.mode === "install" && batch.status.exitCode === 0) {
            appendLog(t("log.installDone"));
            void refreshProjectInfo();
            void refreshTree();
            void reloadProjectIntelligence();
            void listProjectTasks().then(setProjectTasks).catch(() => undefined);
            void probeLanguageServers().then(setLanguageServers).catch(() => undefined);
          } else if (previous.mode === "build" && batch.status.exitCode === 0) {
            appendLog(t("log.buildDone"));
            const outputDir = projectInfo.buildOutputDir ?? "dist";
            void startBuildPreviewServer(outputDir).then((url) => {
              if (disposed) return;
              setProductionPreviewUrl(url);
              setProductionPreviewActive(true);
              setPreviewRevision((value) => value + 1);
              appendLog(t("log.productionReady", { url, dir: outputDir }));
              void refreshTree();
            }).catch((error) => appendLog(t("log.distStartFailed", { error: String(error) })));
          } else if (previous.mode === "build") {
            appendLog(t("log.buildFailedCode", { code: batch.status.exitCode ?? "?" }));
          } else if (previous.mode === "dev") {
            appendLog(t("log.devStopped", { suffix: batch.status.exitCode === null ? "" : t("log.devStoppedCode", { code: batch.status.exitCode }) }));
          }
        }
      } catch (error) {
        if (!disposed) appendLog(t("log.runtimeMonitorFailed", { error: String(error) }));
      } finally {
        polling = false;
      }
    };

    void pollRuntime();
    const timer = window.setInterval(() => { void pollRuntime(); }, 550);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [appendLog, isNative, projectInfo.buildOutputDir, refreshProjectInfo, refreshTree, reloadProjectIntelligence, workspacePath, t]);

  const terminalSessionIds = useMemo(() => terminalSessions.map((session) => session.id).join("|"), [terminalSessions]);

  useEffect(() => {
    if (!isNative || !workspacePath || !terminalSessionIds) return;
    let disposed = false;
    let polling = false;
    const pollTerminal = async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        const ids = terminalSessionIds.split("|").filter(Boolean);
        const batches = await Promise.all(ids.map(async (sessionId) => {
          const cursor = terminalCursorsRef.current[sessionId] ?? 0;
          return [sessionId, await pollTerminalOutput(sessionId, cursor)] as const;
        }));
        if (disposed) return;
        for (const [sessionId, batch] of batches) {
          terminalCursorsRef.current[sessionId] = batch.cursor;
          if (batch.chunks.length) {
            const chunk = batch.chunks.join("");
            setTerminalOutput((current) => {
              const combined = `${current[sessionId] ?? ""}${chunk}`;
              return { ...current, [sessionId]: combined.length > 240_000 ? combined.slice(-240_000) : combined };
            });
          }
          setTerminalSessions((current) => current.map((item) => item.id === sessionId ? batch.status : item));
        }
      } catch (error) {
        if (!disposed) appendLog(t("log.terminalMonitorFailed", { error: String(error) }));
      } finally { polling = false; }
    };
    void pollTerminal();
    const timer = window.setInterval(() => { void pollTerminal(); }, 140);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [appendLog, isNative, terminalSessionIds, workspacePath, t]);

  useEffect(() => {
    if (!isNative || !workspacePath) { setTestHistory([]); return; }
    let disposed = false;
    void getProjectTestHistory().then((items) => { if (!disposed) setTestHistory(items); }).catch(() => { if (!disposed) setTestHistory([]); });
    return () => { disposed = true; };
  }, [isNative, workspacePath]);

  useEffect(() => {
    if (!isNative || !workspacePath || !taskStatus.running) return;
    let disposed = false;
    let polling = false;
    const pollTask = async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        const batch = await pollProjectTaskLogs(taskCursorRef.current);
        if (disposed) return;
        taskCursorRef.current = batch.cursor;
        if (batch.lines.length) setTaskLog((current) => [...current, ...batch.lines].slice(-1600));
        setTaskStatus(batch.status);
        if (!batch.status.running && batch.status.category === "test") {
          const [report, history] = await Promise.all([
            getProjectTestReport().catch(() => null),
            getProjectTestHistory().catch(() => []),
          ]);
          if (!disposed) { setTestReport(report); setTestHistory(history); }
        }
      } catch (error) {
        if (!disposed) appendLog(t("log.taskMonitorFailed", { error: String(error) }));
      } finally { polling = false; }
    };
    void pollTask();
    const timer = window.setInterval(() => void pollTask(), 250);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [appendLog, isNative, taskStatus.running, workspacePath, t]);

  useEffect(() => {
    if (!isNative || !workspacePath || (!languageServerStatus.running && languageDesiredServers.length === 0)) return;
    let disposed = false;
    let polling = false;
    let tick = 0;
    const pollLanguageServices = async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        tick += 1;
        const diagnosticsPromise = tick % 4 === 0 ? refreshLanguageDiagnostics().catch(() => getLanguageDiagnostics()) : getLanguageDiagnostics();
        const [items, status, logs] = await Promise.all([diagnosticsPromise, getLanguageServerStatus(), getLanguageServerLogs(400)]);
        if (disposed) return;
        setLanguageDiagnostics(items);
        setLanguageServerStatus(status);
        setLanguageServerLogs(logs);

        for (const serverId of languageDesiredServers) {
          const runtime = status.servers.find((server) => server.serverId === serverId);
          if (runtime?.running) {
            languageRestartRef.current[serverId] = { attempts: 0, lastAttempt: 0 };
            continue;
          }
          const retry = languageRestartRef.current[serverId] ?? { attempts: 0, lastAttempt: 0 };
          if (retry.attempts >= 3) continue;
          const delay = 1500 * (retry.attempts + 1);
          if (Date.now() - retry.lastAttempt < delay) continue;
          languageRestartRef.current[serverId] = { attempts: retry.attempts + 1, lastAttempt: Date.now() };
          try {
            const restarted = await startLanguageServer(serverId);
            if (!disposed) setLanguageServerStatus(restarted);
            for (const file of Object.values(editorFilesRef.current)) {
              if (!/\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(file.relativePath)) continue;
              const version = (languageVersionRef.current[file.relativePath] ?? 0) + 1;
              languageVersionRef.current[file.relativePath] = version;
              await syncLanguageDocument(file.relativePath, file.content, version).catch(() => undefined);
            }
            appendLog(t("log.languageServerRestarted", { server: serverId, attempt: retry.attempts + 1 }));
          } catch (error) {
            appendLog(t("log.languageServerRestartFailed", { server: serverId, error: String(error) }));
          }
        }
      } catch (error) {
        if (!disposed) appendLog(t("log.languageDiagnosticsFailed", { error: String(error) }));
      } finally { polling = false; }
    };
    void pollLanguageServices();
    const timer = window.setInterval(() => void pollLanguageServices(), 1000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [appendLog, isNative, languageDesiredServers, languageServerStatus.running, workspacePath, t]);

  const runningLanguageServerIds = languageServerStatus.servers.filter((server) => server.running).map((server) => server.serverId).sort().join("|");

  useEffect(() => {
    if (!isNative || !workspacePath || !activePath) return;
    const file = editorFiles[activePath];
    if (!file || !/\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(file.relativePath)) return;
    const lower = file.relativePath.toLowerCase();
    const owner = lower.endsWith(".vue") ? "vue" : lower.endsWith(".svelte") ? "svelte" : /\.(?:[cm]?[jt]sx?)$/.test(lower) ? "typescript" : null;
    if (!owner || !runningLanguageServerIds.split("|").includes(owner)) return;
    const timer = window.setTimeout(() => {
      const version = (languageVersionRef.current[file.relativePath] ?? 0) + 1;
      languageVersionRef.current[file.relativePath] = version;
      void syncLanguageDocument(file.relativePath, file.content, version).catch((error) => appendLog(t("log.languageSyncFailed", { path: file.relativePath, error: String(error) })));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activePath, appendLog, editorFiles, isNative, runningLanguageServerIds, workspacePath, t]);

  useEffect(() => {
    if (!isNative || !workspacePath || !debugStatus.running) return;
    let disposed = false;
    let polling = false;
    const pollDebug = async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        const batch = await pollBrowserDebugEvents(debugCursorRef.current);
        if (disposed) return;
        debugCursorRef.current = batch.cursor;
        setDebugStatus(batch.status);
        if (batch.events.length) setDebugEvents((current) => [...current, ...batch.events].slice(-1200));
      } catch (error) { if (!disposed) appendLog(t("log.debugMonitorFailed", { error: String(error) })); }
      finally { polling = false; }
    };
    void pollDebug();
    const timer = window.setInterval(() => void pollDebug(), 160);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [appendLog, debugStatus.running, isNative, workspacePath, t]);

  useEffect(() => {
    if (!isNative) return;
    let disposed = false;
    void getReleaseUpdateConfig().then((config) => {
      if (!disposed) setReleaseUpdateConfig(config);
    }).catch((error) => {
      if (!disposed) appendLog(t("log.updaterProbeFailed", { error: String(error) }));
    });
    return () => { disposed = true; };
  }, [appendLog, isNative, t]);

  useEffect(() => {
    if (!isNative || !workspacePath) return;
    if (!effectiveSettings.files.restoreSession && !effectiveSettings.files.hotExit) {
      void clearRecoverySnapshot().catch(() => undefined);
      return;
    }
    const timer = window.setTimeout(() => {
      const dirtyBuffers: RecoverySnapshot["dirtyBuffers"] = [];
      let recoveryBytes = 0;
      if (effectiveSettings.files.hotExit) {
        for (const file of Object.values(editorFiles).filter((item) => item.dirty).slice(0, 32)) {
          const size = (file.content.length + file.savedContent.length) * 2;
          if (recoveryBytes + size > 6 * 1024 * 1024) break;
          recoveryBytes += size;
          dirtyBuffers.push({ path: file.relativePath, content: file.content, savedContent: file.savedContent });
        }
      }
      const snapshot: RecoverySnapshot = {
        version: 2,
        appVersion: "1.0.0",
        workspacePath,
        savedAt: Date.now(),
        openPaths: effectiveSettings.files.restoreSession ? openPaths.slice(0, 40) : [],
        activePath: effectiveSettings.files.restoreSession ? activePath : "",
        dirtyBuffers,
      };
      void saveRecoverySnapshot(snapshot).catch((error) => appendLog(t("log.recoverySaveFailed", { error: String(error) })));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activePath, appendLog, editorFiles, effectiveSettings.files.hotExit, effectiveSettings.files.restoreSession, isNative, openPaths, workspacePath, t]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDirtyFiles() || effectiveSettings.files.hotExit) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [effectiveSettings.files.hotExit, hasDirtyFiles, t]);

  const searchWorkspaceText = useCallback(async (options: WorkspaceSearchOptions): Promise<WorkspaceSearchResponse> => {
    if (!options.query.trim()) return { matches: [], filesScanned: 0, truncated: false };
    try {
      if (!isNative) return searchInMemory(filesByPath, options);
      const response = await searchWorkspace({
        ...options,
        exclude: options.exclude || effectiveSettings.search.defaultExclude,
        maxResults: options.maxResults ?? effectiveSettings.search.maxResults,
        useIndex: effectiveSettings.search.useNativeIndex,
        overlays: filesByPath,
      });
      const status = await getWorkspaceIndexStatus().catch(() => null);
      if (status) setWorkspaceIndexStatus(status);
      return response;
    } catch (error) {
      appendLog(t("log.searchFailed", { error: String(error) }));
      throw error;
    }
  }, [appendLog, effectiveSettings.search.defaultExclude, effectiveSettings.search.maxResults, effectiveSettings.search.useNativeIndex, filesByPath, isNative, t]);

  const replaceWorkspaceText = useCallback(async (options: WorkspaceSearchOptions, replacement: string): Promise<WorkspaceReplacement[]> => {
    if (!options.query.trim()) return [];
    try {
      const replacements = isNative
        ? await previewWorkspaceReplace({ ...options, exclude: options.exclude || effectiveSettings.search.defaultExclude, maxResults: options.maxResults ?? effectiveSettings.search.maxResults, useIndex: effectiveSettings.search.useNativeIndex, overlays: filesByPath }, replacement)
        : replaceInMemory(filesByPath, options, replacement);
      if (!replacements.length) return [];
      setEditorFiles((current) => {
        const next = { ...current };
        for (const item of replacements) {
          const existing = next[item.relativePath];
          if (existing) {
            next[item.relativePath] = { ...existing, content: item.content, dirty: item.content !== existing.savedContent };
          } else {
            next[item.relativePath] = { ...createEditorFile(item.relativePath, item.before), content: item.content, dirty: item.content !== item.before };
          }
        }
        return next;
      });
      const count = replacements.reduce((sum, item) => sum + item.replacements, 0);
      appendLog(t("log.searchReplaced", { count, files: replacements.length }));
      return replacements;
    } catch (error) {
      appendLog(t("log.searchReplaceFailed", { error: String(error) }));
      throw error;
    }
  }, [appendLog, effectiveSettings.search.defaultExclude, effectiveSettings.search.maxResults, effectiveSettings.search.useNativeIndex, filesByPath, isNative, t]);

  const packageManifest = useCallback(async (): Promise<PackageManifest> => {
    if (!isNative) return { available: false, manager: null, packageManagerField: null, lockfile: null, dependencies: [], scripts: [] };
    return getPackageManifest();
  }, [isNative]);

  const refreshAfterPackageMutation = useCallback(async () => {
    await Promise.all([refreshProjectInfo(), refreshTree(), reloadProjectIntelligence()]);
    void listProjectTasks().then(setProjectTasks).catch(() => undefined);
    void probeLanguageServers().then(setLanguageServers).catch(() => undefined);
  }, [refreshProjectInfo, refreshTree, reloadProjectIntelligence]);

  const packageInstall = useCallback(async (name: string, dev: boolean, allowLifecycleScripts: boolean): Promise<PackageCommandResult> => {
    const result = await installPackage(name, dev, allowLifecycleScripts);
    await refreshAfterPackageMutation();
    return result;
  }, [refreshAfterPackageMutation]);

  const packageRemove = useCallback(async (name: string, allowLifecycleScripts: boolean): Promise<PackageCommandResult> => {
    const result = await removePackage(name, allowLifecycleScripts);
    await refreshAfterPackageMutation();
    return result;
  }, [refreshAfterPackageMutation]);

  const packageUpdate = useCallback(async (name: string | null, allowLifecycleScripts: boolean): Promise<PackageCommandResult> => {
    const result = await updatePackage(name, allowLifecycleScripts);
    await refreshAfterPackageMutation();
    return result;
  }, [refreshAfterPackageMutation]);

  const packageOutdated = useCallback(async (): Promise<PackageCommandResult> => getOutdatedPackages(), []);
  const packageAudit = useCallback(async (): Promise<PackageCommandResult> => runPackageSecurityAudit(), []);
  const workspaceAssets = useCallback(async (): Promise<AssetInventory> => {
    if (!isNative) return { assets: [], totalBytes: 0, scannedTextFiles: 0 };
    return listWorkspaceAssets();
  }, [isNative]);
  const optimizeAssetSvg = useCallback(async (path: string): Promise<AssetOptimizeResult> => {
    const result = await optimizeSvgAsset(path);
    await refreshTree();
    setPreviewRevision((value) => value + 1);
    return result;
  }, [refreshTree]);
  const projectAudit = useCallback(async (): Promise<ProjectAuditSummary> => {
    if (!isNative) return { findings: [], filesScanned: 0, errors: 0, warnings: 0, infos: 0 };
    return runProjectAudit();
  }, [isNative]);

  const gitStatus = useCallback(async (): Promise<GitStatus> => {
    if (!isNative) return { available: false, repository: false, repoRoot: null, workspaceRootRepository: false, branch: null, ahead: 0, behind: 0, changes: [], error: t("git.desktopRequired") };
    return getGitStatus();
  }, [isNative, t]);

  const gitDiff = useCallback(async (path: string, staged = false) => getGitDiff(path, staged), []);

  const gitStage = useCallback(async (path: string) => {
    if (editorFilesRef.current[path]?.dirty) throw new Error(t("git.saveBeforeStage"));
    await stageGitPath(path);
    appendLog(t("log.gitStaged", { path }));
  }, [appendLog, t]);

  const gitUnstage = useCallback(async (path: string) => {
    await unstageGitPath(path);
    appendLog(t("log.gitUnstaged", { path }));
  }, [appendLog, t]);

  const gitCommit = useCallback(async (message: string) => {
    if (hasDirtyFiles()) throw new Error(t("git.saveBeforeCommit"));
    const output = await commitGit(message);
    appendLog(t("log.gitCommitted", { message: message.trim().split("\n")[0] }));
    return output;
  }, [appendLog, hasDirtyFiles, t]);

  const gitInit = useCallback(async () => {
    const output = await initGitRepository();
    appendLog(t("log.gitInitialized"));
    return output;
  }, [appendLog, t]);

  const reloadAfterGitBranchChange = useCallback(async () => {
    const paths = Object.keys(editorFilesRef.current);
    const loaded: Record<string, EditorFile> = {};
    const results = await Promise.allSettled(paths.map(async (path) => [path, await readWorkspaceFile(path)] as const));
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const [path, content] = result.value;
      loaded[path] = createEditorFile(path, content);
    }

    setEditorFiles(loaded);
    setOpenPaths((current) => {
      const next = current.filter((path) => Boolean(loaded[path]));
      if (!next.includes(activePathRef.current)) setActivePathState(next[0] ?? "");
      return next;
    });
    if (!loaded[activePathRef.current]) setActivePathState((current) => loaded[current] ? current : Object.keys(loaded)[0] ?? "");

    await Promise.all([refreshTree(), refreshProjectInfo()]);
    try { setWorkspaceComponents(await loadWorkspaceComponentLibrary()); } catch { /* library may not exist on the target branch */ setWorkspaceComponents([]); }
    try { await refreshExtensions(); } catch { setExtensions([]); setExtensionCatalog([]); setExtensionComponents([]); setExtensionTemplates([]); }
    await reloadProjectIntelligence();
    setPreviewRevision((value) => value + 1);
  }, [refreshExtensions, refreshProjectInfo, refreshTree, reloadProjectIntelligence]);

  const gitBranches = useCallback(async (): Promise<GitBranch[]> => {
    if (!isNative) return [];
    return listGitBranches();
  }, [isNative]);

  const gitHistory = useCallback(async (limit = 60): Promise<GitCommit[]> => {
    if (!isNative) return [];
    return getGitHistory(limit);
  }, [isNative]);

  const gitGraph = useCallback(async (limit = 120): Promise<GitGraphCommit[]> => {
    if (!isNative) return [];
    return getGitGraph(limit);
  }, [isNative]);

  const gitFileHistory = useCallback(async (path: string, limit = 80): Promise<GitGraphCommit[]> => {
    if (!isNative || !path) return [];
    return getGitFileHistory(path, limit);
  }, [isNative]);

  const gitBlame = useCallback(async (path: string): Promise<GitBlameLine[]> => {
    if (!isNative || !path) return [];
    return getGitBlame(path);
  }, [isNative]);

  const gitStashes = useCallback(async (): Promise<GitStashEntry[]> => isNative ? listGitStashes() : [], [isNative]);
  const gitTags = useCallback(async (): Promise<GitTag[]> => isNative ? listGitTags() : [], [isNative]);
  const gitCredentialState = useCallback(async (): Promise<GitCredentialState | null> => isNative ? getGitCredentialState() : null, [isNative]);

  const reloadAfterGitMutation = useCallback(async () => {
    await reloadAfterGitBranchChange();
    setGitRevision((value) => value + 1);
  }, [reloadAfterGitBranchChange]);

  const gitStashPush = useCallback(async (message?: string) => {
    if (hasDirtyFiles()) throw new Error(t("git.saveBeforeStash"));
    const output = await pushGitStash(message, true);
    appendLog(t("log.gitStashCreated"));
    await reloadAfterGitMutation();
    return output;
  }, [appendLog, hasDirtyFiles, reloadAfterGitMutation, t]);

  const gitStashApply = useCallback(async (reference: string, pop = false) => {
    if (hasDirtyFiles()) throw new Error(t("git.saveBeforeStashApply"));
    try {
      const output = await applyGitStash(reference, pop);
      appendLog(t(pop ? "log.gitStashPopped" : "log.gitStashApplied", { reference }));
      await reloadAfterGitMutation();
      return output;
    } catch (error) {
      await reloadAfterGitMutation().catch(() => undefined);
      throw error;
    }
  }, [appendLog, hasDirtyFiles, reloadAfterGitMutation, t]);

  const gitStashDrop = useCallback(async (reference: string) => {
    const output = await dropGitStash(reference);
    appendLog(t("log.gitStashDropped", { reference }));
    setGitRevision((value) => value + 1);
    return output;
  }, [appendLog, t]);

  const gitCreateTag = useCallback(async (name: string, commit?: string, message?: string) => {
    const output = await createGitTag(name, commit, message);
    appendLog(t("log.gitTagCreated", { tag: name }));
    setGitRevision((value) => value + 1);
    return output;
  }, [appendLog, t]);

  const gitDeleteTag = useCallback(async (name: string) => {
    const output = await deleteGitTag(name);
    appendLog(t("log.gitTagDeleted", { tag: name }));
    setGitRevision((value) => value + 1);
    return output;
  }, [appendLog, t]);

  const gitSwitch = useCallback(async (name: string) => {
    if (hasDirtyFiles()) throw new Error(t("git.saveBeforeSwitch"));
    const output = await switchGitBranch(name);
    appendLog(t("log.gitSwitched", { branch: name }));
    await reloadAfterGitBranchChange();
    setGitRevision((value) => value + 1);
    return output;
  }, [appendLog, hasDirtyFiles, reloadAfterGitBranchChange, t]);

  const gitCreateBranch = useCallback(async (name: string) => {
    if (hasDirtyFiles()) throw new Error(t("git.saveBeforeSwitch"));
    const output = await createGitBranch(name);
    appendLog(t("log.gitBranchCreated", { branch: name }));
    await reloadAfterGitBranchChange();
    setGitRevision((value) => value + 1);
    return output;
  }, [appendLog, hasDirtyFiles, reloadAfterGitBranchChange, t]);


  const gitMerge = useCallback(async (name: string) => {
    if (hasDirtyFiles()) throw new Error(t("git.saveBeforeMerge"));
    try {
      const output = await mergeGitBranch(name);
      appendLog(t("log.gitMerged", { branch: name }));
      await reloadAfterGitBranchChange();
      setGitRevision((value) => value + 1);
      return output;
    } catch (error) {
      // A conflicted merge intentionally changes clean worktree files. Reload the open buffers from disk so
      // Monaco and the Base/Ours/Theirs inspector immediately reflect the conflict state before rethrowing.
      await reloadAfterGitBranchChange().catch(() => undefined);
      setGitRevision((value) => value + 1);
      throw error;
    }
  }, [appendLog, hasDirtyFiles, reloadAfterGitBranchChange, t]);

  const refreshProjectTools = useCallback(async () => {
    if (!isNative || !workspacePath) return;
    const [tasksResult, serversResult, browsersResult] = await Promise.allSettled([listProjectTasks(), probeLanguageServers(), probeDebugBrowsers()]);
    if (tasksResult.status === "fulfilled") setProjectTasks(tasksResult.value);
    if (serversResult.status === "fulfilled") setLanguageServers(serversResult.value);
    if (browsersResult.status === "fulfilled") setDebugBrowsers(browsersResult.value);
  }, [isNative, workspacePath]);

  const runProjectTask = useCallback(async (taskId: string) => {
    if (!isNative || !workspacePath) return;
    try {
      taskCursorRef.current = 0;
      setTaskLog([]);
      setTestReport(null);
      const status = await startProjectTask(taskId);
      setTaskStatus(status);
      appendLog(t("log.taskStarted", { task: taskId }));
    } catch (error) {
      appendLog(t("log.taskStartFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, workspacePath, t]);

  const runProjectTestFile = useCallback(async (taskId: string, relativePath: string) => {
    if (!isNative || !workspacePath) return;
    try {
      taskCursorRef.current = 0;
      setTaskLog([]);
      setTestReport(null);
      const status = await startProjectTestFile(taskId, relativePath);
      setTaskStatus(status);
      appendLog(t("log.testFileStarted", { path: relativePath }));
    } catch (error) {
      appendLog(t("log.taskStartFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, workspacePath, t]);

  const runProjectTestCase = useCallback(async (taskId: string, relativePath: string, testName: string, framework: string) => {
    if (!isNative || !workspacePath) return;
    try {
      taskCursorRef.current = 0;
      setTaskLog([]);
      setTestReport(null);
      const status = await startProjectTestCase(taskId, relativePath, testName, framework);
      setTaskStatus(status);
      appendLog(t("log.testCaseStarted", { name: testName, path: relativePath }));
    } catch (error) {
      appendLog(t("log.taskStartFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, workspacePath, t]);

  const runProjectTestCoverage = useCallback(async (taskId: string) => {
    if (!isNative || !workspacePath) return;
    try {
      taskCursorRef.current = 0;
      setTaskLog([]);
      setTestReport(null);
      const status = await startProjectTestCoverage(taskId);
      setTaskStatus(status);
      appendLog(t("log.testCoverageStarted", { task: taskId }));
    } catch (error) { appendLog(t("log.taskStartFailed", { error: String(error) })); }
  }, [appendLog, isNative, workspacePath, t]);

  const rerunFailedTests = useCallback(async (taskId: string) => {
    if (!isNative || !workspacePath) return;
    try {
      taskCursorRef.current = 0;
      setTaskLog([]);
      const status = await rerunFailedProjectTests(taskId);
      setTaskStatus(status);
      appendLog(t("log.testFailedRerunStarted", { task: taskId }));
    } catch (error) { appendLog(t("log.taskStartFailed", { error: String(error) })); }
  }, [appendLog, isNative, workspacePath, t]);

  const clearTestHistory = useCallback(async () => {
    if (!isNative || !workspacePath) return;
    await clearProjectTestHistory();
    setTestHistory([]);
  }, [isNative, workspacePath]);

  const stopTask = useCallback(async () => {
    if (!isNative) return;
    const status = await stopProjectTask();
    setTaskStatus(status);
    appendLog(t("log.taskStopped"));
  }, [appendLog, isNative, t]);

  const syncOpenLanguageDocuments = useCallback(async () => {
    for (const file of Object.values(editorFilesRef.current)) {
      if (!/\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(file.relativePath)) continue;
      const version = (languageVersionRef.current[file.relativePath] ?? 0) + 1;
      languageVersionRef.current[file.relativePath] = version;
      await syncLanguageDocument(file.relativePath, file.content, version).catch(() => undefined);
    }
  }, []);

  const pushDefaultLanguageConfiguration = useCallback(async () => {
    await updateLanguageConfiguration({
      typescript: { format: { enable: true }, inlayHints: { parameterNames: { enabled: "literals" }, parameterTypes: { enabled: true }, propertyDeclarationTypes: { enabled: true }, functionLikeReturnTypes: { enabled: true }, enumMemberValues: { enabled: true } } },
      javascript: { format: { enable: true }, inlayHints: { parameterNames: { enabled: "literals" }, parameterTypes: { enabled: true }, propertyDeclarationTypes: { enabled: true }, functionLikeReturnTypes: { enabled: true }, enumMemberValues: { enabled: true } } },
      vue: {},
      svelte: {},
    }).catch(() => undefined);
  }, []);

  const startProjectLanguageServer = useCallback(async (serverId: string) => {
    if (!isNative || !workspacePath) return;
    try {
      const status = await startLanguageServer(serverId);
      setLanguageServerStatus(status);
      setLanguageDesiredServers((current) => current.includes(serverId) ? current : [...current, serverId]);
      languageRestartRef.current[serverId] = { attempts: 0, lastAttempt: 0 };
      setLanguageDiagnostics([]);
      await pushDefaultLanguageConfiguration();
      await syncOpenLanguageDocuments();
      const runtime = status.servers.find((server) => server.serverId === serverId);
      appendLog(t("log.languageServerStarted", { server: runtime?.label ?? serverId }));
    } catch (error) {
      appendLog(t("log.languageServerStartFailed", { error: String(error) }));
    }
  }, [appendLog, isNative, pushDefaultLanguageConfiguration, syncOpenLanguageDocuments, workspacePath, t]);

  const startAllProjectLanguageServers = useCallback(async () => {
    if (!isNative || !workspacePath) return;
    const available = languageServers.filter((server) => server.available);
    const desired: string[] = [];
    let latest = languageServerStatus;
    for (const server of available) {
      try {
        latest = await startLanguageServer(server.id);
        desired.push(server.id);
        languageRestartRef.current[server.id] = { attempts: 0, lastAttempt: 0 };
      } catch (error) { appendLog(t("log.languageServerStartFailed", { error: String(error) })); }
    }
    setLanguageServerStatus(latest);
    setLanguageDesiredServers(desired);
    setLanguageDiagnostics([]);
    await pushDefaultLanguageConfiguration();
    await syncOpenLanguageDocuments();
  }, [appendLog, isNative, languageServerStatus, languageServers, pushDefaultLanguageConfiguration, syncOpenLanguageDocuments, workspacePath, t]);

  const stopProjectLanguageServer = useCallback(async (serverId?: string) => {
    if (!isNative) return;
    const status = await stopLanguageServer(serverId);
    setLanguageServerStatus(status);
    setLanguageDesiredServers((current) => serverId ? current.filter((id) => id !== serverId) : []);
    if (serverId) delete languageRestartRef.current[serverId]; else languageRestartRef.current = {};
    if (!status.running) { setLanguageDiagnostics([]); languageVersionRef.current = {}; }
    appendLog(t("log.languageServerStopped"));
  }, [appendLog, isNative, t]);

  const languageDocumentSymbols = useCallback(async (relativePath: string): Promise<LanguageSymbol[]> => {
    if (!isNative || !languageServerStatus.running) return [];
    const file = editorFilesRef.current[relativePath];
    const version = file ? (languageVersionRef.current[relativePath] ?? file.content.length + 1) : undefined;
    const value = await requestLanguageSymbols<LanguageSymbol[]>("document", relativePath, undefined, file?.content, version);
    return Array.isArray(value) ? value : [];
  }, [isNative, languageServerStatus.running]);

  const languageWorkspaceSymbols = useCallback(async (query: string): Promise<LanguageSymbol[]> => {
    if (!isNative || !languageServerStatus.running) return [];
    const value = await requestLanguageSymbols<LanguageSymbol[]>("workspace", undefined, query);
    return Array.isArray(value) ? value : [];
  }, [isNative, languageServerStatus.running]);

  const languagePrepareHierarchy = useCallback(async (kind: "prepareCall" | "prepareType", relativePath: string, line: number, column: number): Promise<LanguageHierarchyItem[]> => {
    if (!isNative || !languageServerStatus.running || !relativePath) return [];
    const file = editorFilesRef.current[relativePath];
    const version = file ? (languageVersionRef.current[relativePath] ?? file.content.length + 1) : undefined;
    const value = await requestLanguageHierarchy<LanguageHierarchyItem[]>(kind, relativePath, line, column, undefined, file?.content, version);
    return Array.isArray(value) ? value : [];
  }, [isNative, languageServerStatus.running]);

  const languageExpandHierarchy = useCallback(async (kind: "incomingCalls" | "outgoingCalls" | "supertypes" | "subtypes", item: LanguageHierarchyItem): Promise<LanguageHierarchyItem[]> => {
    if (!isNative || !languageServerStatus.running) return [];
    const value = await requestLanguageHierarchy<LanguageIncomingCall[] | LanguageOutgoingCall[] | LanguageHierarchyItem[]>(kind, undefined, undefined, undefined, item);
    if (!Array.isArray(value)) return [];
    if (kind === "incomingCalls") return (value as LanguageIncomingCall[]).map((entry) => entry.from).filter(Boolean);
    if (kind === "outgoingCalls") return (value as LanguageOutgoingCall[]).map((entry) => entry.to).filter(Boolean);
    return value as LanguageHierarchyItem[];
  }, [isNative, languageServerStatus.running]);

  const openLanguageHierarchyItem = useCallback(async (item: LanguageHierarchyItem) => {
    let relativePath = "";
    try {
      let pathname = decodeURIComponent(new URL(item.uri).pathname).replace(/\\/g, "/");
      if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
      const root = workspacePath.replace(/\\/g, "/").replace(/\/$/, "");
      if (pathname.toLowerCase().startsWith(`${root.toLowerCase()}/`)) relativePath = pathname.slice(root.length + 1);
    } catch { return; }
    if (!relativePath) return;
    await openFileAt(relativePath, item.selectionRange.start.line + 1, item.selectionRange.start.character + 1);
  }, [openFileAt, workspacePath]);

  const openLanguageSymbol = useCallback(async (symbol: LanguageSymbol, fallbackPath?: string) => {
    let relativePath = fallbackPath ?? "";
    const uri = symbol.location?.uri;
    if (uri && workspacePath) {
      try {
        let pathname = decodeURIComponent(new URL(uri).pathname).replace(/\\/g, "/");
        if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
        const root = workspacePath.replace(/\\/g, "/").replace(/\/$/, "");
        if (pathname.toLowerCase().startsWith(`${root.toLowerCase()}/`)) relativePath = pathname.slice(root.length + 1);
      } catch { /* keep fallback path */ }
    }
    if (!relativePath) return;
    const range = symbol.location?.range ?? symbol.selectionRange ?? symbol.range;
    await openFileAt(relativePath, (range?.start.line ?? 0) + 1, (range?.start.character ?? 0) + 1);
  }, [openFileAt, workspacePath]);

  const gitRemoteBranches = useCallback(async (): Promise<GitRemoteBranch[]> => {
    if (!isNative) return [];
    return listGitRemoteBranches();
  }, [isNative]);

  const gitOperationState = useCallback(async (): Promise<GitOperationState> => {
    if (!isNative) return { merge: false, rebase: false, cherryPick: false };
    return getGitOperationState();
  }, [isNative]);

  const runGitHistoryMutation = useCallback(async (operation: () => Promise<string>) => {
    if (hasDirtyFiles()) throw new Error(t("git.saveBeforeHistoryOperation"));
    try {
      const output = await operation();
      await reloadAfterGitBranchChange();
      setGitRevision((value) => value + 1);
      return output;
    } catch (error) {
      await reloadAfterGitBranchChange().catch(() => undefined);
      setGitRevision((value) => value + 1);
      throw error;
    }
  }, [hasDirtyFiles, reloadAfterGitBranchChange, t]);

  const gitMergeContinue = useCallback(() => runGitHistoryMutation(() => continueGitMerge()), [runGitHistoryMutation]);
  const gitMergeAbort = useCallback(() => runGitHistoryMutation(() => abortGitMerge()), [runGitHistoryMutation]);
  const gitRebase = useCallback((name: string) => runGitHistoryMutation(() => rebaseGitBranch(name)), [runGitHistoryMutation]);
  const gitRebaseContinue = useCallback(() => runGitHistoryMutation(() => continueGitRebase()), [runGitHistoryMutation]);
  const gitRebaseAbort = useCallback(() => runGitHistoryMutation(() => abortGitRebase()), [runGitHistoryMutation]);
  const gitCherryPick = useCallback((commit: string) => runGitHistoryMutation(() => cherryPickGitCommit(commit)), [runGitHistoryMutation]);
  const gitCherryPickContinue = useCallback(() => runGitHistoryMutation(() => continueGitCherryPick()), [runGitHistoryMutation]);
  const gitCherryPickAbort = useCallback(() => runGitHistoryMutation(() => abortGitCherryPick()), [runGitHistoryMutation]);

  const gitRemotes = useCallback(async (): Promise<GitRemote[]> => {
    if (!isNative) return [];
    return listGitRemotes();
  }, [isNative]);

  const gitConflict = useCallback(async (path: string): Promise<GitConflictSnapshot> => getGitConflict(path), []);

  const gitFetch = useCallback(async (remote: string): Promise<GitNetworkResult> => {
    const result = await fetchGitRemote(remote);
    appendLog(t("log.gitFetched", { remote }));
    setGitRevision((value) => value + 1);
    return result;
  }, [appendLog, t]);

  const gitPull = useCallback(async (remote: string): Promise<GitNetworkResult> => {
    if (hasDirtyFiles()) throw new Error(t("git.saveBeforeNetwork"));
    const result = await pullGitRemote(remote);
    await reloadAfterGitBranchChange();
    appendLog(t("log.gitPulled", { remote }));
    setGitRevision((value) => value + 1);
    return result;
  }, [appendLog, hasDirtyFiles, reloadAfterGitBranchChange, t]);

  const gitPush = useCallback(async (remote: string): Promise<GitNetworkResult> => {
    if (hasDirtyFiles()) throw new Error(t("git.saveBeforeNetwork"));
    const result = await pushGitRemote(remote);
    appendLog(t("log.gitPushed", { remote }));
    setGitRevision((value) => value + 1);
    return result;
  }, [appendLog, hasDirtyFiles, t]);

  const startBrowserDebugger = useCallback(async (browserId: string, url: string) => {
    if (!isNative || !terminalAllowed) return null;
    try {
      debugCursorRef.current = 0;
      setDebugEvents([]);
      const status = await startBrowserDebug(browserId, url);
      setDebugStatus(status);
      appendLog(t("log.debugStarted", { browser: status.browserLabel ?? browserId }));
      return status;
    } catch (error) { appendLog(t("log.debugStartFailed", { error: String(error) })); throw error; }
  }, [appendLog, isNative, terminalAllowed, t]);

  const stopBrowserDebugger = useCallback(async () => {
    if (!isNative) return;
    const status = await stopBrowserDebug();
    setDebugStatus(status);
    appendLog(t("log.debugStopped"));
  }, [appendLog, isNative, t]);

  const runBrowserDebugAction = useCallback(async (action: string, options?: { expression?: string; url?: string; line?: number; column?: number; callFrameId?: string; objectId?: string; breakpointId?: string }) => {
    const result = await browserDebugAction(action, options);
    const status = await getBrowserDebugStatus().catch(() => debugStatus);
    setDebugStatus(status);
    return result;
  }, [debugStatus]);

  const applyGitConflictResult = useCallback((path: string, content: string) => {
    setEditorFiles((current) => {
      const existing = current[path];
      if (existing) return { ...current, [path]: { ...existing, content, dirty: content !== existing.savedContent } };
      return { ...current, [path]: { ...createEditorFile(path, content), dirty: true } };
    });
    setOpenPaths((current) => current.includes(path) ? current : [...current, path]);
    setActivePathState(path);
    appendLog(t("log.gitConflictResultApplied", { path }));
  }, [appendLog, t]);

  const resolveGitConflict = useCallback(async (path: string, content: string) => {
    if (!isNative) return;
    await writeWorkspaceFile(path, content);
    await stageGitPath(path);
    setEditorFiles((current) => {
      const existing = current[path];
      return { ...current, [path]: existing ? { ...existing, content, savedContent: content, dirty: false, externalChange: null } : createEditorFile(path, content) };
    });
    setOpenPaths((current) => current.includes(path) ? current : [...current, path]);
    setActivePathState(path);
    appendLog(t("log.gitConflictResolved", { path }));
    setGitRevision((value) => value + 1);
  }, [appendLog, isNative, t]);

  const openFiles = openPaths.map((path) => editorFiles[path]).filter(Boolean);
  const activeFile = activePath ? editorFiles[activePath] : undefined;

  return {
    isNative,
    tree,
    workspaceName,
    workspacePath,
    recentPaths,
    openFiles,
    activeFile,
    activePath,
    filesByPath,
    dirtyCount,
    dirtyPaths,
    log,
    runtimeLog,
    productionPreviewUrl,
    productionPreviewActive,
    workspaceComponents,
    extensions,
    extensionCatalog,
    extensionComponents,
    extensionTemplates,
    terminalAllowed,
    gitNetworkAllowed,
    terminalSessions,
    activeTerminalId,
    terminalOutput,
    releaseUpdateConfig,
    releaseUpdate,
    updateChecking,
    previewBaseUrl,
    previewRevision,
    defaultPreviewPath,
    projectInfo,
    isTrusted,
    runtimeEnvironment,
    runtimeStatus,
    editorTarget,
    languageSnapshot,
    languageServers,
    languageServerStatus,
    languageDiagnostics,
    languageServerLogs,
    projectTasks,
    taskStatus,
    taskLog,
    testReport,
    testHistory,
    debugBrowsers,
    debugStatus,
    debugEvents,
    nativeWatcherActive,
    gitRevision,
    workspaceSettings,
    effectiveSettings,
    workspaceIndexStatus,
    updateWorkspaceSettings,
    rebuildSearchIndexNow,
    openFolder,
    openRecent,
    createNewProject,
    openFile,
    openFileAt,
    updateFile,
    applyLanguageBufferEdit,
    saveActiveFile,
    saveAllFiles,
    closeFile,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry,
    refreshTree,
    refreshProjectInfo,
    reloadProjectIntelligence,
    refreshProjectTools,
    runProjectTask,
    runProjectTestFile,
    runProjectTestCase,
    runProjectTestCoverage,
    rerunFailedTests,
    clearTestHistory,
    stopTask,
    startProjectLanguageServer,
    startAllProjectLanguageServers,
    stopProjectLanguageServer,
    languageDocumentSymbols,
    languageWorkspaceSymbols,
    languagePrepareHierarchy,
    languageExpandHierarchy,
    openLanguageSymbol,
    openLanguageHierarchyItem,
    setTrusted,
    setTerminalAccess,
    setGitNetworkAccess,
    newTerminal,
    selectTerminal,
    sendTerminalInput,
    resizeTerminal,
    closeTerminal,
    checkForUpdates,
    installUpdate,
    addWorkspaceComponent,
    deleteWorkspaceComponent,
    refreshExtensions,
    extensionInstall,
    extensionUninstall,
    extensionSetEnabled,
    extensionSetCapability,
    extensionRunCommand,
    startDevServer,
    startBuild,
    openProductionPreview,
    useSourcePreview,
    installDependencies,
    stopRuntime,
    searchWorkspaceText,
    replaceWorkspaceText,
    packageManifest,
    packageInstall,
    packageRemove,
    packageUpdate,
    packageOutdated,
    packageAudit,
    workspaceAssets,
    optimizeAssetSvg,
    projectAudit,
    gitStatus,
    gitDiff,
    gitStage,
    gitUnstage,
    gitCommit,
    gitInit,
    gitBranches,
    gitHistory,
    gitGraph,
    gitFileHistory,
    gitBlame,
    gitStashes,
    gitStashPush,
    gitStashApply,
    gitStashDrop,
    gitTags,
    gitCreateTag,
    gitDeleteTag,
    gitCredentialState,
    gitSwitch,
    gitCreateBranch,
    gitMerge,
    gitMergeContinue,
    gitMergeAbort,
    gitRemoteBranches,
    gitOperationState,
    gitRebase,
    gitRebaseContinue,
    gitRebaseAbort,
    gitCherryPick,
    gitCherryPickContinue,
    gitCherryPickAbort,
    gitRemotes,
    gitConflict,
    gitFetch,
    gitPull,
    gitPush,
    startBrowserDebugger,
    stopBrowserDebugger,
    runBrowserDebugAction,
    applyGitConflictResult,
    resolveGitConflict,
    setActivePath: setActivePathState,
  };
}
