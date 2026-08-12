use serde::Serialize;
use std::sync::Mutex;
use tauri::State;
use crate::{debugger::BrowserDebugState, language_services::LanguageServiceState, runtime::RuntimeState, tasks::TaskState, terminal::TerminalState};

pub struct WorkspaceSecurityState(pub Mutex<WorkspaceSecurity>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSecurity {
    trusted: bool,
    terminal_allowed: bool,
    git_network_allowed: bool,
}

impl WorkspaceSecurityState {
    pub fn new() -> Self {
        Self(Mutex::new(WorkspaceSecurity { trusted: false, terminal_allowed: false, git_network_allowed: false }))
    }

    pub fn reset(&self) -> Result<(), String> {
        let mut guard = self.0.lock().map_err(|_| "workspace security lock is poisoned".to_string())?;
        guard.trusted = false;
        guard.terminal_allowed = false;
        guard.git_network_allowed = false;
        Ok(())
    }

    pub fn set_trusted(&self, trusted: bool) -> Result<(), String> {
        let mut guard = self.0.lock().map_err(|_| "workspace security lock is poisoned".to_string())?;
        guard.trusted = trusted;
        if !trusted { guard.terminal_allowed = false; guard.git_network_allowed = false; }
        Ok(())
    }

    pub fn set_terminal_allowed(&self, allowed: bool) -> Result<(), String> {
        let mut guard = self.0.lock().map_err(|_| "workspace security lock is poisoned".to_string())?;
        if allowed && !guard.trusted { return Err("trust the workspace before enabling terminal commands".into()); }
        guard.terminal_allowed = allowed;
        if !allowed { guard.git_network_allowed = false; }
        Ok(())
    }

    pub fn snapshot(&self) -> Result<WorkspaceSecurity, String> {
        self.0.lock().map_err(|_| "workspace security lock is poisoned".to_string()).map(|value| value.clone())
    }

    pub fn is_trusted(&self) -> Result<bool, String> { Ok(self.snapshot()?.trusted) }
    pub fn terminal_allowed(&self) -> Result<bool, String> { Ok(self.snapshot()?.terminal_allowed) }
    pub fn git_network_allowed(&self) -> Result<bool, String> { Ok(self.snapshot()?.git_network_allowed) }

    pub fn set_git_network_allowed(&self, allowed: bool) -> Result<(), String> {
        let mut guard = self.0.lock().map_err(|_| "workspace security lock is poisoned".to_string())?;
        if allowed && (!guard.trusted || !guard.terminal_allowed) {
            return Err("enable Trusted Workspace and Terminal Access before enabling Git Network Access".into());
        }
        guard.git_network_allowed = allowed;
        Ok(())
    }
}

pub(crate) fn require_trusted(state: &State<'_, WorkspaceSecurityState>) -> Result<(), String> {
    if state.is_trusted()? { Ok(()) } else { Err("workspace is restricted; trust it before running project commands".into()) }
}

pub(crate) fn require_terminal_allowed(state: &State<'_, WorkspaceSecurityState>) -> Result<(), String> {
    require_trusted(state)?;
    if state.terminal_allowed()? { Ok(()) } else { Err("terminal execution is disabled for this workspace; explicitly enable Terminal Access first".into()) }
}

pub(crate) fn require_git_network_allowed(state: &State<'_, WorkspaceSecurityState>) -> Result<(), String> {
    require_terminal_allowed(state)?;
    if state.git_network_allowed()? { Ok(()) } else { Err("Git network access is disabled for this workspace session; explicitly enable it first".into()) }
}

#[tauri::command]
pub fn set_workspace_trust(
    trusted: bool,
    state: State<'_, WorkspaceSecurityState>,
    runtime: State<'_, RuntimeState>,
    terminal: State<'_, TerminalState>,
    tasks: State<'_, TaskState>,
    language: State<'_, LanguageServiceState>,
    debugger: State<'_, BrowserDebugState>,
) -> Result<WorkspaceSecurity, String> {
    if !trusted {
        runtime.stop()?;
        terminal.clear()?;
        tasks.stop()?;
        language.stop()?;
        debugger.stop()?;
    }
    state.set_trusted(trusted)?;
    get_workspace_security(state)
}

#[tauri::command]
pub fn set_terminal_permission(
    allowed: bool,
    state: State<'_, WorkspaceSecurityState>,
    terminal: State<'_, TerminalState>,
    tasks: State<'_, TaskState>,
    language: State<'_, LanguageServiceState>,
    debugger: State<'_, BrowserDebugState>,
) -> Result<WorkspaceSecurity, String> {
    if !allowed {
        terminal.clear()?;
        tasks.stop()?;
        language.stop()?;
        debugger.stop()?;
    }
    state.set_terminal_allowed(allowed)?;
    get_workspace_security(state)
}

#[tauri::command]
pub fn set_git_network_permission(
    allowed: bool,
    state: State<'_, WorkspaceSecurityState>,
) -> Result<WorkspaceSecurity, String> {
    state.set_git_network_allowed(allowed)?;
    get_workspace_security(state)
}

#[tauri::command]
pub fn get_workspace_security(state: State<'_, WorkspaceSecurityState>) -> Result<WorkspaceSecurity, String> {
    state.snapshot()
}

#[cfg(test)]
mod tests {
    use super::WorkspaceSecurityState;

    #[test]
    fn terminal_permission_requires_trust() {
        let state = WorkspaceSecurityState::new();
        assert!(state.set_terminal_allowed(true).is_err());
        state.set_trusted(true).unwrap();
        state.set_terminal_allowed(true).unwrap();
        assert!(state.terminal_allowed().unwrap());
        state.set_trusted(false).unwrap();
        assert!(!state.terminal_allowed().unwrap());
    }

    #[test]
    fn git_network_requires_terminal_permission() {
        let state = WorkspaceSecurityState::new();
        assert!(state.set_git_network_allowed(true).is_err());
        state.set_trusted(true).unwrap();
        assert!(state.set_git_network_allowed(true).is_err());
        state.set_terminal_allowed(true).unwrap();
        state.set_git_network_allowed(true).unwrap();
        assert!(state.git_network_allowed().unwrap());
        state.set_terminal_allowed(false).unwrap();
        assert!(!state.git_network_allowed().unwrap());
    }
}
