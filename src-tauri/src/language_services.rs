use crate::{
    runtime::{configure_process_group, force_terminate_process_tree, terminate_process_tree},
    security::{require_terminal_allowed, WorkspaceSecurityState},
    workspace::{clean_relative_path, workspace_root, WorkspaceState},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    env,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{atomic::{AtomicBool, AtomicI64, Ordering}, mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;
use url::Url;

const MAX_DIAGNOSTICS: usize = 4000;
const MAX_LOG_ENTRIES: usize = 1200;
const MAX_CONFIGURATION_BYTES: usize = 256 * 1024;
const MAX_COMMAND_ARGUMENT_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerInfo {
    id: String,
    label: String,
    available: bool,
    source: Option<String>,
    command: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerRuntimeStatus {
    server_id: String,
    label: String,
    running: bool,
    pid: Option<u32>,
    error: Option<String>,
    semantic_token_types: Vec<String>,
    semantic_token_modifiers: Vec<String>,
    supports_call_hierarchy: bool,
    supports_type_hierarchy: bool,
    supports_inlay_hints: bool,
    supports_formatting: bool,
    supports_code_lens: bool,
    supports_workspace_diagnostics: bool,
    crash_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerStatus {
    running: bool,
    server_id: Option<String>,
    label: Option<String>,
    pid: Option<u32>,
    error: Option<String>,
    semantic_token_types: Vec<String>,
    semantic_token_modifiers: Vec<String>,
    supports_call_hierarchy: bool,
    supports_type_hierarchy: bool,
    supports_inlay_hints: bool,
    supports_formatting: bool,
    supports_code_lens: bool,
    supports_workspace_diagnostics: bool,
    servers: Vec<LanguageServerRuntimeStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageServerLogEntry {
    server_id: String,
    level: String,
    message: String,
    timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageDiagnostic {
    path: String,
    line: u32,
    column: u32,
    end_line: u32,
    end_column: u32,
    severity: String,
    message: String,
    code: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Clone)]
struct ServerResolution {
    id: String,
    label: String,
    executable: PathBuf,
    source: String,
}

struct LanguageServerInstance {
    id: String,
    label: String,
    child: Mutex<Option<Child>>,
    writer: Arc<Mutex<Option<ChildStdin>>>,
    diagnostics: Arc<Mutex<HashMap<String, Vec<LanguageDiagnostic>>>>,
    open_documents: Mutex<HashSet<String>>,
    pending: Arc<Mutex<HashMap<i64, mpsc::Sender<Result<Value, String>>>>>,
    next_request_id: AtomicI64,
    status: Arc<Mutex<LanguageServerRuntimeStatus>>,
    capabilities: Mutex<Value>,
    allowed_commands: Mutex<HashSet<String>>,
    logs: Arc<Mutex<VecDeque<LanguageServerLogEntry>>>,
    intentional_stop: Arc<AtomicBool>,
}

impl LanguageServerInstance {
    fn new(id: String, label: String, logs: Arc<Mutex<VecDeque<LanguageServerLogEntry>>>) -> Self {
        Self {
            status: Arc::new(Mutex::new(LanguageServerRuntimeStatus {
                server_id: id.clone(),
                label: label.clone(),
                running: false,
                pid: None,
                error: None,
                semantic_token_types: Vec::new(),
                semantic_token_modifiers: Vec::new(),
                supports_call_hierarchy: false,
                supports_type_hierarchy: false,
                supports_inlay_hints: false,
                supports_formatting: false,
                supports_code_lens: false,
                supports_workspace_diagnostics: false,
                crash_count: 0,
            })),
            id,
            label,
            child: Mutex::new(None),
            writer: Arc::new(Mutex::new(None)),
            diagnostics: Arc::new(Mutex::new(HashMap::new())),
            open_documents: Mutex::new(HashSet::new()),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_request_id: AtomicI64::new(1000),
            capabilities: Mutex::new(Value::Null),
            allowed_commands: Mutex::new(HashSet::new()),
            logs,
            intentional_stop: Arc::new(AtomicBool::new(false)),
        }
    }

    fn stop(&self, clear_error: bool) -> Result<(), String> {
        self.intentional_stop.store(true, Ordering::Relaxed);
        if let Ok(mut writer) = self.writer.lock() {
            if let Some(stdin) = writer.as_mut() {
                let shutdown_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
                let _ = write_message(stdin, &json!({"jsonrpc":"2.0","id":shutdown_id,"method":"shutdown","params":null}));
                let _ = write_message(stdin, &json!({"jsonrpc":"2.0","method":"exit","params":null}));
            }
            *writer = None;
        }
        let mut child_guard = self.child.lock().map_err(|_| "language service child lock is poisoned".to_string())?;
        if let Some(mut child) = child_guard.take() {
            let pid = child.id();
            for _ in 0..6 {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => thread::sleep(Duration::from_millis(40)),
                    Err(_) => break,
                }
            }
            if child.try_wait().ok().flatten().is_none() {
                terminate_process_tree(pid, &mut child);
                thread::sleep(Duration::from_millis(50));
                if child.try_wait().ok().flatten().is_none() { force_terminate_process_tree(pid, &mut child); }
            }
            let _ = child.wait();
        }
        self.diagnostics.lock().map_err(|_| "language diagnostics lock is poisoned".to_string())?.clear();
        if let Ok(mut pending) = self.pending.lock() {
            for (_, sender) in pending.drain() { let _ = sender.send(Err("language server stopped".into())); }
        }
        self.open_documents.lock().map_err(|_| "language document lock is poisoned".to_string())?.clear();
        if let Ok(mut capabilities) = self.capabilities.lock() { *capabilities = Value::Null; }
        if let Ok(mut commands) = self.allowed_commands.lock() { commands.clear(); }
        if let Ok(mut status) = self.status.lock() {
            status.running = false;
            status.pid = None;
            if clear_error { status.error = None; }
        }
        append_log(&self.logs, &self.id, "info", "language server stopped");
        Ok(())
    }
}

pub struct LanguageServiceState {
    servers: Mutex<HashMap<String, Arc<LanguageServerInstance>>>,
    logs: Arc<Mutex<VecDeque<LanguageServerLogEntry>>>,
    configuration: Arc<Mutex<Value>>,
}

impl LanguageServiceState {
    pub fn new() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
            logs: Arc::new(Mutex::new(VecDeque::new())),
            configuration: Arc::new(Mutex::new(default_configuration())),
        }
    }

    pub fn stop_all(&self) -> Result<(), String> {
        let servers = self.servers.lock().map_err(|_| "language servers lock is poisoned".to_string())?.values().cloned().collect::<Vec<_>>();
        for server in servers { server.stop(true)?; }
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> { self.stop_all() }
}

fn server_specs() -> [(&'static str, &'static str, &'static str); 3] {
    [
        ("typescript", "TypeScript / JavaScript", "typescript-language-server"),
        ("vue", "Vue Language Server", "vue-language-server"),
        ("svelte", "Svelte Language Server", "svelteserver"),
    ]
}

fn default_configuration() -> Value {
    json!({
        "typescript": {"format": {"enable": true}},
        "javascript": {"format": {"enable": true}},
        "vue": {},
        "svelte": {}
    })
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().min(u128::from(u64::MAX)) as u64
}

fn append_log(logs: &Arc<Mutex<VecDeque<LanguageServerLogEntry>>>, server_id: &str, level: &str, message: impl Into<String>) {
    if let Ok(mut entries) = logs.lock() {
        entries.push_back(LanguageServerLogEntry { server_id: server_id.to_string(), level: level.to_string(), message: message.into(), timestamp_ms: now_ms() });
        while entries.len() > MAX_LOG_ENTRIES { entries.pop_front(); }
    }
}

fn path_extensions() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into()).split(';').map(|value| value.to_ascii_lowercase()).collect()
    }
    #[cfg(not(target_os = "windows"))]
    { vec![String::new()] }
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    let extensions = path_extensions();
    for directory in env::split_paths(&path) {
        #[cfg(target_os = "windows")]
        {
            let raw = directory.join(name);
            if raw.is_file() { return Some(raw); }
            for extension in &extensions {
                let candidate = directory.join(format!("{name}{extension}"));
                if candidate.is_file() { return Some(candidate); }
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let candidate = directory.join(name);
            if candidate.is_file() { return Some(candidate); }
        }
    }
    None
}

fn resolve_server(root: &Path, id: &str) -> Option<ServerResolution> {
    let (_, label, binary) = server_specs().into_iter().find(|(candidate, _, _)| *candidate == id)?;
    #[cfg(target_os = "windows")]
    let local_names = [format!("{binary}.cmd"), format!("{binary}.exe"), binary.to_string()];
    #[cfg(not(target_os = "windows"))]
    let local_names = [binary.to_string(), binary.to_string(), binary.to_string()];

    for name in local_names {
        let candidate = root.join("node_modules").join(".bin").join(name);
        if candidate.is_file() {
            return Some(ServerResolution { id: id.into(), label: label.into(), executable: candidate, source: "workspace".into() });
        }
    }
    find_on_path(binary).map(|executable| ServerResolution { id: id.into(), label: label.into(), executable, source: "system".into() })
}

fn root_uri(root: &Path) -> Result<String, String> {
    Url::from_directory_path(root).map_err(|_| "unable to create workspace file URI".to_string()).map(|value| value.to_string())
}

fn file_uri(path: &Path) -> Result<String, String> {
    Url::from_file_path(path).map_err(|_| "unable to create file URI".to_string()).map(|value| value.to_string())
}

fn uri_to_relative(root: &Path, uri: &str) -> Option<String> {
    let url = Url::parse(uri).ok()?;
    let path = url.to_file_path().ok()?;
    let relative = path.strip_prefix(root).ok()?;
    Some(relative.to_string_lossy().replace('\\', "/"))
}

fn language_id(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".tsx") { "typescriptreact" }
    else if lower.ends_with(".ts") || lower.ends_with(".mts") || lower.ends_with(".cts") { "typescript" }
    else if lower.ends_with(".jsx") { "javascriptreact" }
    else if lower.ends_with(".js") || lower.ends_with(".mjs") || lower.ends_with(".cjs") { "javascript" }
    else if lower.ends_with(".vue") { "vue" }
    else if lower.ends_with(".svelte") { "svelte" }
    else { "plaintext" }
}

fn server_id_for_path(path: &str) -> Option<&'static str> {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".vue") { Some("vue") }
    else if lower.ends_with(".svelte") { Some("svelte") }
    else if lower.ends_with(".ts") || lower.ends_with(".tsx") || lower.ends_with(".mts") || lower.ends_with(".cts") || lower.ends_with(".js") || lower.ends_with(".jsx") || lower.ends_with(".mjs") || lower.ends_with(".cjs") { Some("typescript") }
    else { None }
}

