use crate::{search::WorkspaceSearchIndexState, workspace::{workspace_root, WorkspaceChanges, WorkspaceState}};
use notify::{
    event::{ModifyKind, RenameMode},
    Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use std::{
    collections::{BTreeSet, VecDeque},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::State;

const MAX_PENDING_EVENTS: usize = 10_000;
const IGNORED_SEGMENTS: &[&str] = &[
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NativeChangeKind {
    Created,
    Modified,
    Removed,
    Rescan,
}

#[derive(Debug, Clone)]
struct NativeChange {
    kind: NativeChangeKind,
    path: Option<PathBuf>,
}

pub struct NativeWorkspaceWatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    root: Arc<Mutex<Option<PathBuf>>>,
    queue: Arc<Mutex<VecDeque<NativeChange>>>,
}

impl NativeWorkspaceWatcherState {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
            root: Arc::new(Mutex::new(None)),
            queue: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    pub fn stop(&self) -> Result<(), String> {
        *self
            .watcher
            .lock()
            .map_err(|_| "native watcher lock is poisoned".to_string())? = None;
        *self
            .root
            .lock()
            .map_err(|_| "native watcher root lock is poisoned".to_string())? = None;
        self.queue
            .lock()
            .map_err(|_| "native watcher queue lock is poisoned".to_string())?
            .clear();
        Ok(())
    }

    pub fn start(&self, root: PathBuf) -> Result<(), String> {
        self.stop()?;
        let queue = Arc::clone(&self.queue);
        let watch_root = root.clone();
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
            let mut pending = match queue.lock() {
                Ok(value) => value,
                Err(_) => return,
            };
            match result {
                Ok(event) => push_event(&mut pending, &watch_root, event),
                Err(_) => pending.push_back(NativeChange { kind: NativeChangeKind::Rescan, path: None }),
            }
            if pending.len() > MAX_PENDING_EVENTS {
                while pending.len() > MAX_PENDING_EVENTS - 1 { pending.pop_front(); }
                pending.push_back(NativeChange { kind: NativeChangeKind::Rescan, path: None });
            }
        })
        .map_err(|error| format!("unable to create native filesystem watcher: {error}"))?;

        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|error| format!("unable to watch workspace: {error}"))?;

        *self
            .root
            .lock()
            .map_err(|_| "native watcher root lock is poisoned".to_string())? = Some(root);
        *self
            .watcher
            .lock()
            .map_err(|_| "native watcher lock is poisoned".to_string())? = Some(watcher);
        Ok(())
    }

    fn drain(&self, expected_root: &Path) -> Result<WorkspaceChanges, String> {
        let current_root = self
            .root
            .lock()
            .map_err(|_| "native watcher root lock is poisoned".to_string())?
            .clone();
        if current_root.as_deref() != Some(expected_root) {
            return Ok(WorkspaceChanges::default());
        }

        let mut pending = self
            .queue
            .lock()
            .map_err(|_| "native watcher queue lock is poisoned".to_string())?;
        let events: Vec<_> = pending.drain(..).collect();
        drop(pending);

        let mut created = BTreeSet::new();
        let mut modified = BTreeSet::new();
        let mut removed = BTreeSet::new();
        let mut rescan = false;

        for item in events {
            if item.kind == NativeChangeKind::Rescan {
                rescan = true;
                continue;
            }
            let Some(path) = item.path else { continue; };
            let Some(relative) = relative_workspace_path(expected_root, &path) else { continue; };
            if relative.is_empty() || ignored_relative(&relative) { continue; }
            match item.kind {
                NativeChangeKind::Created => {
                    removed.remove(&relative);
                    created.insert(relative);
                }
                NativeChangeKind::Modified => {
                    if !created.contains(&relative) && !removed.contains(&relative) {
                        modified.insert(relative);
                    }
                }
                NativeChangeKind::Removed => {
                    created.remove(&relative);
                    modified.remove(&relative);
                    removed.insert(relative);
                }
                NativeChangeKind::Rescan => {}
            }
        }

        Ok(WorkspaceChanges {
            created: created.into_iter().collect(),
            modified: modified.into_iter().collect(),
            removed: removed.into_iter().collect(),
            rescan,
            native: true,
        })
    }
}

fn push_change(queue: &mut VecDeque<NativeChange>, root: &Path, kind: NativeChangeKind, path: PathBuf) {
    if path.starts_with(root) {
        queue.push_back(NativeChange { kind, path: Some(path) });
    }
}

fn push_event(queue: &mut VecDeque<NativeChange>, root: &Path, event: Event) {
    if event.need_rescan() {
        queue.push_back(NativeChange { kind: NativeChangeKind::Rescan, path: None });
    }
    match event.kind {
        EventKind::Access(_) => {}
        EventKind::Create(_) => {
            for path in event.paths { push_change(queue, root, NativeChangeKind::Created, path); }
        }
        EventKind::Remove(_) => {
            for path in event.paths { push_change(queue, root, NativeChangeKind::Removed, path); }
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if event.paths.len() >= 2 => {
            push_change(queue, root, NativeChangeKind::Removed, event.paths[0].clone());
            push_change(queue, root, NativeChangeKind::Created, event.paths[event.paths.len() - 1].clone());
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
            for path in event.paths { push_change(queue, root, NativeChangeKind::Removed, path); }
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            for path in event.paths { push_change(queue, root, NativeChangeKind::Created, path); }
        }
        EventKind::Modify(_) | EventKind::Any | EventKind::Other => {
            for path in event.paths { push_change(queue, root, NativeChangeKind::Modified, path); }
        }
    }
}

fn relative_workspace_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    Some(relative.to_string_lossy().replace('\\', "/"))
}

fn ignored_relative(relative: &str) -> bool {
    Path::new(relative).components().any(|component| match component {
        Component::Normal(value) => IGNORED_SEGMENTS.iter().any(|ignored| value.to_string_lossy() == *ignored),
        _ => false,
    })
}

#[tauri::command]
pub fn start_native_workspace_watch(
    workspace: State<'_, WorkspaceState>,
    watcher: State<'_, NativeWorkspaceWatcherState>,
) -> Result<(), String> {
    watcher.start(workspace_root(&workspace)?)
}

#[tauri::command]
pub fn stop_native_workspace_watch(watcher: State<'_, NativeWorkspaceWatcherState>) -> Result<(), String> {
    watcher.stop()
}

#[tauri::command]
pub fn poll_native_workspace_changes(
    workspace: State<'_, WorkspaceState>,
    watcher: State<'_, NativeWorkspaceWatcherState>,
    index: State<'_, WorkspaceSearchIndexState>,
) -> Result<WorkspaceChanges, String> {
    let root = workspace_root(&workspace)?;
    let changes = watcher.drain(&root)?;
    index.apply_changes(&root, &changes)?;
    Ok(changes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_generated_directories() {
        assert!(ignored_relative("node_modules/pkg/index.js"));
        assert!(ignored_relative("src-tauri/target/debug/app.exe"));
        assert!(!ignored_relative("src/App.tsx"));
    }

    #[test]
    fn normalizes_relative_paths() {
        let root = if cfg!(windows) { PathBuf::from(r"C:\\repo") } else { PathBuf::from("/repo") };
        let child = root.join("src").join("App.tsx");
        assert_eq!(relative_workspace_path(&root, &child).as_deref(), Some("src/App.tsx"));
    }
}
