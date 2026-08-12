import type { RuntimeEnvironment, RuntimeLogBatch, RuntimeStatus, ProjectInfo, WorkspaceSecurity } from "../types/runtime";
import type { DeployConfig, DeployProviderConfig, DeployProviderState, DeployResult } from "../types/deploy";
import type { WorkspaceChanges, WorkspaceEntry, WorkspaceWrite } from "../types/workspace";
import type { CreatedProject, CreateProjectRequest } from "../types/project";
import type { ComponentSnippet } from "../types/designer";
import type { ReleaseUpdateConfig, ReleaseUpdateInfo, TerminalOutputBatch, TerminalSessionStatus } from "../types/terminal";
import type { WorkspaceIndexStatus, WorkspaceSearchRequest, WorkspaceSearchResponse, WorkspaceReplacement } from "../types/search";
import type { BrowserDebugEventBatch, BrowserDebugStatus, DebugBrowserInfo } from "../types/debug";
import type { GitBlameLine, GitBranch, GitCommit, GitConflictSnapshot, GitCredentialState, GitGraphCommit, GitNetworkResult, GitOperationState, GitRemote, GitRemoteBranch, GitStashEntry, GitStatus, GitTag } from "../types/git";
import type { ProjectLanguageSnapshot } from "../types/intelligence";
import type { LanguageDiagnostic, LanguageHierarchyItem, LanguageServerInfo, LanguageServerLogEntry, LanguageServerStatus } from "../types/languageServices";
import type { ProjectTask, TaskLogBatch, TaskStatus, TestHistoryEntry, TestRunReport } from "../types/tasks";
import type { PackageCommandResult, PackageManifest } from "../types/packages";
import type { AssetInventory, AssetOptimizeResult } from "../types/assets";
import type { ProjectAuditSummary } from "../types/audit";
import type { CreatedExtensionProject, ExtensionCatalogEntry, ExtensionCommandAction, ExtensionComponentContribution, ExtensionRecord, ExtensionTemplateSummary } from "../types/extensions";
import type { RecoverySnapshot, WorkspaceSettings } from "../types/settings";
import type { BundleAnalysis } from "../types/devtools";


export function runningInTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function chooseDirectory(title = "Open WebForge workspace"): Promise<string | null> {
  if (!runningInTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}

export function chooseWorkspace(title = "Open WebForge workspace"): Promise<string | null> {
  return chooseDirectory(title);
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import("@tauri-apps/api/core");
  return api.invoke<T>(command, args);
}

export function setWorkspaceRoot(path: string): Promise<WorkspaceEntry> {
  return invoke<WorkspaceEntry>("set_workspace_root", { path });
}

export function refreshWorkspace(): Promise<WorkspaceEntry> {
  return invoke<WorkspaceEntry>("refresh_workspace");
}

export function resetWorkspaceWatch(): Promise<void> {
  return invoke<void>("reset_workspace_watch");
}

export function pollWorkspaceChanges(): Promise<WorkspaceChanges> {
  return invoke<WorkspaceChanges>("poll_workspace_changes");
}

export function startNativeWorkspaceWatch(): Promise<void> {
  return invoke<void>("start_native_workspace_watch");
}

export function stopNativeWorkspaceWatch(): Promise<void> {
  return invoke<void>("stop_native_workspace_watch");
}

export function pollNativeWorkspaceChanges(): Promise<WorkspaceChanges> {
  return invoke<WorkspaceChanges>("poll_native_workspace_changes");
}

export function readWorkspaceFile(relativePath: string): Promise<string> {
  return invoke<string>("read_workspace_file", { relativePath });
}

export function writeWorkspaceFile(relativePath: string, content: string): Promise<void> {
  return invoke<void>("write_workspace_file", { relativePath, content });
}

export function writeWorkspaceFiles(files: WorkspaceWrite[]): Promise<void> {
  return invoke<void>("write_workspace_files", { files });
}

export function createWorkspaceFile(relativePath: string, content = ""): Promise<void> {
  return invoke<void>("create_workspace_file", { relativePath, content });
}

export function createWorkspaceDirectory(relativePath: string): Promise<void> {
  return invoke<void>("create_workspace_directory", { relativePath });
}

export function renameWorkspaceEntry(relativePath: string, newRelativePath: string): Promise<void> {
  return invoke<void>("rename_workspace_entry", { relativePath, newRelativePath });
}

export function deleteWorkspaceEntry(relativePath: string): Promise<void> {
  return invoke<void>("delete_workspace_entry", { relativePath });
}

export function loadWorkspaceSettings(): Promise<WorkspaceSettings> {
  return invoke<WorkspaceSettings>("load_workspace_settings");
}

export function saveWorkspaceSettings(settings: WorkspaceSettings): Promise<void> {
  return invoke<void>("save_workspace_settings", { settings });
}

export function saveRecoverySnapshot(snapshot: RecoverySnapshot): Promise<void> {
  return invoke<void>("save_recovery_snapshot", { snapshot });
}

export function loadRecoverySnapshot(): Promise<RecoverySnapshot | null> {
  return invoke<RecoverySnapshot | null>("load_recovery_snapshot");
}

export function clearRecoverySnapshot(): Promise<void> {
  return invoke<void>("clear_recovery_snapshot");
}

export async function startWorkspacePreview(): Promise<string> {
  await invoke<void>("sync_preview_root");
  return invoke<string>("start_preview_server");
}

export function setPreviewOverlays(files: Record<string, string>): Promise<void> {
  return invoke<void>("set_preview_overlays", { files });
}

export function detectProject(): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("detect_project");
}

