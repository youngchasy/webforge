use crate::{
    generator::runtime_vite_config,
    project::{detect_project_at, ProjectInfo},
    security::{require_trusted, WorkspaceSecurityState},
    workspace::{workspace_root, WorkspaceState},
};
use serde::Serialize;
use std::{
    collections::VecDeque,
    fs,
    io::{BufRead, BufReader},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{Manager, State};

const MAX_RUNTIME_LOG_LINES: usize = 1500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTool {
    available: bool,
    version: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeEnvironment {
    node: RuntimeTool,
    npm: RuntimeTool,
    pnpm: RuntimeTool,
    yarn: RuntimeTool,
    bun: RuntimeTool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    running: bool,
    ready: bool,
    mode: Option<String>,
    command: Option<String>,
    preview_url: Option<String>,
    package_manager: Option<String>,
    exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogBatch {
    cursor: usize,
    lines: Vec<String>,
    status: RuntimeStatus,
}

#[derive(Debug, Clone)]
struct RuntimeMeta {
    running: bool,
    mode: Option<String>,
    command: Option<String>,
    preview_url: Option<String>,
    package_manager: Option<String>,
    exit_code: Option<i32>,
}

struct RuntimeLogBuffer {
    base_cursor: usize,
    lines: VecDeque<String>,
}

impl RuntimeLogBuffer {
    fn new() -> Self {
        Self {
            base_cursor: 0,
            lines: VecDeque::new(),
        }
    }

    fn clear(&mut self) {
        self.base_cursor = 0;
        self.lines.clear();
    }

    fn push(&mut self, line: String) {
        self.lines.push_back(line);
        while self.lines.len() > MAX_RUNTIME_LOG_LINES {
            self.lines.pop_front();
            self.base_cursor += 1;
        }
    }

    fn current_cursor(&self) -> usize {
        self.base_cursor + self.lines.len()
    }
}

pub struct RuntimeState {
    child: Mutex<Option<Child>>,
    logs: Arc<Mutex<RuntimeLogBuffer>>,
    meta: Mutex<RuntimeMeta>,
}

impl RuntimeState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            logs: Arc::new(Mutex::new(RuntimeLogBuffer::new())),
            meta: Mutex::new(RuntimeMeta {
                running: false,
                mode: None,
                command: None,
                preview_url: None,
                package_manager: None,
                exit_code: None,
            }),
        }
    }

    fn append_log(&self, line: String) {
        append_runtime_log(&self.logs, line);
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut child_guard = self.child.lock().map_err(|_| "runtime child lock is poisoned".to_string())?;
        if let Some(mut child) = child_guard.take() {
            let pid = child.id();
            terminate_process_tree(pid, &mut child);
            let mut exited = false;
            for _ in 0..12 {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        exited = true;
                        break;
                    }
                    Ok(None) => thread::sleep(Duration::from_millis(50)),
                    Err(_) => break,
                }
            }
            if !exited {
                force_terminate_process_tree(pid, &mut child);
            }
            let _ = child.wait();
            self.append_log(format!("[runtime] stopped process {pid}"));
        }
        let mut meta = self.meta.lock().map_err(|_| "runtime metadata lock is poisoned".to_string())?;
        meta.running = false;
        meta.mode = None;
        meta.preview_url = None;
        meta.exit_code = None;
        Ok(())
    }

    fn refresh_status(&self) -> Result<RuntimeStatus, String> {
        let mut exited = false;
        let mut exit_code = None;
        {
            let mut child_guard = self.child.lock().map_err(|_| "runtime child lock is poisoned".to_string())?;
            if let Some(child) = child_guard.as_mut() {
                if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                    exited = true;
                    exit_code = status.code();
                    *child_guard = None;
                }
            }
        }

        let mut meta = self.meta.lock().map_err(|_| "runtime metadata lock is poisoned".to_string())?;
        if exited {
            meta.running = false;
            meta.exit_code = exit_code;
            meta.preview_url = None;
            self.append_log(format!("[runtime] process exited with code {}", exit_code.unwrap_or(-1)));
        }
        Ok(status_from_meta(&meta))
    }
}