fn severity(value: Option<u64>) -> String {
    match value { Some(1) => "error", Some(2) => "warning", Some(3) => "info", Some(4) => "hint", _ => "info" }.into()
}

fn severity_number(value: &str) -> u64 {
    match value { "error" => 1, "warning" => 2, "info" => 3, "hint" => 4, _ => 3 }
}

fn diagnostic_to_lsp(value: &LanguageDiagnostic) -> Value {
    json!({
        "range": {
            "start": {"line": value.line.saturating_sub(1), "character": value.column.saturating_sub(1)},
            "end": {"line": value.end_line.saturating_sub(1), "character": value.end_column.saturating_sub(1)}
        },
        "severity": severity_number(&value.severity),
        "code": value.code.clone(),
        "source": value.source.clone(),
        "message": value.message.clone()
    })
}

fn parse_diagnostic_items(root: &Path, uri: &str, items: &[Value]) -> Option<(String, Vec<LanguageDiagnostic>)> {
    let path = uri_to_relative(root, uri)?;
    let mut diagnostics = Vec::new();
    for item in items.iter().take(MAX_DIAGNOSTICS) {
        let Some(range) = item.get("range") else { continue; };
        let Some(start) = range.get("start") else { continue; };
        let Some(end) = range.get("end") else { continue; };
        diagnostics.push(LanguageDiagnostic {
            path: path.clone(),
            line: start.get("line").and_then(Value::as_u64).unwrap_or(0) as u32 + 1,
            column: start.get("character").and_then(Value::as_u64).unwrap_or(0) as u32 + 1,
            end_line: end.get("line").and_then(Value::as_u64).unwrap_or(0) as u32 + 1,
            end_column: end.get("character").and_then(Value::as_u64).unwrap_or(0) as u32 + 1,
            severity: severity(item.get("severity").and_then(Value::as_u64)),
            message: item.get("message").and_then(Value::as_str).unwrap_or("Language service diagnostic").to_string(),
            code: item.get("code").map(|value| value.as_str().map(str::to_string).unwrap_or_else(|| value.to_string())),
            source: item.get("source").and_then(Value::as_str).map(str::to_string),
        });
    }
    Some((path, diagnostics))
}

