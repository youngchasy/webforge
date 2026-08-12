use crate::{
    security::{require_trusted, WorkspaceSecurityState},
    workspace::{clean_relative_path, workspace_root, WorkspaceState},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use tauri::State;

const EXTENSION_SCHEMA_VERSION: u32 = 1;
const EXTENSIONS_DIR: &str = ".webforge/extensions";
const STATE_FILE: &str = ".webforge/extensions-state.json";
const MANIFEST_FILE: &str = "webforge-extension.json";
const MAX_MANIFEST_BYTES: u64 = 512 * 1024;
const MAX_EXTENSIONS: usize = 64;
const MAX_COMMANDS: usize = 64;
const MAX_COMPONENTS: usize = 200;
const MAX_TEMPLATES: usize = 32;
const MAX_TEMPLATE_FILES: usize = 160;
const MAX_TEMPLATE_BYTES: usize = 3 * 1024 * 1024;
const MAX_SNIPPET_BYTES: usize = 128 * 1024;

const SUPPORTED_CAPABILITIES: &[&str] = &[
    "workspace.read",
    "workspace.write",
    "editor.commands",
    "ui.panels",
    "designer.components",
    "project.templates",
    "editor.theme",
    "project.adapters",
    "diagnostics.contribute",
    "formatters.contribute",
    "languages.contribute",
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ExtensionContributions {
    #[serde(default)]
    commands: Vec<ExtensionCommand>,
    #[serde(default)]
    panels: Vec<ExtensionPanel>,
    #[serde(default)]
    component_packs: Vec<ExtensionComponentPack>,
    #[serde(default)]
    templates: Vec<ExtensionTemplate>,
    #[serde(default)]
    themes: Vec<ExtensionTheme>,
    #[serde(default)]
    project_adapters: Vec<ExtensionProjectAdapter>,
    #[serde(default)]
    linters: Vec<ExtensionToolDescriptor>,
    #[serde(default)]
    formatters: Vec<ExtensionToolDescriptor>,
    #[serde(default)]
    languages: Vec<ExtensionLanguageDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionManifest {
    schema_version: u32,
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    publisher: String,
    #[serde(default)]
    capabilities: Vec<String>,
    #[serde(default)]
    contributes: ExtensionContributions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionPanel {
    id: String,
    title: String,
    #[serde(default)]
    body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionCommand {
    id: String,
    title: String,
    #[serde(default)]
    detail: String,
    #[serde(default)]
    capability: Option<String>,
    action: ExtensionCommandAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExtensionCommandAction {
    ShowMessage { message: String },
    OpenFile { path: String, #[serde(default)] line: Option<u32>, #[serde(default)] column: Option<u32> },
    CreateFile { path: String, #[serde(default)] content: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionComponentPack {
    id: String,
    label: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    components: Vec<ExtensionComponent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionComponent {
    id: String,
    label: String,
    #[serde(default)]
    category: String,
    snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionTemplate {
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default = "default_template_framework")]
    framework: String,
    #[serde(default)]
    files: Vec<ExtensionTemplateFile>,
}

fn default_template_framework() -> String { "static".into() }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionTemplateFile {
    path: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionTheme {
    id: String,
    label: String,
    #[serde(default)]
    tokens: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionProjectAdapter {
    id: String,
    label: String,
    #[serde(default)]
    detect_files: Vec<String>,
    #[serde(default)]
    framework: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionToolDescriptor {
    id: String,
    label: String,
    #[serde(default)]
    languages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionLanguageDescriptor {
    id: String,
    label: String,
    #[serde(default)]
    extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionContributionCounts {
    commands: usize,
    panels: usize,
    components: usize,
    templates: usize,
    themes: usize,
    project_adapters: usize,
    linters: usize,
    formatters: usize,
    languages: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionRecord {
    id: String,
    name: String,
    version: String,
    description: String,
    publisher: String,
    enabled: bool,
    requested_capabilities: Vec<String>,
    granted_capabilities: Vec<String>,
    missing_capabilities: Vec<String>,
    contributions: ExtensionContributionCounts,
    commands: Vec<ExtensionCommandSummary>,
    panels: Vec<ExtensionPanelSummary>,
    themes: Vec<ExtensionThemeSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCommandSummary {
    extension_id: String,
    id: String,
    title: String,
    detail: String,
    capability: Option<String>,
    available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionPanelSummary {
    extension_id: String,
    id: String,
    title: String,
    body: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionThemeSummary {
    extension_id: String,
    id: String,
    label: String,
    tokens: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCatalogEntry {
    id: String,
    name: String,
    version: String,
    description: String,
    publisher: String,
    installed: bool,
    capabilities: Vec<String>,
    contributions: ExtensionContributionCounts,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionComponentContribution {
    extension_id: String,
    pack_id: String,
    id: String,
    label: String,
    category: String,
    snippet: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionTemplateSummary {
    extension_id: String,
    id: String,
    name: String,
    description: String,
    framework: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedExtensionProject {
    path: String,
    name: String,
    extension_id: String,
    template_id: String,
    files_created: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ExtensionStateEntry {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    grants: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ExtensionStateFile {
    #[serde(default)]
    extensions: HashMap<String, ExtensionStateEntry>,
}

fn safe_identifier(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 96
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
}

fn safe_theme_token(name: &str) -> bool {
    matches!(
        name,
        "--bg-app"
            | "--bg-panel"
            | "--bg-panel-raised"
            | "--bg-hover"
            | "--bg-active"
            | "--line"
            | "--line-soft"
            | "--text"
            | "--text-muted"
            | "--text-faint"
            | "--accent"
            | "--accent-strong"
            | "--success"
            | "--warning"
            | "--danger"
    )
}

fn safe_web_color(value: &str) -> bool {
    let value = value.trim();
    if value.len() > 64 || value.is_empty() { return false; }
    value.starts_with('#')
        || value.starts_with("rgb(")
        || value.starts_with("rgba(")
        || value.starts_with("hsl(")
        || value.starts_with("hsla(")
        || value.starts_with("oklch(")
        || value.starts_with("color(")
        || value.starts_with("var(")
        || value.chars().all(|ch| ch.is_ascii_alphabetic() || ch == '-')
}

fn ensure_webforge_dir(root: &Path) -> Result<PathBuf, String> {
    let directory = root.join(".webforge");
    if directory.exists() {
        let metadata = fs::symlink_metadata(&directory).map_err(|error| format!("unable to inspect {}: {error}", directory.display()))?;
        if metadata.file_type().is_symlink() { return Err(".webforge may not be a symbolic link".into()); }
    } else {
        fs::create_dir(&directory).map_err(|error| format!("unable to create {}: {error}", directory.display()))?;
    }
    let canonical = fs::canonicalize(&directory).map_err(|error| format!("unable to resolve {}: {error}", directory.display()))?;
    if !canonical.starts_with(root) { return Err(".webforge escaped the workspace".into()); }
    Ok(canonical)
}

fn extensions_root(root: &Path, create: bool) -> Result<PathBuf, String> {
    let webforge = if create { ensure_webforge_dir(root)? } else { root.join(".webforge") };
    if !webforge.exists() { return Ok(webforge.join("extensions")); }
    let directory = webforge.join("extensions");
    if directory.exists() {
        let metadata = fs::symlink_metadata(&directory).map_err(|error| format!("unable to inspect {}: {error}", directory.display()))?;
        if metadata.file_type().is_symlink() { return Err("extension directory may not be a symbolic link".into()); }
    } else if create {
        fs::create_dir(&directory).map_err(|error| format!("unable to create {}: {error}", directory.display()))?;
    }
    if directory.exists() {
        let canonical = fs::canonicalize(&directory).map_err(|error| format!("unable to resolve {}: {error}", directory.display()))?;
        if !canonical.starts_with(root) { return Err("extension directory escaped the workspace".into()); }
        Ok(canonical)
    } else {
        Ok(directory)
    }
}

fn state_path(root: &Path, create: bool) -> Result<PathBuf, String> {
    let webforge = if create { ensure_webforge_dir(root)? } else { root.join(".webforge") };
    Ok(webforge.join("extensions-state.json"))
}

fn load_state(root: &Path) -> Result<ExtensionStateFile, String> {
    let path = state_path(root, false)?;
    if !path.is_file() { return Ok(ExtensionStateFile::default()); }
    let metadata = fs::symlink_metadata(&path).map_err(|error| format!("unable to inspect {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() { return Err("extension state file may not be a symbolic link".into()); }
    let raw = fs::read_to_string(&path).map_err(|error| format!("unable to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw).map_err(|error| format!("invalid extension state JSON: {error}"))
}

fn save_state(root: &Path, state: &ExtensionStateFile) -> Result<(), String> {
    let path = state_path(root, true)?;
    if path.exists() {
        let metadata = fs::symlink_metadata(&path).map_err(|error| format!("unable to inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() { return Err("extension state file may not be a symbolic link".into()); }
    }
    let json = serde_json::to_string_pretty(state).map_err(|error| error.to_string())? + "\n";
    fs::write(&path, json).map_err(|error| format!("unable to write {}: {error}", path.display()))
}

fn validate_manifest(manifest: &ExtensionManifest) -> Result<(), String> {
    if manifest.schema_version != EXTENSION_SCHEMA_VERSION { return Err(format!("unsupported extension schema version {}", manifest.schema_version)); }
    if !safe_identifier(&manifest.id) { return Err("extension id must contain only ASCII letters, numbers, '.', '-' or '_'".into()); }
    if manifest.name.trim().is_empty() || manifest.name.len() > 120 { return Err("extension name is invalid".into()); }
    if manifest.version.trim().is_empty() || manifest.version.len() > 48 { return Err("extension version is invalid".into()); }
    if manifest.description.len() > 4_096 || manifest.publisher.len() > 120 { return Err("extension metadata is too large".into()); }
    if manifest.capabilities.len() > SUPPORTED_CAPABILITIES.len() { return Err("extension requests too many capabilities".into()); }
    let mut seen_caps = HashSet::new();
    for capability in &manifest.capabilities {
        if !SUPPORTED_CAPABILITIES.contains(&capability.as_str()) { return Err(format!("unsupported extension capability: {capability}")); }
        if !seen_caps.insert(capability) { return Err(format!("duplicate extension capability: {capability}")); }
    }
    if manifest.contributes.commands.len() > MAX_COMMANDS { return Err("extension contributes too many commands".into()); }
    if !manifest.contributes.commands.is_empty() && !manifest.capabilities.iter().any(|value| value == "editor.commands") { return Err("extensions that contribute commands must request editor.commands".into()); }
    if manifest.contributes.panels.len() > 24 { return Err("extension contributes too many panels".into()); }
    if !manifest.contributes.panels.is_empty() && !manifest.capabilities.iter().any(|value| value == "ui.panels") { return Err("extensions that contribute panels must request ui.panels".into()); }
    for panel in &manifest.contributes.panels {
        if !safe_identifier(&panel.id) || panel.title.trim().is_empty() || panel.body.len() > 64 * 1024 { return Err("extension panel is invalid or too large".into()); }
    }
    if manifest.contributes.templates.len() > MAX_TEMPLATES { return Err("extension contributes too many templates".into()); }
    let mut command_ids = HashSet::new();
    for command in &manifest.contributes.commands {
        if !safe_identifier(&command.id) || command.title.trim().is_empty() { return Err("extension command id/title is invalid".into()); }
        if !command_ids.insert(&command.id) { return Err(format!("duplicate command id: {}", command.id)); }
        if let Some(capability) = &command.capability {
            if !manifest.capabilities.contains(capability) { return Err(format!("command {} requires capability not requested by the manifest", command.id)); }
        }
        match &command.action {
            ExtensionCommandAction::ShowMessage { message } => {
                if message.len() > 4_096 { return Err("extension command message is too large".into()); }
            }
            ExtensionCommandAction::OpenFile { path, .. } => {
                clean_relative_path(path)?;
                if command.capability.as_deref() != Some("workspace.read") { return Err(format!("command {} must require workspace.read", command.id)); }
            }
            ExtensionCommandAction::CreateFile { path, content } => {
                clean_relative_path(path)?;
                if content.len() > MAX_SNIPPET_BYTES { return Err("extension create-file payload is too large".into()); }
                if command.capability.as_deref() != Some("workspace.write") { return Err(format!("command {} must require workspace.write", command.id)); }
            }
        }
    }

    let component_count: usize = manifest.contributes.component_packs.iter().map(|pack| pack.components.len()).sum();
    if component_count > MAX_COMPONENTS { return Err("extension contributes too many components".into()); }
    for pack in &manifest.contributes.component_packs {
        if !safe_identifier(&pack.id) || pack.label.trim().is_empty() { return Err("component pack id/label is invalid".into()); }
        for component in &pack.components {
            if !safe_identifier(&component.id) || component.label.trim().is_empty() || component.snippet.len() > MAX_SNIPPET_BYTES {
                return Err("extension component is invalid or exceeds the snippet size limit".into());
            }
        }
    }

    for template in &manifest.contributes.templates {
        if !safe_identifier(&template.id) || template.name.trim().is_empty() { return Err("extension template id/name is invalid".into()); }
        if template.files.len() > MAX_TEMPLATE_FILES { return Err("extension template contains too many files".into()); }
        let mut bytes = 0usize;
        for file in &template.files {
            let clean = clean_relative_path(&file.path)?;
            if clean.as_os_str().is_empty() { return Err("extension template file path cannot be empty".into()); }
            bytes = bytes.saturating_add(file.content.len());
        }
        if bytes > MAX_TEMPLATE_BYTES { return Err("extension template is too large".into()); }
    }

    for theme in &manifest.contributes.themes {
        if !safe_identifier(&theme.id) || theme.label.trim().is_empty() { return Err("extension theme id/label is invalid".into()); }
        if theme.tokens.len() > 24 { return Err("extension theme has too many tokens".into()); }
        for (name, value) in &theme.tokens {
            if !safe_theme_token(name) || !safe_web_color(value) { return Err(format!("extension theme token is not allowed: {name}")); }
        }
    }

    for adapter in &manifest.contributes.project_adapters {
        if !safe_identifier(&adapter.id) || adapter.label.trim().is_empty() || adapter.detect_files.len() > 32 { return Err("extension project adapter is invalid".into()); }
        for path in &adapter.detect_files { clean_relative_path(path)?; }
    }
    for tool in manifest.contributes.linters.iter().chain(manifest.contributes.formatters.iter()) {
        if !safe_identifier(&tool.id) || tool.label.trim().is_empty() || tool.languages.len() > 32 { return Err("extension tool descriptor is invalid".into()); }
    }
    for language in &manifest.contributes.languages {
        if !safe_identifier(&language.id) || language.label.trim().is_empty() || language.extensions.len() > 32 { return Err("extension language descriptor is invalid".into()); }
    }
    Ok(())
}

fn read_manifest(path: &Path) -> Result<ExtensionManifest, String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| format!("unable to inspect {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() { return Err("extension manifest may not be a symbolic link".into()); }
    if metadata.len() > MAX_MANIFEST_BYTES { return Err("extension manifest exceeds the size limit".into()); }
    let raw = fs::read_to_string(path).map_err(|error| format!("unable to read {}: {error}", path.display()))?;
    let manifest: ExtensionManifest = serde_json::from_str(&raw).map_err(|error| format!("invalid extension manifest JSON: {error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn load_manifests(root: &Path) -> Result<Vec<ExtensionManifest>, String> {
    let directory = extensions_root(root, false)?;
    if !directory.is_dir() { return Ok(Vec::new()); }
    let mut manifests = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| format!("unable to read {}: {error}", directory.display()))? {
        if manifests.len() >= MAX_EXTENSIONS { break; }
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if !file_type.is_dir() || file_type.is_symlink() { continue; }
        let folder_name = entry.file_name().to_string_lossy().to_string();
        let manifest_path = entry.path().join(MANIFEST_FILE);
        if !manifest_path.is_file() { continue; }
        let manifest = read_manifest(&manifest_path)?;
        if manifest.id != folder_name { return Err(format!("extension manifest id {} must match directory name {folder_name}", manifest.id)); }
        manifests.push(manifest);
    }
    manifests.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(manifests)
}

fn contribution_counts(manifest: &ExtensionManifest) -> ExtensionContributionCounts {
    ExtensionContributionCounts {
        commands: manifest.contributes.commands.len(),
        panels: manifest.contributes.panels.len(),
        components: manifest.contributes.component_packs.iter().map(|pack| pack.components.len()).sum(),
        templates: manifest.contributes.templates.len(),
        themes: manifest.contributes.themes.len(),
        project_adapters: manifest.contributes.project_adapters.len(),
        linters: manifest.contributes.linters.len(),
        formatters: manifest.contributes.formatters.len(),
        languages: manifest.contributes.languages.len(),
    }
}

fn extension_record(manifest: &ExtensionManifest, state: Option<&ExtensionStateEntry>) -> ExtensionRecord {
    let enabled = state.map(|value| value.enabled).unwrap_or(false);
    let grants: HashSet<&str> = state.map(|value| value.grants.iter().map(String::as_str).collect()).unwrap_or_default();
    let granted_capabilities: Vec<String> = manifest.capabilities.iter().filter(|capability| grants.contains(capability.as_str())).cloned().collect();
    let missing_capabilities: Vec<String> = manifest.capabilities.iter().filter(|capability| !grants.contains(capability.as_str())).cloned().collect();
    let commands = manifest.contributes.commands.iter().map(|command| ExtensionCommandSummary {
        extension_id: manifest.id.clone(),
        id: command.id.clone(),
        title: command.title.clone(),
        detail: command.detail.clone(),
        capability: command.capability.clone(),
        available: enabled && grants.contains("editor.commands") && command.capability.as_ref().map(|value| grants.contains(value.as_str())).unwrap_or(true),
    }).collect();
    let panels = if enabled && grants.contains("ui.panels") {
        manifest.contributes.panels.iter().map(|panel| ExtensionPanelSummary { extension_id: manifest.id.clone(), id: panel.id.clone(), title: panel.title.clone(), body: panel.body.clone() }).collect()
    } else { Vec::new() };
    let themes = if enabled && grants.contains("editor.theme") {
        manifest.contributes.themes.iter().map(|theme| ExtensionThemeSummary { extension_id: manifest.id.clone(), id: theme.id.clone(), label: theme.label.clone(), tokens: theme.tokens.clone() }).collect()
    } else { Vec::new() };
    ExtensionRecord {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        description: manifest.description.clone(),
        publisher: manifest.publisher.clone(),
        enabled,
        requested_capabilities: manifest.capabilities.clone(),
        granted_capabilities,
        missing_capabilities,
        contributions: contribution_counts(manifest),
        commands,
        panels,
        themes,
    }
}

fn bundled_manifests() -> Vec<ExtensionManifest> {
    vec![
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "id": "webforge.starter-pack",
            "name": "WebForge Starter Pack",
            "version": "1.0.0",
            "publisher": "WebForge",
            "description": "Landing/dashboard templates and source-backed component packs for the declarative extension host.",
            "capabilities": ["designer.components", "project.templates", "editor.commands", "workspace.read", "ui.panels"],
            "contributes": {
                "panels": [{
                    "id": "starter.guide",
                    "title": "Starter Pack Guide",
                    "body": "This is a declarative extension panel. It can present trusted text content, but it cannot inject script or raw HTML into the WebForge WebView.\n\nGrant designer.components to expose the component pack and project.templates to expose the project templates."
                }],
                "commands": [{
                    "id": "starter.openReadme",
                    "title": "Starter Pack: Open README",
                    "detail": "Open the workspace README when it exists",
                    "capability": "workspace.read",
                    "action": { "type": "openFile", "path": "README.md", "line": 1, "column": 1 }
                }],
                "componentPacks": [{
                    "id": "starter-ui",
                    "label": "Starter UI",
                    "category": "Marketplace",
                    "components": [
                        { "id": "hero", "label": "Hero section", "category": "Sections", "snippet": "<section class=\"hero\"><h1>Build something great</h1><p>Start with WebForge.</p><a href=\"#content\">Get started</a></section>" },
                        { "id": "feature-grid", "label": "Feature grid", "category": "Sections", "snippet": "<section class=\"feature-grid\"><article><h2>Fast</h2><p>Ship quickly.</p></article><article><h2>Accessible</h2><p>Use semantic markup.</p></article><article><h2>Responsive</h2><p>Adapt everywhere.</p></article></section>" },
                        { "id": "stat-card", "label": "Stat card", "category": "Dashboard", "snippet": "<article class=\"stat-card\"><span>Conversion</span><strong>12.8%</strong><small>+2.4% this week</small></article>" }
                    ]
                }],
                "templates": [
                    {
                        "id": "landing",
                        "name": "Product Landing",
                        "description": "A dependency-free responsive landing page.",
                        "framework": "static",
                        "files": [
                            { "path": "index.html", "content": "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <meta name=\"description\" content=\"{{name}} product landing page\">\n  <title>{{name}}</title>\n  <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n  <main class=\"shell\">\n    <p class=\"eyebrow\">{{name}}</p>\n    <h1>Turn your idea into a polished web experience.</h1>\n    <p class=\"lede\">A clean WebForge marketplace template with no runtime dependencies.</p>\n    <a class=\"cta\" href=\"#features\">Explore features</a>\n    <section id=\"features\" class=\"grid\">\n      <article><h2>Design</h2><p>Edit visually without losing source control.</p></article>\n      <article><h2>Debug</h2><p>Run tests and browser debugging from one workbench.</p></article>\n      <article><h2>Ship</h2><p>Keep production output separate from IDE instrumentation.</p></article>\n    </section>\n  </main>\n</body>\n</html>\n" },
                            { "path": "styles.css", "content": ":root{font-family:Inter,system-ui,sans-serif;color:#eef2ff;background:#0f172a}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#1e293b,#0f172a 55%)}.shell{width:min(1040px,calc(100% - 40px));margin:auto;padding:96px 0}.eyebrow{color:#93c5fd;text-transform:uppercase;letter-spacing:.16em;font-weight:700}h1{max-width:850px;font-size:clamp(3rem,8vw,6.5rem);line-height:.95;margin:.25em 0}.lede{max-width:620px;color:#cbd5e1;font-size:1.2rem;line-height:1.7}.cta{display:inline-block;margin:24px 0 64px;padding:12px 18px;border-radius:999px;background:#dbeafe;color:#0f172a;text-decoration:none;font-weight:800}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.grid article{padding:24px;border:1px solid #334155;border-radius:18px;background:#172033}.grid p{color:#aebbd0;line-height:1.6}\n" },
                            { "path": "README.md", "content": "# {{name}}\n\nCreated from the WebForge Starter Pack extension template.\n" }
                        ]
                    },
                    {
                        "id": "dashboard",
                        "name": "Dashboard Shell",
                        "description": "A compact static dashboard layout.",
                        "framework": "static",
                        "files": [
                            { "path": "index.html", "content": "<!doctype html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>{{name}} Dashboard</title><link rel=\"stylesheet\" href=\"styles.css\"></head><body><aside><strong>{{name}}</strong><nav><a href=\"#overview\">Overview</a><a href=\"#activity\">Activity</a></nav></aside><main><header><p>Workspace</p><h1>Overview</h1></header><section id=\"overview\" class=\"cards\"><article><span>Revenue</span><strong>$24,480</strong></article><article><span>Users</span><strong>8,203</strong></article><article><span>Conversion</span><strong>12.8%</strong></article></section></main></body></html>" },
                            { "path": "styles.css", "content": "*{box-sizing:border-box}body{margin:0;display:grid;grid-template-columns:220px 1fr;min-height:100vh;font-family:Inter,system-ui,sans-serif;background:#f6f7fb;color:#182033}aside{padding:28px;background:#111827;color:white}nav{display:grid;gap:10px;margin-top:32px}nav a{color:#cbd5e1;text-decoration:none}main{padding:36px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.cards article{display:grid;gap:10px;padding:24px;border:1px solid #dde2ea;border-radius:16px;background:white}.cards span{color:#697386}.cards strong{font-size:2rem}@media(max-width:760px){body{grid-template-columns:1fr}aside{display:none}.cards{grid-template-columns:1fr}}" }
                        ]
                    }
                ]
            }
        })).expect("bundled starter extension is valid JSON"),
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "id": "webforge.accessible-components",
            "name": "Accessible Components",
            "version": "1.0.0",
            "publisher": "WebForge",
            "description": "Semantic component snippets designed for the WebForge Visual Designer.",
            "capabilities": ["designer.components"],
            "contributes": {
                "componentPacks": [{
                    "id": "a11y",
                    "label": "Accessible UI",
                    "category": "Accessibility",
                    "components": [
                        { "id": "skip-link", "label": "Skip link", "category": "Accessibility", "snippet": "<a class=\"skip-link\" href=\"#main-content\">Skip to main content</a>" },
                        { "id": "labeled-field", "label": "Labeled field", "category": "Forms", "snippet": "<label class=\"field\"><span>Email address</span><input type=\"email\" name=\"email\" autocomplete=\"email\" required></label>" },
                        { "id": "status-region", "label": "Status region", "category": "Accessibility", "snippet": "<div role=\"status\" aria-live=\"polite\">Ready</div>" }
                    ]
                }]
            }
        })).expect("bundled accessibility extension is valid JSON"),
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "id": "webforge.midnight-theme",
            "name": "Midnight Theme",
            "version": "1.0.0",
            "publisher": "WebForge",
            "description": "A declarative token theme demonstrating editor.theme capability isolation.",
            "capabilities": ["editor.theme"],
            "contributes": {
                "themes": [{
                    "id": "midnight-blue",
                    "label": "Midnight Blue",
                    "tokens": {
                        "--bg-app": "#080d16",
                        "--bg-panel": "#0d1420",
                        "--bg-panel-raised": "#121c2b",
                        "--bg-hover": "#18263a",
                        "--bg-active": "#20324d",
                        "--line": "#20304a",
                        "--line-soft": "#17243a",
                        "--text": "#dbeafe",
                        "--text-muted": "#8fa5c4",
                        "--text-faint": "#607796",
                        "--accent": "#60a5fa",
                        "--accent-strong": "#93c5fd"
                    }
                }]
            }
        })).expect("bundled theme extension is valid JSON"),
    ]
}

fn find_manifest<'a>(manifests: &'a [ExtensionManifest], extension_id: &str) -> Result<&'a ExtensionManifest, String> {
    manifests.iter().find(|manifest| manifest.id == extension_id).ok_or_else(|| format!("extension not found: {extension_id}"))
}

fn state_for<'a>(state: &'a ExtensionStateFile, extension_id: &str) -> Option<&'a ExtensionStateEntry> {
    state.extensions.get(extension_id)
}

fn require_extension_enabled<'a>(manifest: &'a ExtensionManifest, state: &'a ExtensionStateFile) -> Result<&'a ExtensionStateEntry, String> {
    let entry = state.extensions.get(&manifest.id).ok_or_else(|| "extension is not enabled".to_string())?;
    if !entry.enabled { return Err("extension is disabled".into()); }
    Ok(entry)
}

fn require_grant(entry: &ExtensionStateEntry, capability: &str) -> Result<(), String> {
    if entry.grants.iter().any(|value| value == capability) { Ok(()) } else { Err(format!("extension capability is not granted: {capability}")) }
}

#[tauri::command]
pub fn list_extensions(state: State<'_, WorkspaceState>) -> Result<Vec<ExtensionRecord>, String> {
    let root = workspace_root(&state)?;
    let manifests = load_manifests(&root)?;
    let extension_state = load_state(&root)?;
    Ok(manifests.iter().map(|manifest| extension_record(manifest, state_for(&extension_state, &manifest.id))).collect())
}

#[tauri::command]
pub fn list_extension_catalog(state: State<'_, WorkspaceState>) -> Result<Vec<ExtensionCatalogEntry>, String> {
    let root = workspace_root(&state)?;
    let installed: HashSet<String> = load_manifests(&root)?.into_iter().map(|manifest| manifest.id).collect();
    let mut entries = Vec::new();
    for manifest in bundled_manifests() {
        validate_manifest(&manifest)?;
        entries.push(ExtensionCatalogEntry {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            version: manifest.version.clone(),
            description: manifest.description.clone(),
            publisher: manifest.publisher.clone(),
            installed: installed.contains(&manifest.id),
            capabilities: manifest.capabilities.clone(),
            contributions: contribution_counts(&manifest),
        });
    }
    Ok(entries)
}

#[tauri::command]
pub fn install_bundled_extension(
    extension_id: String,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<(), String> {
    require_trusted(&security)?;
    if !safe_identifier(&extension_id) { return Err("invalid extension id".into()); }
    let root = workspace_root(&workspace)?;
    let manifest = bundled_manifests().into_iter().find(|manifest| manifest.id == extension_id).ok_or_else(|| "bundled extension is not available".to_string())?;
    validate_manifest(&manifest)?;
    let directory = extensions_root(&root, true)?.join(&manifest.id);
    if directory.exists() {
        let metadata = fs::symlink_metadata(&directory).map_err(|error| format!("unable to inspect {}: {error}", directory.display()))?;
        if metadata.file_type().is_symlink() { return Err("extension directory may not be a symbolic link".into()); }
    } else {
        fs::create_dir(&directory).map_err(|error| format!("unable to create {}: {error}", directory.display()))?;
    }
    let path = directory.join(MANIFEST_FILE);
    if path.exists() {
        let metadata = fs::symlink_metadata(&path).map_err(|error| format!("unable to inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() { return Err("extension manifest may not be a symbolic link".into()); }
    }
    let canonical_directory = fs::canonicalize(&directory).map_err(|error| format!("unable to resolve {}: {error}", directory.display()))?;
    let canonical_extensions = fs::canonicalize(extensions_root(&root, false)?).map_err(|error| format!("unable to resolve extension root: {error}"))?;
    if !canonical_directory.starts_with(&canonical_extensions) { return Err("extension directory escaped the workspace".into()); }
    let json = serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())? + "\n";
    fs::write(&path, json).map_err(|error| format!("unable to install extension: {error}"))?;
    let mut state = load_state(&root)?;
    state.extensions.entry(manifest.id.clone()).or_insert(ExtensionStateEntry { enabled: true, grants: Vec::new() }).enabled = true;
    save_state(&root, &state)
}

#[tauri::command]
pub fn uninstall_extension(
    extension_id: String,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<(), String> {
    require_trusted(&security)?;
    if !safe_identifier(&extension_id) { return Err("invalid extension id".into()); }
    let root = workspace_root(&workspace)?;
    let directory = extensions_root(&root, false)?.join(&extension_id);
    if directory.exists() {
        let metadata = fs::symlink_metadata(&directory).map_err(|error| format!("unable to inspect {}: {error}", directory.display()))?;
        if metadata.file_type().is_symlink() { return Err("extension directory may not be a symbolic link".into()); }
        let canonical = fs::canonicalize(&directory).map_err(|error| format!("unable to resolve {}: {error}", directory.display()))?;
        let extension_root = fs::canonicalize(extensions_root(&root, false)?).map_err(|error| error.to_string())?;
        if !canonical.starts_with(&extension_root) { return Err("extension directory escaped the workspace".into()); }
        fs::remove_dir_all(&canonical).map_err(|error| format!("unable to remove extension: {error}"))?;
    }
    let mut state = load_state(&root)?;
    state.extensions.remove(&extension_id);
    save_state(&root, &state)
}

#[tauri::command]
pub fn set_extension_enabled(
    extension_id: String,
    enabled: bool,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<(), String> {
    require_trusted(&security)?;
    let root = workspace_root(&workspace)?;
    let manifests = load_manifests(&root)?;
    find_manifest(&manifests, &extension_id)?;
    let mut state = load_state(&root)?;
    state.extensions.entry(extension_id).or_default().enabled = enabled;
    save_state(&root, &state)
}

#[tauri::command]
pub fn set_extension_capability(
    extension_id: String,
    capability: String,
    granted: bool,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<(), String> {
    require_trusted(&security)?;
    if !SUPPORTED_CAPABILITIES.contains(&capability.as_str()) { return Err("unsupported extension capability".into()); }
    let root = workspace_root(&workspace)?;
    let manifests = load_manifests(&root)?;
    let manifest = find_manifest(&manifests, &extension_id)?;
    if !manifest.capabilities.contains(&capability) { return Err("extension did not request this capability".into()); }
    let mut state = load_state(&root)?;
    let entry = state.extensions.entry(extension_id).or_default();
    entry.grants.retain(|value| SUPPORTED_CAPABILITIES.contains(&value.as_str()));
    if granted {
        if !entry.grants.contains(&capability) { entry.grants.push(capability); }
    } else {
        entry.grants.retain(|value| value != &capability);
    }
    save_state(&root, &state)
}

#[tauri::command]
pub fn list_extension_components(
    state: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<Vec<ExtensionComponentContribution>, String> {
    require_trusted(&security)?;
    let root = workspace_root(&state)?;
    let manifests = load_manifests(&root)?;
    let extension_state = load_state(&root)?;
    let mut output = Vec::new();
    for manifest in manifests {
        let entry = match require_extension_enabled(&manifest, &extension_state) { Ok(value) => value, Err(_) => continue };
        if require_grant(entry, "designer.components").is_err() { continue; }
        for pack in manifest.contributes.component_packs {
            for component in pack.components {
                output.push(ExtensionComponentContribution {
                    extension_id: manifest.id.clone(), pack_id: pack.id.clone(), id: component.id,
                    label: component.label, category: if component.category.is_empty() { pack.category.clone() } else { component.category }, snippet: component.snippet,
                });
            }
        }
    }
    Ok(output)
}

#[tauri::command]
pub fn list_extension_templates(
    state: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<Vec<ExtensionTemplateSummary>, String> {
    require_trusted(&security)?;
    let root = workspace_root(&state)?;
    let manifests = load_manifests(&root)?;
    let extension_state = load_state(&root)?;
    let mut output = Vec::new();
    for manifest in manifests {
        let entry = match require_extension_enabled(&manifest, &extension_state) { Ok(value) => value, Err(_) => continue };
        if require_grant(entry, "project.templates").is_err() { continue; }
        for template in manifest.contributes.templates {
            output.push(ExtensionTemplateSummary { extension_id: manifest.id.clone(), id: template.id, name: template.name, description: template.description, framework: template.framework });
        }
    }
    Ok(output)
}

#[tauri::command]
pub fn run_extension_command(
    extension_id: String,
    command_id: String,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<ExtensionCommandAction, String> {
    require_trusted(&security)?;
    let root = workspace_root(&workspace)?;
    let manifests = load_manifests(&root)?;
    let extension_state = load_state(&root)?;
    let manifest = find_manifest(&manifests, &extension_id)?;
    let entry = require_extension_enabled(manifest, &extension_state)?;
    let command = manifest.contributes.commands.iter().find(|command| command.id == command_id).ok_or_else(|| "extension command not found".to_string())?;
    require_grant(entry, "editor.commands")?;
    if let Some(capability) = &command.capability { require_grant(entry, capability)?; }
    Ok(command.action.clone())
}

fn validate_project_name(value: &str) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty() || name == "." || name == ".." { return Err("project name is required".into()); }
    if name.len() > 120 || name.chars().any(|ch| matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')) { return Err("project name contains invalid characters".into()); }
    if name.ends_with('.') || name.ends_with(' ') { return Err("project name cannot end with a dot or space".into()); }
    Ok(name.to_string())
}

fn replace_template_variables(value: &str, name: &str) -> String { value.replace("{{name}}", name) }

#[tauri::command]
pub fn create_extension_project(
    extension_id: String,
    template_id: String,
    parent_path: String,
    name: String,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<CreatedExtensionProject, String> {
    require_trusted(&security)?;
    let workspace_root_path = workspace_root(&workspace)?;
    let manifests = load_manifests(&workspace_root_path)?;
    let extension_state = load_state(&workspace_root_path)?;
    let manifest = find_manifest(&manifests, &extension_id)?;
    let entry = require_extension_enabled(manifest, &extension_state)?;
    require_grant(entry, "project.templates")?;
    let template = manifest.contributes.templates.iter().find(|template| template.id == template_id).ok_or_else(|| "extension project template not found".to_string())?;
    let name = validate_project_name(&name)?;
    let parent = fs::canonicalize(Path::new(&parent_path)).map_err(|error| format!("unable to resolve project parent: {error}"))?;
    if !parent.is_dir() { return Err("project parent is not a directory".into()); }
    let target = parent.join(&name);
    if target.exists() { return Err("project target already exists".into()); }
    fs::create_dir(&target).map_err(|error| format!("unable to create project directory: {error}"))?;
    let target_root = fs::canonicalize(&target).map_err(|error| format!("unable to resolve project directory: {error}"))?;
    let mut created = 0usize;
    let result = (|| -> Result<(), String> {
        for file in &template.files {
            let relative = clean_relative_path(&file.path)?;
            if relative.as_os_str().is_empty() { return Err("extension template file path cannot be empty".into()); }
            let destination = target_root.join(relative);
            if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| format!("unable to create template directory: {error}"))?; }
            if let Some(parent) = destination.parent() {
                let canonical_parent = fs::canonicalize(parent).map_err(|error| format!("unable to resolve template parent: {error}"))?;
                if !canonical_parent.starts_with(&target_root) { return Err("extension template path escaped the project target".into()); }
            }
            fs::write(&destination, replace_template_variables(&file.content, &name)).map_err(|error| format!("unable to write {}: {error}", destination.display()))?;
            created += 1;
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&target_root);
        return Err(error);
    }
    Ok(CreatedExtensionProject { path: target_root.to_string_lossy().to_string(), name, extension_id, template_id, files_created: created })
}

#[cfg(test)]
mod tests {
    use super::{bundled_manifests, clean_relative_path, safe_identifier, validate_manifest};

    #[test]
    fn bundled_extension_manifests_validate() {
        for manifest in bundled_manifests() { validate_manifest(&manifest).unwrap(); }
    }

    #[test]
    fn rejects_unsafe_extension_identifiers() {
        assert!(safe_identifier("publisher.extension"));
        assert!(!safe_identifier("../escape"));
        assert!(!safe_identifier("bad id"));
    }

    #[test]
    fn template_paths_use_workspace_path_rules() {
        assert!(clean_relative_path("src/index.html").is_ok());
        assert!(clean_relative_path("../outside.txt").is_err());
    }
}