fn status_from_meta(meta: &RuntimeMeta) -> RuntimeStatus {
    RuntimeStatus {
        running: meta.running,
        ready: meta.running && preview_is_ready(meta.preview_url.as_deref()),
        mode: meta.mode.clone(),
        command: meta.command.clone(),
        preview_url: meta.preview_url.clone(),
        package_manager: meta.package_manager.clone(),
        exit_code: meta.exit_code,
    }
}

fn preview_is_ready(url: Option<&str>) -> bool {
    let Some(url) = url else { return false; };
    let Some(authority) = url.strip_prefix("http://") else { return false; };
    let Some((host, port)) = authority.rsplit_once(':') else { return false; };
    if host != "127.0.0.1" && host != "localhost" {
        return false;
    }
    let Ok(port) = port.parse::<u16>() else { return false; };
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(35)).is_ok()
}

fn append_runtime_log(logs: &Arc<Mutex<RuntimeLogBuffer>>, line: String) {
    if let Ok(mut guard) = logs.lock() {
        guard.push(line);
    }
}

fn tool_command(name: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        return match name {
            "npm" | "pnpm" | "yarn" => format!("{name}.cmd"),
            _ => name.to_string(),
        };
    }
    #[cfg(not(target_os = "windows"))]
    name.to_string()
}

#[derive(Debug, Clone)]
pub(crate) struct ToolResolution {
    pub(crate) executable: String,
    pub(crate) source: String,
}

fn env_override_name(name: &str) -> String {
    format!("WEBFORGE_{}_PATH", name.to_ascii_uppercase())
}

fn bundled_candidates(app: &tauri::AppHandle, name: &str) -> Vec<std::path::PathBuf> {
    let mut candidates = Vec::new();
    let file = tool_command(name);
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("runtime").join("bin").join(&file));
        candidates.push(resource_dir.join("runtime").join(&file));
    }
    candidates
}

pub(crate) fn resolve_tool(app: &tauri::AppHandle, name: &str) -> ToolResolution {
    if let Ok(value) = std::env::var(env_override_name(name)) {
        let path = std::path::PathBuf::from(&value);
        if path.is_file() {
            return ToolResolution { executable: value, source: "override".into() };
        }
    }
    for path in bundled_candidates(app, name) {
        if path.is_file() {
            return ToolResolution { executable: path.to_string_lossy().to_string(), source: "bundled".into() };
        }
    }
    ToolResolution { executable: tool_command(name), source: "system".into() }
}

fn probe_tool(app: &tauri::AppHandle, name: &str) -> RuntimeTool {
    let resolution = resolve_tool(app, name);
    match Command::new(&resolution.executable).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let raw = if output.stdout.is_empty() { &output.stderr } else { &output.stdout };
            let version = String::from_utf8_lossy(raw).trim().lines().next().map(str::to_string);
            RuntimeTool { available: true, version, source: Some(resolution.source) }
        }
        _ => RuntimeTool { available: false, version: None, source: None },
    }
}

pub(crate) fn environment(app: &tauri::AppHandle) -> RuntimeEnvironment {
    RuntimeEnvironment {
        node: probe_tool(app, "node"),
        npm: probe_tool(app, "npm"),
        pnpm: probe_tool(app, "pnpm"),
        yarn: probe_tool(app, "yarn"),
        bun: probe_tool(app, "bun"),
    }
}

fn manager_available(env: &RuntimeEnvironment, manager: &str) -> bool {
    match manager {
        "npm" => env.npm.available,
        "pnpm" => env.pnpm.available,
        "yarn" => env.yarn.available,
        "bun" => env.bun.available,
        _ => false,
    }
}

