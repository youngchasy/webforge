import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const json = (path) => JSON.parse(read(path));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const hasAll = (path, markers) => {
  const text = read(path);
  for (const marker of markers) assert(text.includes(marker), `${path} missing: ${marker}`);
  return text;
};

const pkg = json("package.json");
const lock = json("package-lock.json");
const tauri = json("src-tauri/tauri.conf.json");
const releaseConfig = json("src-tauri/tauri.release.conf.json");
const capability = json("src-tauri/capabilities/default.json");
const cargo = read("src-tauri/Cargo.toml");

assert(pkg.version === "1.0.0", "package.json version must be 1.0.0");
assert(lock.version === pkg.version && lock.packages?.[""]?.version === pkg.version, "package-lock root version must match package.json");
assert(tauri.version === pkg.version, "tauri.conf.json version must match package.json");
assert(cargo.includes(`version = "${pkg.version}"`), "Cargo.toml version must match package.json");
assert(pkg.dependencies?.["source-map-js"] === "1.2.1", "source-map-js direct dependency missing");
for (const dependency of ['portable-pty = "0.9.0"', 'regex = "1"', 'notify = "8.2.0"', 'url = "2"', 'tungstenite = "0.30.0"', 'tauri-plugin-updater = "2.10.1"', 'semver = "1"']) assert(cargo.includes(dependency), `Cargo dependency missing: ${dependency}`);
assert(releaseConfig.bundle?.createUpdaterArtifacts === false, "v1.0.0 updater artifacts must stay disabled until a signed feed is configured");
assert(Array.isArray(tauri.bundle?.resources) && tauri.bundle.resources.includes("runtime/**/*"), "bundled runtime resources are not configured");
assert(typeof tauri.app?.security?.csp === "string" && tauri.app.security.csp.includes("object-src 'none'"), "production CSP missing");
assert(!capability.permissions.includes("core:default"), "broad core:default capability must not be granted");

const requiredPermissions = [
  "allow-search-workspace", "allow-preview-workspace-replace", "allow-get-git-status", "allow-get-git-diff", "allow-git-stage", "allow-git-unstage", "allow-git-commit", "allow-git-init",
  "allow-list-git-branches", "allow-git-merge-continue", "allow-git-merge-abort", "allow-list-git-remote-branches", "allow-get-git-operation-state", "allow-git-rebase-branch", "allow-git-rebase-continue", "allow-git-rebase-abort", "allow-git-cherry-pick", "allow-git-cherry-pick-continue", "allow-git-cherry-pick-abort",
  "allow-list-git-remotes", "allow-get-git-conflict", "allow-git-fetch-remote", "allow-git-pull-remote", "allow-git-push-remote",
  "allow-list-git-stashes", "allow-git-stash-push", "allow-git-stash-apply", "allow-git-stash-drop", "allow-list-git-tags", "allow-git-create-tag", "allow-git-delete-tag", "allow-get-git-graph", "allow-get-git-file-history", "allow-get-git-blame", "allow-get-git-credential-state",
  "allow-probe-language-servers", "allow-start-language-server", "allow-stop-language-server", "allow-get-language-server-status", "allow-sync-language-document", "allow-close-language-document", "allow-get-language-diagnostics", "allow-request-language-feature", "allow-request-language-symbols", "allow-request-language-hierarchy", "allow-update-language-configuration", "allow-refresh-language-diagnostics", "allow-get-language-server-logs", "allow-execute-language-command",
  "allow-list-project-tasks", "allow-start-project-task", "allow-start-project-test-file", "allow-start-project-test-case", "allow-start-project-test-coverage", "allow-rerun-failed-project-tests", "allow-get-project-test-history", "allow-clear-project-test-history", "allow-stop-project-task", "allow-get-project-task-status", "allow-poll-project-task-logs", "allow-get-project-test-report",
  "allow-probe-debug-browsers", "allow-start-browser-debug", "allow-stop-browser-debug", "allow-get-browser-debug-status", "allow-poll-browser-debug-events", "allow-browser-debug-action",
  "allow-start-native-workspace-watch", "allow-stop-native-workspace-watch", "allow-poll-native-workspace-changes", "allow-rebuild-workspace-index", "allow-get-workspace-index-status",
  "allow-load-workspace-settings", "allow-save-workspace-settings", "allow-save-recovery-snapshot", "allow-load-recovery-snapshot", "allow-clear-recovery-snapshot",
  "allow-analyze-project-bundle", "allow-get-deploy-config", "allow-save-deploy-config", "allow-get-deploy-providers", "allow-store-deploy-credential", "allow-clear-deploy-credential", "allow-generate-github-pages-workflow", "allow-deploy-project", "allow-get-package-manifest", "allow-package-install", "allow-package-remove", "allow-package-update", "allow-package-outdated", "allow-package-security-audit", "allow-list-workspace-assets", "allow-optimize-svg-asset", "allow-run-project-audit",
  "allow-list-extensions", "allow-list-extension-catalog", "allow-install-bundled-extension", "allow-uninstall-extension", "allow-set-extension-enabled", "allow-set-extension-capability", "allow-list-extension-components", "allow-list-extension-templates", "allow-run-extension-command", "allow-create-extension-project",
  "allow-create-terminal-session", "allow-set-git-network-permission", "allow-install-release-update",
];
for (const permission of requiredPermissions) assert(capability.permissions.includes(permission), `capability missing ${permission}`);