export function setWorkspaceTrust(trusted: boolean): Promise<WorkspaceSecurity> {
  return invoke<WorkspaceSecurity>("set_workspace_trust", { trusted });
}

export function getWorkspaceSecurity(): Promise<WorkspaceSecurity> {
  return invoke<WorkspaceSecurity>("get_workspace_security");
}

export function probeRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  return invoke<RuntimeEnvironment>("probe_runtime_environment");
}

export function startProjectDevServer(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("start_project_dev_server");
}

export function startProjectBuild(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("start_project_build");
}

export function installProjectDependencies(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("install_project_dependencies");
}

export function stopProjectRuntime(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("stop_project_runtime");
}

export function getProjectRuntimeStatus(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("get_project_runtime_status");
}

export function pollProjectRuntimeLogs(cursor: number): Promise<RuntimeLogBatch> {
  return invoke<RuntimeLogBatch>("poll_project_runtime_logs", { cursor });
}

export function createProject(request: CreateProjectRequest): Promise<CreatedProject> {
  return invoke<CreatedProject>("create_project", { request });
}

export function startBuildPreviewServer(outputDir: string): Promise<string> {
  return invoke<string>("start_build_preview_server", { outputDir });
}

export function stopBuildPreviewServer(): Promise<void> {
  return invoke<void>("stop_build_preview_server");
}

export function setTerminalPermission(allowed: boolean): Promise<WorkspaceSecurity> {
  return invoke<WorkspaceSecurity>("set_terminal_permission", { allowed });
}

export function setGitNetworkPermission(allowed: boolean): Promise<WorkspaceSecurity> {
  return invoke<WorkspaceSecurity>("set_git_network_permission", { allowed });
}

export function createTerminalSession(title?: string, cols = 120, rows = 30): Promise<TerminalSessionStatus> {
  return invoke<TerminalSessionStatus>("create_terminal_session", { title: title ?? null, cols, rows });
}

export function listTerminalSessions(): Promise<TerminalSessionStatus[]> {
  return invoke<TerminalSessionStatus[]>("list_terminal_sessions");
}

export function writeTerminalInput(sessionId: string, data: string): Promise<void> {
  return invoke<void>("write_terminal_input", { sessionId, data });
}

export function resizeTerminalSession(sessionId: string, cols: number, rows: number): Promise<TerminalSessionStatus> {
  return invoke<TerminalSessionStatus>("resize_terminal_session", { sessionId, cols, rows });
}

export function pollTerminalOutput(sessionId: string, cursor: number): Promise<TerminalOutputBatch> {
  return invoke<TerminalOutputBatch>("poll_terminal_output", { sessionId, cursor });
}

export function closeTerminalSession(sessionId: string): Promise<void> {
  return invoke<void>("close_terminal_session", { sessionId });
}

export function closeAllTerminalSessions(): Promise<void> {
  return invoke<void>("close_all_terminal_sessions");
}