pub(crate) fn choose_manager(project: &ProjectInfo, env: &RuntimeEnvironment) -> Result<String, String> {
    if let Some(preferred) = project.preferred_package_manager.as_deref() {
        if manager_available(env, preferred) {
            return Ok(preferred.to_string());
        }
    }
    ["npm", "pnpm", "yarn", "bun"]
        .into_iter()
        .find(|manager| manager_available(env, manager))
        .map(str::to_string)
        .ok_or_else(|| "no supported package manager was found; install Node.js/npm, pnpm, yarn or bun".to_string())
}

fn reserve_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    Ok(listener.local_addr().map_err(|error| error.to_string())?.port())
}

fn command_for_script(manager: &str, executable: String, script: &str, port: u16, is_vite: bool) -> (String, Vec<String>) {
    let mut args = vec!["run".to_string(), script.to_string()];
    if is_vite {
        match manager {
            "yarn" => {
                args.extend([
                    "--host".into(), "127.0.0.1".into(),
                    "--port".into(), port.to_string(),
                    "--strictPort".into(),
                ]);
            }
            _ => {
                args.push("--".into());
                args.extend([
                    "--host".into(), "127.0.0.1".into(),
                    "--port".into(), port.to_string(),
                    "--strictPort".into(),
                ]);
            }
        }
    }
    (executable, args)
}

fn command_for_install(executable: String) -> (String, Vec<String>) {
    (executable, vec!["install".to_string()])
}

const WEBFORGE_RUNTIME_DIR: &str = ".webforge-runtime";
const WEBFORGE_VITE_CONFIG: &str = "webforge.vite.config.mjs";

fn prepare_vite_runtime_config(root: &Path, original_config: Option<&str>) -> Result<Option<PathBuf>, String> {
    let node_modules = root.join("node_modules");
    let metadata = match fs::symlink_metadata(&node_modules) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("unable to inspect node_modules for Designer runtime: {error}")),
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Ok(None);
    }

    let canonical_root = fs::canonicalize(root).map_err(|error| format!("unable to resolve workspace root: {error}"))?;
    let canonical_modules = fs::canonicalize(&node_modules).map_err(|error| format!("unable to resolve node_modules: {error}"))?;
    if !canonical_modules.starts_with(&canonical_root) {
        return Ok(None);
    }

    let runtime_dir = node_modules.join(WEBFORGE_RUNTIME_DIR);
    match fs::symlink_metadata(&runtime_dir) {
        Ok(existing) if existing.file_type().is_symlink() || !existing.is_dir() => return Ok(None),
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&runtime_dir).map_err(|error| format!("unable to create Designer runtime directory: {error}"))?;
        }
        Err(error) => return Err(format!("unable to inspect Designer runtime directory: {error}")),
    }

    let config_path = runtime_dir.join(WEBFORGE_VITE_CONFIG);
    fs::write(&config_path, runtime_vite_config(original_config))
        .map_err(|error| format!("unable to write Designer Vite runtime config: {error}"))?;
    Ok(Some(config_path))
}

fn append_vite_runtime_config(args: &mut Vec<String>, root: &Path, config_path: &Path) -> Result<(), String> {
    let relative = config_path
        .strip_prefix(root)
        .map_err(|_| "Designer runtime config escaped the workspace".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    args.extend(["--config".to_string(), relative]);
    Ok(())
}

fn spawn_reader<R: std::io::Read + Send + 'static>(reader: R, prefix: &'static str, logs: Arc<Mutex<RuntimeLogBuffer>>) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            append_runtime_log(&logs, format!("[{prefix}] {line}"));
        }
    });
}

