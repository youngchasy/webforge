use serde::Serialize;
use serde_json::Value;
use std::{collections::HashSet, fs, path::{Path, PathBuf}};
use tauri::State;

use crate::workspace::{workspace_root, WorkspaceState};

const MAX_FILES: usize = 2500;
const MAX_TOTAL_BYTES: usize = 12 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES: u64 = 1024 * 1024;
const MAX_DECLARATION_FILE_BYTES: u64 = 768 * 1024;
const MAX_DEPTH: usize = 20;
const MAX_WALK_ENTRIES: usize = 50_000;

const SKIP_DIRS: &[&str] = &[
    ".git", ".idea", ".next", ".nuxt", ".svelte-kit", ".turbo", "target", "dist", "build", "coverage",
];

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLanguageFile {
    relative_path: String,
    content: String,
    declaration: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLanguageSnapshot {
    files: Vec<ProjectLanguageFile>,
    source_count: usize,
    declaration_count: usize,
    total_bytes: usize,
    truncated: bool,
}

struct Collector {
    root: PathBuf,
    files: Vec<ProjectLanguageFile>,
    seen: HashSet<PathBuf>,
    source_count: usize,
    declaration_count: usize,
    total_bytes: usize,
    scanned_entries: usize,
    truncated: bool,
}

impl Collector {
    fn new(root: PathBuf) -> Self {
        Self { root, files: Vec::new(), seen: HashSet::new(), source_count: 0, declaration_count: 0, total_bytes: 0, scanned_entries: 0, truncated: false }
    }

    fn full(&self) -> bool { self.files.len() >= MAX_FILES || self.total_bytes >= MAX_TOTAL_BYTES || self.scanned_entries >= MAX_WALK_ENTRIES }

    fn visit_entry(&mut self) -> bool {
        if self.scanned_entries >= MAX_WALK_ENTRIES { self.truncated = true; return false; }
        self.scanned_entries += 1;
        true
    }

    fn add_file(&mut self, path: &Path, declaration: bool) {
        if self.full() { self.truncated = true; return; }
        let canonical = match fs::canonicalize(path) { Ok(value) => value, Err(_) => return };
        if !canonical.starts_with(&self.root) || !self.seen.insert(canonical.clone()) { return; }
        let metadata = match fs::metadata(&canonical) { Ok(value) => value, Err(_) => return };
        let limit = if declaration { MAX_DECLARATION_FILE_BYTES } else { MAX_SOURCE_FILE_BYTES };
        if !metadata.is_file() || metadata.len() > limit { return; }
        let content = match fs::read_to_string(&canonical) { Ok(value) => value, Err(_) => return };
        if self.total_bytes.saturating_add(content.len()) > MAX_TOTAL_BYTES { self.truncated = true; return; }
        let relative_path = canonical.strip_prefix(&self.root).unwrap_or(&canonical).to_string_lossy().replace('\\', "/");
        self.total_bytes += content.len();
        if declaration { self.declaration_count += 1; } else { self.source_count += 1; }
        self.files.push(ProjectLanguageFile { relative_path, content, declaration });
    }
}

fn is_source_file(path: &Path) -> bool {
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts") { return false; }
    matches!(path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase()).as_deref(), Some("ts") | Some("tsx") | Some("js") | Some("jsx") | Some("mts") | Some("cts") | Some("mjs") | Some("cjs"))
}

fn is_declaration_file(path: &Path) -> bool {
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts")
}

fn walk_sources(collector: &mut Collector, dir: &Path, depth: usize) {
    if depth > MAX_DEPTH || collector.full() { if collector.full() { collector.truncated = true; } return; }
    let entries = match fs::read_dir(dir) { Ok(value) => value, Err(_) => return };
    for entry in entries.flatten() {
        if collector.full() { collector.truncated = true; break; }
        if !collector.visit_entry() { break; }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "node_modules" || SKIP_DIRS.contains(&name.as_str()) { continue; }
        let meta = match fs::symlink_metadata(&path) { Ok(value) => value, Err(_) => continue };
        if meta.file_type().is_symlink() { continue; }
        if meta.is_dir() { walk_sources(collector, &path, depth + 1); }
        else if is_declaration_file(&path) { collector.add_file(&path, true); }
        else if is_source_file(&path) { collector.add_file(&path, false); }
    }
}