hasAll("src-tauri/build.rs", ["get_deploy_config", "save_deploy_config", "get_deploy_providers", "store_deploy_credential", "clear_deploy_credential", "generate_github_pages_workflow", "deploy_project", "get_package_manifest", "package_install", "list_workspace_assets", "optimize_svg_asset", "run_project_audit", "analyze_project_bundle", "start_project_test_coverage", "rerun_failed_project_tests", "get_project_test_history", "clear_project_test_history", "request_language_hierarchy", "browser_debug_action", "git_rebase_branch", "git_merge_continue", "git_merge_abort", "list_git_stashes", "git_create_tag", "get_git_graph", "get_git_blame", "get_git_credential_state", "update_language_configuration", "refresh_language_diagnostics", "get_language_server_logs", "execute_language_command", "list_extensions", "install_bundled_extension", "set_extension_capability", "list_extension_components", "list_extension_templates", "run_extension_command", "create_extension_project"]);
hasAll("src-tauri/src/lib.rs", ["deploy::get_deploy_config", "deploy::save_deploy_config", "deploy::get_deploy_providers", "deploy::store_deploy_credential", "deploy::clear_deploy_credential", "deploy::generate_github_pages_workflow", "deploy::deploy_project", "package_manager::get_package_manifest", "assets::list_workspace_assets", "audit::run_project_audit", "devtools::analyze_project_bundle", "tasks::start_project_test_coverage", "tasks::rerun_failed_project_tests", "tasks::get_project_test_history", "tasks::clear_project_test_history", "debugger::browser_debug_action", "language_services::request_language_hierarchy", "git::git_merge_continue", "git::git_merge_abort", "git::list_git_stashes", "git::git_stash_apply", "git::list_git_tags", "git::get_git_graph", "git::get_git_file_history", "git::get_git_blame", "git::get_git_credential_state", "language_services::update_language_configuration", "language_services::refresh_language_diagnostics", "language_services::get_language_server_logs", "language_services::execute_language_command", "extensions::list_extensions", "extensions::install_bundled_extension", "extensions::set_extension_capability", "extensions::run_extension_command", "extensions::create_extension_project"]);

const extensionSource = hasAll("src-tauri/src/extensions.rs", [
  "EXTENSION_SCHEMA_VERSION", "SUPPORTED_CAPABILITIES", "workspace.read", "workspace.write", "editor.commands", "ui.panels", "designer.components", "project.templates", "editor.theme", "project.adapters", "diagnostics.contribute", "formatters.contribute", "languages.contribute",
  "ExtensionManifest", "ExtensionCommandAction", "ExtensionComponentPack", "ExtensionTemplate", "ExtensionTheme", "ExtensionProjectAdapter", "install_bundled_extension", "set_extension_capability", "list_extension_components", "list_extension_templates", "run_extension_command", "create_extension_project",
  ".webforge/extensions-state.json", "webforge-extension.json", "extension directory may not be a symbolic link", "editor.commands", "require_trusted", "clean_relative_path", "Midnight Theme", "WebForge Starter Pack",
]);
assert(!extensionSource.includes("std::process::Command"), "2.3 declarative extension host must not execute extension process commands");
assert(extensionSource.includes('ExtensionCommandAction::CreateFile') && extensionSource.includes('ExtensionCommandAction::OpenFile'), "bounded extension command actions missing");