fn spawn_process(
    state: &RuntimeState,
    cwd: &std::path::Path,
    manager: &str,
    mode: &str,
    executable: String,
    args: Vec<String>,
    preview_url: Option<String>,
) -> Result<RuntimeStatus, String> {
    state.stop()?;

    let command_label = format!("{} {}", manager, args.join(" "));
    if let Ok(mut logs) = state.logs.lock() {
        logs.clear();
    }
    state.append_log(format!("[runtime] cwd: {}", cwd.display()));
    state.append_log(format!("[runtime] $ {command_label}"));

    let mut command = Command::new(&executable);
    configure_process_group(&mut command);
    command
        .args(&args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("BROWSER", "none")
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        .env("WEBFORGE_BRIDGE", if mode == "dev" { "1" } else { "0" });

    let mut child = command.spawn().map_err(|error| format!("unable to start {executable}: {error}"))?;
    if let Some(stdout) = child.stdout.take() {
        spawn_reader(stdout, "stdout", Arc::clone(&state.logs));
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_reader(stderr, "stderr", Arc::clone(&state.logs));
    }

    *state.child.lock().map_err(|_| "runtime child lock is poisoned".to_string())? = Some(child);
    let mut meta = state.meta.lock().map_err(|_| "runtime metadata lock is poisoned".to_string())?;
    *meta = RuntimeMeta {
        running: true,
        mode: Some(mode.to_string()),
        command: Some(command_label),
        preview_url,
        package_manager: Some(manager.to_string()),
        exit_code: None,
    };
    Ok(status_from_meta(&meta))
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(target_os = "windows")]
pub(crate) fn configure_process_group(_command: &mut Command) {}

#[cfg(target_os = "windows")]
pub(crate) fn terminate_process_tree(pid: u32, child: &mut Child) {
    let result = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if result.map(|status| !status.success()).unwrap_or(true) {
        let _ = child.kill();
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn terminate_process_tree(pid: u32, child: &mut Child) {
    let result = Command::new("kill")
        .args(["-TERM", &format!("-{pid}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if result.map(|status| !status.success()).unwrap_or(true) {
        let _ = child.kill();
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn force_terminate_process_tree(pid: u32, child: &mut Child) {
    terminate_process_tree(pid, child);
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn force_terminate_process_tree(pid: u32, child: &mut Child) {
    let result = Command::new("kill")
        .args(["-KILL", &format!("-{pid}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if result.map(|status| !status.success()).unwrap_or(true) {
        let _ = child.kill();
    }
}

#[tauri::command]
pub fn probe_runtime_environment(app: tauri::AppHandle) -> RuntimeEnvironment {
    environment(&app)
}

#[tauri::command]
pub fn start_project_dev_server(
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, RuntimeState>,
) -> Result<RuntimeStatus, String> {
    require_trusted(&security)?;
    let root = workspace_root(&workspace)?;
    let project = detect_project_at(&root)?;
    let script = project.dev_script.clone().ok_or_else(|| "package.json does not define a dev/start script".to_string())?;
    if !project.package_json {
        return Err("this project does not use a package.json dev server".into());
    }
    if !project.dependencies_installed {
        return Err("project dependencies are not installed; run Install dependencies first".into());
    }
    if !project.dev_server_supported {
        return Err("WebForge only supervises dev/start scripts that directly invoke Vite".into());
    }

    let env = environment(&app);
    let manager = choose_manager(&project, &env)?;
    let executable = resolve_tool(&app, &manager).executable;
    let port = reserve_port()?;
    let preview_url = format!("http://127.0.0.1:{port}");
    let (executable, mut args) = command_for_script(&manager, executable, &script, port, true);
    if let Some(config_path) = prepare_vite_runtime_config(&root, project.vite_config_path.as_deref())? {
        append_vite_runtime_config(&mut args, &root, &config_path)?;
    }
    spawn_process(&state, &root, &manager, "dev", executable, args, Some(preview_url))
}


#[tauri::command]
pub fn start_project_build(
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, RuntimeState>,
) -> Result<RuntimeStatus, String> {
    require_trusted(&security)?;
    let root = workspace_root(&workspace)?;
    let project = detect_project_at(&root)?;
    let script = project.build_script.clone().ok_or_else(|| "package.json does not define a build script".to_string())?;
    if !project.package_json {
        return Err("this workspace has no package.json build workflow".into());
    }
    if !project.dependencies_installed {
        return Err("project dependencies are not installed; run Install dependencies first".into());
    }
    if !project.build_supported {
        return Err("WebForge only supervises build scripts that directly invoke Vite build".into());
    }

    let env = environment(&app);
    let manager = choose_manager(&project, &env)?;
    let executable = resolve_tool(&app, &manager).executable;
    let (executable, args) = command_for_script(&manager, executable, &script, 0, false);
    spawn_process(&state, &root, &manager, "build", executable, args, None)
}

#[tauri::command]
pub fn install_project_dependencies(
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, RuntimeState>,
) -> Result<RuntimeStatus, String> {
    require_trusted(&security)?;
    let root = workspace_root(&workspace)?;
    let project = detect_project_at(&root)?;
    if !project.package_json {
        return Err("this workspace has no package.json".into());
    }
    let env = environment(&app);
    let manager = choose_manager(&project, &env)?;
    let executable = resolve_tool(&app, &manager).executable;
    let (executable, args) = command_for_install(executable);
    spawn_process(&state, &root, &manager, "install", executable, args, None)
}

#[tauri::command]
pub fn stop_project_runtime(state: State<'_, RuntimeState>) -> Result<RuntimeStatus, String> {
    state.stop()?;
    state.refresh_status()
}

#[tauri::command]
pub fn get_project_runtime_status(state: State<'_, RuntimeState>) -> Result<RuntimeStatus, String> {
    state.refresh_status()
}

#[tauri::command]
pub fn poll_project_runtime_logs(
    cursor: usize,
    state: State<'_, RuntimeState>,
) -> Result<RuntimeLogBatch, String> {
    let status = state.refresh_status()?;
    let logs = state.logs.lock().map_err(|_| "runtime log lock is poisoned".to_string())?;
    let current_cursor = logs.current_cursor();
    let normalized_cursor = cursor.max(logs.base_cursor).min(current_cursor);
    let start = normalized_cursor - logs.base_cursor;
    let lines = logs.lines.iter().skip(start).cloned().collect();
    Ok(RuntimeLogBatch {
        cursor: current_cursor,
        lines,
        status,
    })
}

#[cfg(test)]
mod tests {
    use super::{command_for_script, preview_is_ready, RuntimeLogBuffer, MAX_RUNTIME_LOG_LINES};

    #[test]
    fn npm_vite_script_receives_strict_local_port_flags() {
        let (_command, args) = command_for_script("npm", "npm".into(), "dev", 43123, true);
        assert_eq!(
            args,
            vec![
                "run", "dev", "--", "--host", "127.0.0.1", "--port", "43123", "--strictPort"
            ]
        );
    }

    #[test]
    fn build_script_does_not_receive_dev_server_flags() {
        let (_command, args) = command_for_script("npm", "npm".into(), "build", 0, false);
        assert_eq!(args, vec!["run", "build"]);
    }

    #[test]
    fn yarn_vite_script_uses_yarn_argument_forwarding() {
        let (_command, args) = command_for_script("yarn", "yarn".into(), "dev", 43123, true);
        assert_eq!(
            args,
            vec![
                "run", "dev", "--host", "127.0.0.1", "--port", "43123", "--strictPort"
            ]
        );
    }


    #[test]
    fn runtime_log_cursor_advances_after_buffer_truncation() {
        let mut logs = RuntimeLogBuffer::new();
        for index in 0..(MAX_RUNTIME_LOG_LINES + 5) {
            logs.push(format!("line {index}"));
        }
        assert_eq!(logs.lines.len(), MAX_RUNTIME_LOG_LINES);
        assert_eq!(logs.base_cursor, 5);
        assert_eq!(logs.current_cursor(), MAX_RUNTIME_LOG_LINES + 5);
    }

    #[test]
    fn missing_preview_url_is_not_ready() {
        assert!(!preview_is_ready(None));
        assert!(!preview_is_ready(Some("https://example.com")));
    }
}