export function getReleaseUpdateConfig(): Promise<ReleaseUpdateConfig> {
  return invoke<ReleaseUpdateConfig>("get_release_update_config");
}

export function checkReleaseUpdate(): Promise<ReleaseUpdateInfo> {
  return invoke<ReleaseUpdateInfo>("check_release_update");
}

export function installReleaseUpdate(): Promise<void> {
  return invoke<void>("install_release_update");
}

export function loadWorkspaceComponentLibrary(): Promise<ComponentSnippet[]> {
  return invoke<ComponentSnippet[]>("load_workspace_component_library");
}

export function saveWorkspaceComponentLibrary(components: ComponentSnippet[]): Promise<void> {
  return invoke<void>("save_workspace_component_library", { components });
}

export function listExtensions(): Promise<ExtensionRecord[]> {
  return invoke<ExtensionRecord[]>("list_extensions");
}

export function listExtensionCatalog(): Promise<ExtensionCatalogEntry[]> {
  return invoke<ExtensionCatalogEntry[]>("list_extension_catalog");
}

export function installBundledExtension(extensionId: string): Promise<void> {
  return invoke<void>("install_bundled_extension", { extensionId });
}

export function uninstallExtension(extensionId: string): Promise<void> {
  return invoke<void>("uninstall_extension", { extensionId });
}

export function setExtensionEnabled(extensionId: string, enabled: boolean): Promise<void> {
  return invoke<void>("set_extension_enabled", { extensionId, enabled });
}

export function setExtensionCapability(extensionId: string, capability: string, granted: boolean): Promise<void> {
  return invoke<void>("set_extension_capability", { extensionId, capability, granted });
}

export function listExtensionComponents(): Promise<ExtensionComponentContribution[]> {
  return invoke<ExtensionComponentContribution[]>("list_extension_components");
}

export function listExtensionTemplates(): Promise<ExtensionTemplateSummary[]> {
  return invoke<ExtensionTemplateSummary[]>("list_extension_templates");
}

export function runExtensionCommand(extensionId: string, commandId: string): Promise<ExtensionCommandAction> {
  return invoke<ExtensionCommandAction>("run_extension_command", { extensionId, commandId });
}

export function createExtensionProject(extensionId: string, templateId: string, parentPath: string, name: string): Promise<CreatedExtensionProject> {
  return invoke<CreatedExtensionProject>("create_extension_project", { extensionId, templateId, parentPath, name });
}


export function getDeployConfig(): Promise<DeployConfig> {
  return invoke<DeployConfig>("get_deploy_config");
}

export function saveDeployConfig(config: DeployConfig): Promise<void> {
  return invoke<void>("save_deploy_config", { config });
}

export function getDeployProviders(): Promise<DeployProviderState[]> {
  return invoke<DeployProviderState[]>("get_deploy_providers");
}

export function storeDeployCredential(provider: string, secret: string): Promise<void> {
  return invoke<void>("store_deploy_credential", { provider, secret });
}

export function clearDeployCredential(provider: string): Promise<void> {
  return invoke<void>("clear_deploy_credential", { provider });
}

export function generateGitHubPagesWorkflow(outputDir: string): Promise<string> {
  return invoke<string>("generate_github_pages_workflow", { outputDir });
}

export function deployProject(provider: string, config: DeployProviderConfig): Promise<DeployResult> {
  return invoke<DeployResult>("deploy_project", { provider, config });
}

export function analyzeProjectBundle(outputDir?: string): Promise<BundleAnalysis> {
  return invoke<BundleAnalysis>("analyze_project_bundle", { outputDir: outputDir ?? null });
}

export function rebuildWorkspaceIndex(): Promise<WorkspaceIndexStatus> {
  return invoke<WorkspaceIndexStatus>("rebuild_workspace_index");
}

export function getWorkspaceIndexStatus(): Promise<WorkspaceIndexStatus> {
  return invoke<WorkspaceIndexStatus>("get_workspace_index_status");
}

export function searchWorkspace(request: WorkspaceSearchRequest): Promise<WorkspaceSearchResponse> {
  return invoke<WorkspaceSearchResponse>("search_workspace", { request });
}

