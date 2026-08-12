use crate::{
    security::{require_terminal_allowed, WorkspaceSecurityState},
    workspace::{workspace_root, WorkspaceState},
};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    sync::{Arc, Mutex},
    sync::atomic::{AtomicU64, Ordering},
    thread,
};
use tauri::State;

const MAX_TERMINAL_OUTPUT_CHUNKS: usize = 4096;
const MAX_TERMINAL_INPUT_BYTES: usize = 64 * 1024;
const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 30;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionStatus {
    id: String,
    title: String,
    shell: String,
    running: bool,
    exit_code: Option<i32>,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputBatch {
    cursor: usize,
    chunks: Vec<String>,
    status: TerminalSessionStatus,
}

struct TerminalOutputBuffer {
    base_cursor: usize,
    chunks: VecDeque<String>,
}

impl TerminalOutputBuffer {
    fn new() -> Self { Self { base_cursor: 0, chunks: VecDeque::new() } }
    fn push(&mut self, chunk: String) {
        if chunk.is_empty() { return; }
        self.chunks.push_back(chunk);
        while self.chunks.len() > MAX_TERMINAL_OUTPUT_CHUNKS {
            self.chunks.pop_front();
            self.base_cursor += 1;
        }
    }
    fn current_cursor(&self) -> usize { self.base_cursor + self.chunks.len() }
}

struct TerminalSession {
    id: String,
    title: String,
    shell: String,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Option<Box<dyn Child + Send>>>,
    output: Arc<Mutex<TerminalOutputBuffer>>,
    size: Mutex<(u16, u16)>,
    exit_code: Mutex<Option<i32>>,
}

impl TerminalSession {
    fn status(&self) -> Result<TerminalSessionStatus, String> {
        self.refresh()?;
        let running = self.child.lock().map_err(|_| "terminal child lock is poisoned".to_string())?.is_some();
        let (cols, rows) = *self.size.lock().map_err(|_| "terminal size lock is poisoned".to_string())?;
        let exit_code = *self.exit_code.lock().map_err(|_| "terminal exit lock is poisoned".to_string())?;
        Ok(TerminalSessionStatus {
            id: self.id.clone(),
            title: self.title.clone(),
            shell: self.shell.clone(),
            running,
            exit_code,
            cols,
            rows,
        })
    }

    fn refresh(&self) -> Result<(), String> {
        let mut child_guard = self.child.lock().map_err(|_| "terminal child lock is poisoned".to_string())?;
        let Some(child) = child_guard.as_mut() else { return Ok(()); };
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            let code = status.exit_code() as i32;
            *self.exit_code.lock().map_err(|_| "terminal exit lock is poisoned".to_string())? = Some(code);
            *child_guard = None;
            if let Ok(mut output) = self.output.lock() {
                output.push(format!("\r\n[WebForge] shell exited with code {code}\r\n"));
            }
        }
        Ok(())
    }

    fn stop(&self) -> Result<(), String> {
        let mut child_guard = self.child.lock().map_err(|_| "terminal child lock is poisoned".to_string())?;
        if let Some(mut child) = child_guard.take() {
            let _ = child.kill();
            let status = child.wait().ok();
            let code = status.map(|value| value.exit_code() as i32);
            *self.exit_code.lock().map_err(|_| "terminal exit lock is poisoned".to_string())? = code;
            if let Ok(mut output) = self.output.lock() {
                output.push("\r\n[WebForge] terminal stopped\r\n".to_string());
            }
        }
        Ok(())
    }
}

pub struct TerminalState {
    sessions: Mutex<HashMap<String, Arc<TerminalSession>>>,
    next_id: AtomicU64,
}

impl TerminalState {
    pub fn new() -> Self {
        Self { sessions: Mutex::new(HashMap::new()), next_id: AtomicU64::new(1) }
    }

    fn session(&self, id: &str) -> Result<Arc<TerminalSession>, String> {
        self.sessions
            .lock()
            .map_err(|_| "terminal session lock is poisoned".to_string())?
            .get(id)
            .cloned()
            .ok_or_else(|| format!("terminal session not found: {id}"))
    }

    pub fn stop(&self) -> Result<(), String> {
        let sessions = self.sessions
            .lock()
            .map_err(|_| "terminal session lock is poisoned".to_string())?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for session in sessions { let _ = session.stop(); }
        Ok(())
    }

    pub fn clear(&self) -> Result<(), String> {
        self.stop()?;
        self.sessions.lock().map_err(|_| "terminal session lock is poisoned".to_string())?.clear();
        Ok(())
    }
}

fn terminal_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        return std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let configured = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        if std::path::Path::new(&configured).is_file() { configured } else { "/bin/sh".to_string() }
    }
}

fn clamp_size(cols: u16, rows: u16) -> (u16, u16) {
    (cols.clamp(20, 500), rows.clamp(5, 200))
}

