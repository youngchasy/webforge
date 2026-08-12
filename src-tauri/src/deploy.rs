use crate::{
    project::detect_project_at,
    runtime::resolve_tool,
    security::{require_terminal_allowed, require_trusted, WorkspaceSecurityState},
    workspace::{clean_relative_path, workspace_root, WorkspaceState},
};
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}, process::{Command, Stdio}};
use tauri::State;

const SERVICE_NAME: &str = "dev.webforge.desktop.deploy";
const MAX_DEPLOY_OUTPUT: usize = 128 * 1024;
const MAX_SECRET_LEN: usize = 4096;
const DEPLOY_CONFIG_PATH: &str = ".webforge/deploy.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeployProviderConfig {
    #[serde(default)] pub output_dir: String,
    #[serde(default)] pub project_name: String,
    #[serde(default)] pub account_id: String,
    #[serde(default)] pub site_id: String,
    #[serde(default)] pub production: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeployConfig {
    #[serde(default)] pub github_pages: DeployProviderConfig,
    #[serde(default)] pub cloudflare: DeployProviderConfig,
    #[serde(default)] pub netlify: DeployProviderConfig,
    #[serde(default)] pub vercel: DeployProviderConfig,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployProviderState {
    id: String,
    cli_available: bool,
    cli_version: Option<String>,
    credential_stored: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployResult {
    provider: String,
    success: bool,
    command: String,
    output: String,
    url: Option<String>,
}

fn provider_secret_key(provider: &str) -> Result<&'static str, String> {
    match provider {
        "cloudflare" => Ok("cloudflare-api-token"),
        "netlify" => Ok("netlify-auth-token"),
        "vercel" => Ok("vercel-token"),
        _ => Err("this deploy provider does not use a stored credential".into()),
    }
}

fn credential_entry(provider: &str) -> Result<Entry, String> {
    let key = provider_secret_key(provider)?;
    Entry::new(SERVICE_NAME, key).map_err(|error| format!("unable to access OS credential store: {error}"))
}

fn credential_exists(provider: &str) -> bool {
    credential_entry(provider).and_then(|entry| entry.get_password().map_err(|error| error.to_string())).is_ok()
}

fn load_secret(provider: &str) -> Result<String, String> {
    credential_entry(provider)?.get_password().map_err(|error| format!("no credential stored for {provider}: {error}"))
}

fn cli_command(name: &str) -> String {
    #[cfg(target_os = "windows")]
    { format!("{name}.cmd") }
    #[cfg(not(target_os = "windows"))]
    { name.to_string() }
}

fn probe_cli(name: &str) -> (bool, Option<String>) {
    match Command::new(cli_command(name)).arg("--version").stdout(Stdio::piped()).stderr(Stdio::piped()).output() {
        Ok(output) if output.status.success() => {
            let raw = if output.stdout.is_empty() { output.stderr } else { output.stdout };
            (true, String::from_utf8_lossy(&raw).trim().lines().next().map(str::to_string))
        }
        _ => (false, None),
    }
}

fn ensure_simple(value: &str, label: &str, max: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > max || !value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return Err(format!("invalid {label}"));
    }
    Ok(value.to_string())
}

fn resolve_output(root: &Path, configured: &str, fallback: &str) -> Result<(PathBuf, String), String> {
    let relative = if configured.trim().is_empty() { fallback } else { configured.trim() };
    let clean = clean_relative_path(relative)?;
    if clean.as_os_str().is_empty() { return Err("deploy output must be a workspace subdirectory".into()); }
    let candidate = root.join(&clean);
    let metadata = fs::symlink_metadata(&candidate).map_err(|_| format!("deploy output {} does not exist; run a production build first", relative))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() { return Err("deploy output must be a real directory, not a symlink".into()); }
    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let canonical = fs::canonicalize(&candidate).map_err(|error| error.to_string())?;
    if !canonical.starts_with(&canonical_root) { return Err("deploy output escaped the workspace".into()); }
    Ok((canonical, clean.to_string_lossy().replace('\\', "/")))
}

