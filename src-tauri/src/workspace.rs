use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::State;
use crate::{debugger::BrowserDebugState, language_services::LanguageServiceState, runtime::RuntimeState, search::WorkspaceSearchIndexState, security::WorkspaceSecurityState, tasks::TaskState, terminal::TerminalState};

pub struct WorkspaceState(pub Mutex<Option<PathBuf>>);
pub struct WorkspaceWatchState(pub Mutex<HashMap<String, FileStamp>>);

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    name: String,
    relative_path: String,
    kind: EntryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<WorkspaceEntry>>,
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum EntryKind {
    File,
    Directory,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWrite {
    relative_path: String,
    content: String,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChanges {
    pub(crate) created: Vec<String>,
    pub(crate) modified: Vec<String>,
    pub(crate) removed: Vec<String>,
    #[serde(default)]
    pub(crate) rescan: bool,
    #[serde(default)]
    pub(crate) native: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileStamp {
    modified_nanos: u128,
    len: u64,
    is_directory: bool,
}

const MAX_SCAN_DEPTH: usize = 16;
const MAX_TEXT_FILE_BYTES: u64 = 5 * 1024 * 1024;
const IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    ".idea",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    "node_modules",
    "target",
    "dist",
    "build",
    "coverage",
];

pub(crate) fn clean_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if path.is_absolute() {
        return Err("absolute paths are not accepted by workspace commands".into());
    }

    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("path traversal outside the workspace is not allowed".into());
            }
        }
    }
    Ok(clean)
}

pub(crate) fn workspace_root(state: &State<'_, WorkspaceState>) -> Result<PathBuf, String> {
    state
        .0
        .lock()
        .map_err(|_| "workspace state lock is poisoned".to_string())?
        .clone()
        .ok_or_else(|| "no workspace is currently open".to_string())
}

fn resolve_existing(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = clean_relative_path(relative_path)?;
    if relative.as_os_str().is_empty() {
        return Ok(root.to_path_buf());
    }
    let resolved = fs::canonicalize(root.join(relative)).map_err(|error| error.to_string())?;
    if !resolved.starts_with(root) {
        return Err("resolved path is outside the selected workspace".into());
    }
    Ok(resolved)
}

fn resolve_new(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = clean_relative_path(relative_path)?;
    if relative.as_os_str().is_empty() {
        return Err("the workspace root cannot be created, renamed or replaced".into());
    }

    let target = root.join(relative);
    let parent = target
        .parent()
        .ok_or_else(|| "target path has no parent directory".to_string())?;
    let parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
    if !parent.starts_with(root) {
        return Err("target parent is outside the selected workspace".into());
    }
    Ok(target)
}

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn scan_entry(root: &Path, path: &Path, depth: usize) -> Result<WorkspaceEntry, String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    if metadata.is_dir() {
        let mut children = Vec::new();
        if depth < MAX_SCAN_DEPTH {
            let read_dir = fs::read_dir(path).map_err(|error| error.to_string())?;
            for child in read_dir.flatten() {
                let child_path = child.path();
                let child_name = child.file_name().to_string_lossy().to_string();
                if IGNORED_DIRECTORIES.contains(&child_name.as_str()) {
                    continue;
                }
                let child_metadata = match fs::symlink_metadata(&child_path) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                if child_metadata.file_type().is_symlink() {
                    continue;
                }
                if let Ok(entry) = scan_entry(root, &child_path, depth + 1) {
                    children.push(entry);
                }
            }
            children.sort_by(|a, b| {
                let a_dir = matches!(a.kind, EntryKind::Directory);
                let b_dir = matches!(b.kind, EntryKind::Directory);
                b_dir.cmp(&a_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            });
        }

        Ok(WorkspaceEntry {
            name,
            relative_path: relative_display(root, path),
            kind: EntryKind::Directory,
            children: Some(children),
        })
    } else {
        Ok(WorkspaceEntry {
            name,
            relative_path: relative_display(root, path),
            kind: EntryKind::File,
            children: None,
        })
    }
}

fn workspace_tree(root: &Path) -> Result<WorkspaceEntry, String> {
    let mut snapshot = scan_entry(root, root, 0)?;
    snapshot.name = root
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| root.to_string_lossy().to_string());
    snapshot.relative_path.clear();
    Ok(snapshot)
}

