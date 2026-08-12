use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::State;

use crate::workspace::{workspace_root, WorkspaceChanges, WorkspaceState};

const MAX_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_INDEX_BYTES: usize = 128 * 1024 * 1024;
const MAX_INDEX_FILES: usize = 100_000;
const MAX_SEARCH_DEPTH: usize = 48;
const DEFAULT_MAX_RESULTS: usize = 2_000;
const HARD_MAX_RESULTS: usize = 10_000;
fn default_true() -> bool { true }

const IGNORED_DIRECTORIES: &[&str] = &[
    ".git", ".idea", ".next", ".nuxt", ".svelte-kit", ".turbo", "node_modules", "target", "dist", "build", "coverage",
];

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    query: String,
    #[serde(default)]
    case_sensitive: bool,
    #[serde(default)]
    whole_word: bool,
    #[serde(default)]
    regex: bool,
    #[serde(default)]
    include: String,
    #[serde(default)]
    exclude: String,
    #[serde(default)]
    max_results: Option<usize>,
    #[serde(default = "default_true")]
    use_index: bool,
    #[serde(default)]
    overlays: HashMap<String, String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    path: String,
    line: usize,
    column: usize,
    end_column: usize,
    preview: String,
    matched: String,
}

#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexStatus {
    pub indexed: bool,
    pub files: usize,
    pub total_bytes: usize,
    pub revision: u64,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    matches: Vec<SearchMatch>,
    files_scanned: usize,
    truncated: bool,
    indexed: bool,
    index_revision: u64,
    indexed_files: usize,
    index_truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceRequest {
    search: SearchRequest,
    replacement: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReplacement {
    relative_path: String,
    before: String,
    content: String,
    replacements: usize,
}

#[derive(Default)]
struct WorkspaceIndex {
    root: Option<PathBuf>,
    files: HashMap<String, String>,
    total_bytes: usize,
    revision: u64,
    truncated: bool,
}

pub struct WorkspaceSearchIndexState(Mutex<WorkspaceIndex>);

impl WorkspaceSearchIndexState {
    pub fn new() -> Self { Self(Mutex::new(WorkspaceIndex::default())) }

    pub fn reset(&self) -> Result<(), String> {
        *self.0.lock().map_err(|_| "workspace search index lock is poisoned".to_string())? = WorkspaceIndex::default();
        Ok(())
    }

    pub fn rebuild(&self, root: &Path) -> Result<WorkspaceIndexStatus, String> {
        let mut files = HashMap::new();
        let mut total_bytes = 0usize;
        let mut truncated = false;
        let gitignore = GitIgnoreRules::load(root);
        collect_index_files(root, root, 0, &gitignore, &mut files, &mut total_bytes, &mut truncated)?;
        let mut index = self.0.lock().map_err(|_| "workspace search index lock is poisoned".to_string())?;
        index.root = Some(root.to_path_buf());
        index.files = files;
        index.total_bytes = total_bytes;
        index.revision = index.revision.wrapping_add(1).max(1);
        index.truncated = truncated;
        Ok(status_for(&index))
    }

    fn ensure(&self, root: &Path) -> Result<WorkspaceIndexStatus, String> {
        let needs_rebuild = {
            let index = self.0.lock().map_err(|_| "workspace search index lock is poisoned".to_string())?;
            index.root.as_deref() != Some(root) || index.revision == 0
        };
        if needs_rebuild { self.rebuild(root) } else { self.status() }
    }

    pub fn status(&self) -> Result<WorkspaceIndexStatus, String> {
        let index = self.0.lock().map_err(|_| "workspace search index lock is poisoned".to_string())?;
        Ok(status_for(&index))
    }

    pub fn apply_changes(&self, root: &Path, changes: &WorkspaceChanges) -> Result<(), String> {
        let active = {
            let index = self.0.lock().map_err(|_| "workspace search index lock is poisoned".to_string())?;
            index.root.as_deref() == Some(root) && index.revision > 0
        };
        if !active { return Ok(()); }
        if changes.rescan || changes.created.iter().chain(changes.modified.iter()).chain(changes.removed.iter()).any(|path| path == ".gitignore") {
            self.rebuild(root)?;
            return Ok(());
        }
        let rules = GitIgnoreRules::load(root);
        let mut index = self.0.lock().map_err(|_| "workspace search index lock is poisoned".to_string())?;
        let mut rebuild = false;
        for relative in &changes.removed {
            let prefix = format!("{}/", relative.trim_end_matches('/'));
            let removed = index.files.keys().filter(|path| *path == relative || path.starts_with(&prefix)).cloned().collect::<Vec<_>>();
            for path in removed {
                if let Some(content) = index.files.remove(&path) { index.total_bytes = index.total_bytes.saturating_sub(content.len()); }
            }
        }
        for relative in changes.created.iter().chain(changes.modified.iter()) {
            let path = root.join(relative);
            let metadata = match fs::symlink_metadata(&path) { Ok(value) => value, Err(_) => continue };
            if metadata.file_type().is_symlink() { continue; }
            if metadata.is_dir() { rebuild = true; break; }
            update_index_file(&mut index, root, relative, &path, &metadata, &rules);
        }
        if rebuild {
            drop(index);
            self.rebuild(root)?;
        } else {
            index.revision = index.revision.wrapping_add(1).max(1);
        }
        Ok(())
    }
}

fn status_for(index: &WorkspaceIndex) -> WorkspaceIndexStatus {
    WorkspaceIndexStatus {
        indexed: index.root.is_some() && index.revision > 0,
        files: index.files.len(),
        total_bytes: index.total_bytes,
        revision: index.revision,
        truncated: index.truncated,
    }
}

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    let p = pattern.as_bytes();
    let v = value.as_bytes();
    let (mut pi, mut vi, mut star, mut match_i) = (0usize, 0usize, None, 0usize);
    while vi < v.len() {
        if pi < p.len() && (p[pi] == b'?' || p[pi].to_ascii_lowercase() == v[vi].to_ascii_lowercase()) {
            pi += 1;
            vi += 1;
        } else if pi < p.len() && p[pi] == b'*' {
            star = Some(pi);
            match_i = vi;
            pi += 1;
        } else if let Some(star_index) = star {
            pi = star_index + 1;
            match_i += 1;
            vi = match_i;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == b'*' { pi += 1; }
    pi == p.len()
}

fn patterns(value: &str) -> Vec<String> {
    value.split(',').map(str::trim).filter(|item| !item.is_empty()).map(|item| item.replace('\\', "/")).collect()
}

fn path_allowed(path: &str, request: &SearchRequest) -> bool {
    let includes = patterns(&request.include);
    let excludes = patterns(&request.exclude);
    let included = includes.is_empty() || includes.iter().any(|pattern| wildcard_match(pattern, path));
    let excluded = excludes.iter().any(|pattern| wildcard_match(pattern, path));
    included && !excluded
}

#[derive(Default)]
struct GitIgnoreRules(Vec<(bool, String, bool, bool)>);

impl GitIgnoreRules {
    fn load(root: &Path) -> Self {
        let Ok(text) = fs::read_to_string(root.join(".gitignore")) else { return Self::default(); };
        let mut rules = Vec::new();
        for raw in text.lines() {
            let mut line = raw.trim();
            if line.is_empty() || line.starts_with('#') { continue; }
            let negated = line.starts_with('!');
            if negated { line = line[1..].trim(); }
            if line.is_empty() { continue; }
            let directory_only = line.ends_with('/');
            let anchored = line.starts_with('/');
            let mut pattern = line.trim_matches('/').replace("**", "*");
            if pattern.is_empty() { continue; }
            if directory_only { pattern = pattern.trim_end_matches('/').to_string(); }
            rules.push((negated, pattern, directory_only, anchored));
        }
        Self(rules)
    }

    fn ignored(&self, relative: &str, is_dir: bool) -> bool {
        let normalized = relative.replace('\\', "/");
        let basename = normalized.rsplit('/').next().unwrap_or(&normalized);
        let mut ignored = false;
        for (negated, pattern, directory_only, anchored) in &self.0 {
            if *directory_only && !is_dir { continue; }
            let matched = if *anchored || pattern.contains('/') {
                wildcard_match(pattern, &normalized) || normalized.starts_with(&format!("{pattern}/"))
            } else {
                wildcard_match(pattern, basename) || normalized.split('/').any(|part| wildcard_match(pattern, part))
            };
            if matched { ignored = !*negated; }
        }
        ignored
    }
}

fn fixed_ignored(relative: &str) -> bool {
    Path::new(relative).components().any(|component| match component {
        Component::Normal(value) => IGNORED_DIRECTORIES.iter().any(|ignored| value.to_string_lossy() == *ignored),
        _ => false,
    })
}

fn collect_index_files(
    root: &Path,
    dir: &Path,
    depth: usize,
    rules: &GitIgnoreRules,
    output: &mut HashMap<String, String>,
    total_bytes: &mut usize,
    truncated: &mut bool,
) -> Result<(), String> {
    if depth > MAX_SEARCH_DEPTH || *truncated { return Ok(()); }
    for child in fs::read_dir(dir).map_err(|error| error.to_string())?.flatten() {
        let path = child.path();
        let metadata = match fs::symlink_metadata(&path) { Ok(value) => value, Err(_) => continue };
        if metadata.file_type().is_symlink() { continue; }
        let relative = relative_display(root, &path);
        if fixed_ignored(&relative) || rules.ignored(&relative, metadata.is_dir()) { continue; }
        if metadata.is_dir() {
            collect_index_files(root, &path, depth + 1, rules, output, total_bytes, truncated)?;
        } else if metadata.is_file() && metadata.len() <= MAX_SEARCH_FILE_BYTES {
            if output.len() >= MAX_INDEX_FILES { *truncated = true; break; }
            let Ok(content) = fs::read_to_string(&path) else { continue; };
            if total_bytes.saturating_add(content.len()) > MAX_INDEX_BYTES { *truncated = true; break; }
            *total_bytes += content.len();
            output.insert(relative, content);
        }
    }
    Ok(())
}

fn update_index_file(index: &mut WorkspaceIndex, root: &Path, relative: &str, path: &Path, metadata: &fs::Metadata, rules: &GitIgnoreRules) {
    if let Some(old) = index.files.remove(relative) { index.total_bytes = index.total_bytes.saturating_sub(old.len()); }
    if fixed_ignored(relative) || rules.ignored(relative, false) || !metadata.is_file() || metadata.len() > MAX_SEARCH_FILE_BYTES { return; }
    let Ok(content) = fs::read_to_string(path) else { return; };
    if index.files.len() >= MAX_INDEX_FILES || index.total_bytes.saturating_add(content.len()) > MAX_INDEX_BYTES {
        index.truncated = true;
        return;
    }
    index.total_bytes += content.len();
    index.files.insert(relative_display(root, path), content);
}

fn compile_pattern(request: &SearchRequest) -> Result<Regex, String> {
    let query = request.query.trim();
    if query.is_empty() { return Err("search query cannot be empty".into()); }
    if query.len() > 2_000 { return Err("search query is too long".into()); }
    let mut pattern = if request.regex { query.to_string() } else { regex::escape(query) };
    if request.whole_word { pattern = format!(r"\b(?:{pattern})\b"); }
    RegexBuilder::new(&pattern)
        .case_insensitive(!request.case_sensitive)
        .multi_line(true)
        .build()
        .map_err(|error| format!("invalid search pattern: {error}"))
}

fn offset_to_line_column(content: &str, offset: usize) -> (usize, usize, String) {
    let before = &content[..offset.min(content.len())];
    let line = before.bytes().filter(|value| *value == b'\n').count() + 1;
    let line_start = before.rfind('\n').map(|index| index + 1).unwrap_or(0);
    let column = content[line_start..offset.min(content.len())].chars().count() + 1;
    let line_end = content[offset.min(content.len())..].find('\n').map(|index| offset + index).unwrap_or(content.len());
    let preview = content[line_start..line_end].trim_end_matches('\r').to_string();
    (line, column, preview)
}

fn run_search(request: &SearchRequest, index: &WorkspaceIndex) -> Result<SearchResponse, String> {
    let regex = compile_pattern(request)?;
    let limit = request.max_results.unwrap_or(DEFAULT_MAX_RESULTS).clamp(1, HARD_MAX_RESULTS);
    let mut paths = index.files.keys().cloned().collect::<Vec<_>>();
    for path in request.overlays.keys() { if !index.files.contains_key(path) { paths.push(path.clone()); } }
    paths.sort();
    paths.dedup();
    let mut matches = Vec::new();
    let mut files_scanned = 0usize;
    let mut truncated = false;

    for path in paths {
        if !path_allowed(&path, request) { continue; }
        let content = request.overlays.get(&path).or_else(|| index.files.get(&path));
        let Some(content) = content else { continue; };
        files_scanned += 1;
        for found in regex.find_iter(content) {
            let (line, column, preview) = offset_to_line_column(content, found.start());
            matches.push(SearchMatch {
                path: path.clone(),
                line,
                column,
                end_column: column + content[found.start()..found.end()].chars().count(),
                preview,
                matched: found.as_str().to_string(),
            });
            if matches.len() >= limit { truncated = true; break; }
        }
        if truncated { break; }
    }

    Ok(SearchResponse {
        matches,
        files_scanned,
        truncated,
        indexed: true,
        index_revision: index.revision,
        indexed_files: index.files.len(),
        index_truncated: index.truncated,
    })
}

#[tauri::command]
pub fn rebuild_workspace_index(state: State<'_, WorkspaceState>, index: State<'_, WorkspaceSearchIndexState>) -> Result<WorkspaceIndexStatus, String> {
    let root = workspace_root(&state)?;
    index.rebuild(&root)
}

#[tauri::command]
pub fn get_workspace_index_status(index: State<'_, WorkspaceSearchIndexState>) -> Result<WorkspaceIndexStatus, String> {
    index.status()
}

#[tauri::command]
pub fn search_workspace(request: SearchRequest, state: State<'_, WorkspaceState>, index: State<'_, WorkspaceSearchIndexState>) -> Result<SearchResponse, String> {
    let root = workspace_root(&state)?;
    if request.use_index { index.ensure(&root)?; } else { index.rebuild(&root)?; }
    let index = index.0.lock().map_err(|_| "workspace search index lock is poisoned".to_string())?;
    run_search(&request, &index)
}

#[tauri::command]
pub fn preview_workspace_replace(request: ReplaceRequest, state: State<'_, WorkspaceState>, index: State<'_, WorkspaceSearchIndexState>) -> Result<Vec<WorkspaceReplacement>, String> {
    let root = workspace_root(&state)?;
    if request.search.use_index { index.ensure(&root)?; } else { index.rebuild(&root)?; }
    let regex = compile_pattern(&request.search)?;
    let index = index.0.lock().map_err(|_| "workspace search index lock is poisoned".to_string())?;
    let mut paths = index.files.keys().cloned().collect::<Vec<_>>();
    for path in request.search.overlays.keys() { if !index.files.contains_key(path) { paths.push(path.clone()); } }
    paths.sort();
    paths.dedup();
    let mut output = Vec::new();

    for path in paths {
        if !path_allowed(&path, &request.search) { continue; }
        let Some(before) = request.search.overlays.get(&path).or_else(|| index.files.get(&path)).cloned() else { continue; };
        let replacements = regex.find_iter(&before).count();
        if replacements == 0 { continue; }
        let content = if request.search.regex {
            regex.replace_all(&before, request.replacement.as_str()).into_owned()
        } else {
            regex.replace_all(&before, regex::NoExpand(&request.replacement)).into_owned()
        };
        output.push(WorkspaceReplacement { relative_path: path, before, content, replacements });
        if output.len() >= 500 { break; }
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::{compile_pattern, wildcard_match, GitIgnoreRules, SearchRequest};
    use std::collections::HashMap;

    fn request(query: &str) -> SearchRequest {
        SearchRequest { query: query.into(), case_sensitive: false, whole_word: false, regex: false, include: String::new(), exclude: String::new(), max_results: None, use_index: true, overlays: HashMap::new() }
    }

    #[test]
    fn wildcard_filters_paths() {
        assert!(wildcard_match("src/*.ts", "src/app.ts"));
        assert!(wildcard_match("*.tsx", "src/components/App.tsx"));
        assert!(!wildcard_match("*.css", "src/App.tsx"));
    }

    #[test]
    fn literal_search_escapes_regex_characters() {
        let regex = compile_pattern(&request("a+b")).unwrap();
        assert!(regex.is_match("A+B"));
        assert!(!regex.is_match("aaab"));
    }

    #[test]
    fn gitignore_rules_support_negation() {
        let rules = GitIgnoreRules(vec![
            (false, "*.log".into(), false, false),
            (true, "keep.log".into(), false, false),
        ]);
        assert!(rules.ignored("logs/error.log", false));
        assert!(!rules.ignored("logs/keep.log", false));
    }
}