export function previewWorkspaceReplace(search: WorkspaceSearchRequest, replacement: string): Promise<WorkspaceReplacement[]> {
  return invoke<WorkspaceReplacement[]>("preview_workspace_replace", { request: { search, replacement } });
}

export function getGitStatus(): Promise<GitStatus> {
  return invoke<GitStatus>("get_git_status");
}

export function getGitDiff(relativePath: string, staged = false): Promise<string> {
  return invoke<string>("get_git_diff", { relativePath, staged });
}

export function stageGitPath(relativePath: string): Promise<void> {
  return invoke<void>("git_stage", { relativePath });
}

export function unstageGitPath(relativePath: string): Promise<void> {
  return invoke<void>("git_unstage", { relativePath });
}

export function commitGit(message: string): Promise<string> {
  return invoke<string>("git_commit", { message });
}

export function initGitRepository(): Promise<string> {
  return invoke<string>("git_init");
}

export function listGitBranches(): Promise<GitBranch[]> {
  return invoke<GitBranch[]>("list_git_branches");
}

export function getGitHistory(limit = 40): Promise<GitCommit[]> {
  return invoke<GitCommit[]>("get_git_history", { limit });
}

export function switchGitBranch(name: string): Promise<string> {
  return invoke<string>("git_switch_branch", { name });
}

export function createGitBranch(name: string): Promise<string> {
  return invoke<string>("git_create_branch", { name });
}

export function mergeGitBranch(name: string): Promise<string> {
  return invoke<string>("git_merge_branch", { name });
}
export function continueGitMerge(): Promise<string> { return invoke<string>("git_merge_continue"); }
export function abortGitMerge(): Promise<string> { return invoke<string>("git_merge_abort"); }

export function listGitRemoteBranches(): Promise<GitRemoteBranch[]> {
  return invoke<GitRemoteBranch[]>("list_git_remote_branches");
}

export function getGitOperationState(): Promise<GitOperationState> {
  return invoke<GitOperationState>("get_git_operation_state");
}

export function rebaseGitBranch(name: string): Promise<string> {
  return invoke<string>("git_rebase_branch", { name });
}

export function continueGitRebase(): Promise<string> { return invoke<string>("git_rebase_continue"); }
export function abortGitRebase(): Promise<string> { return invoke<string>("git_rebase_abort"); }
export function cherryPickGitCommit(commit: string): Promise<string> { return invoke<string>("git_cherry_pick", { commit }); }
export function continueGitCherryPick(): Promise<string> { return invoke<string>("git_cherry_pick_continue"); }
export function abortGitCherryPick(): Promise<string> { return invoke<string>("git_cherry_pick_abort"); }

export function listGitRemotes(): Promise<GitRemote[]> {
  return invoke<GitRemote[]>("list_git_remotes");
}

export function getGitConflict(relativePath: string): Promise<GitConflictSnapshot> {
  return invoke<GitConflictSnapshot>("get_git_conflict", { relativePath });
}

export function fetchGitRemote(remote: string): Promise<GitNetworkResult> {
  return invoke<GitNetworkResult>("git_fetch_remote", { remote });
}

export function pullGitRemote(remote: string): Promise<GitNetworkResult> {
  return invoke<GitNetworkResult>("git_pull_remote", { remote });
}

export function pushGitRemote(remote: string): Promise<GitNetworkResult> {
  return invoke<GitNetworkResult>("git_push_remote", { remote });
}

export function listGitStashes(): Promise<GitStashEntry[]> { return invoke<GitStashEntry[]>("list_git_stashes"); }
export function pushGitStash(message?: string, includeUntracked = true): Promise<string> { return invoke<string>("git_stash_push", { message: message ?? null, includeUntracked }); }
export function applyGitStash(reference: string, pop = false): Promise<string> { return invoke<string>("git_stash_apply", { reference, pop }); }
export function dropGitStash(reference: string): Promise<string> { return invoke<string>("git_stash_drop", { reference }); }
export function listGitTags(): Promise<GitTag[]> { return invoke<GitTag[]>("list_git_tags"); }
export function createGitTag(name: string, commit?: string, message?: string): Promise<string> { return invoke<string>("git_create_tag", { name, commit: commit ?? null, message: message ?? null }); }
export function deleteGitTag(name: string): Promise<string> { return invoke<string>("git_delete_tag", { name }); }
export function getGitGraph(limit = 120): Promise<GitGraphCommit[]> { return invoke<GitGraphCommit[]>("get_git_graph", { limit }); }
export function getGitFileHistory(relativePath: string, limit = 80): Promise<GitGraphCommit[]> { return invoke<GitGraphCommit[]>("get_git_file_history", { relativePath, limit }); }
export function getGitBlame(relativePath: string): Promise<GitBlameLine[]> { return invoke<GitBlameLine[]>("get_git_blame", { relativePath }); }
export function getGitCredentialState(): Promise<GitCredentialState> { return invoke<GitCredentialState>("get_git_credential_state"); }