fn parse_diagnostics(root: &Path, params: &Value) -> Option<(String, Vec<LanguageDiagnostic>)> {
    let uri = params.get("uri")?.as_str()?;
    let items = params.get("diagnostics")?.as_array()?;
    parse_diagnostic_items(root, uri, items)
}

fn write_message(writer: &mut ChildStdin, message: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    writer.write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes()).map_err(|error| error.to_string())?;
    writer.write_all(&body).map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

fn read_message(reader: &mut BufReader<ChildStdout>) -> Result<Value, String> {
    let mut content_length = None;
    loop {
        let mut header = String::new();
        let bytes = reader.read_line(&mut header).map_err(|error| error.to_string())?;
        if bytes == 0 { return Err("language server closed stdout".into()); }
        if header == "\r\n" || header == "\n" { break; }
        let lower = header.to_ascii_lowercase();
        if let Some(value) = lower.strip_prefix("content-length:") { content_length = value.trim().parse::<usize>().ok(); }
    }
    let length = content_length.ok_or_else(|| "language server response missing Content-Length".to_string())?;
    if length > 16 * 1024 * 1024 { return Err("language server message exceeded 16 MiB".into()); }
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body).map_err(|error| error.to_string())?;
    serde_json::from_slice(&body).map_err(|error| error.to_string())
}

fn configuration_section(configuration: &Value, section: Option<&str>) -> Value {
    let Some(section) = section.filter(|value| !value.trim().is_empty()) else { return configuration.clone(); };
    let mut current = configuration;
    for part in section.split('.') {
        let Some(next) = current.get(part) else { return Value::Null; };
        current = next;
    }
    current.clone()
}

fn respond_to_server_request(writer: &mut ChildStdin, message: &Value, root_uri: &str, root_name: &str, configuration: &Arc<Mutex<Value>>) {
    let (Some(id), Some(method)) = (message.get("id").cloned(), message.get("method").and_then(Value::as_str)) else { return; };
    let result = match method {
        "workspace/configuration" => {
            let config = configuration.lock().map(|value| value.clone()).unwrap_or(Value::Null);
            let items = message.get("params").and_then(|value| value.get("items")).and_then(Value::as_array).cloned().unwrap_or_default();
            Value::Array(items.iter().map(|item| configuration_section(&config, item.get("section").and_then(Value::as_str))).collect())
        }
        "workspace/workspaceFolders" => json!([{"uri":root_uri,"name":root_name}]),
        "workspace/semanticTokens/refresh" | "workspace/inlayHint/refresh" | "workspace/codeLens/refresh" | "workspace/diagnostic/refresh" => Value::Null,
        _ => Value::Null,
    };
    let _ = write_message(writer, &json!({"jsonrpc":"2.0","id":id,"result":result}));
}

fn spawn_server_process(root: &Path, resolution: &ServerResolution) -> Result<Child, String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let is_script = resolution.executable.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case("cmd") || value.eq_ignore_ascii_case("bat"));
        if is_script {
            let mut cmd = Command::new(env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()));
            let command_line = format!("\"{}\" --stdio", resolution.executable.to_string_lossy());
            cmd.arg("/D").arg("/S").arg("/C").arg(command_line);
            cmd
        } else {
            let mut cmd = Command::new(&resolution.executable);
            cmd.arg("--stdio");
            cmd
        }
    };
    #[cfg(not(target_os = "windows"))]
    let mut command = { let mut cmd = Command::new(&resolution.executable); cmd.arg("--stdio"); cmd };
    command.current_dir(root).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    configure_process_group(&mut command);
    command.spawn().map_err(|error| format!("unable to launch {}: {error}", resolution.label))
}

fn capability_enabled(capabilities: &Value, key: &str) -> bool {
    capabilities.get(key).is_some_and(|value| value != &Value::Bool(false) && !value.is_null())
}

fn service_status(state: &LanguageServiceState) -> Result<LanguageServerStatus, String> {
    let map = state.servers.lock().map_err(|_| "language servers lock is poisoned".to_string())?;
    let mut servers = Vec::new();
    for (id, _, _) in server_specs() {
        if let Some(server) = map.get(id) {
            if let Ok(status) = server.status.lock() { servers.push(status.clone()); }
        }
    }
    let running_servers = servers.iter().filter(|server| server.running).collect::<Vec<_>>();
    let running = !running_servers.is_empty();
    let label = match running_servers.len() {
        0 => None,
        1 => Some(running_servers[0].label.clone()),
        count => Some(format!("{count} servers")),
    };
    let mut token_types = Vec::<String>::new();
    let mut token_modifiers = Vec::<String>::new();
    for server in &servers {
        for value in &server.semantic_token_types { if !token_types.contains(value) { token_types.push(value.clone()); } }
        for value in &server.semantic_token_modifiers { if !token_modifiers.contains(value) { token_modifiers.push(value.clone()); } }
    }
    Ok(LanguageServerStatus {
        running,
        server_id: running_servers.first().map(|server| server.server_id.clone()),
        label,
        pid: if running_servers.len() == 1 { running_servers[0].pid } else { None },
        error: servers.iter().find_map(|server| server.error.clone()),
        semantic_token_types: token_types,
        semantic_token_modifiers: token_modifiers,
        supports_call_hierarchy: running_servers.iter().any(|server| server.supports_call_hierarchy),
        supports_type_hierarchy: running_servers.iter().any(|server| server.supports_type_hierarchy),
        supports_inlay_hints: running_servers.iter().any(|server| server.supports_inlay_hints),
        supports_formatting: running_servers.iter().any(|server| server.supports_formatting),
        supports_code_lens: running_servers.iter().any(|server| server.supports_code_lens),
        supports_workspace_diagnostics: running_servers.iter().any(|server| server.supports_workspace_diagnostics),
        servers,
    })
}

