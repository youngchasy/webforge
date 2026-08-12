use crate::{
    runtime::{configure_process_group, force_terminate_process_tree, terminate_process_tree},
    security::{require_terminal_allowed, WorkspaceSecurityState},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    env,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;
use tungstenite::{connect, stream::MaybeTlsStream, Message, WebSocket};
use url::Url;

const MAX_DEBUG_EVENTS: usize = 1500;
const MAX_CALL_FRAMES: usize = 80;
const MAX_DEBUG_SCRIPTS: usize = 600;
const MAX_VARIABLE_PROPERTIES: usize = 300;
const MAX_EVALUATE_EXPRESSION: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugBrowserInfo {
    id: String,
    label: String,
    available: bool,
    path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugScope {
    r#type: String,
    name: Option<String>,
    object_id: Option<String>,
    description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugCallFrame {
    call_frame_id: String,
    function_name: String,
    url: String,
    line: u32,
    column: u32,
    scopes: Vec<DebugScope>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugScript {
    script_id: String,
    url: String,
    source_map_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDebugStatus {
    running: bool,
    connected: bool,
    browser_id: Option<String>,
    browser_label: Option<String>,
    pid: Option<u32>,
    port: Option<u16>,
    target_id: Option<String>,
    target_title: Option<String>,
    target_url: Option<String>,
    paused: bool,
    pause_reason: Option<String>,
    call_frames: Vec<DebugCallFrame>,
    script_count: usize,
    scripts: Vec<DebugScript>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDebugEvent {
    cursor: usize,
    kind: String,
    text: String,
    url: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDebugEventBatch {
    cursor: usize,
    events: Vec<BrowserDebugEvent>,
    status: BrowserDebugStatus,
}

struct DebugEventBuffer {
    base_cursor: usize,
    events: VecDeque<BrowserDebugEvent>,
}

impl DebugEventBuffer {
    fn new() -> Self { Self { base_cursor: 0, events: VecDeque::new() } }
    fn clear(&mut self) { self.base_cursor = 0; self.events.clear(); }
    fn push(&mut self, kind: &str, text: String, url: Option<String>, line: Option<u32>, column: Option<u32>) {
        let cursor = self.base_cursor + self.events.len();
        self.events.push_back(BrowserDebugEvent { cursor, kind: kind.into(), text, url, line, column });
        while self.events.len() > MAX_DEBUG_EVENTS { self.events.pop_front(); self.base_cursor += 1; }
    }
    fn current_cursor(&self) -> usize { self.base_cursor + self.events.len() }
}

struct DebugRequest {
    method: String,
    params: Value,
    reply: mpsc::Sender<Result<Value, String>>,
}

pub struct BrowserDebugState {
    child: Mutex<Option<Child>>,
    sender: Mutex<Option<mpsc::Sender<DebugRequest>>>,
    status: Arc<Mutex<BrowserDebugStatus>>,
    events: Arc<Mutex<DebugEventBuffer>>,
    profile_dir: Mutex<Option<PathBuf>>,
}

fn idle_status() -> BrowserDebugStatus {
    BrowserDebugStatus { running: false, connected: false, browser_id: None, browser_label: None, pid: None, port: None, target_id: None, target_title: None, target_url: None, paused: false, pause_reason: None, call_frames: Vec::new(), script_count: 0, scripts: Vec::new(), error: None }
}

impl BrowserDebugState {
    pub fn new() -> Self {
        Self { child: Mutex::new(None), sender: Mutex::new(None), status: Arc::new(Mutex::new(idle_status())), events: Arc::new(Mutex::new(DebugEventBuffer::new())), profile_dir: Mutex::new(None) }
    }

    pub fn stop(&self) -> Result<(), String> {
        *self.sender.lock().map_err(|_| "debug command lock is poisoned".to_string())? = None;
        let mut child_guard = self.child.lock().map_err(|_| "debug child lock is poisoned".to_string())?;
        if let Some(mut child) = child_guard.take() {
            let pid = child.id();
            terminate_process_tree(pid, &mut child);
            thread::sleep(Duration::from_millis(80));
            if child.try_wait().ok().flatten().is_none() { force_terminate_process_tree(pid, &mut child); }
            let _ = child.wait();
        }
        if let Some(profile) = self.profile_dir.lock().map_err(|_| "debug profile lock is poisoned".to_string())?.take() { let _ = fs::remove_dir_all(profile); }
        *self.status.lock().map_err(|_| "debug status lock is poisoned".to_string())? = idle_status();
        Ok(())
    }

    fn refresh_process(&self) -> Result<BrowserDebugStatus, String> {
        let mut exited = false;
        {
            let mut child_guard = self.child.lock().map_err(|_| "debug child lock is poisoned".to_string())?;
            if let Some(child) = child_guard.as_mut() {
                if child.try_wait().map_err(|error| error.to_string())?.is_some() { exited = true; *child_guard = None; }
            }
        }
        if exited {
            if let Ok(mut status) = self.status.lock() { status.running = false; status.connected = false; status.pid = None; status.error = Some("debug browser exited".into()); }
            *self.sender.lock().map_err(|_| "debug command lock is poisoned".to_string())? = None;
        }
        self.status.lock().map_err(|_| "debug status lock is poisoned".to_string()).map(|value| value.clone())
    }
}

fn path_extensions() -> Vec<String> {
    #[cfg(target_os = "windows")]
    { env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into()).split(';').map(|value| value.to_ascii_lowercase()).collect() }
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

fn browser_candidates() -> Vec<(&'static str, &'static str, Vec<PathBuf>)> {
    let mut edge = Vec::new();
    let mut chrome = Vec::new();
    let mut chromium = Vec::new();
    #[cfg(target_os = "windows")]
    {
        for base in [env::var_os("PROGRAMFILES"), env::var_os("PROGRAMFILES(X86)")].into_iter().flatten() {
            edge.push(PathBuf::from(&base).join("Microsoft/Edge/Application/msedge.exe"));
            chrome.push(PathBuf::from(&base).join("Google/Chrome/Application/chrome.exe"));
        }
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            edge.push(PathBuf::from(&local).join("Microsoft/Edge/Application/msedge.exe"));
            chrome.push(PathBuf::from(&local).join("Google/Chrome/Application/chrome.exe"));
        }
        if let Some(path) = find_on_path("msedge") { edge.push(path); }
        if let Some(path) = find_on_path("chrome") { chrome.push(path); }
        if let Some(path) = find_on_path("chromium") { chromium.push(path); }
    }
    #[cfg(target_os = "macos")]
    {
        edge.push(PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"));
        chrome.push(PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
        chromium.push(PathBuf::from("/Applications/Chromium.app/Contents/MacOS/Chromium"));
    }
    #[cfg(target_os = "linux")]
    {
        for name in ["microsoft-edge", "microsoft-edge-stable"] { if let Some(path) = find_on_path(name) { edge.push(path); } }
        for name in ["google-chrome", "google-chrome-stable"] { if let Some(path) = find_on_path(name) { chrome.push(path); } }
        for name in ["chromium", "chromium-browser"] { if let Some(path) = find_on_path(name) { chromium.push(path); } }
    }
    vec![("edge", "Microsoft Edge", edge), ("chrome", "Google Chrome", chrome), ("chromium", "Chromium", chromium)]
}

fn resolve_browser(id: &str) -> Option<(String, PathBuf)> {
    browser_candidates().into_iter().find_map(|(candidate_id, label, paths)| {
        if candidate_id != id { return None; }
        paths.into_iter().find(|path| path.is_file()).map(|path| (label.into(), path))
    })
}

fn reserve_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    Ok(listener.local_addr().map_err(|error| error.to_string())?.port())
}

fn validate_debug_url(value: &str) -> Result<String, String> {
    let parsed = Url::parse(value).map_err(|_| "debug target URL is invalid".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") { return Err("browser debugging only supports http/https preview URLs".into()); }
    let host = parsed.host_str().unwrap_or("").to_ascii_lowercase();
    if !matches!(host.as_str(), "127.0.0.1" | "localhost" | "[::1]" | "::1") { return Err("managed browser debugging is restricted to loopback preview URLs".into()); }
    Ok(parsed.to_string())
}

fn http_get(port: u16, path: &str) -> Result<String, String> {
    let mut stream = TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().map_err(|_| "invalid debug port".to_string())?, Duration::from_millis(500)).map_err(|error| error.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(1))).map_err(|error| error.to_string())?;
    stream.write_all(format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").as_bytes()).map_err(|error| error.to_string())?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|error| error.to_string())?;
    let text = String::from_utf8_lossy(&raw);
    let (_, body) = text.split_once("\r\n\r\n").ok_or_else(|| "invalid browser debug HTTP response".to_string())?;
    Ok(body.to_string())
}

fn wait_for_page_target(port: u16, target_url: &str) -> Result<Value, String> {
    let deadline = Instant::now() + Duration::from_secs(12);
    let target_origin = Url::parse(target_url).ok().map(|url| url.origin().unicode_serialization()).unwrap_or_default();
    loop {
        if Instant::now() >= deadline { return Err("timed out waiting for Chromium debug target".into()); }
        if let Ok(raw) = http_get(port, "/json/list") {
            if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                if let Some(items) = value.as_array() {
                    let page = items.iter().find(|item| item.get("type").and_then(Value::as_str) == Some("page") && item.get("url").and_then(Value::as_str).is_some_and(|url| url.starts_with(&target_origin)))
                        .or_else(|| items.iter().find(|item| item.get("type").and_then(Value::as_str) == Some("page")));
                    if let Some(page) = page { if page.get("webSocketDebuggerUrl").and_then(Value::as_str).is_some() { return Ok(page.clone()); } }
                }
            }
        }
        thread::sleep(Duration::from_millis(120));
    }
}

fn set_socket_timeout(socket: &mut WebSocket<MaybeTlsStream<TcpStream>>) {
    if let MaybeTlsStream::Plain(stream) = socket.get_mut() {
        let _ = stream.set_read_timeout(Some(Duration::from_millis(80)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    }
}

fn parse_call_frames(params: &Value) -> Vec<DebugCallFrame> {
    params.get("callFrames").and_then(Value::as_array).into_iter().flatten().take(MAX_CALL_FRAMES).map(|frame| {
        let location = frame.get("location").cloned().unwrap_or(Value::Null);
        let scopes = frame.get("scopeChain").and_then(Value::as_array).into_iter().flatten().take(40).map(|scope| {
            let object = scope.get("object").cloned().unwrap_or(Value::Null);
            DebugScope {
                r#type: scope.get("type").and_then(Value::as_str).unwrap_or("unknown").to_string(),
                name: scope.get("name").and_then(Value::as_str).map(str::to_string),
                object_id: object.get("objectId").and_then(Value::as_str).map(str::to_string),
                description: object.get("description").and_then(Value::as_str).map(str::to_string),
            }
        }).collect();
        DebugCallFrame {
            call_frame_id: frame.get("callFrameId").and_then(Value::as_str).unwrap_or("").to_string(),
            function_name: frame.get("functionName").and_then(Value::as_str).unwrap_or("(anonymous)").to_string(),
            url: frame.get("url").and_then(Value::as_str).unwrap_or("").to_string(),
            line: location.get("lineNumber").and_then(Value::as_u64).unwrap_or(0) as u32 + 1,
            column: location.get("columnNumber").and_then(Value::as_u64).unwrap_or(0) as u32 + 1,
            scopes,
        }
    }).collect()
}

fn sanitize_remote_object(value: &Value) -> Value {
    let mut result = serde_json::Map::new();
    for key in ["type", "subtype", "className", "description", "value", "unserializableValue", "objectId"] {
        if let Some(item) = value.get(key) { result.insert(key.to_string(), item.clone()); }
    }
    Value::Object(result)
}

fn sanitize_properties(result: Value) -> Value {
    let properties = result.get("result").and_then(Value::as_array).into_iter().flatten().take(MAX_VARIABLE_PROPERTIES).map(|item| {
        json!({
            "name": item.get("name").and_then(Value::as_str).unwrap_or(""),
            "value": item.get("value").map(sanitize_remote_object),
            "enumerable": item.get("enumerable").and_then(Value::as_bool).unwrap_or(false),
            "configurable": item.get("configurable").and_then(Value::as_bool).unwrap_or(false),
            "writable": item.get("writable").and_then(Value::as_bool),
        })
    }).collect::<Vec<_>>();
    json!({"result": properties})
}

fn event_text(method: &str, params: &Value) -> Option<(String, Option<String>, Option<u32>, Option<u32>)> {
    match method {
        "Runtime.consoleAPICalled" => {
            let kind = params.get("type").and_then(Value::as_str).unwrap_or("log");
            let text = params.get("args").and_then(Value::as_array).map(|items| items.iter().map(|item| item.get("value").map(Value::to_string).or_else(|| item.get("description").and_then(Value::as_str).map(str::to_string)).unwrap_or_default()).collect::<Vec<_>>().join(" ")).unwrap_or_default();
            Some((format!("console.{kind}: {text}"), None, None, None))
        },
        "Runtime.exceptionThrown" => {
            let details = params.get("exceptionDetails").cloned().unwrap_or(Value::Null);
            let text = details.get("text").and_then(Value::as_str).unwrap_or("JavaScript exception").to_string();
            let url = details.get("url").and_then(Value::as_str).map(str::to_string);
            let line = details.get("lineNumber").and_then(Value::as_u64).map(|value| value as u32 + 1);
            let column = details.get("columnNumber").and_then(Value::as_u64).map(|value| value as u32 + 1);
            Some((text, url, line, column))
        },
        _ => None,
    }
}

fn process_event(message: &Value, status: &Arc<Mutex<BrowserDebugStatus>>, events: &Arc<Mutex<DebugEventBuffer>>) {
    let Some(method) = message.get("method").and_then(Value::as_str) else { return; };
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    match method {
        "Debugger.paused" => {
            if let Ok(mut guard) = status.lock() {
                guard.paused = true;
                guard.pause_reason = params.get("reason").and_then(Value::as_str).map(str::to_string);
                guard.call_frames = parse_call_frames(&params);
            }
            if let Ok(mut log) = events.lock() { log.push("paused", format!("Paused: {}", params.get("reason").and_then(Value::as_str).unwrap_or("other")), None, None, None); }
        },
        "Debugger.resumed" => {
            if let Ok(mut guard) = status.lock() { guard.paused = false; guard.pause_reason = None; guard.call_frames.clear(); }
            if let Ok(mut log) = events.lock() { log.push("resumed", "Execution resumed".into(), None, None, None); }
        },
        "Debugger.scriptParsed" => {
            if let Ok(mut guard) = status.lock() {
                guard.script_count = guard.script_count.saturating_add(1);
                let script_id = params.get("scriptId").and_then(Value::as_str).unwrap_or("").to_string();
                let url = params.get("url").and_then(Value::as_str).unwrap_or("").to_string();
                if !script_id.is_empty() && !url.is_empty() {
                    let script = DebugScript { script_id: script_id.clone(), url, source_map_url: params.get("sourceMapURL").and_then(Value::as_str).filter(|value| !value.is_empty()).map(str::to_string) };
                    if let Some(existing) = guard.scripts.iter_mut().find(|item| item.script_id == script_id) { *existing = script; }
                    else { guard.scripts.push(script); if guard.scripts.len() > MAX_DEBUG_SCRIPTS { guard.scripts.remove(0); } }
                }
            }
        },
        "Debugger.breakpointResolved" => {
            if let Some(id) = params.get("breakpointId").and_then(Value::as_str) {
                if let Ok(mut log) = events.lock() { log.push("breakpointResolved", format!("Resolved {id}"), None, None, None); }
            }
        },
        _ => {
            if let Some((text, url, line, column)) = event_text(method, &params) {
                if let Ok(mut log) = events.lock() { log.push(method, text, url, line, column); }
            }
        }
    }
}

fn read_message(socket: &mut WebSocket<MaybeTlsStream<TcpStream>>) -> Result<Option<Value>, String> {
    match socket.read() {
        Ok(Message::Text(text)) => serde_json::from_str::<Value>(text.as_str()).map(Some).map_err(|error| error.to_string()),
        Ok(Message::Close(_)) => Err("browser debugger connection closed".into()),
        Ok(_) => Ok(None),
        Err(tungstenite::Error::Io(error)) if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn send_cdp_request(socket: &mut WebSocket<MaybeTlsStream<TcpStream>>, id: i64, method: &str, params: Value, status: &Arc<Mutex<BrowserDebugStatus>>, events: &Arc<Mutex<DebugEventBuffer>>) -> Result<Value, String> {
    socket.send(Message::Text(json!({"id":id,"method":method,"params":params}).to_string().into())).map_err(|error| error.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if let Some(message) = read_message(socket)? {
            if message.get("id").and_then(Value::as_i64) == Some(id) {
                if let Some(error) = message.get("error") { return Err(format!("CDP {method} failed: {error}")); }
                return Ok(message.get("result").cloned().unwrap_or(Value::Null));
            }
            process_event(&message, status, events);
        }
    }
    Err(format!("CDP request '{method}' timed out"))
}

fn spawn_cdp_loop(ws_url: String, status: Arc<Mutex<BrowserDebugStatus>>, events: Arc<Mutex<DebugEventBuffer>>, receiver: mpsc::Receiver<DebugRequest>) {
    thread::spawn(move || {
        let (mut socket, _) = match connect(&ws_url) {
            Ok(value) => value,
            Err(error) => { if let Ok(mut guard) = status.lock() { guard.connected = false; guard.error = Some(format!("unable to connect debugger WebSocket: {error}")); } return; }
        };
        set_socket_timeout(&mut socket);
        let mut next_id = 1i64;
        for method in ["Runtime.enable", "Debugger.enable", "Page.enable"] {
            let _ = send_cdp_request(&mut socket, next_id, method, json!({}), &status, &events);
            next_id += 1;
        }
        if let Ok(mut guard) = status.lock() { guard.connected = true; guard.error = None; }
        if let Ok(mut log) = events.lock() { log.push("connected", "Chrome DevTools Protocol connected".into(), None, None, None); }
        loop {
            loop {
                match receiver.try_recv() {
                    Ok(request) => {
                        let result = send_cdp_request(&mut socket, next_id, &request.method, request.params, &status, &events);
                        next_id += 1;
                        let _ = request.reply.send(result);
                    }
                    Err(mpsc::TryRecvError::Empty) => break,
                    Err(mpsc::TryRecvError::Disconnected) => return,
                }
            }
            match read_message(&mut socket) {
                Ok(Some(message)) => process_event(&message, &status, &events),
                Ok(None) => {},
                Err(error) => { if let Ok(mut guard) = status.lock() { guard.connected = false; guard.error = Some(error); } return; }
            }
        }
    });
}

#[tauri::command]
pub fn probe_debug_browsers() -> Result<Vec<DebugBrowserInfo>, String> {
    Ok(browser_candidates().into_iter().map(|(id, label, paths)| {
        let path = paths.into_iter().find(|path| path.is_file());
        DebugBrowserInfo { id: id.into(), label: label.into(), available: path.is_some(), path: path.map(|value| value.to_string_lossy().to_string()) }
    }).collect())
}

#[tauri::command]
pub fn start_browser_debug(
    browser_id: String,
    url: String,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, BrowserDebugState>,
) -> Result<BrowserDebugStatus, String> {
    require_terminal_allowed(&security)?;
    let target_url = validate_debug_url(&url)?;
    let (browser_label, executable) = resolve_browser(&browser_id).ok_or_else(|| format!("debug browser '{browser_id}' is not available"))?;
    state.stop()?;
    let port = reserve_port()?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_nanos()).unwrap_or(0);
    let profile = env::temp_dir().join(format!("webforge-debug-profile-{}-{stamp}", std::process::id()));
    fs::create_dir_all(&profile).map_err(|error| format!("unable to create isolated debug profile: {error}"))?;
    let mut command = Command::new(&executable);
    configure_process_group(&mut command);
    let browser_args = vec![
        "--remote-debugging-address=127.0.0.1".to_string(),
        format!("--remote-debugging-port={port}"),
        format!("--user-data-dir={}", profile.to_string_lossy()),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--disable-default-apps".to_string(),
    ];
    command
        .args(browser_args)
        .arg(&target_url)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = command.spawn().map_err(|error| format!("unable to start debug browser: {error}"))?;
    let pid = child.id();
    let target = match wait_for_page_target(port, &target_url) {
        Ok(value) => value,
        Err(error) => {
            terminate_process_tree(pid, &mut child);
            let _ = child.wait();
            let _ = fs::remove_dir_all(&profile);
            return Err(error);
        }
    };
    let ws_url = target.get("webSocketDebuggerUrl").and_then(Value::as_str).ok_or_else(|| "debug target has no WebSocket URL".to_string())?.to_string();
    let target_id = target.get("id").and_then(Value::as_str).map(str::to_string);
    let target_title = target.get("title").and_then(Value::as_str).map(str::to_string);
    let actual_url = target.get("url").and_then(Value::as_str).map(str::to_string).or_else(|| Some(target_url.clone()));
    if let Ok(mut events) = state.events.lock() { events.clear(); }
    let status = BrowserDebugStatus { running: true, connected: false, browser_id: Some(browser_id), browser_label: Some(browser_label), pid: Some(pid), port: Some(port), target_id, target_title, target_url: actual_url, paused: false, pause_reason: None, call_frames: Vec::new(), script_count: 0, scripts: Vec::new(), error: None };
    *state.status.lock().map_err(|_| "debug status lock is poisoned".to_string())? = status.clone();
    *state.child.lock().map_err(|_| "debug child lock is poisoned".to_string())? = Some(child);
    *state.profile_dir.lock().map_err(|_| "debug profile lock is poisoned".to_string())? = Some(profile);
    let (sender, receiver) = mpsc::channel();
    *state.sender.lock().map_err(|_| "debug command lock is poisoned".to_string())? = Some(sender);
    spawn_cdp_loop(ws_url, Arc::clone(&state.status), Arc::clone(&state.events), receiver);
    Ok(status)
}

#[tauri::command]
pub fn stop_browser_debug(state: State<'_, BrowserDebugState>) -> Result<BrowserDebugStatus, String> {
    state.stop()?;
    state.refresh_process()
}

#[tauri::command]
pub fn get_browser_debug_status(state: State<'_, BrowserDebugState>) -> Result<BrowserDebugStatus, String> { state.refresh_process() }

#[tauri::command]
pub fn poll_browser_debug_events(cursor: usize, state: State<'_, BrowserDebugState>) -> Result<BrowserDebugEventBatch, String> {
    let status = state.refresh_process()?;
    let events = state.events.lock().map_err(|_| "debug events lock is poisoned".to_string())?;
    let start = cursor.max(events.base_cursor).saturating_sub(events.base_cursor).min(events.events.len());
    Ok(BrowserDebugEventBatch { cursor: events.current_cursor(), events: events.events.iter().skip(start).cloned().collect(), status })
}

#[tauri::command]
pub fn browser_debug_action(
    action: String,
    expression: Option<String>,
    url: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
    call_frame_id: Option<String>,
    object_id: Option<String>,
    breakpoint_id: Option<String>,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, BrowserDebugState>,
) -> Result<Value, String> {
    require_terminal_allowed(&security)?;
    if !state.status.lock().map_err(|_| "debug status lock is poisoned".to_string())?.connected { return Err("browser debugger is not connected".into()); }
    let (method, params) = match action.as_str() {
        "pause" => ("Debugger.pause", json!({})),
        "resume" => ("Debugger.resume", json!({})),
        "stepOver" => ("Debugger.stepOver", json!({})),
        "stepInto" => ("Debugger.stepInto", json!({})),
        "stepOut" => ("Debugger.stepOut", json!({})),
        "reload" => ("Page.reload", json!({"ignoreCache":false})),
        "evaluate" => {
            let expression = expression.unwrap_or_default();
            if expression.len() > MAX_EVALUATE_EXPRESSION { return Err("debug expression exceeds 16 KiB limit".into()); }
            if let Some(frame) = call_frame_id.filter(|value| !value.is_empty()) {
                ("Debugger.evaluateOnCallFrame", json!({"callFrameId":frame,"expression":expression,"returnByValue":false,"throwOnSideEffect":false,"silent":true}))
            } else {
                ("Runtime.evaluate", json!({"expression":expression,"returnByValue":false,"awaitPromise":true,"userGesture":false}))
            }
        },
        "getProperties" => {
            let object = object_id.filter(|value| !value.is_empty()).ok_or_else(|| "variable expansion requires an object id".to_string())?;
            ("Runtime.getProperties", json!({"objectId":object,"ownProperties":true,"accessorPropertiesOnly":false,"generatePreview":true}))
        },
        "setBreakpoint" => {
            let url = validate_debug_url(url.as_deref().ok_or_else(|| "breakpoint requires a source URL".to_string())?)?;
            ("Debugger.setBreakpointByUrl", json!({"url":url,"lineNumber":line.unwrap_or(1).saturating_sub(1),"columnNumber":column.unwrap_or(1).saturating_sub(1)}))
        },
        "removeBreakpoint" => {
            let id = breakpoint_id.filter(|value| !value.is_empty()).ok_or_else(|| "remove breakpoint requires an id".to_string())?;
            ("Debugger.removeBreakpoint", json!({"breakpointId":id}))
        },
        _ => return Err("unsupported browser debug action".into()),
    };
    let (reply_tx, reply_rx) = mpsc::channel();
    let sender = state.sender.lock().map_err(|_| "debug command lock is poisoned".to_string())?.as_ref().cloned().ok_or_else(|| "browser debugger command channel is unavailable".to_string())?;
    sender.send(DebugRequest { method: method.into(), params, reply: reply_tx }).map_err(|_| "browser debugger command channel is closed".to_string())?;
    let result = reply_rx.recv_timeout(Duration::from_secs(6)).map_err(|_| "browser debugger action timed out".to_string())??;
    if action == "getProperties" { Ok(sanitize_properties(result)) } else { Ok(result) }
}

#[cfg(test)]
mod tests {
    use super::validate_debug_url;

    #[test]
    fn debug_urls_are_loopback_only() {
        assert!(validate_debug_url("http://127.0.0.1:5173/").is_ok());
        assert!(validate_debug_url("http://localhost:1420/src/main.ts").is_ok());
        assert!(validate_debug_url("https://example.com").is_err());
        assert!(validate_debug_url("file:///tmp/index.html").is_err());
    }
}