const tasks = hasAll("src-tauri/src/tasks.rs", [
  "CoverageSummary", "TestHistoryEntry", "MAX_TEST_HISTORY", "MAX_FAILED_RERUN_CASES", "start_project_test_coverage", "rerun_failed_project_tests", "get_project_test_history", "clear_project_test_history",
  "PLAYWRIGHT_JSON_OUTPUT_FILE", "--reporter=json", "--outputFile=", "--coverage.reporter=json-summary", "--coverageReporters=json-summary", "regex::escape", "MAX_TEST_REPORT_BYTES", "MAX_TEST_REPORT_CASES",
]);
assert(tasks.includes("path: path.clone()") && tasks.includes("title: title.clone()"), "Playwright report ownership fix missing");
assert(tasks.includes("let category = task_category(&name, &script).to_string();"), "project task ownership fix missing");

const gitSource = hasAll("src-tauri/src/git.rs", [
  "GitStashEntry", "GitTag", "GitGraphCommit", "GitBlameLine", "GitCredentialState", "git_merge_continue", "git_merge_abort", "git_stash_push", "git_stash_apply", "git_stash_drop", "git_create_tag", "git_delete_tag", "get_git_graph", "get_git_file_history", "get_git_blame", "get_git_credential_state", "--line-porcelain", "--follow", "--topo-order", "secrets_exposed_to_webview", "tag.gpgSign=false", "merge.gpgSign=false", "parsed.set_query(None)",
]);
assert(gitSource.includes('require_terminal_allowed(&security)?;'), "advanced worktree Git mutations must retain Terminal Access checks");
assert(gitSource.includes('credential.helper') && !gitSource.includes('password: String'), "Git credential state must remain metadata-only");

const debuggerSource = hasAll("src-tauri/src/debugger.rs", [
  "DebugScope", "DebugScript", "scopeChain", "sourceMapURL", "MAX_DEBUG_SCRIPTS", "MAX_VARIABLE_PROPERTIES", "Debugger.evaluateOnCallFrame", "Runtime.getProperties", "Debugger.removeBreakpoint", "Debugger.breakpointResolved", "Debugger.setBreakpointByUrl", "MAX_EVALUATE_EXPRESSION",
]);
assert(debuggerSource.includes('matches!(host.as_str(), "127.0.0.1" | "localhost" | "[::1]" | "::1")'), "debug target must stay loopback-only");
assert(!debuggerSource.includes("path::{Path, PathBuf}"), "stale unused debugger Path import remains");

const language = hasAll("src-tauri/src/language_services.rs", [
  "LanguageServerInstance", "server_id_for_path", "typescript-language-server", "vue-language-server", "svelteserver", "semanticTokensProvider", "textDocument/semanticTokens/full", "textDocument/prepareCallHierarchy", "textDocument/prepareTypeHierarchy",
  "textDocument/inlayHint", "textDocument/formatting", "textDocument/codeLens", "workspace/diagnostic", "workspace/didChangeConfiguration", "workspace/configuration", "workspace/workspaceFolders", "allowed_commands", "intentional_stop",
  "language server command was not issued by a current CodeLens", '"clientInfo":{"name":"WebForge","version":"1.0.0"}',
]);
assert(language.includes("terminate_process_tree"), "language-server process cleanup missing");

