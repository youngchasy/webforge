use crate::{
    security::{require_trusted, WorkspaceSecurityState},
    workspace::{clean_relative_path, workspace_root, WorkspaceState},
};
use regex::Regex;
use serde::Serialize;
use std::{collections::HashMap, fs, path::{Path, PathBuf}};
use tauri::State;

const MAX_ASSETS: usize = 10_000;
const MAX_TEXT_FILES: usize = 12_000;
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_SVG_BYTES: u64 = 4 * 1024 * 1024;
const IGNORED: &[&str] = &[".git", "node_modules", "target", "dist", "build", "coverage", ".next", ".nuxt", ".svelte-kit", ".turbo"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetEntry {
    path: String,
    name: String,
    extension: String,
    kind: String,
    size_bytes: u64,
    references: usize,
    unused: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetInventory {
    assets: Vec<AssetEntry>,
    total_bytes: u64,
    scanned_text_files: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetOptimizeResult {
    path: String,
    before_bytes: u64,
    after_bytes: u64,
    saved_bytes: u64,
}

fn display_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

fn asset_kind(extension: &str) -> Option<&'static str> {
    match extension {
        "svg" => Some("svg"),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "ico" | "bmp" => Some("image"),
        "woff" | "woff2" | "ttf" | "otf" | "eot" => Some("font"),
        "mp4" | "webm" | "mov" | "m4v" => Some("video"),
        "mp3" | "wav" | "ogg" | "m4a" | "aac" | "flac" => Some("audio"),
        _ => None,
    }
}

fn is_text_source(extension: &str) -> bool {
    matches!(extension, "html" | "htm" | "css" | "scss" | "sass" | "less" | "js" | "jsx" | "ts" | "tsx" | "vue" | "svelte" | "json" | "md" | "mdx" | "xml" | "txt")
}

fn collect_files(root: &Path, dir: &Path, assets: &mut Vec<(PathBuf, String, String, u64)>, texts: &mut Vec<PathBuf>, depth: usize) {
    if depth > 24 || assets.len() >= MAX_ASSETS { return; }
    let Ok(entries) = fs::read_dir(dir) else { return; };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(metadata) = fs::symlink_metadata(&path) else { continue; };
        if metadata.file_type().is_symlink() { continue; }
        if metadata.is_dir() {
            if !IGNORED.contains(&name.as_str()) { collect_files(root, &path, assets, texts, depth + 1); }
            continue;
        }
        if !metadata.is_file() { continue; }
        let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
        if let Some(kind) = asset_kind(&extension) {
            assets.push((path.clone(), extension, kind.into(), metadata.len()));
        } else if texts.len() < MAX_TEXT_FILES && metadata.len() <= MAX_TEXT_BYTES && is_text_source(&extension) {
            texts.push(path);
        }
    }
    let _ = root;
}

#[tauri::command]
pub fn list_workspace_assets(state: State<'_, WorkspaceState>) -> Result<AssetInventory, String> {
    let root = workspace_root(&state)?;
    let mut raw_assets = Vec::new();
    let mut text_files = Vec::new();
    collect_files(&root, &root, &mut raw_assets, &mut text_files, 0);

    let mut references: HashMap<String, usize> = raw_assets.iter().map(|(path, _, _, _)| (display_path(&root, path), 0usize)).collect();
    for path in &text_files {
        let Ok(content) = fs::read_to_string(path) else { continue; };
        for (asset_path, count) in references.iter_mut() {
            let basename = asset_path.rsplit('/').next().unwrap_or(asset_path);
            if content.contains(asset_path) || content.contains(&format!("/{asset_path}")) || content.contains(&format!("./{asset_path}")) || (basename.len() > 5 && content.contains(basename)) {
                *count += 1;
            }
        }
    }

    let total_bytes = raw_assets.iter().map(|(_, _, _, size)| *size).sum();
    let mut assets = raw_assets.into_iter().map(|(path, extension, kind, size_bytes)| {
        let relative = display_path(&root, &path);
        let count = *references.get(&relative).unwrap_or(&0);
        AssetEntry {
            name: path.file_name().map(|value| value.to_string_lossy().to_string()).unwrap_or_else(|| relative.clone()),
            path: relative,
            extension,
            kind,
            size_bytes,
            references: count,
            unused: count == 0,
        }
    }).collect::<Vec<_>>();
    assets.sort_by(|a, b| a.path.to_ascii_lowercase().cmp(&b.path.to_ascii_lowercase()));
    Ok(AssetInventory { assets, total_bytes, scanned_text_files: text_files.len() })
}

#[tauri::command]
pub fn optimize_svg_asset(
    relative_path: String,
    state: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
) -> Result<AssetOptimizeResult, String> {
    require_trusted(&security)?;
    let root = workspace_root(&state)?;
    let relative = clean_relative_path(&relative_path)?;
    if relative.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("svg")) != Some(true) {
        return Err("only SVG assets can be optimized by this command".into());
    }
    let target = fs::canonicalize(root.join(&relative)).map_err(|error| error.to_string())?;
    if !target.starts_with(&root) { return Err("asset path resolved outside the workspace".into()); }
    let metadata = fs::metadata(&target).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_SVG_BYTES { return Err("SVG exceeds the 4 MiB optimization limit".into()); }
    let before = fs::read_to_string(&target).map_err(|error| error.to_string())?;
    let inter_tag = Regex::new(r">[\t\r\n ]+<").map_err(|error| error.to_string())?;
    let lower = before.to_ascii_lowercase();
    let text_sensitive = ["<text", "<tspan", "<title", "<desc", "<style", "<script", "<foreignobject", "<metadata", "xml:space"]
        .iter().any(|marker| lower.contains(marker));
    let mut optimized = before.trim_start_matches('\u{feff}').trim().to_string();
    if !text_sensitive { optimized = inter_tag.replace_all(&optimized, "><").into_owned(); }
    if !optimized.ends_with('\n') { optimized.push('\n'); }
    if optimized.len() < before.len() { fs::write(&target, optimized.as_bytes()).map_err(|error| error.to_string())?; }
    let after_bytes = if optimized.len() < before.len() { optimized.len() as u64 } else { before.len() as u64 };
    Ok(AssetOptimizeResult { path: relative_path, before_bytes: before.len() as u64, after_bytes, saved_bytes: before.len() as u64 - after_bytes })
}