fn get_running_server(state: &LanguageServiceState, server_id: &str) -> Result<Arc<LanguageServerInstance>, String> {
    let server = state.servers.lock().map_err(|_| "language servers lock is poisoned".to_string())?.get(server_id).cloned().ok_or_else(|| format!("language server '{server_id}' is not running"))?;
    let running = server.status.lock().map_err(|_| "language status lock is poisoned".to_string())?.running;
    if !running { return Err(format!("language server '{server_id}' is not running")); }
    Ok(server)
}

fn get_server_for_path(state: &LanguageServiceState, relative_path: &str) -> Result<Arc<LanguageServerInstance>, String> {
    let id = server_id_for_path(relative_path).ok_or_else(|| format!("no external language server is registered for '{relative_path}'"))?;
    get_running_server(state, id)
}

#[tauri::command]
pub fn probe_language_servers(workspace: State<'_, WorkspaceState>) -> Result<Vec<LanguageServerInfo>, String> {
    let root = workspace_root(&workspace)?;
    Ok(server_specs().into_iter().map(|(id, label, binary)| {
        let resolution = resolve_server(&root, id);
        LanguageServerInfo { id: id.into(), label: label.into(), available: resolution.is_some(), source: resolution.as_ref().map(|value| value.source.clone()), command: resolution.map(|value| value.executable.to_string_lossy().to_string()).or_else(|| Some(binary.into())) }
    }).collect())
}

