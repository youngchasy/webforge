use crate::workspace::{workspace_root, WorkspaceState};
use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeMap, fs, path::Path};
use tauri::State;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub adapter: String,
    pub label: String,
    pub framework: Option<String>,
    pub framework_version: Option<String>,
    pub vite: bool,
    pub vite_config_path: Option<String>,
    pub typescript: bool,
    pub package_json: bool,
    pub dependencies_installed: bool,
    pub preferred_package_manager: Option<String>,
    pub dev_script: Option<String>,
    pub dev_server_supported: bool,
    pub build_script: Option<String>,
    pub build_supported: bool,
    pub build_output_dir: Option<String>,
    pub scripts: Vec<String>,
    pub css_frameworks: Vec<String>,
    pub entry_path: Option<String>,
}

fn package_manager(root: &Path) -> Option<String> {
    [
        ("pnpm-lock.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("bun.lockb", "bun"),
        ("bun.lock", "bun"),
        ("package-lock.json", "npm"),
        ("npm-shrinkwrap.json", "npm"),
    ]
    .into_iter()
    .find_map(|(file, manager)| root.join(file).exists().then(|| manager.to_string()))
}

fn object_strings(value: Option<&Value>) -> BTreeMap<String, String> {
    value
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| value.as_str().map(|value| (key.clone(), value.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn dependency_version(dependencies: &BTreeMap<String, String>, name: &str) -> Option<String> {
    dependencies.get(name).cloned()
}

fn dependency_exists(dependencies: &BTreeMap<String, String>, name: &str) -> bool {
    dependencies.contains_key(name)
}

fn is_vite_token(token: &str) -> bool {
    token == "vite" || token.ends_with("/vite") || token.starts_with("vite@")
}

fn safe_direct_vite_tokens(script: &str) -> Option<Vec<&str>> {
    if script.contains('\n') || script.contains('\r') || ["&", "|", ";", ">", "<", "`", "$(", "%", "!", "^"].iter().any(|marker| script.contains(*marker)) {
        return None;
    }
    let tokens: Vec<_> = script.split_whitespace().collect();
    if tokens.first().copied().is_some_and(is_vite_token) { Some(tokens) } else { None }
}

fn script_mentions_vite(script: &str) -> bool {
    safe_direct_vite_tokens(script).is_some()
}

fn script_mentions_vite_build(script: &str) -> bool {
    safe_direct_vite_tokens(script)
        .is_some_and(|tokens| tokens.get(1).copied() == Some("build"))
}

fn script_vite_config(script: &str) -> Option<String> {
    let tokens = safe_direct_vite_tokens(script)?;
    for (index, token) in tokens.iter().enumerate() {
        let inline = token.strip_prefix("--config=").or_else(|| token.strip_prefix("-c="));
        let Some(candidate) = inline.or_else(|| {
            ((*token == "--config" || *token == "-c") && tokens.get(index + 1).is_some())
                .then(|| tokens[index + 1])
        }) else { continue; };
        let candidate = candidate.trim_matches(|ch| ch == '"' || ch == '\'');
        let path = Path::new(candidate);
        if !candidate.is_empty() && !path.is_absolute() && !path.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
            return Some(candidate.replace('\\', "/"));
        }
    }
    None
}

fn default_vite_config(root: &Path) -> Option<String> {
    ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.mts"]
        .into_iter()
        .find(|candidate| root.join(candidate).is_file())
        .map(str::to_string)
}

fn configured_vite_out_dir(root: &Path) -> Option<String> {
    for candidate in ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.mts"] {
        let Ok(content) = fs::read_to_string(root.join(candidate)) else { continue; };
        let Some(index) = content.find("outDir") else { continue; };
        let tail = &content[index + "outDir".len()..];
        let Some(colon) = tail.find(':') else { continue; };
        let value = tail[colon + 1..].trim_start();
        let Some(quote) = value.chars().next().filter(|ch| *ch == '\'' || *ch == '"') else { continue; };
        let rest = &value[quote.len_utf8()..];
        let Some(end) = rest.find(quote) else { continue; };
        let path = rest[..end].trim();
        if !path.is_empty() && !path.starts_with('/') && !path.contains("..") {
            return Some(path.replace('\\', "/"));
        }
    }
    None
}

fn first_html_entry(root: &Path) -> Option<String> {
    for candidate in ["index.html", "src/index.html", "public/index.html"] {
        if root.join(candidate).is_file() {
            return Some(candidate.to_string());
        }
    }
    None
}

pub(crate) fn detect_project_at(root: &Path) -> Result<ProjectInfo, String> {
    let package_path = root.join("package.json");
    let package_json = package_path.is_file();
    let mut dependencies = BTreeMap::new();
    let mut scripts = BTreeMap::new();

    if package_json {
        let raw = fs::read_to_string(&package_path).map_err(|error| format!("unable to read package.json: {error}"))?;
        let package: Value = serde_json::from_str(&raw).map_err(|error| format!("invalid package.json: {error}"))?;
        dependencies.extend(object_strings(package.get("dependencies")));
        dependencies.extend(object_strings(package.get("devDependencies")));
        scripts = object_strings(package.get("scripts"));
    }

    let has_vite = dependency_exists(&dependencies, "vite")
        || scripts.values().any(|script| script_mentions_vite(script));
    let has_react = dependency_exists(&dependencies, "react") || dependency_exists(&dependencies, "@vitejs/plugin-react") || dependency_exists(&dependencies, "@vitejs/plugin-react-swc");
    let has_vue = dependency_exists(&dependencies, "vue") || dependency_exists(&dependencies, "@vitejs/plugin-vue");
    let has_svelte = dependency_exists(&dependencies, "svelte") || dependency_exists(&dependencies, "@sveltejs/vite-plugin-svelte");

    let (adapter, label, framework, version) = if has_react && has_vite {
        ("react-vite", "React + Vite", Some("React"), dependency_version(&dependencies, "react"))
    } else if has_react {
        ("react", "React", Some("React"), dependency_version(&dependencies, "react"))
    } else if has_vue && has_vite {
        ("vue-vite", "Vue + Vite", Some("Vue"), dependency_version(&dependencies, "vue"))
    } else if has_vue {
        ("vue", "Vue", Some("Vue"), dependency_version(&dependencies, "vue"))
    } else if has_svelte && has_vite {
        ("svelte-vite", "Svelte + Vite", Some("Svelte"), dependency_version(&dependencies, "svelte"))
    } else if has_svelte {
        ("svelte", "Svelte", Some("Svelte"), dependency_version(&dependencies, "svelte"))
    } else if has_vite {
        ("vite", "Vite", None, dependency_version(&dependencies, "vite"))
    } else if package_json {
        ("node", "Node / web project", None, None)
    } else {
        ("static", "Static HTML/CSS/JS", None, None)
    };

    let typescript = root.join("tsconfig.json").exists()
        || dependencies.contains_key("typescript")
        || ["src/main.ts", "src/main.tsx", "src/App.tsx", "src/App.vue"]
            .iter()
            .any(|candidate| root.join(candidate).exists());

    let mut css_frameworks = Vec::new();
    for (dependency, label) in [
        ("tailwindcss", "Tailwind CSS"),
        ("bootstrap", "Bootstrap"),
        ("@unocss/vite", "UnoCSS"),
    ] {
        if dependencies.contains_key(dependency) {
            css_frameworks.push(label.to_string());
        }
    }

    let mut script_names: Vec<_> = scripts.keys().cloned().collect();
    script_names.sort();
    let dev_script = scripts
        .contains_key("dev")
        .then(|| "dev".to_string())
        .or_else(|| scripts.contains_key("start").then(|| "start".to_string()));
    let vite_config_path = dev_script
        .as_deref()
        .and_then(|name| scripts.get(name))
        .and_then(|script| script_vite_config(script))
        .or_else(|| default_vite_config(root));
    let dev_server_supported = dev_script
        .as_deref()
        .and_then(|name| scripts.get(name))
        .map(|script| script_mentions_vite(script))
        .unwrap_or(false);
    let build_script = scripts.contains_key("build").then(|| "build".to_string());
    let build_supported = build_script
        .as_deref()
        .and_then(|name| scripts.get(name))
        .map(|script| script_mentions_vite_build(script))
        .unwrap_or(false);
    let build_output_dir = build_supported.then(|| configured_vite_out_dir(root).unwrap_or_else(|| "dist".to_string()));

    Ok(ProjectInfo {
        adapter: adapter.to_string(),
        label: label.to_string(),
        framework: framework.map(str::to_string),
        framework_version: version,
        vite: has_vite,
        vite_config_path,
        typescript,
        package_json,
        dependencies_installed: root.join("node_modules").is_dir(),
        preferred_package_manager: package_manager(root).or_else(|| package_json.then(|| "npm".to_string())),
        dev_script,
        dev_server_supported,
        build_script,
        build_supported,
        build_output_dir,
        scripts: script_names,
        css_frameworks,
        entry_path: first_html_entry(root),
    })
}

#[tauri::command]
pub fn detect_project(state: State<'_, WorkspaceState>) -> Result<ProjectInfo, String> {
    detect_project_at(&workspace_root(&state)?)
}

#[cfg(test)]
mod tests {
    use super::detect_project_at;
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("webforge-{label}-{suffix}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn detects_react_vite_project() {
        let root = temp_dir("react");
        fs::write(root.join("package.json"), r#"{
          "scripts":{"dev":"vite","build":"vite build"},
          "dependencies":{"react":"^19.0.0"},
          "devDependencies":{"vite":"^8.0.0","typescript":"^5.0.0"}
        }"#).unwrap();
        fs::write(root.join("index.html"), "<div id='root'></div>").unwrap();

        let info = detect_project_at(&root).unwrap();
        assert_eq!(info.adapter, "react-vite");
        assert!(info.vite);
        assert!(info.typescript);
        assert_eq!(info.dev_script.as_deref(), Some("dev"));
        assert!(info.build_supported);
        assert_eq!(info.build_output_dir.as_deref(), Some("dist"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detects_vue_vite_and_tailwind() {
        let root = temp_dir("vue");
        fs::write(root.join("package.json"), r#"{
          "scripts":{"dev":"vite"},
          "dependencies":{"vue":"^3.0.0"},
          "devDependencies":{"vite":"^8.0.0","tailwindcss":"^4.0.0"}
        }"#).unwrap();
        fs::write(root.join("pnpm-lock.yaml"), "lockfileVersion: '9.0'").unwrap();

        let info = detect_project_at(&root).unwrap();
        assert_eq!(info.adapter, "vue-vite");
        assert_eq!(info.preferred_package_manager.as_deref(), Some("pnpm"));
        assert_eq!(info.css_frameworks, vec!["Tailwind CSS"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn shell_chained_vite_scripts_are_not_supervised() {
        assert!(!super::script_mentions_vite("vite && node post.js"));
        assert!(!super::script_mentions_vite_build("vite build && node post.js"));
        assert!(!super::script_mentions_vite_build("vite build; node post.js"));
        assert!(!super::script_mentions_vite_build("vite build $(node post.js)"));
        assert!(!super::script_mentions_vite("vite & node post.js"));
    }

    #[test]
    fn direct_vite_build_is_supervised() {
        assert!(super::script_mentions_vite("vite --host 127.0.0.1"));
        assert!(super::script_mentions_vite_build("vite build"));
        assert!(!super::script_mentions_vite_build("vite --mode production build"));
    }

    #[test]
    fn does_not_run_custom_dev_wrapper_as_vite() {
        let root = temp_dir("custom-dev");
        fs::write(root.join("package.json"), r#"{
          "scripts":{"dev":"node scripts/dev-server.mjs"},
          "devDependencies":{"vite":"^8.0.0"}
        }"#).unwrap();

        let info = detect_project_at(&root).unwrap();
        assert_eq!(info.adapter, "vite");
        assert!(info.vite);
        assert!(!info.dev_server_supported);
        let _ = fs::remove_dir_all(root);
    }


    #[test]
    fn detects_custom_vite_output_directory() {
        let root = temp_dir("vite-out-dir");
        fs::write(root.join("package.json"), r#"{
          "scripts":{"dev":"vite","build":"vite build"},
          "devDependencies":{"vite":"^8.0.0"}
        }"#).unwrap();
        fs::write(root.join("vite.config.ts"), "export default { build: { outDir: 'public-build' } };").unwrap();
        let info = detect_project_at(&root).unwrap();
        assert_eq!(info.build_output_dir.as_deref(), Some("public-build"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detects_explicit_vite_config() {
        let root = temp_dir("vite-config");
        fs::write(root.join("package.json"), r#"{
          "scripts":{"dev":"vite --config=config/vite.dev.ts"},
          "devDependencies":{"vite":"^8.0.0"}
        }"#).unwrap();
        let info = detect_project_at(&root).unwrap();
        assert_eq!(info.vite_config_path.as_deref(), Some("config/vite.dev.ts"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn detects_static_project() {
        let root = temp_dir("static");
        fs::write(root.join("index.html"), "<h1>Hello</h1>").unwrap();
        let info = detect_project_at(&root).unwrap();
        assert_eq!(info.adapter, "static");
        assert_eq!(info.entry_path.as_deref(), Some("index.html"));
        let _ = fs::remove_dir_all(root);
    }
}
