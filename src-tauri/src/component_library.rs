use crate::workspace::{workspace_root, WorkspaceState};
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::State;

const LIBRARY_RELATIVE_PATH: &str = ".webforge/components.json";
const MAX_COMPONENTS: usize = 200;
const MAX_SNIPPET_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceComponentSnippet {
    id: String,
    label: String,
    category: String,
    snippet: String,
    user_defined: bool,
}


fn checked_library_path(root: &std::path::Path, create_directory: bool) -> Result<std::path::PathBuf, String> {
    let directory = root.join(".webforge");
    if directory.exists() {
        let metadata = fs::symlink_metadata(&directory).map_err(|error| format!("unable to inspect {}: {error}", directory.display()))?;
        if metadata.file_type().is_symlink() { return Err(".webforge may not be a symbolic link".into()); }
    } else if create_directory {
        fs::create_dir(&directory).map_err(|error| format!("unable to create {}: {error}", directory.display()))?;
    } else {
        return Ok(root.join(LIBRARY_RELATIVE_PATH));
    }

    let canonical_directory = fs::canonicalize(&directory).map_err(|error| format!("unable to resolve {}: {error}", directory.display()))?;
    if !canonical_directory.starts_with(root) { return Err("component library directory escaped the workspace".into()); }
    let path = canonical_directory.join("components.json");
    if path.exists() {
        let metadata = fs::symlink_metadata(&path).map_err(|error| format!("unable to inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() { return Err("component library file may not be a symbolic link".into()); }
        let canonical = fs::canonicalize(&path).map_err(|error| format!("unable to resolve {}: {error}", path.display()))?;
        if !canonical.starts_with(root) { return Err("component library file escaped the workspace".into()); }
    }
    Ok(path)
}

fn validate_components(components: Vec<WorkspaceComponentSnippet>) -> Result<Vec<WorkspaceComponentSnippet>, String> {
    if components.len() > MAX_COMPONENTS { return Err(format!("component library exceeds {MAX_COMPONENTS} entries")); }
    for component in &components {
        if component.id.trim().is_empty() || component.label.trim().is_empty() { return Err("component id and label are required".into()); }
        if component.snippet.len() > MAX_SNIPPET_BYTES { return Err(format!("component {} exceeds the snippet size limit", component.label)); }
    }
    Ok(components)
}

#[tauri::command]
pub fn load_workspace_component_library(state: State<'_, WorkspaceState>) -> Result<Vec<WorkspaceComponentSnippet>, String> {
    let root = workspace_root(&state)?;
    let path = checked_library_path(&root, false)?;
    if !path.is_file() { return Ok(Vec::new()); }
    let raw = fs::read_to_string(&path).map_err(|error| format!("unable to read {}: {error}", path.display()))?;
    let components: Vec<WorkspaceComponentSnippet> = serde_json::from_str(&raw).map_err(|error| format!("invalid component library JSON: {error}"))?;
    validate_components(components)
}

#[tauri::command]
pub fn save_workspace_component_library(
    components: Vec<WorkspaceComponentSnippet>,
    state: State<'_, WorkspaceState>,
) -> Result<(), String> {
    let components = validate_components(components)?;
    let root = workspace_root(&state)?;
    let path = checked_library_path(&root, true)?;
    let json = serde_json::to_string_pretty(&components).map_err(|error| error.to_string())? + "\n";
    fs::write(&path, json).map_err(|error| format!("unable to write {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::{checked_library_path, validate_components, WorkspaceComponentSnippet, MAX_COMPONENTS};

    fn component(id: &str) -> WorkspaceComponentSnippet {
        WorkspaceComponentSnippet { id: id.into(), label: id.into(), category: "Test".into(), snippet: "<div></div>".into(), user_defined: true }
    }

    #[test]
    fn validates_small_component_library() { assert_eq!(validate_components(vec![component("card")]).unwrap().len(), 1); }

    #[test]
    fn rejects_too_many_components() {
        let values = (0..=MAX_COMPONENTS).map(|index| component(&format!("c{index}"))).collect();
        assert!(validate_components(values).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_component_directory() {
        use std::os::unix::fs::symlink;
        use std::time::{SystemTime, UNIX_EPOCH};

        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!("webforge-components-{nonce}"));
        let root = base.join("workspace");
        let outside = base.join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join(".webforge")).unwrap();

        let result = checked_library_path(&root, true);
        assert!(result.is_err());

        let _ = std::fs::remove_dir_all(&base);
    }
}