#[tauri::command]
pub fn start_language_server(
    server_id: String,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, LanguageServiceState>,
) -> Result<LanguageServerStatus, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&workspace)?;
    let resolution = resolve_server(&root, &server_id).ok_or_else(|| format!("language server '{server_id}' was not found in node_modules/.bin or PATH"))?;

    if let Ok(existing) = get_running_server(&state, &server_id) {
        append_log(&state.logs, &server_id, "info", "start ignored because server is already running");
        drop(existing);
        return service_status(&state);
    }
    if let Some(existing) = state.servers.lock().map_err(|_| "language servers lock is poisoned".to_string())?.remove(&server_id) { let _ = existing.stop(false); }

    let instance = Arc::new(LanguageServerInstance::new(resolution.id.clone(), resolution.label.clone(), Arc::clone(&state.logs)));
    append_log(&state.logs, &server_id, "info", format!("starting {}", resolution.label));
    let mut child = spawn_server_process(&root, &resolution)?;
    let pid = child.id();
    let stdin = child.stdin.take().ok_or_else(|| "language server stdin is unavailable".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "language server stdout is unavailable".to_string())?;
    if let Some(stderr) = child.stderr.take() {
        let logs = Arc::clone(&state.logs);
        let id = server_id.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(|line| line.ok()) {
                if !line.trim().is_empty() { append_log(&logs, &id, "stderr", line); }
            }
        });
    }

    let (message_tx, message_rx) = mpsc::channel::<Result<Value, String>>();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let message = read_message(&mut reader);
            let finished = message.is_err();
            if message_tx.send(message).is_err() || finished { break; }
        }
    });

    let mut writer = stdin;
    let root_uri_value = root_uri(&root)?;
    let root_name = root.file_name().and_then(|value| value.to_str()).unwrap_or("workspace").to_string();
    let initialize_result = (|| -> Result<Value, String> {
        write_message(&mut writer, &json!({
            "jsonrpc":"2.0","id":1,"method":"initialize",
            "params":{
                "processId":std::process::id(),
                "rootUri":root_uri_value,
                "workspaceFolders":[{"uri":root_uri_value,"name":root_name}],
                "clientInfo":{"name":"WebForge","version":"1.0.0"},
                "capabilities":{
                    "textDocument":{
                        "publishDiagnostics":{"relatedInformation":true},
                        "synchronization":{"didSave":true},
                        "completion":{"completionItem":{"snippetSupport":true,"documentationFormat":["markdown","plaintext"]}},
                        "hover":{"contentFormat":["markdown","plaintext"]},
                        "definition":{"linkSupport":true},
                        "references":{},
                        "rename":{"prepareSupport":false},
                        "signatureHelp":{"signatureInformation":{"documentationFormat":["markdown","plaintext"]}},
                        "codeAction":{"codeActionLiteralSupport":{"codeActionKind":{"valueSet":["quickfix","refactor","source"]}}},
                        "documentSymbol":{"hierarchicalDocumentSymbolSupport":true},
                        "semanticTokens":{"dynamicRegistration":false,"requests":{"range":false,"full":true},"tokenTypes":["namespace","type","class","enum","interface","struct","typeParameter","parameter","variable","property","enumMember","event","function","method","macro","keyword","modifier","comment","string","number","regexp","operator","decorator"],"tokenModifiers":["declaration","definition","readonly","static","deprecated","abstract","async","modification","documentation","defaultLibrary"],"formats":["relative"],"overlappingTokenSupport":false,"multilineTokenSupport":false},
                        "callHierarchy":{"dynamicRegistration":false},
                        "typeHierarchy":{"dynamicRegistration":false},
                        "inlayHint":{"dynamicRegistration":false,"resolveSupport":{"properties":["tooltip","textEdits","label.tooltip","label.location","label.command"]}},
                        "formatting":{"dynamicRegistration":false},
                        "codeLens":{"dynamicRegistration":false},
                        "diagnostic":{"dynamicRegistration":false,"relatedDocumentSupport":true}
                    },
                    "workspace":{"workspaceFolders":true,"configuration":true,"didChangeConfiguration":{"dynamicRegistration":false},"symbol":{"dynamicRegistration":false},"diagnostics":{"refreshSupport":true},"inlayHint":{"refreshSupport":true},"codeLens":{"refreshSupport":true},"semanticTokens":{"refreshSupport":true}}
                }
            }
        }))?;
        let deadline = Instant::now() + Duration::from_secs(12);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() { return Err("language server initialize timed out after 12 seconds".into()); }
            let message = message_rx.recv_timeout(remaining).map_err(|error| match error { mpsc::RecvTimeoutError::Timeout => "language server initialize timed out after 12 seconds".to_string(), mpsc::RecvTimeoutError::Disconnected => "language server closed during initialize".to_string() })??;
            if message.get("id").and_then(Value::as_i64) == Some(1) {
                if message.get("error").is_some() { return Err(format!("language server initialize failed: {}", message["error"])); }
                let result = message.get("result").cloned().unwrap_or(Value::Null);
                write_message(&mut writer, &json!({"jsonrpc":"2.0","method":"initialized","params":{}}))?;
                let config = state.configuration.lock().map(|value| value.clone()).unwrap_or(Value::Null);
                let _ = write_message(&mut writer, &json!({"jsonrpc":"2.0","method":"workspace/didChangeConfiguration","params":{"settings":config}}));
                return Ok(result);
            }
            respond_to_server_request(&mut writer, &message, &root_uri_value, &root_name, &state.configuration);
        }
    })();

    let initialize_value = match initialize_result {
        Ok(value) => value,
        Err(error) => {
            let process_id = child.id();
            terminate_process_tree(process_id, &mut child);
            thread::sleep(Duration::from_millis(40));
            if child.try_wait().ok().flatten().is_none() { force_terminate_process_tree(process_id, &mut child); }
            let _ = child.wait();
            append_log(&state.logs, &server_id, "error", &error);
            return Err(error);
        }
    };
    let capabilities = initialize_value.get("capabilities").cloned().unwrap_or(Value::Null);
    if let Ok(mut slot) = instance.capabilities.lock() { *slot = capabilities.clone(); }
    let semantic_legend = capabilities.get("semanticTokensProvider").and_then(|value| value.get("legend"));
    let semantic_token_types = semantic_legend.and_then(|value| value.get("tokenTypes")).and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    let semantic_token_modifiers = semantic_legend.and_then(|value| value.get("tokenModifiers")).and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    let diagnostic_provider = capabilities.get("diagnosticProvider");
    let supports_workspace_diagnostics = diagnostic_provider.and_then(|value| value.get("workspaceDiagnostics")).and_then(Value::as_bool).unwrap_or(false);
    if let Ok(mut status) = instance.status.lock() {
        status.running = true;
        status.pid = Some(pid);
        status.error = None;
        status.semantic_token_types = semantic_token_types;
        status.semantic_token_modifiers = semantic_token_modifiers;
        status.supports_call_hierarchy = capability_enabled(&capabilities, "callHierarchyProvider");
        status.supports_type_hierarchy = capability_enabled(&capabilities, "typeHierarchyProvider");
        status.supports_inlay_hints = capability_enabled(&capabilities, "inlayHintProvider");
        status.supports_formatting = capability_enabled(&capabilities, "documentFormattingProvider");
        status.supports_code_lens = capability_enabled(&capabilities, "codeLensProvider");
        status.supports_workspace_diagnostics = supports_workspace_diagnostics;
    }
    *instance.writer.lock().map_err(|_| "language writer lock is poisoned".to_string())? = Some(writer);
    *instance.child.lock().map_err(|_| "language child lock is poisoned".to_string())? = Some(child);
    state.servers.lock().map_err(|_| "language servers lock is poisoned".to_string())?.insert(server_id.clone(), Arc::clone(&instance));

    let diagnostics = Arc::clone(&instance.diagnostics);
    let pending = Arc::clone(&instance.pending);
    let status_state = Arc::clone(&instance.status);
    let response_writer = Arc::clone(&instance.writer);
    let response_root_uri = root_uri_value.clone();
    let response_root_name = root_name.clone();
    let configuration = Arc::clone(&state.configuration);
    let logs = Arc::clone(&state.logs);
    let intentional_stop = Arc::clone(&instance.intentional_stop);
    let thread_server_id = server_id.clone();
    thread::spawn(move || {
        while let Ok(received) = message_rx.recv() {
            match received {
                Ok(message) => {
                    if message.get("method").and_then(Value::as_str) == Some("textDocument/publishDiagnostics") {
                        if let Some(params) = message.get("params") {
                            if let Some((path, items)) = parse_diagnostics(&root, params) {
                                if let Ok(mut map) = diagnostics.lock() { map.insert(path, items); }
                            }
                        }
                        continue;
                    }
                    if message.get("method").is_none() {
                        if let Some(id) = message.get("id").and_then(Value::as_i64) {
                            if let Ok(mut requests) = pending.lock() {
                                if let Some(sender) = requests.remove(&id) {
                                    let response = if let Some(error) = message.get("error") { Err(format!("language request failed: {error}")) } else { Ok(message.get("result").cloned().unwrap_or(Value::Null)) };
                                    let _ = sender.send(response);
                                    continue;
                                }
                            }
                        }
                    }
                    if message.get("id").is_some() && message.get("method").is_some() {
                        if let Ok(mut guard) = response_writer.lock() {
                            if let Some(stdin) = guard.as_mut() { respond_to_server_request(stdin, &message, &response_root_uri, &response_root_name, &configuration); }
                        }
                    }
                }
                Err(error) => {
                    let intentional = intentional_stop.load(Ordering::Relaxed);
                    if !intentional { append_log(&logs, &thread_server_id, "error", &error); }
                    if let Ok(mut guard) = status_state.lock() {
                        guard.running = false;
                        guard.pid = None;
                        if intentional { guard.error = None; } else {
                            guard.error = Some(error);
                            guard.crash_count = guard.crash_count.saturating_add(1);
                        }
                    }
                    if let Ok(mut requests) = pending.lock() {
                        for (_, sender) in requests.drain() { let _ = sender.send(Err(if intentional { "language server stopped".into() } else { "language server crashed".into() })); }
                    }
                    break;
                }
            }
        }
    });
    append_log(&state.logs, &server_id, "info", format!("{} started with pid {pid}", resolution.label));
    service_status(&state)
}