fn bounded_output(output: std::process::Output) -> String {
    let mut value = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        if !value.is_empty() { value.push('\n'); }
        value.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    if value.len() > MAX_DEPLOY_OUTPUT { value.truncate(MAX_DEPLOY_OUTPUT); value.push_str("\n[output truncated]"); }
    value
}

fn first_https_url(value: &str) -> Option<String> {
    value.split_whitespace().map(|item| item.trim_matches(|c: char| matches!(c, '"' | '\'' | '(' | ')' | ','))).find(|item| item.starts_with("https://")).map(str::to_string)
}

fn read_config(root: &Path) -> Result<DeployConfig, String> {
    let path = root.join(DEPLOY_CONFIG_PATH);
    match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() { return Err("deploy config must be a regular workspace file".into()); }
            let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
            if raw.len() > 64 * 1024 { return Err("deploy config is too large".into()); }
            serde_json::from_str(&raw).map_err(|error| format!("invalid .webforge/deploy.json: {error}"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(DeployConfig::default()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn get_deploy_config(workspace: State<'_, WorkspaceState>) -> Result<DeployConfig, String> {
    read_config(&workspace_root(&workspace)?)
}

#[tauri::command]
pub fn save_deploy_config(config: DeployConfig, workspace: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<(), String> {
    require_trusted(&security)?;
    let root = workspace_root(&workspace)?;
    let dir = root.join(".webforge");
    match fs::symlink_metadata(&dir) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => return Err(".webforge must be a real directory".into()),
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir(&dir).map_err(|error| error.to_string())?,
        Err(error) => return Err(error.to_string()),
    }
    let path = root.join(DEPLOY_CONFIG_PATH);
    if let Ok(metadata) = fs::symlink_metadata(&path) { if metadata.file_type().is_symlink() { return Err("deploy config symlink is not accepted".into()); } }
    let raw = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    fs::write(path, format!("{raw}\n")).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_deploy_providers(security: State<'_, WorkspaceSecurityState>) -> Vec<DeployProviderState> {
    let trusted = security.is_trusted().unwrap_or(false);
    let can_probe = security.terminal_allowed().unwrap_or(false);
    [
        ("github-pages", None),
        ("cloudflare", Some("wrangler")),
        ("netlify", Some("netlify")),
        ("vercel", Some("vercel")),
    ].into_iter().map(|(id, cli)| {
        let (cli_available, cli_version) = if can_probe { cli.map(probe_cli).unwrap_or((true, None)) } else { (id == "github-pages", None) };
        DeployProviderState { id: id.into(), cli_available, cli_version, credential_stored: trusted && matches!(id, "cloudflare" | "netlify" | "vercel") && credential_exists(id) }
    }).collect()
}

#[tauri::command]
pub fn store_deploy_credential(provider: String, secret: String, security: State<'_, WorkspaceSecurityState>) -> Result<(), String> {
    require_trusted(&security)?;
    let value = secret.trim();
    if value.len() < 8 || value.len() > MAX_SECRET_LEN { return Err("credential length is outside the allowed range".into()); }
    credential_entry(&provider)?.set_password(value).map_err(|error| format!("unable to store credential in OS keychain: {error}"))
}

#[tauri::command]
pub fn clear_deploy_credential(provider: String, security: State<'_, WorkspaceSecurityState>) -> Result<(), String> {
    require_trusted(&security)?;
    match credential_entry(&provider)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("unable to remove credential from OS keychain: {error}")),
    }
}

#[tauri::command]
pub fn generate_github_pages_workflow(
    output_dir: String,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<String, String> {
    require_trusted(&security)?;
    let root = workspace_root(&workspace)?;
    let project = detect_project_at(&root)?;
    let output = if output_dir.trim().is_empty() { project.build_output_dir.unwrap_or_else(|| "dist".into()) } else { output_dir.trim().to_string() };
    clean_relative_path(&output)?;
    let manager = project.preferred_package_manager.unwrap_or_else(|| "npm".into());
    let (install, run) = match manager.as_str() {
        "pnpm" => ("corepack enable && pnpm install --frozen-lockfile", "pnpm run build"),
        "yarn" => ("corepack enable && yarn install --immutable", "yarn build"),
        "bun" => ("npm install -g bun && bun install --frozen-lockfile", "bun run build"),
        _ => ("npm ci", "npm run build"),
    };
    let workflow = format!(r#"name: WebForge · GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
      - run: {install}
      - run: {run}
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with:
          path: './{output}'

  deploy:
    environment:
      name: github-pages
      url: ${{{{ steps.deployment.outputs.page_url }}}}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
"#);
    let dir = root.join(".github/workflows");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join("webforge-pages.yml");
    if let Ok(metadata) = fs::symlink_metadata(&path) { if metadata.file_type().is_symlink() { return Err("workflow symlink is not accepted".into()); } }
    fs::write(&path, workflow).map_err(|error| error.to_string())?;
    Ok(".github/workflows/webforge-pages.yml".into())
}

#[tauri::command]
pub fn deploy_project(
    provider: String,
    config: DeployProviderConfig,
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<DeployResult, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&workspace)?;
    let project = detect_project_at(&root)?;
    let fallback = project.build_output_dir.as_deref().unwrap_or("dist");
    let (output, relative_output) = resolve_output(&root, &config.output_dir, fallback)?;

    let (program, args, envs, label): (String, Vec<String>, Vec<(&str, String)>, String) = match provider.as_str() {
        "cloudflare" => {
            let project_name = ensure_simple(&config.project_name, "Cloudflare project name", 96)?;
            let account_id = ensure_simple(&config.account_id, "Cloudflare account ID", 128)?;
            let token = load_secret("cloudflare")?;
            (cli_command("wrangler"), vec!["pages".into(), "deploy".into(), output.to_string_lossy().to_string(), format!("--project-name={project_name}")], vec![("CLOUDFLARE_API_TOKEN", token), ("CLOUDFLARE_ACCOUNT_ID", account_id)], format!("wrangler pages deploy {relative_output} --project-name={project_name}"))
        }
        "netlify" => {
            let site_id = ensure_simple(&config.site_id, "Netlify site ID", 128)?;
            let token = load_secret("netlify")?;
            let mut args = vec!["deploy".into(), "--dir".into(), output.to_string_lossy().to_string(), "--json".into()];
            if config.production { args.push("--prod".into()); }
            (cli_command("netlify"), args, vec![("NETLIFY_AUTH_TOKEN", token), ("NETLIFY_SITE_ID", site_id)], format!("netlify deploy --dir {relative_output}{}", if config.production { " --prod" } else { "" }))
        }
        "vercel" => {
            let token = load_secret("vercel")?;
            let mut args = vec!["deploy".into(), output.to_string_lossy().to_string(), "--yes".into()];
            if config.production { args.push("--prod".into()); }
            (cli_command("vercel"), args, vec![("VERCEL_TOKEN", token)], format!("vercel deploy {relative_output} --yes{}", if config.production { " --prod" } else { "" }))
        }
        _ => return Err("unsupported direct deploy provider".into()),
    };

    // Prefer a globally installed provider CLI; deliberately do not auto-download executable packages during deploy.
    let mut command = Command::new(&program);
    command.args(&args).current_dir(&root).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .env("NO_COLOR", "1").env("FORCE_COLOR", "0").env("CI", "1");
    for (key, value) in envs { command.env(key, value); }
    // Ensure the bundled Node runtime can be discovered by provider shims when present.
    let node = resolve_tool(&app, "node");
    if node.source == "bundled" {
        if let Some(dir) = Path::new(&node.executable).parent() {
            let current = std::env::var_os("PATH").unwrap_or_default();
            let mut paths = vec![dir.to_path_buf()];
            paths.extend(std::env::split_paths(&current));
            if let Ok(value) = std::env::join_paths(paths) { command.env("PATH", value); }
        }
    }
    let output = command.output().map_err(|error| format!("unable to start {program}: {error}. Install the provider CLI first."))?;
    let success = output.status.success();
    let text = bounded_output(output);
    Ok(DeployResult { provider, success, command: label, url: first_https_url(&text), output: text })
}