hasAll("src/types/debug.ts", ["DebugRemoteValue", "DebugScope", "DebugScript", "DebugBreakpoint", "DebugLaunchFile"]);
hasAll("src/types/tasks.ts", ["CoverageSummary", "TestHistoryEntry", "coverage: CoverageSummary | null", "finishedAtMs"]);
hasAll("src/types/git.ts", ["GitStashEntry", "GitTag", "GitGraphCommit", "GitBlameLine", "GitCredentialState", "secretsExposedToWebview"]);
hasAll("src/types/languageServices.ts", ["LanguageServerRuntimeStatus", "LanguageServerLogEntry", "supportsInlayHints", "supportsFormatting", "supportsCodeLens", "supportsWorkspaceDiagnostics", "servers: LanguageServerRuntimeStatus[]"]);
hasAll("src/monaco/lsp.ts", ["serverForPath", "remapSemanticData", "registerInlayHintsProvider", "registerDocumentFormattingEditProvider", "registerCodeLensProvider", "webforge.lsp.executeCommand"]);
hasAll("src/components/SourceControlPanel.tsx", ["CommitGraph", "\"stashes\"", "\"tags\"", "\"inspect\"", "getFileHistory", "getBlame", "getCredentialState", "GitMergeEditor", "resolveConflict"]);
hasAll("src/components/GitMergeEditor.tsx", ["createDiffEditor", "git.baseVsOurs", "git.baseVsTheirs", "onResolve", "git-merge-overlay"]);
hasAll("src/lib/sourceMaps.ts", ["SourceMapConsumer", "originalToGeneratedLocation", "generatedToOriginalLocation", "MAX_SOURCE_MAP_CHARS", "isLoopbackUrl"]);
hasAll("src/components/CodeEditor.tsx", ["diagnosticsRef", "cursorRef", "toggleBreakpointRef", "glyphMargin: true", "GUTTER_GLYPH_MARGIN", "debug-breakpoint-glyph", "[file.relativePath, file.language]"]);
hasAll("src/components/DebugPanel.tsx", ["getProperties", "debug.variables", "debug.watch", "debug.breakpoints", "callFrameId", "objectId"]);
hasAll("src/components/BottomPanel.tsx", ["tests.rerunFailed", "tests.coverage", "coverage-grid", "test-history", "DebugPanel", "matchesFailedStatus", "language.startAll", "languageServerLogs", "language.inlayHints", "language.workspaceDiagnostics"]);
hasAll("src/hooks/useWorkspace.ts", ["testHistory", "runProjectTestCoverage", "rerunFailedTests", "clearTestHistory", "getProjectTestHistory", "scripts: []", "gitStashPush", "gitStashApply", "gitCreateTag", "gitGraph", "gitFileHistory", "gitBlame", "gitCredentialState", "resolveGitConflict", "startAllProjectLanguageServers", "languageDesiredServers", "refreshLanguageDiagnostics", "getLanguageServerLogs", "languageRestartRef"]);
hasAll("src/lib/tauri.ts", ["startProjectTestCoverage", "rerunFailedProjectTests", "getProjectTestHistory", "clearProjectTestHistory", "callFrameId", "objectId", "breakpointId", "listGitStashes", "pushGitStash", "listGitTags", "getGitGraph", "getGitFileHistory", "getGitBlame", "getGitCredentialState", "updateLanguageConfiguration", "refreshLanguageDiagnostics", "getLanguageServerLogs", "executeLanguageCommand"]);
hasAll("src/App.tsx", ["webforge.debug.breakpoints", ".webforge/launch.json", "originalToGeneratedLocation", "generatedToOriginalLocation", "toggleDebugBreakpoint", "resetRemoteBreakpoints", "onToggleBreakpoint={toggleDebugBreakpoint}", "onRunTestCoverage", "onRerunFailedTests", "getGraph={workspace.gitGraph}", "stashPush={workspace.gitStashPush}", "resolveConflict={workspace.resolveGitConflict}", "resolveFrameworkSelection", "frameworkStructuralEditable", "frameworkTextEditable", "onSetText={setText}"]);
hasAll("src/lib/frameworkSource.ts", ["resolveFrameworkSelection", "setFrameworkAttribute", "setFrameworkText", "moveFrameworkNode", "insertFrameworkSnippet", "frameworkStructuralEditable", "frameworkTextEditable", "adaptSnippetForReact", "v-bind:", "bind:"]);
hasAll("src/components/InspectorPanel.tsx", ["structuralEditable", "textEditable", "onSetText", "sourceKind === \"framework\""]);
hasAll("src-tauri/src/runtime.rs", ["prepare_vite_runtime_config", "WEBFORGE_RUNTIME_DIR", "symlink_metadata", "runtime_vite_config", "append_vite_runtime_config"]);
hasAll("src-tauri/src/project.rs", ["vite_config_path", "script_vite_config", "--config=", "vite.config.ts"]);
hasAll("src/types/runtime.ts", ["viteConfigPath: string | null"]);