fn spawn_output_reader(mut reader: Box<dyn Read + Send>, output: Arc<Mutex<TerminalOutputBuffer>>) {
    thread::spawn(move || {
        let mut bytes = [0u8; 8192];
        let mut pending = Vec::<u8>::new();
        loop {
            match reader.read(&mut bytes) {
                Ok(0) => {
                    if !pending.is_empty() {
                        let chunk = String::from_utf8_lossy(&pending).into_owned();
                        if let Ok(mut guard) = output.lock() { guard.push(chunk); }
                    }
                    break;
                }
                Ok(count) => {
                    pending.extend_from_slice(&bytes[..count]);
                    loop {
                        match std::str::from_utf8(&pending) {
                            Ok(text) => {
                                if !text.is_empty() {
                                    if let Ok(mut guard) = output.lock() { guard.push(text.to_string()); }
                                }
                                pending.clear();
                                break;
                            }
                            Err(error) => {
                                let valid = error.valid_up_to();
                                if valid > 0 {
                                    let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
                                    if let Ok(mut guard) = output.lock() { guard.push(text); }
                                    pending.drain(..valid);
                                }
                                if let Some(length) = error.error_len() {
                                    let take = length.min(pending.len());
                                    if take == 0 { break; }
                                    let text = String::from_utf8_lossy(&pending[..take]).into_owned();
                                    if let Ok(mut guard) = output.lock() { guard.push(text); }
                                    pending.drain(..take);
                                    continue;
                                }
                                // The tail is a valid but incomplete UTF-8 sequence; keep it for the next PTY read.
                                break;
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });
}

#[tauri::command]
pub fn create_terminal_session(
    title: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, TerminalState>,
) -> Result<TerminalSessionStatus, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&workspace)?;
    let (cols, rows) = clamp_size(cols.unwrap_or(DEFAULT_COLS), rows.unwrap_or(DEFAULT_ROWS));
    let shell = terminal_shell();
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|error| format!("unable to open PTY: {error}"))?;

    let mut command = CommandBuilder::new(&shell);
    command.cwd(&root);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("WEBFORGE_TERMINAL", "1");
    let child = pair.slave.spawn_command(command).map_err(|error| format!("unable to spawn PTY shell {shell}: {error}"))?;
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(|error| format!("unable to clone PTY reader: {error}"))?;
    let writer = pair.master.take_writer().map_err(|error| format!("unable to take PTY writer: {error}"))?;
    let output = Arc::new(Mutex::new(TerminalOutputBuffer::new()));
    spawn_output_reader(reader, Arc::clone(&output));

    let number = state.next_id.fetch_add(1, Ordering::Relaxed);
    let id = format!("term-{number}");
    let title = title
        .map(|value| value.trim().chars().take(40).collect::<String>())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("Terminal {number}"));
    let session = Arc::new(TerminalSession {
        id: id.clone(),
        title,
        shell,
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(Some(child)),
        output,
        size: Mutex::new((cols, rows)),
        exit_code: Mutex::new(None),
    });
    let status = session.status()?;
    state.sessions.lock().map_err(|_| "terminal session lock is poisoned".to_string())?.insert(id, session);
    Ok(status)
}

#[tauri::command]
pub fn list_terminal_sessions(state: State<'_, TerminalState>) -> Result<Vec<TerminalSessionStatus>, String> {
    let sessions = state.sessions
        .lock()
        .map_err(|_| "terminal session lock is poisoned".to_string())?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    let mut statuses = sessions.into_iter().map(|session| session.status()).collect::<Result<Vec<_>, _>>()?;
    statuses.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(statuses)
}

#[tauri::command]
pub fn write_terminal_input(
    session_id: String,
    data: String,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    require_terminal_allowed(&security)?;
    if data.len() > MAX_TERMINAL_INPUT_BYTES { return Err("terminal input chunk is too large".into()); }
    let session = state.session(&session_id)?;
    let mut writer = session.writer.lock().map_err(|_| "terminal writer lock is poisoned".to_string())?;
    writer.write_all(data.as_bytes()).map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn resize_terminal_session(
    session_id: String,
    cols: u16,
    rows: u16,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, TerminalState>,
) -> Result<TerminalSessionStatus, String> {
    require_terminal_allowed(&security)?;
    let (cols, rows) = clamp_size(cols, rows);
    let session = state.session(&session_id)?;
    session.master.lock().map_err(|_| "terminal master lock is poisoned".to_string())?
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|error| error.to_string())?;
    *session.size.lock().map_err(|_| "terminal size lock is poisoned".to_string())? = (cols, rows);
    session.status()
}

#[tauri::command]
pub fn poll_terminal_output(
    session_id: String,
    cursor: usize,
    state: State<'_, TerminalState>,
) -> Result<TerminalOutputBatch, String> {
    let session = state.session(&session_id)?;
    let status = session.status()?;
    let output = session.output.lock().map_err(|_| "terminal output lock is poisoned".to_string())?;
    let current_cursor = output.current_cursor();
    let normalized = cursor.max(output.base_cursor).min(current_cursor);
    let start = normalized - output.base_cursor;
    Ok(TerminalOutputBatch {
        cursor: current_cursor,
        chunks: output.chunks.iter().skip(start).cloned().collect(),
        status,
    })
}

#[tauri::command]
pub fn close_terminal_session(session_id: String, state: State<'_, TerminalState>) -> Result<(), String> {
    let session = state.sessions.lock().map_err(|_| "terminal session lock is poisoned".to_string())?.remove(&session_id);
    if let Some(session) = session { session.stop()?; }
    Ok(())
}

#[tauri::command]
pub fn close_all_terminal_sessions(state: State<'_, TerminalState>) -> Result<(), String> { state.clear() }

#[cfg(test)]
mod tests {
    use super::{clamp_size, TerminalOutputBuffer, MAX_TERMINAL_OUTPUT_CHUNKS};

    #[test]
    fn terminal_output_cursor_survives_truncation() {
        let mut output = TerminalOutputBuffer::new();
        for index in 0..(MAX_TERMINAL_OUTPUT_CHUNKS + 3) { output.push(format!("chunk {index}")); }
        assert_eq!(output.base_cursor, 3);
        assert_eq!(output.current_cursor(), MAX_TERMINAL_OUTPUT_CHUNKS + 3);
    }

    #[test]
    fn pty_size_is_bounded() {
        assert_eq!(clamp_size(1, 1), (20, 5));
        assert_eq!(clamp_size(900, 900), (500, 200));
    }
}