export function loadProjectLanguageFiles(): Promise<ProjectLanguageSnapshot> {
  return invoke<ProjectLanguageSnapshot>("load_project_language_files");
}

export function probeLanguageServers(): Promise<LanguageServerInfo[]> {
  return invoke<LanguageServerInfo[]>("probe_language_servers");
}

export function startLanguageServer(serverId: string): Promise<LanguageServerStatus> {
  return invoke<LanguageServerStatus>("start_language_server", { serverId });
}

export function stopLanguageServer(serverId?: string): Promise<LanguageServerStatus> {
  return invoke<LanguageServerStatus>("stop_language_server", { serverId: serverId ?? null });
}

export function getLanguageServerStatus(): Promise<LanguageServerStatus> {
  return invoke<LanguageServerStatus>("get_language_server_status");
}

export function updateLanguageConfiguration(configuration: Record<string, unknown>): Promise<LanguageServerStatus> {
  return invoke<LanguageServerStatus>("update_language_configuration", { configuration });
}

export function refreshLanguageDiagnostics(): Promise<LanguageDiagnostic[]> {
  return invoke<LanguageDiagnostic[]>("refresh_language_diagnostics");
}

export function getLanguageServerLogs(limit = 300): Promise<LanguageServerLogEntry[]> {
  return invoke<LanguageServerLogEntry[]>("get_language_server_logs", { limit });
}

export function executeLanguageCommand<T = unknown>(serverId: string, command: string, argumentsValue: unknown[] = []): Promise<T> {
  return invoke<T>("execute_language_command", { serverId, command, arguments: argumentsValue });
}

export function syncLanguageDocument(relativePath: string, content: string, version: number): Promise<void> {
  return invoke<void>("sync_language_document", { relativePath, content, version });
}

export function closeLanguageDocument(relativePath: string): Promise<void> {
  return invoke<void>("close_language_document", { relativePath });
}

export function getLanguageDiagnostics(): Promise<LanguageDiagnostic[]> {
  return invoke<LanguageDiagnostic[]>("get_language_diagnostics");
}

export function requestLanguageFeature<T = unknown>(feature: string, relativePath: string, line: number, column: number, newName?: string, content?: string, version?: number): Promise<T> {
  return invoke<T>("request_language_feature", { feature, relativePath, line, column, newName: newName ?? null, content: content ?? null, version: version ?? null });
}

export function requestLanguageSymbols<T = unknown>(scope: "document" | "workspace", relativePath?: string, query?: string, content?: string, version?: number): Promise<T> {
  return invoke<T>("request_language_symbols", { scope, relativePath: relativePath ?? null, query: query ?? null, content: content ?? null, version: version ?? null });
}

export function requestLanguageHierarchy<T = unknown>(kind: string, relativePath?: string, line?: number, column?: number, item?: LanguageHierarchyItem, content?: string, version?: number): Promise<T> {
  return invoke<T>("request_language_hierarchy", { kind, relativePath: relativePath ?? null, line: line ?? null, column: column ?? null, item: item ?? null, content: content ?? null, version: version ?? null });
}

export function listProjectTasks(): Promise<ProjectTask[]> {
  return invoke<ProjectTask[]>("list_project_tasks");
}

export function startProjectTask(taskId: string): Promise<TaskStatus> {
  return invoke<TaskStatus>("start_project_task", { taskId });
}

export function startProjectTestFile(taskId: string, relativePath: string): Promise<TaskStatus> {
  return invoke<TaskStatus>("start_project_test_file", { taskId, relativePath });
}