const generator = hasAll("src-tauri/src/generator.rs", ["WEBFORGE 1.0.0", "Created with WebForge 1.0.0", "transformIndexHtml", "webforgeStripSourceHints", "webforgeSourceHints", "framework-source-edit", "runtime_vite_config", "data-webforge-source-map", "sourcesContent"]);
assert(generator.includes("WEBFORGE 1.0.0"), "generated templates have a stale version label");

for (const path of [
  "src/components/DebugPanel.tsx", "src/components/GitMergeEditor.tsx", "src/lib/sourceMaps.ts", "src/lib/frameworkSource.ts", "src/types/debug.ts", "src/types/tasks.ts", "src/types/git.ts", "src-tauri/src/debugger.rs", "src-tauri/src/tasks.rs", "src-tauri/src/git.rs",
]) assert(existsSync(resolve(root, path)), `required release file missing: ${path}`);

const i18n = hasAll("src/i18n/messages.ts", [
  '"app.versionBadge": "1.0.0"', '"settings.keybindingsTitle"', '"settings.hotExit"', '"settings.nativeIndex"', '"extensions.title"', '"extensions.capabilities"', '"components.title"', '"wizard.extensionSecurityNote"', '"activity.packages"', '"packages.lifecycleConfirm"', '"assets.optimizeSvg"', '"health.staticAudit"', '"language.startAll"', '"language.stopAll"', '"language.inlayHints"', '"language.formatting"', '"language.codeLens"', '"language.workspaceDiagnostics"', '"language.serverLog"', '"inspector.frameworkEnabled"', '"inspector.textContent"', '"inspector.safeStaticText"', '"tests.rerunFailed"', '"tests.coverage"', '"tests.history"', '"debug.breakpoints"', '"debug.variables"', '"debug.watch"', '"debug.addConfiguration"', '"git.viewStashes"', '"git.viewTags"', '"git.viewInspect"', '"git.mergeEditorTitle"', '"git.credentialsNeverExposed"',
]);
const [englishCatalog, russianCatalog = ""] = i18n.split("export type TranslationKey");
const keyPattern = /^  "([^"]+)":/gm;
const englishKeys = new Set([...englishCatalog.matchAll(keyPattern)].map((match) => match[1]));
const russianKeys = new Set([...russianCatalog.matchAll(keyPattern)].map((match) => match[1]));
assert(englishKeys.size >= 630, "localization catalog is unexpectedly small");
assert(englishKeys.size === russianKeys.size, "English/Russian localization key counts differ");
for (const key of englishKeys) assert(russianKeys.has(key), `Russian localization missing key: ${key}`);
assert(/[А-Яа-яЁё]/.test(russianCatalog), "Russian localization must contain Cyrillic text");

