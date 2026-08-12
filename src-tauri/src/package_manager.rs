use crate::{
    project::detect_project_at,
    runtime::{choose_manager, environment, resolve_tool},
    security::{require_terminal_allowed, WorkspaceSecurityState},
    workspace::{workspace_root, WorkspaceState},
};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::{fs, process::Command};
use tauri::{AppHandle, State};

const MAX_COMMAND_OUTPUT: usize = 512 * 1024;
const MAX_PACKAGE_SPEC: usize = 220;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageDependency {
    name: String,
    requested: String,
    kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageScript {
    name: String,
    command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageManifest {
    available: bool,
    manager: Option<String>,
    package_manager_field: Option<String>,
    lockfile: Option<String>,
    dependencies: Vec<PackageDependency>,
    scripts: Vec<PackageScript>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageOutdatedEntry {
    name: String,
    current: Option<String>,
    wanted: Option<String>,
    latest: Option<String>,
    kind: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageCommandResult {
    success: bool,
    exit_code: Option<i32>,
    command: String,
    output: String,
    outdated: Vec<PackageOutdatedEntry>,
}

fn bounded_output(stdout: &[u8], stderr: &[u8]) -> String {
    let mut text = String::new();
    if !stdout.is_empty() { text.push_str(&String::from_utf8_lossy(stdout)); }
    if !stderr.is_empty() {
        if !text.is_empty() && !text.ends_with('\n') { text.push('\n'); }
        text.push_str(&String::from_utf8_lossy(stderr));
    }
    if text.len() > MAX_COMMAND_OUTPUT {
        let mut start = text.len() - MAX_COMMAND_OUTPUT;
        while start < text.len() && !text.is_char_boundary(start) { start += 1; }
        format!("[output truncated]\n{}", &text[start..])
    } else { text }
}

fn package_spec(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_PACKAGE_SPEC || trimmed.starts_with('-') || trimmed.contains(char::is_whitespace) {
        return Err("invalid package name/specifier".into());
    }
    let pattern = Regex::new(r"^(?:@[A-Za-z0-9_.-]+/)?[A-Za-z0-9_.-]+(?:@[^\s]+)?$").map_err(|error| error.to_string())?;
    if !pattern.is_match(trimmed) { return Err("invalid package name/specifier".into()); }
    Ok(trimmed.to_string())
}

fn manager_for(app: &AppHandle, root: &std::path::Path) -> Result<String, String> {
    let project = detect_project_at(root)?;
    choose_manager(&project, &environment(app))
}

fn lifecycle_flag(manager: &str, allow_lifecycle_scripts: bool) -> Option<String> {
    if allow_lifecycle_scripts { None } else {
        match manager {
            "npm" | "pnpm" | "yarn" | "bun" => Some("--ignore-scripts".into()),
            _ => None,
        }
    }
}

fn run_manager(app: &AppHandle, root: &std::path::Path, manager: &str, args: &[String]) -> Result<PackageCommandResult, String> {
    let tool = resolve_tool(app, manager);
    let output = Command::new(&tool.executable)
        .args(args)
        .current_dir(root)
        .env("CI", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| format!("unable to run {manager}: {error}"))?;
    let command = format!("{} {}", manager, args.join(" "));
    let text = bounded_output(&output.stdout, &output.stderr);
    Ok(PackageCommandResult {
        success: output.status.success(),
        exit_code: output.status.code(),
        command,
        output: text,
        outdated: Vec::new(),
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn parse_outdated(value: &Value) -> Vec<PackageOutdatedEntry> {
    let mut entries = Vec::new();
    if let Some(object) = value.as_object() {
        for (name, item) in object {
            if !item.is_object() { continue; }
            entries.push(PackageOutdatedEntry {
                name: name.clone(),
                current: string_field(item, "current"),
                wanted: string_field(item, "wanted"),
                latest: string_field(item, "latest"),
                kind: string_field(item, "type").map(|kind| if kind.to_ascii_lowercase().contains("dev") { "devDependency".into() } else { "dependency".into() }),
            });
        }
    } else if let Some(array) = value.as_array() {
        for item in array {
            let Some(name) = string_field(item, "name").or_else(|| string_field(item, "package")) else { continue; };
            entries.push(PackageOutdatedEntry {
                name,
                current: string_field(item, "current"),
                wanted: string_field(item, "wanted").or_else(|| string_field(item, "compatible")),
                latest: string_field(item, "latest"),
                kind: string_field(item, "type").map(|kind| if kind.to_ascii_lowercase().contains("dev") { "devDependency".into() } else { "dependency".into() }),
            });
        }
    }
    entries.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    entries
}

#[tauri::command]
pub fn get_package_manifest(app: AppHandle, state: State<'_, WorkspaceState>) -> Result<PackageManifest, String> {
    let root = workspace_root(&state)?;
    let package_path = root.join("package.json");
    if !package_path.is_file() {
        return Ok(PackageManifest { available: false, manager: None, package_manager_field: None, lockfile: None, dependencies: Vec::new(), scripts: Vec::new() });
    }
    let raw = fs::read_to_string(&package_path).map_err(|error| error.to_string())?;
    let value: Value = serde_json::from_str(&raw).map_err(|error| format!("invalid package.json: {error}"))?;
    let package_manager_field = string_field(&value, "packageManager");
    let project = detect_project_at(&root)?;
    let manager = choose_manager(&project, &environment(&app)).ok();
    let lockfile = [
        ("pnpm-lock.yaml", "pnpm-lock.yaml"), ("yarn.lock", "yarn.lock"), ("bun.lock", "bun.lock"), ("bun.lockb", "bun.lockb"), ("package-lock.json", "package-lock.json"),
    ].into_iter().find(|(file, _)| root.join(file).is_file()).map(|(_, label)| label.to_string());
    let mut dependencies = Vec::new();
    for (key, kind) in [("dependencies", "dependency"), ("devDependencies", "devDependency")] {
        if let Some(object) = value.get(key).and_then(Value::as_object) {
            for (name, requested) in object {
                dependencies.push(PackageDependency { name: name.clone(), requested: requested.as_str().unwrap_or("").to_string(), kind: kind.into() });
            }
        }
    }
    dependencies.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    let mut scripts = value.get("scripts").and_then(Value::as_object).map(|object| object.iter().filter_map(|(name, command)| command.as_str().map(|command| PackageScript { name: name.clone(), command: command.to_string() })).collect::<Vec<_>>()).unwrap_or_default();
    scripts.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(PackageManifest { available: true, manager, package_manager_field, lockfile, dependencies, scripts })
}

#[tauri::command]
pub fn package_install(
    app: AppHandle,
    name: String,
    dev: bool,
    allow_lifecycle_scripts: bool,
    state: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<PackageCommandResult, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    let manager = manager_for(&app, &root)?;
    let name = package_spec(&name)?;
    let mut args = match manager.as_str() {
        "npm" => vec!["install".into(), name],
        "pnpm" | "yarn" | "bun" => vec!["add".into(), name],
        _ => return Err("unsupported package manager".into()),
    };
    if dev { args.push(if manager == "npm" { "--save-dev".into() } else if manager == "bun" { "--dev".into() } else { "-D".into() }); }
    if let Some(flag) = lifecycle_flag(&manager, allow_lifecycle_scripts) { args.push(flag); }
    run_manager(&app, &root, &manager, &args)
}

#[tauri::command]
pub fn package_remove(
    app: AppHandle,
    name: String,
    allow_lifecycle_scripts: bool,
    state: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<PackageCommandResult, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    let manager = manager_for(&app, &root)?;
    let name = package_spec(&name)?;
    let mut args = vec![if manager == "npm" { "uninstall".into() } else { "remove".into() }, name];
    if let Some(flag) = lifecycle_flag(&manager, allow_lifecycle_scripts) { args.push(flag); }
    run_manager(&app, &root, &manager, &args)
}

#[tauri::command]
pub fn package_update(
    app: AppHandle,
    name: Option<String>,
    allow_lifecycle_scripts: bool,
    state: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<PackageCommandResult, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    let manager = manager_for(&app, &root)?;
    let mut args = vec![match manager.as_str() { "yarn" => "upgrade".into(), _ => "update".into() }];
    if let Some(name) = name.filter(|value| !value.trim().is_empty()) { args.push(package_spec(&name)?); }
    if let Some(flag) = lifecycle_flag(&manager, allow_lifecycle_scripts) { args.push(flag); }
    run_manager(&app, &root, &manager, &args)
}

#[tauri::command]
pub fn package_outdated(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<PackageCommandResult, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    let manager = manager_for(&app, &root)?;
    let args: Vec<String> = match manager.as_str() {
        "npm" | "pnpm" | "bun" => vec!["outdated".into(), "--json".into()],
        "yarn" => vec!["outdated".into(), "--json".into()],
        _ => return Err("unsupported package manager".into()),
    };
    let mut result = run_manager(&app, &root, &manager, &args)?;
    let json_candidate = result.output.lines().find(|line| line.trim_start().starts_with('{') || line.trim_start().starts_with('[')).unwrap_or(&result.output);
    if let Ok(value) = serde_json::from_str::<Value>(json_candidate) { result.outdated = parse_outdated(&value); }
    Ok(result)
}

#[tauri::command]
pub fn package_security_audit(
    app: AppHandle,
    state: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<PackageCommandResult, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    let manager = manager_for(&app, &root)?;
    let args: Vec<String> = match manager.as_str() {
        "npm" | "pnpm" => vec!["audit".into(), "--json".into()],
        "yarn" => vec!["audit".into(), "--json".into()],
        "bun" => vec!["audit".into()],
        _ => return Err("unsupported package manager".into()),
    };
    run_manager(&app, &root, &manager, &args)
}
