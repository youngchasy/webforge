use crate::workspace::{clean_relative_path, workspace_root, WorkspaceState};
use serde::Serialize;
use std::{collections::HashMap, fs, path::{Path, PathBuf}};
use tauri::State;

const MAX_BUNDLE_FILES: usize = 50_000;
const MAX_DEPTH: usize = 24;
const DEFAULT_OUTPUT_DIRS: &[&str] = &["dist", "build", "out"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleAsset {
    path: String,
    extension: String,
    size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleGroup {
    kind: String,
    files: usize,
    size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleAnalysis {
    output_dir: String,
    exists: bool,
    file_count: usize,
    total_bytes: u64,
    groups: Vec<BundleGroup>,
    largest: Vec<BundleAsset>,
    sourcemap_bytes: u64,
}

fn group_for(extension: &str) -> &'static str {
    match extension {
        "js" | "mjs" | "cjs" => "JavaScript",
        "css" => "CSS",
        "map" => "Source maps",
        "html" | "htm" => "HTML",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "svg" | "ico" => "Images",
        "woff" | "woff2" | "ttf" | "otf" | "eot" => "Fonts",
        "mp4" | "webm" | "mov" | "mp3" | "wav" | "ogg" | "m4a" => "Media",
        "json" => "JSON",
        _ => "Other",
    }
}

fn display_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

fn collect(root: &Path, dir: &Path, output: &mut Vec<BundleAsset>, depth: usize) {
    if depth > MAX_DEPTH || output.len() >= MAX_BUNDLE_FILES { return; }
    let Ok(entries) = fs::read_dir(dir) else { return; };
    for entry in entries.flatten() {
        if output.len() >= MAX_BUNDLE_FILES { break; }
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else { continue; };
        if metadata.file_type().is_symlink() { continue; }
        if metadata.is_dir() { collect(root, &path, output, depth + 1); continue; }
        if !metadata.is_file() { continue; }
        let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
        output.push(BundleAsset { path: display_path(root, &path), extension, size_bytes: metadata.len() });
    }
}

fn resolve_output(root: &Path, requested: Option<String>) -> Result<(PathBuf, String), String> {
    if let Some(value) = requested.filter(|value| !value.trim().is_empty()) {
        let relative = clean_relative_path(value.trim())?;
        if relative.as_os_str().is_empty() { return Err("bundle output directory cannot be the workspace root".into()); }
        let path = root.join(&relative);
        if path.exists() {
            let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() { return Err("bundle output directory may not be a symbolic link".into()); }
            let canonical = fs::canonicalize(&path).map_err(|error| error.to_string())?;
            if !canonical.starts_with(root) { return Err("bundle output resolved outside the workspace".into()); }
            return Ok((canonical, relative.to_string_lossy().replace('\\', "/")));
        }
        return Ok((path, relative.to_string_lossy().replace('\\', "/")));
    }
    for candidate in DEFAULT_OUTPUT_DIRS {
        let path = root.join(candidate);
        if path.is_dir() {
            let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() { continue; }
            let canonical = fs::canonicalize(&path).map_err(|error| error.to_string())?;
            if canonical.starts_with(root) { return Ok((canonical, (*candidate).into())); }
        }
    }
    Ok((root.join("dist"), "dist".into()))
}

#[tauri::command]
pub fn analyze_project_bundle(output_dir: Option<String>, state: State<'_, WorkspaceState>) -> Result<BundleAnalysis, String> {
    let root = workspace_root(&state)?;
    let (target, display) = resolve_output(&root, output_dir)?;
    if !target.is_dir() {
        return Ok(BundleAnalysis { output_dir: display, exists: false, file_count: 0, total_bytes: 0, groups: Vec::new(), largest: Vec::new(), sourcemap_bytes: 0 });
    }
    let mut assets = Vec::new();
    collect(&target, &target, &mut assets, 0);
    let total_bytes = assets.iter().map(|asset| asset.size_bytes).sum();
    let sourcemap_bytes = assets.iter().filter(|asset| asset.extension == "map").map(|asset| asset.size_bytes).sum();
    let mut grouped: HashMap<&'static str, (usize, u64)> = HashMap::new();
    for asset in &assets {
        let entry = grouped.entry(group_for(&asset.extension)).or_insert((0, 0));
        entry.0 += 1; entry.1 += asset.size_bytes;
    }
    let mut groups = grouped.into_iter().map(|(kind, (files, size_bytes))| BundleGroup { kind: kind.into(), files, size_bytes }).collect::<Vec<_>>();
    groups.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes).then_with(|| a.kind.cmp(&b.kind)));
    assets.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes).then_with(|| a.path.cmp(&b.path)));
    let largest = assets.iter().take(30).cloned().collect();
    Ok(BundleAnalysis { output_dir: display, exists: true, file_count: assets.len(), total_bytes, groups, largest, sourcemap_bytes })
}