#[tauri::command]
pub fn stop_language_server(server_id: Option<String>, state: State<'_, LanguageServiceState>) -> Result<LanguageServerStatus, String> {
    if let Some(server_id) = server_id {
        if let Some(server) = state.servers.lock().map_err(|_| "language servers lock is poisoned".to_string())?.get(&server_id).cloned() { server.stop(true)?; }
    } else {
        state.stop_all()?;
    }
    service_status(&state)
}

#[tauri::command]
pub fn get_language_server_status(state: State<'_, LanguageServiceState>) -> Result<LanguageServerStatus, String> { service_status(&state) }

#[tauri::command]
pub fn update_language_configuration(configuration: Value, state: State<'_, LanguageServiceState>) -> Result<LanguageServerStatus, String> {
    let encoded = serde_json::to_vec(&configuration).map_err(|error| error.to_string())?;
    if encoded.len() > MAX_CONFIGURATION_BYTES { return Err("language configuration exceeds 256 KiB limit".into()); }
    if !configuration.is_object() { return Err("language configuration must be a JSON object".into()); }
    *state.configuration.lock().map_err(|_| "language configuration lock is poisoned".to_string())? = configuration.clone();
    let servers = state.servers.lock().map_err(|_| "language servers lock is poisoned".to_string())?.values().cloned().collect::<Vec<_>>();
    for server in servers {
        if !server.status.lock().map_err(|_| "language status lock is poisoned".to_string())?.running { continue; }
        if let Some(stdin) = server.writer.lock().map_err(|_| "language writer lock is poisoned".to_string())?.as_mut() {
            write_message(stdin, &json!({"jsonrpc":"2.0","method":"workspace/didChangeConfiguration","params":{"settings":configuration}}))?;
        }
    }
    service_status(&state)
}

fn sync_document_internal(relative_path: &str, content: &str, version: i32, root: &Path, server: &LanguageServerInstance) -> Result<(), String> {
    if content.len() > 4 * 1024 * 1024 { return Err("language document exceeds 4 MiB sync limit".into()); }
    let clean = clean_relative_path(relative_path)?;
    let uri = file_uri(&root.join(clean))?;
    let mut documents = server.open_documents.lock().map_err(|_| "language document lock is poisoned".to_string())?;
    let first = documents.insert(relative_path.to_string());
    let message = if first {
        json!({"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":uri,"languageId":language_id(relative_path),"version":version,"text":content}}})
    } else {
        json!({"jsonrpc":"2.0","method":"textDocument/didChange","params":{"textDocument":{"uri":uri,"version":version},"contentChanges":[{"text":content}]}})
    };
    drop(documents);
    let mut writer = server.writer.lock().map_err(|_| "language writer lock is poisoned".to_string())?;
    let stdin = writer.as_mut().ok_or_else(|| "language server writer is unavailable".to_string())?;
    write_message(stdin, &message)
}

#[tauri::command]
pub fn sync_language_document(relative_path: String, content: String, version: i32, workspace: State<'_, WorkspaceState>, state: State<'_, LanguageServiceState>) -> Result<(), String> {
    let Ok(server) = get_server_for_path(&state, &relative_path) else { return Ok(()); };
    let root = workspace_root(&workspace)?;
    sync_document_internal(&relative_path, &content, version, &root, &server)
}

#[tauri::command]
pub fn close_language_document(relative_path: String, workspace: State<'_, WorkspaceState>, state: State<'_, LanguageServiceState>) -> Result<(), String> {
    let Ok(server) = get_server_for_path(&state, &relative_path) else { return Ok(()); };
    let root = workspace_root(&workspace)?;
    let clean = clean_relative_path(&relative_path)?;
    let uri = file_uri(&root.join(clean))?;
    let mut documents = server.open_documents.lock().map_err(|_| "language document lock is poisoned".to_string())?;
    if !documents.remove(&relative_path) { return Ok(()); }
    drop(documents);
    if let Some(stdin) = server.writer.lock().map_err(|_| "language writer lock is poisoned".to_string())?.as_mut() {
        write_message(stdin, &json!({"jsonrpc":"2.0","method":"textDocument/didClose","params":{"textDocument":{"uri":uri}}}))?;
    }
    if let Ok(mut map) = server.diagnostics.lock() { map.remove(&relative_path); }
    Ok(())
}

fn supported_feature(feature: &str) -> Option<&'static str> {
    match feature {
        "completion" => Some("textDocument/completion"),
        "hover" => Some("textDocument/hover"),
        "definition" => Some("textDocument/definition"),
        "references" => Some("textDocument/references"),
        "rename" => Some("textDocument/rename"),
        "signatureHelp" => Some("textDocument/signatureHelp"),
        "codeAction" => Some("textDocument/codeAction"),
        "semanticTokensFull" => Some("textDocument/semanticTokens/full"),
        "inlayHint" => Some("textDocument/inlayHint"),
        "formatting" => Some("textDocument/formatting"),
        "codeLens" => Some("textDocument/codeLens"),
        _ => None,
    }
}