const sourceFiles = [];
const collectSources = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name);
    if (entry.isDirectory()) collectSources(target);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) sourceFiles.push(target);
  }
};
collectSources(resolve(root, "src"));
const translationCall = /\bt\(\s*["']([^"']+)["']/g;
for (const sourcePath of sourceFiles) {
  const sourceText = readFileSync(sourcePath, "utf8");
  for (const match of sourceText.matchAll(translationCall)) assert(englishKeys.has(match[1]), `${sourcePath.slice(root.length + 1)} references unknown localization key: ${match[1]}`);
}


hasAll("src/components/VisualStyleControls.tsx", ["designer.layout", "grid-template-columns", "transition-duration", "animation-duration", "container-type", "utilityToggles", "onCreateAnimationPreset", "onCreateContainerQuery"]);
hasAll("src/lib/cssFrameworks.ts", ["detectCssUtilityFrameworks", "tailwind", "bootstrap", "toggleUtilityClass"]);
hasAll("src/lib/designer.ts", ["appendDesignerAnimation", "appendDesignerContainerQuery", "WebForge Designer 2.0 motion", "WebForge Designer 2.0 container queries"]);
hasAll("src/components/PreviewPane.tsx", ["PreviewStyleCommit", "designer-style-commit", "onDesignerStyleCommit"]);
hasAll("src/App.tsx", ["commitPreviewStyleBatch", "appendDesignerAnimation", "appendDesignerContainerQuery", "onDesignerStyleCommit={commitPreviewStyleBatch}", "projectCssFrameworks={workspace.projectInfo.cssFrameworks}"]);
assert(existsSync(resolve(root, "SECURITY.md")), "SECURITY.md is required");
hasAll("SECURITY.md", [
  "WebForge",
  "v1.0.0",
]);
hasAll("src-tauri/src/preview.rs", ["visual-designer-2", "resize-handles", "box-model-overlay", "designer-style-commit", "marginOverlay", "contentOverlay"]);
hasAll("src-tauri/src/generator.rs", ["visual-designer-2", "resize-handles", "box-model-overlay", "designer-style-commit", "marginOverlay", "contentOverlay"]);

hasAll("src-tauri/src/package_manager.rs", ["PackageManifest", "package_install", "package_remove", "package_update", "package_outdated", "package_security_audit", "--ignore-scripts", "require_terminal_allowed", "invalid package name/specifier"]);
hasAll("src-tauri/src/assets.rs", ["AssetInventory", "list_workspace_assets", "optimize_svg_asset", "require_trusted", "symlink", "node_modules"]);
hasAll("src-tauri/src/audit.rs", ["ProjectAuditSummary", "run_project_audit", "html-lang", "meta-description", "img-alt", "form-label", "broken-local-link"]);
hasAll("src/types/extensions.ts", ["ExtensionCapability", "ui.panels", "ExtensionRecord", "ExtensionCatalogEntry", "ExtensionComponentContribution", "ExtensionTemplateSummary", "ExtensionCommandAction"]);
hasAll("src/components/ExtensionsPanel.tsx", ["extensions.capabilities", "onSetCapability", "extension.panels", "onApplyTheme", "extensions.marketplace"]);
hasAll("src/components/ComponentMarketplacePanel.tsx", ["extensionComponents", "components.copySnippet", "onOpenExtensions"]);
hasAll("src/components/ProjectWizard.tsx", ["extensionTemplates", "extensionTemplate", "wizard.extensionSecurityNote", "ExtensionTemplateSummary"]);
hasAll("src/hooks/useWorkspace.ts", ["extensionCatalog", "extensionComponents", "extensionTemplates", "refreshExtensions", "extensionInstall", "extensionSetCapability", "extensionRunCommand", "createExtensionProject"]);
hasAll("src/lib/tauri.ts", ["listExtensions", "listExtensionCatalog", "installBundledExtension", "setExtensionCapability", "listExtensionComponents", "listExtensionTemplates", "runExtensionCommand", "createExtensionProject"]);
hasAll("src/App.tsx", ["ExtensionsPanel", "ComponentMarketplacePanel", "extensionThemeKey", "activeExtensionTheme", "designerComponents", "executeExtensionCommand", "workspace.extensionTemplates"]);
hasAll("src/lib/themes.ts", ["midnight", "graphite", "slate", "light", "paper", "glass", "terminalThemeFor"]);
hasAll("src/monaco/themes.ts", ["webforge-midnight", "webforge-graphite", "webforge-slate", "webforge-light", "webforge-paper", "webforge-glass"]);
hasAll("src/components/SettingsDialog.tsx", ["BUILTIN_THEMES", "settings.appearanceTitle", "theme-card"]);
hasAll("src/styles/tokens.css", ['data-theme="midnight"', 'data-theme="graphite"', 'data-theme="slate"', 'data-theme="light"', 'data-theme="paper"', 'data-theme="glass"']);
hasAll("src/App.tsx", ["document.documentElement.dataset.theme", "uiTheme={workspace.effectiveSettings.appearance.theme}"]);

hasAll("src/types/packages.ts", ["PackageManifest", "PackageCommandResult", "PackageOutdatedEntry"]);
hasAll("src/types/assets.ts", ["AssetInventory", "AssetOptimizeResult"]);
hasAll("src/types/audit.ts", ["ProjectAuditSummary", "ProjectAuditFinding"]);
hasAll("src/components/PackageManagerPanel.tsx", ["packages.lifecycleConfirm", "allowLifecycleScripts", "getOutdated", "runAudit"]);
hasAll("src/components/AssetManagerPanel.tsx", ["assets.unusedOnly", "optimizeSvg", "previewBaseUrl", "navigator.clipboard"]);
hasAll("src/components/ProjectHealthPanel.tsx", ["health.staticAudit", "AuditCategory", "openFileAt"]);

hasAll("src-tauri/src/settings.rs", ["load_workspace_settings", "save_workspace_settings", "save_recovery_snapshot", "load_recovery_snapshot", "MAX_RECOVERY_BYTES", "app_local_data_dir", ".webforge/settings.json"]);
hasAll("src-tauri/src/search.rs", ["WorkspaceSearchIndexState", "MAX_INDEX_BYTES", "MAX_INDEX_FILES", "GitIgnoreRules", "apply_changes", "rebuild_workspace_index", "get_workspace_index_status", "use_index"]);
hasAll("src-tauri/src/watcher.rs", ["WorkspaceSearchIndexState", "index.apply_changes"]);
hasAll("src/components/SettingsDialog.tsx", ["settings.keybindingsTitle", "settings.hotExit", "settings.nativeIndex", "onRebuildIndex", "workspaceSettings"]);
hasAll("src/components/CodeEditor.tsx", ["CodeEditorHandle", "formatDocument", "updateOptions", "editorSettings"]);
hasAll("src/hooks/useWorkspace.ts", ["effectiveSettings", "loadRecoverySnapshot", "saveRecoverySnapshot", "sessionRestored", "rebuildSearchIndexNow", "useIndex"]);
hasAll("src/App.tsx", ["useIdeSettings", "shortcutMatches", "saveActiveWithFormatting", "sessionRestoreAttemptedRef", "editorSettings={workspace.effectiveSettings.editor}"]);
hasAll("src-tauri/build.rs", ["rebuild_workspace_index", "load_workspace_settings", "save_recovery_snapshot"]);
hasAll("src-tauri/capabilities/default.json", ["allow-rebuild-workspace-index", "allow-load-workspace-settings", "allow-save-recovery-snapshot"]);

hasAll("src/types/devtools.ts", ["DevToolsNetworkEntry", "DevToolsStorageSnapshot", "DevToolsPerformanceSnapshot", "RuntimeAccessibilitySnapshot", "BundleAnalysis"]);
hasAll("src/components/DevToolsPanel.tsx", ["devtools.network", "devtools.storage", "devtools.performance", "devtools.accessibility", "analyzeProjectBundle", "devtools.storageSecurity"]);
hasAll("src/components/PreviewPane.tsx", ["devtools-network", "devtools-storage", "devtools-performance", "devtools-accessibility", "requestDevtools", "onDevToolsReady"]);
hasAll("src-tauri/src/devtools.rs", ["BundleAnalysis", "analyze_project_bundle", "MAX_BUNDLE_FILES", "clean_relative_path", "canonicalize", "file_type().is_symlink"]);
hasAll("src-tauri/src/preview.rs", ["network-devtools", "storage-devtools", "performance-devtools", "runtime-a11y", "[redacted]", "clearLocalStorage"]);
hasAll("src-tauri/src/generator.rs", ["network-devtools", "storage-devtools", "performance-devtools", "runtime-a11y", "[redacted]", "clearLocalStorage"]);
hasAll("src/lib/tauri.ts", ["analyzeProjectBundle", "analyze_project_bundle"]);
hasAll("src/App.tsx", ["DevToolsPanel", "project.devtools", "onDevToolsNetwork", "devToolsCommand"]);
hasAll("src/i18n/messages.ts", ["devtools.title", "devtools.network", "devtools.storageSecurity", "devtools.a11yNote", "palette.devtools"]);

hasAll("src/types/deploy.ts", ["DeployProviderId", "DeployConfig", "DeployProviderState", "DeployResult"]);
hasAll("src/components/DeployPanel.tsx", ["deploy.title", "storeDeployCredential", "generateGitHubPagesWorkflow", "deployProject", "deploy.secretBoundary"]);
hasAll("src-tauri/src/deploy.rs", ["SERVICE_NAME", "keyring", "NETLIFY_AUTH_TOKEN", "CLOUDFLARE_API_TOKEN", "VERCEL_TOKEN", "generate_github_pages_workflow", "require_terminal_allowed", "file_type().is_symlink"]);
hasAll("scripts/prepare-node-runtime.mjs", ["24.19.0", "SHASUMS256.txt", "sha256", "windows-x64", "linux-x64", "macos-x64", "macos-arm64"]);
hasAll("src-tauri/runtime/manifest.json", ["24.19.0", "prepared", "sha256"]);
hasAll(".github/workflows/release.yml", ["Prepare verified bundled Node runtime", "windows-x64", "linux-x64", "macos-arm64", "macos-x64"]);

assert(existsSync(resolve(root, "README.md")), "README.md is required");
hasAll("README.md", [
  "WebForge",
  "v1.0.0",
]);

hasAll("scripts/production-validate.mjs", ["initial JavaScript exceeds 1.5 MB budget", "production frontend must not ship source maps", "createUpdaterArtifacts", "object-src 'none'"]);
hasAll("scripts/verify-release-tag.mjs", ["v${pkg.version}", "stable"]);
hasAll("scripts/release-manifest.mjs", ["sha256", "webforge-release-manifest.json"]);
hasAll("src/App.tsx", ["lazy(() => import", "Suspense", "externalLspLoadedRef", "hasRunningLanguageServer", 'import("./monaco/lsp")']);
hasAll("src/components/CodeEditor.tsx", ['import "../monaco/setup"', "monaco-editor"]);
hasAll("vite.config.ts", ["manualChunks", "monaco", "terminal", "sourcemap: false"]);
hasAll("src/hooks/useWorkspace.ts", ["recovery?.version === 1 || recovery?.version === 2", "version: 2", 'appVersion: "1.0.0"']);
hasAll("src-tauri/src/release.rs", ["channel_accepts_version", "stable_rejects_prerelease_updates", "MAX_UPDATE_NOTES_CHARS", "Version::parse"]);
hasAll(".github/workflows/production-validation.yml", ["Production validation", "windows-x64", "macos-arm64", "--no-bundle"]);

const releaseWorkflow = read(".github/workflows/release.yml");
for (const target of ["Windows x64", "Linux x64", "macOS · Apple Silicon", "macOS · Intel", "windows-x64", "linux-x64", "macos-arm64", "macos-x64", "deb,appimage", "macos-15-intel"]) assert(releaseWorkflow.includes(target), `release matrix missing ${target}`);
for (const marker of ["release:", "types: [published]", "github.event.release.id", "github.event.release.tag_name", "releaseId:", "uploadUpdaterJson: false", "WINDOWS_CERTIFICATE", "APPLE_CERTIFICATE", "APPLE_SIGNING_IDENTITY=-"]) assert(releaseWorkflow.includes(marker), `browser release workflow missing ${marker}`);
assert(releaseWorkflow.includes("tauri-apps/tauri-action@action-v1.0.0"), "release action must be pinned to the tested Tauri action release");
assert(!existsSync(resolve(root, ".github/workflows/promote.yml")), "obsolete staging promotion workflow must not ship in v1.0.0");

console.log(`WebForge ${pkg.version} source verification passed (${englishKeys.size} localized keys).`);