fn walk_declarations(collector: &mut Collector, dir: &Path, depth: usize) {
    if depth > MAX_DEPTH || collector.full() { if collector.full() { collector.truncated = true; } return; }
    let canonical = match fs::canonicalize(dir) { Ok(value) => value, Err(_) => return };
    if !canonical.starts_with(&collector.root) { return; }
    let entries = match fs::read_dir(&canonical) { Ok(value) => value, Err(_) => return };
    for entry in entries.flatten() {
        if collector.full() { collector.truncated = true; break; }
        if !collector.visit_entry() { break; }
        let path = entry.path();
        let meta = match fs::symlink_metadata(&path) { Ok(value) => value, Err(_) => continue };
        if meta.is_dir() || meta.file_type().is_symlink() {
            // npm/pnpm package entries are often directory symlinks. Canonicalization above keeps reads inside the workspace.
            if fs::canonicalize(&path).map(|value| value.starts_with(&collector.root)).unwrap_or(false) {
                walk_declarations(collector, &path, depth + 1);
            }
        } else if is_declaration_file(&path) {
            collector.add_file(&path, true);
        }
    }
}

fn package_names(root: &Path) -> Vec<String> {
    let path = root.join("package.json");
    let Ok(content) = fs::read_to_string(path) else { return Vec::new(); };
    let Ok(json) = serde_json::from_str::<Value>(&content) else { return Vec::new(); };
    let mut names = HashSet::new();
    for key in ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] {
        if let Some(map) = json.get(key).and_then(Value::as_object) {
            names.extend(map.keys().cloned());
        }
    }
    let mut values = names.into_iter().collect::<Vec<_>>();
    values.sort();
    values
}

#[tauri::command]
pub fn load_project_language_files(state: State<'_, WorkspaceState>) -> Result<ProjectLanguageSnapshot, String> {
    let root = workspace_root(&state)?;
    let mut collector = Collector::new(root.clone());
    walk_sources(&mut collector, &root, 0);

    let at_types = root.join("node_modules").join("@types");
    if at_types.is_dir() { walk_declarations(&mut collector, &at_types, 0); }

    let node_modules = root.join("node_modules");
    if node_modules.is_dir() {
        for package in package_names(&root) {
            if collector.full() { collector.truncated = true; break; }
            let package_path = package.split('/').fold(node_modules.clone(), |path, part| path.join(part));
            if package_path.exists() { walk_declarations(&mut collector, &package_path, 0); }
        }
    }

    Ok(ProjectLanguageSnapshot {
        files: collector.files,
        source_count: collector.source_count,
        declaration_count: collector.declaration_count,
        total_bytes: collector.total_bytes,
        truncated: collector.truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::{is_declaration_file, is_source_file};
    use std::path::Path;

    #[test]
    fn recognizes_project_language_sources() {
        assert!(is_source_file(Path::new("src/App.tsx")));
        assert!(is_source_file(Path::new("src/tool.mjs")));
        assert!(is_source_file(Path::new("src/legacy.cjs")));
        assert!(!is_source_file(Path::new("types/index.d.ts")));
        assert!(!is_source_file(Path::new("styles/main.css")));
    }

    #[test]
    fn recognizes_declaration_files() {
        assert!(is_declaration_file(Path::new("index.d.ts")));
        assert!(is_declaration_file(Path::new("index.d.mts")));
        assert!(is_declaration_file(Path::new("index.d.cts")));
        assert!(!is_declaration_file(Path::new("index.ts")));
    }
}