fn stamp_for(metadata: &fs::Metadata) -> FileStamp {
    let modified_nanos = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or(0);

    FileStamp {
        modified_nanos,
        len: metadata.len(),
        is_directory: metadata.is_dir(),
    }
}

fn collect_watch_snapshot(root: &Path) -> Result<HashMap<String, FileStamp>, String> {
    fn walk(root: &Path, path: &Path, output: &mut HashMap<String, FileStamp>, depth: usize) -> Result<(), String> {
        if depth > MAX_SCAN_DEPTH {
            return Ok(());
        }
        for child in fs::read_dir(path).map_err(|error| error.to_string())?.flatten() {
            let child_path = child.path();
            let child_name = child.file_name().to_string_lossy().to_string();
            if IGNORED_DIRECTORIES.contains(&child_name.as_str()) {
                continue;
            }
            let metadata = match fs::symlink_metadata(&child_path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            let relative = relative_display(root, &child_path);
            output.insert(relative, stamp_for(&metadata));
            if metadata.is_dir() {
                walk(root, &child_path, output, depth + 1)?;
            }
        }
        Ok(())
    }

    let mut output = HashMap::new();
    walk(root, root, &mut output, 0)?;
    Ok(output)
}

fn reset_watch_snapshot(root: &Path, watch: &State<'_, WorkspaceWatchState>) -> Result<(), String> {
    let snapshot = collect_watch_snapshot(root)?;
    *watch
        .0
        .lock()
        .map_err(|_| "workspace watch state lock is poisoned".to_string())? = snapshot;
    Ok(())
}

#[tauri::command]
pub fn set_workspace_root(
    path: String,
    state: State<'_, WorkspaceState>,
    watch: State<'_, WorkspaceWatchState>,
    security: State<'_, WorkspaceSecurityState>,
    runtime: State<'_, RuntimeState>,
    terminal: State<'_, TerminalState>,
    tasks: State<'_, TaskState>,
    language: State<'_, LanguageServiceState>,
    debugger: State<'_, BrowserDebugState>,
    search_index: State<'_, WorkspaceSearchIndexState>,
) -> Result<WorkspaceEntry, String> {
    let root = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !root.is_dir() {
        return Err("selected workspace is not a directory".into());
    }

    let snapshot = workspace_tree(&root)?;
    runtime.stop()?;
    terminal.clear()?;
    tasks.stop()?;
    language.stop()?;
    debugger.stop()?;
    search_index.reset()?;
    security.reset()?;
    *state
        .0
        .lock()
        .map_err(|_| "workspace state lock is poisoned".to_string())? = Some(root.clone());
    reset_watch_snapshot(&root, &watch)?;
    Ok(snapshot)
}

#[tauri::command]
pub fn refresh_workspace(state: State<'_, WorkspaceState>) -> Result<WorkspaceEntry, String> {
    let root = workspace_root(&state)?;
    workspace_tree(&root)
}

#[tauri::command]
pub fn reset_workspace_watch(
    state: State<'_, WorkspaceState>,
    watch: State<'_, WorkspaceWatchState>,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    reset_watch_snapshot(&root, &watch)
}

#[tauri::command]
pub fn poll_workspace_changes(
    state: State<'_, WorkspaceState>,
    watch: State<'_, WorkspaceWatchState>,
) -> Result<WorkspaceChanges, String> {
    let root = workspace_root(&state)?;
    let current = collect_watch_snapshot(&root)?;
    let mut previous = watch
        .0
        .lock()
        .map_err(|_| "workspace watch state lock is poisoned".to_string())?;

    let current_paths: HashSet<_> = current.keys().cloned().collect();
    let previous_paths: HashSet<_> = previous.keys().cloned().collect();

    let mut changes = WorkspaceChanges {
        created: current_paths.difference(&previous_paths).cloned().collect(),
        removed: previous_paths.difference(&current_paths).cloned().collect(),
        modified: Vec::new(),
        rescan: false,
        native: false,
    };

    for path in current_paths.intersection(&previous_paths) {
        if let (Some(next), Some(old)) = (current.get(path), previous.get(path)) {
            if next != old && !next.is_directory {
                changes.modified.push(path.clone());
            }
        }
    }

    changes.created.sort();
    changes.modified.sort();
    changes.removed.sort();
    *previous = current;
    Ok(changes)
}

#[tauri::command]
pub fn read_workspace_file(relative_path: String, state: State<'_, WorkspaceState>) -> Result<String, String> {
    let root = workspace_root(&state)?;
    let path = resolve_existing(&root, &relative_path)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("requested path is not a file".into());
    }
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(format!("file is larger than the {} MiB editor limit", MAX_TEXT_FILE_BYTES / 1024 / 1024));
    }
    fs::read_to_string(path).map_err(|error| format!("unable to read text file: {error}"))
}