fn request_server_value(server: &LanguageServerInstance, method: &str, params: Value, timeout_label: &str) -> Result<Value, String> {
    let id = server.next_request_id.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = mpsc::channel();
    server.pending.lock().map_err(|_| "language request lock is poisoned".to_string())?.insert(id, sender);
    let write_result = {
        let mut writer = server.writer.lock().map_err(|_| "language writer lock is poisoned".to_string())?;
        let stdin = writer.as_mut().ok_or_else(|| "language server writer is unavailable".to_string())?;
        write_message(stdin, &json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
    };
    if let Err(error) = write_result {
        if let Ok(mut pending) = server.pending.lock() { pending.remove(&id); }
        return Err(error);
    }
    match receiver.recv_timeout(Duration::from_secs(5)) {
        Ok(result) => result,
        Err(_) => {
            if let Ok(mut pending) = server.pending.lock() { pending.remove(&id); }
            Err(format!("language request '{timeout_label}' timed out after 5 seconds"))
        }
    }
}

#[tauri::command]
pub fn request_language_symbols(scope: String, relative_path: Option<String>, query: Option<String>, content: Option<String>, version: Option<i32>, workspace: State<'_, WorkspaceState>, state: State<'_, LanguageServiceState>) -> Result<Value, String> {
    let root = workspace_root(&workspace)?;
    match scope.as_str() {
        "document" => {
            let relative_path = relative_path.ok_or_else(|| "document symbols require a file path".to_string())?;
            let server = get_server_for_path(&state, &relative_path)?;
            if let Some(content) = content.as_deref() { sync_document_internal(&relative_path, content, version.unwrap_or(1), &root, &server)?; }
            let clean = clean_relative_path(&relative_path)?;
            let uri = file_uri(&root.join(clean))?;
            request_server_value(&server, "textDocument/documentSymbol", json!({"textDocument":{"uri":uri}}), "documentSymbol")
        },
        "workspace" => {
            let query = query.unwrap_or_default().trim().to_string();
            if query.is_empty() { return Ok(Value::Array(Vec::new())); }
            if query.len() > 200 { return Err("workspace symbol query is too long".into()); }
            let servers = state.servers.lock().map_err(|_| "language servers lock is poisoned".to_string())?.values().cloned().collect::<Vec<_>>();
            let mut merged = Vec::new();
            for server in servers {
                if !server.status.lock().map_err(|_| "language status lock is poisoned".to_string())?.running { continue; }
                if let Ok(value) = request_server_value(&server, "workspace/symbol", json!({"query":query}), "workspaceSymbol") {
                    if let Some(items) = value.as_array() { merged.extend(items.iter().cloned().take(500)); }
                }
                if merged.len() >= 1000 { break; }
            }
            merged.truncate(1000);
            Ok(Value::Array(merged))
        },
        _ => Err("unsupported language symbol scope".into()),
    }
}

#[tauri::command]
pub fn request_language_feature(feature: String, relative_path: String, line: u32, column: u32, new_name: Option<String>, content: Option<String>, version: Option<i32>, workspace: State<'_, WorkspaceState>, state: State<'_, LanguageServiceState>) -> Result<Value, String> {
    let method = supported_feature(&feature).ok_or_else(|| format!("unsupported language feature: {feature}"))?;
    let root = workspace_root(&workspace)?;
    let server = get_server_for_path(&state, &relative_path)?;
    if let Some(content) = content.as_deref() { sync_document_internal(&relative_path, content, version.unwrap_or(1), &root, &server)?; }
    let clean = clean_relative_path(&relative_path)?;
    let uri = file_uri(&root.join(clean))?;
    let position = json!({"line":line.saturating_sub(1),"character":column.saturating_sub(1)});
    let params = match feature.as_str() {
        "completion" => json!({"textDocument":{"uri":uri},"position":position,"context":{"triggerKind":1}}),
        "semanticTokensFull" | "codeLens" => json!({"textDocument":{"uri":uri}}),
        "inlayHint" => {
            let last_line = content.as_deref().map(|value| value.lines().count().saturating_add(1)).unwrap_or(100_000);
            json!({"textDocument":{"uri":uri},"range":{"start":{"line":0,"character":0},"end":{"line":last_line,"character":0}}})
        },
        "formatting" => json!({"textDocument":{"uri":uri},"options":{"tabSize":4,"insertSpaces":true,"trimTrailingWhitespace":true,"insertFinalNewline":false,"trimFinalNewlines":false}}),
        "definition" | "hover" | "signatureHelp" => json!({"textDocument":{"uri":uri},"position":position}),
        "references" => json!({"textDocument":{"uri":uri},"position":position,"context":{"includeDeclaration":true}}),
        "rename" => {
            let name = new_name.filter(|value| !value.trim().is_empty()).ok_or_else(|| "rename requires a non-empty new name".to_string())?;
            json!({"textDocument":{"uri":uri},"position":position,"newName":name})
        },
        "codeAction" => {
            let diagnostics = server.diagnostics.lock().ok().and_then(|map| map.get(&relative_path).cloned()).unwrap_or_default();
            let items = diagnostics.iter().filter(|item| { let row = line.max(1); row >= item.line && row <= item.end_line.max(item.line) }).take(64).map(diagnostic_to_lsp).collect::<Vec<_>>();
            json!({"textDocument":{"uri":uri},"range":{"start":position.clone(),"end":position},"context":{"diagnostics":items,"only":["quickfix","refactor","source"]}})
        },
        _ => unreachable!(),
    };
    let response = request_server_value(&server, method, params, &feature)?;
    if feature == "codeLens" {
        if let Ok(mut allowed) = server.allowed_commands.lock() {
            for lens in response.as_array().into_iter().flatten().take(1000) {
                if let Some(command) = lens.get("command").and_then(|value| value.get("command")).and_then(Value::as_str) {
                    if command.len() <= 300 { allowed.insert(command.to_string()); }
                }
            }
        }
    }
    Ok(response)
}

#[tauri::command]
pub fn execute_language_command(server_id: String, command: String, arguments: Option<Value>, state: State<'_, LanguageServiceState>) -> Result<Value, String> {
    if command.trim().is_empty() || command.len() > 300 { return Err("invalid language server command".into()); }
    let arguments = arguments.unwrap_or_else(|| Value::Array(Vec::new()));
    if serde_json::to_vec(&arguments).map_err(|error| error.to_string())?.len() > MAX_COMMAND_ARGUMENT_BYTES { return Err("language command arguments exceed 256 KiB limit".into()); }
    let server = get_running_server(&state, &server_id)?;
    let allowed = server.allowed_commands.lock().map_err(|_| "language command allowlist lock is poisoned".to_string())?.contains(&command);
    if !allowed { return Err("language server command was not issued by a current CodeLens".into()); }
    request_server_value(&server, "workspace/executeCommand", json!({"command":command,"arguments":arguments}), "executeCommand")
}

#[tauri::command]
pub fn request_language_hierarchy(kind: String, relative_path: Option<String>, line: Option<u32>, column: Option<u32>, item: Option<Value>, content: Option<String>, version: Option<i32>, workspace: State<'_, WorkspaceState>, state: State<'_, LanguageServiceState>) -> Result<Value, String> {
    let root = workspace_root(&workspace)?;
    match kind.as_str() {
        "prepareCall" | "prepareType" => {
            let relative_path = relative_path.ok_or_else(|| "hierarchy preparation requires a file path".to_string())?;
            let server = get_server_for_path(&state, &relative_path)?;
            if let Some(content) = content.as_deref() { sync_document_internal(&relative_path, content, version.unwrap_or(1), &root, &server)?; }
            let clean = clean_relative_path(&relative_path)?;
            let uri = file_uri(&root.join(clean))?;
            let position = json!({"line":line.unwrap_or(1).saturating_sub(1),"character":column.unwrap_or(1).saturating_sub(1)});
            let method = if kind == "prepareCall" { "textDocument/prepareCallHierarchy" } else { "textDocument/prepareTypeHierarchy" };
            request_server_value(&server, method, json!({"textDocument":{"uri":uri},"position":position}), &kind)
        },
        "incomingCalls" | "outgoingCalls" | "supertypes" | "subtypes" => {
            let item = item.ok_or_else(|| "hierarchy expansion requires an item".to_string())?;
            if serde_json::to_vec(&item).map_err(|error| error.to_string())?.len() > 256 * 1024 { return Err("hierarchy item exceeds 256 KiB limit".into()); }
            let uri = item.get("uri").and_then(Value::as_str).ok_or_else(|| "hierarchy item URI is missing".to_string())?;
            let relative = uri_to_relative(&root, uri).ok_or_else(|| "hierarchy item is outside the workspace".to_string())?;
            let server = get_server_for_path(&state, &relative)?;
            let method = match kind.as_str() { "incomingCalls" => "callHierarchy/incomingCalls", "outgoingCalls" => "callHierarchy/outgoingCalls", "supertypes" => "typeHierarchy/supertypes", "subtypes" => "typeHierarchy/subtypes", _ => unreachable!() };
            let response = request_server_value(&server, method, json!({"item":item}), &kind)?;
            if kind == "incomingCalls" || kind == "outgoingCalls" {
                let key = if kind == "incomingCalls" { "from" } else { "to" };
                let items = response.as_array().into_iter().flatten().filter_map(|entry| entry.get(key).cloned()).take(512).collect::<Vec<_>>();
                Ok(Value::Array(items))
            } else { Ok(response) }
        },
        _ => Err("unsupported hierarchy request".into()),
    }
}

fn apply_workspace_diagnostic_response(root: &Path, server: &LanguageServerInstance, response: &Value) {
    let Some(items) = response.get("items").and_then(Value::as_array) else { return; };
    for report in items.iter().take(2000) {
        let Some(uri) = report.get("uri").and_then(Value::as_str) else { continue; };
        let Some(diagnostics) = report.get("items").and_then(Value::as_array) else { continue; };
        if let Some((path, parsed)) = parse_diagnostic_items(root, uri, diagnostics) {
            if let Ok(mut map) = server.diagnostics.lock() { map.insert(path, parsed); }
        }
    }
}

#[tauri::command]
pub fn refresh_language_diagnostics(workspace: State<'_, WorkspaceState>, state: State<'_, LanguageServiceState>) -> Result<Vec<LanguageDiagnostic>, String> {
    let root = workspace_root(&workspace)?;
    let servers = state.servers.lock().map_err(|_| "language servers lock is poisoned".to_string())?.values().cloned().collect::<Vec<_>>();
    for server in servers {
        let status = server.status.lock().map_err(|_| "language status lock is poisoned".to_string())?.clone();
        if !status.running || !status.supports_workspace_diagnostics { continue; }
        match request_server_value(&server, "workspace/diagnostic", json!({"previousResultIds":[]}), "workspaceDiagnostic") {
            Ok(response) => apply_workspace_diagnostic_response(&root, &server, &response),
            Err(error) => append_log(&state.logs, &server.id, "warning", error),
        }
    }
    get_language_diagnostics(state)
}

#[tauri::command]
pub fn get_language_diagnostics(state: State<'_, LanguageServiceState>) -> Result<Vec<LanguageDiagnostic>, String> {
    let servers = state.servers.lock().map_err(|_| "language servers lock is poisoned".to_string())?.values().cloned().collect::<Vec<_>>();
    let mut result = Vec::new();
    for server in servers {
        if let Ok(map) = server.diagnostics.lock() {
            for items in map.values() {
                for item in items { result.push(item.clone()); if result.len() >= MAX_DIAGNOSTICS { return Ok(result); } }
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn get_language_server_logs(limit: Option<usize>, state: State<'_, LanguageServiceState>) -> Result<Vec<LanguageServerLogEntry>, String> {
    let limit = limit.unwrap_or(300).clamp(1, MAX_LOG_ENTRIES);
    let logs = state.logs.lock().map_err(|_| "language logs lock is poisoned".to_string())?;
    let start = logs.len().saturating_sub(limit);
    Ok(logs.iter().skip(start).cloned().collect())
}

#[cfg(test)]
mod tests {
    use super::{language_id, server_id_for_path, severity, supported_feature};

    #[test]
    fn language_ids_match_common_web_files() {
        assert_eq!(language_id("src/App.tsx"), "typescriptreact");
        assert_eq!(language_id("src/main.vue"), "vue");
        assert_eq!(language_id("src/App.svelte"), "svelte");
    }

    #[test]
    fn routes_frameworks_to_independent_servers() {
        assert_eq!(server_id_for_path("src/App.tsx"), Some("typescript"));
        assert_eq!(server_id_for_path("src/App.vue"), Some("vue"));
        assert_eq!(server_id_for_path("src/App.svelte"), Some("svelte"));
        assert_eq!(server_id_for_path("README.md"), None);
    }

    #[test]
    fn lsp_severity_mapping_is_stable() {
        assert_eq!(severity(Some(1)), "error");
        assert_eq!(severity(Some(2)), "warning");
        assert_eq!(severity(Some(4)), "hint");
    }

    #[test]
    fn new_language_features_are_exposed() {
        assert_eq!(supported_feature("semanticTokensFull"), Some("textDocument/semanticTokens/full"));
        assert_eq!(supported_feature("inlayHint"), Some("textDocument/inlayHint"));
        assert_eq!(supported_feature("formatting"), Some("textDocument/formatting"));
        assert_eq!(supported_feature("codeLens"), Some("textDocument/codeLens"));
    }
}
