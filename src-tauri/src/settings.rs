use serde_json::{Map, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};

use crate::workspace::{workspace_root, WorkspaceState};

const MAX_SETTINGS_BYTES: usize = 64 * 1024;
const MAX_RECOVERY_BYTES: usize = 8 * 1024 * 1024;
const SETTINGS_DIR: &str = ".webforge";
const SETTINGS_FILE: &str = "settings.json";

fn ensure_workspace_settings_dir(root: &Path) -> Result<PathBuf, String> {
    let dir = root.join(SETTINGS_DIR);
    if dir.exists() {
        let metadata = fs::symlink_metadata(&dir).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(".webforge must be a real directory inside the workspace".into());
        }
    } else {
        fs::create_dir(&dir).map_err(|error| format!("unable to create .webforge settings directory: {error}"))?;
    }
    Ok(dir)
}

fn settings_path(root: &Path) -> Result<PathBuf, String> {
    let dir = root.join(SETTINGS_DIR);
    if !dir.exists() { return Ok(dir.join(SETTINGS_FILE)); }
    let metadata = fs::symlink_metadata(&dir).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(".webforge must be a real directory inside the workspace".into());
    }
    let path = dir.join(SETTINGS_FILE);
    if path.exists() {
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(".webforge/settings.json must be a regular file".into());
        }
    }
    Ok(path)
}

fn validate_settings(value: &Value) -> Result<Vec<u8>, String> {
    if !value.is_object() { return Err("workspace settings must be a JSON object".into()); }
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_SETTINGS_BYTES { return Err("workspace settings exceed the 64 KiB limit".into()); }
    Ok(bytes)
}

fn recovery_workspace_key(root: &Path) -> String {
    // Stable FNV-1a avoids tying recovery filenames to Rust's DefaultHasher implementation.
    let mut hash = 0xcbf29ce484222325u64;
    for byte in root.to_string_lossy().to_lowercase().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}.json")
}

fn recovery_path(app: &AppHandle, root: &Path) -> Result<PathBuf, String> {
    let key = recovery_workspace_key(root);
    let base = app.path().app_local_data_dir().map_err(|error| error.to_string())?.join("recovery");
    fs::create_dir_all(&base).map_err(|error| format!("unable to create recovery directory: {error}"))?;
    Ok(base.join(key))
}

#[tauri::command]
pub fn load_workspace_settings(state: State<'_, WorkspaceState>) -> Result<Value, String> {
    let root = workspace_root(&state)?;
    let path = settings_path(&root)?;
    if !path.exists() { return Ok(Value::Object(Map::new())); }
    let bytes = fs::read(&path).map_err(|error| format!("unable to read workspace settings: {error}"))?;
    if bytes.len() > MAX_SETTINGS_BYTES { return Err("workspace settings exceed the 64 KiB limit".into()); }
    let value: Value = serde_json::from_slice(&bytes).map_err(|error| format!("invalid .webforge/settings.json: {error}"))?;
    if !value.is_object() { return Err(".webforge/settings.json must contain a JSON object".into()); }
    Ok(value)
}

#[tauri::command]
pub fn save_workspace_settings(settings: Value, state: State<'_, WorkspaceState>) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let bytes = validate_settings(&settings)?;
    let dir = ensure_workspace_settings_dir(&root)?;
    let path = dir.join(SETTINGS_FILE);
    if path.exists() {
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(".webforge/settings.json must be a regular file".into());
        }
    }
    let temp = dir.join("settings.json.tmp");
    fs::write(&temp, bytes).map_err(|error| format!("unable to write workspace settings: {error}"))?;
    if path.exists() { fs::remove_file(&path).map_err(|error| format!("unable to replace workspace settings: {error}"))?; }
    fs::rename(temp, path).map_err(|error| format!("unable to commit workspace settings: {error}"))
}

#[tauri::command]
pub fn save_recovery_snapshot(snapshot: Value, app: AppHandle, state: State<'_, WorkspaceState>) -> Result<(), String> {
    if !snapshot.is_object() { return Err("recovery snapshot must be a JSON object".into()); }
    let bytes = serde_json::to_vec(&snapshot).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_RECOVERY_BYTES { return Err("recovery snapshot exceeds the 8 MiB limit".into()); }
    let root = workspace_root(&state)?;
    let path = recovery_path(&app, &root)?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, bytes).map_err(|error| format!("unable to write recovery snapshot: {error}"))?;
    if path.exists() { let _ = fs::remove_file(&path); }
    fs::rename(temp, path).map_err(|error| format!("unable to commit recovery snapshot: {error}"))
}

#[tauri::command]
pub fn load_recovery_snapshot(app: AppHandle, state: State<'_, WorkspaceState>) -> Result<Option<Value>, String> {
    let root = workspace_root(&state)?;
    let path = recovery_path(&app, &root)?;
    if !path.exists() { return Ok(None); }
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() { return Err("invalid recovery snapshot file".into()); }
    if metadata.len() as usize > MAX_RECOVERY_BYTES { return Err("recovery snapshot exceeds the 8 MiB limit".into()); }
    let value = serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?).map_err(|error| format!("invalid recovery snapshot: {error}"))?;
    Ok(Some(value))
}

#[tauri::command]
pub fn clear_recovery_snapshot(app: AppHandle, state: State<'_, WorkspaceState>) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let path = recovery_path(&app, &root)?;
    if path.exists() { fs::remove_file(path).map_err(|error| format!("unable to remove recovery snapshot: {error}"))?; }
    Ok(())
}