#[tauri::command]
pub fn write_workspace_file(
    relative_path: String,
    content: String,
    state: State<'_, WorkspaceState>,
    watch: State<'_, WorkspaceWatchState>,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let path = resolve_existing(&root, &relative_path)?;
    if !path.is_file() {
        return Err("requested path is not a file".into());
    }
    fs::write(path, content).map_err(|error| error.to_string())?;
    reset_watch_snapshot(&root, &watch)
}

#[tauri::command]
pub fn write_workspace_files(
    files: Vec<WorkspaceWrite>,
    state: State<'_, WorkspaceState>,
    watch: State<'_, WorkspaceWatchState>,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let mut resolved = Vec::with_capacity(files.len());

    for file in &files {
        let path = resolve_existing(&root, &file.relative_path)?;
        if !path.is_file() {
            return Err(format!("{} is not a file", file.relative_path));
        }
        resolved.push(path);
    }

    for (file, path) in files.into_iter().zip(resolved) {
        fs::write(path, file.content).map_err(|error| error.to_string())?;
    }
    reset_watch_snapshot(&root, &watch)
}

#[tauri::command]
pub fn create_workspace_file(
    relative_path: String,
    content: Option<String>,
    state: State<'_, WorkspaceState>,
    watch: State<'_, WorkspaceWatchState>,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let path = resolve_new(&root, &relative_path)?;
    if path.exists() {
        return Err("a file or directory already exists at that path".into());
    }
    fs::write(path, content.unwrap_or_default()).map_err(|error| error.to_string())?;
    reset_watch_snapshot(&root, &watch)
}

#[tauri::command]
pub fn create_workspace_directory(
    relative_path: String,
    state: State<'_, WorkspaceState>,
    watch: State<'_, WorkspaceWatchState>,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let path = resolve_new(&root, &relative_path)?;
    if path.exists() {
        return Err("a file or directory already exists at that path".into());
    }
    fs::create_dir(path).map_err(|error| error.to_string())?;
    reset_watch_snapshot(&root, &watch)
}

#[tauri::command]
pub fn rename_workspace_entry(
    relative_path: String,
    new_relative_path: String,
    state: State<'_, WorkspaceState>,
    watch: State<'_, WorkspaceWatchState>,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let source = resolve_existing(&root, &relative_path)?;
    if source == root {
        return Err("the workspace root cannot be renamed".into());
    }
    let destination = resolve_new(&root, &new_relative_path)?;
    if destination.exists() {
        return Err("a file or directory already exists at the destination".into());
    }
    fs::rename(source, destination).map_err(|error| error.to_string())?;
    reset_watch_snapshot(&root, &watch)
}

#[tauri::command]
pub fn delete_workspace_entry(
    relative_path: String,
    state: State<'_, WorkspaceState>,
    watch: State<'_, WorkspaceWatchState>,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let path = resolve_existing(&root, &relative_path)?;
    if path == root {
        return Err("the workspace root cannot be deleted".into());
    }

    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    reset_watch_snapshot(&root, &watch)
}

#[cfg(test)]
mod tests {
    use super::clean_relative_path;

    #[test]
    fn relative_paths_are_normalized() {
        let path = clean_relative_path("src/./components/App.tsx").expect("path should be accepted");
        assert_eq!(path.to_string_lossy().replace('\\', "/"), "src/components/App.tsx");
    }

    #[test]
    fn parent_traversal_is_rejected() {
        assert!(clean_relative_path("../secret.txt").is_err());
        assert!(clean_relative_path("src/../../secret.txt").is_err());
    }
}