export function startProjectTestCase(taskId: string, relativePath: string, testName: string, framework: string): Promise<TaskStatus> {
  return invoke<TaskStatus>("start_project_test_case", { taskId, relativePath, testName, framework });
}

export function startProjectTestCoverage(taskId: string): Promise<TaskStatus> {
  return invoke<TaskStatus>("start_project_test_coverage", { taskId });
}

export function rerunFailedProjectTests(taskId: string): Promise<TaskStatus> {
  return invoke<TaskStatus>("rerun_failed_project_tests", { taskId });
}

export function getProjectTestHistory(): Promise<TestHistoryEntry[]> {
  return invoke<TestHistoryEntry[]>("get_project_test_history");
}

export function clearProjectTestHistory(): Promise<void> {
  return invoke<void>("clear_project_test_history");
}

export function getProjectTestReport(): Promise<TestRunReport | null> {
  return invoke<TestRunReport | null>("get_project_test_report");
}

export function stopProjectTask(): Promise<TaskStatus> {
  return invoke<TaskStatus>("stop_project_task");
}

export function getProjectTaskStatus(): Promise<TaskStatus> {
  return invoke<TaskStatus>("get_project_task_status");
}

export function pollProjectTaskLogs(cursor: number): Promise<TaskLogBatch> {
  return invoke<TaskLogBatch>("poll_project_task_logs", { cursor });
}


export function probeDebugBrowsers(): Promise<DebugBrowserInfo[]> { return invoke<DebugBrowserInfo[]>("probe_debug_browsers"); }
export function startBrowserDebug(browserId: string, url: string): Promise<BrowserDebugStatus> { return invoke<BrowserDebugStatus>("start_browser_debug", { browserId, url }); }
export function stopBrowserDebug(): Promise<BrowserDebugStatus> { return invoke<BrowserDebugStatus>("stop_browser_debug"); }
export function getBrowserDebugStatus(): Promise<BrowserDebugStatus> { return invoke<BrowserDebugStatus>("get_browser_debug_status"); }
export function pollBrowserDebugEvents(cursor: number): Promise<BrowserDebugEventBatch> { return invoke<BrowserDebugEventBatch>("poll_browser_debug_events", { cursor }); }
export function browserDebugAction(action: string, options?: { expression?: string; url?: string; line?: number; column?: number; callFrameId?: string; objectId?: string; breakpointId?: string }): Promise<unknown> {
  return invoke("browser_debug_action", {
    action,
    expression: options?.expression ?? null,
    url: options?.url ?? null,
    line: options?.line ?? null,
    column: options?.column ?? null,
    callFrameId: options?.callFrameId ?? null,
    objectId: options?.objectId ?? null,
    breakpointId: options?.breakpointId ?? null,
  });
}

export function getPackageManifest(): Promise<PackageManifest> {
  return invoke<PackageManifest>("get_package_manifest");
}
export function installPackage(name: string, dev: boolean, allowLifecycleScripts: boolean): Promise<PackageCommandResult> {
  return invoke<PackageCommandResult>("package_install", { name, dev, allowLifecycleScripts });
}
export function removePackage(name: string, allowLifecycleScripts: boolean): Promise<PackageCommandResult> {
  return invoke<PackageCommandResult>("package_remove", { name, allowLifecycleScripts });
}
export function updatePackage(name: string | null, allowLifecycleScripts: boolean): Promise<PackageCommandResult> {
  return invoke<PackageCommandResult>("package_update", { name, allowLifecycleScripts });
}
export function getOutdatedPackages(): Promise<PackageCommandResult> {
  return invoke<PackageCommandResult>("package_outdated");
}
export function runPackageSecurityAudit(): Promise<PackageCommandResult> {
  return invoke<PackageCommandResult>("package_security_audit");
}
export function listWorkspaceAssets(): Promise<AssetInventory> {
  return invoke<AssetInventory>("list_workspace_assets");
}
export function optimizeSvgAsset(relativePath: string): Promise<AssetOptimizeResult> {
  return invoke<AssetOptimizeResult>("optimize_svg_asset", { relativePath });
}
export function runProjectAudit(): Promise<ProjectAuditSummary> {
  return invoke<ProjectAuditSummary>("run_project_audit");
}
