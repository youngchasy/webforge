use crate::workspace::{workspace_root, WorkspaceState};
use regex::Regex;
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}};
use tauri::State;

const MAX_HTML_FILES: usize = 500;
const MAX_HTML_BYTES: u64 = 3 * 1024 * 1024;
const IGNORED: &[&str] = &[".git", "node_modules", "target", "dist", "build", "coverage", ".next", ".nuxt", ".svelte-kit", ".turbo"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAuditFinding {
    id: String,
    category: String,
    severity: String,
    rule: String,
    path: String,
    line: usize,
    message: String,
    suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAuditSummary {
    findings: Vec<ProjectAuditFinding>,
    files_scanned: usize,
    errors: usize,
    warnings: usize,
    infos: usize,
}

fn display_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/")
}

fn collect_html(dir: &Path, files: &mut Vec<PathBuf>, depth: usize) {
    if depth > 20 || files.len() >= MAX_HTML_FILES { return; }
    let Ok(entries) = fs::read_dir(dir) else { return; };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(metadata) = fs::symlink_metadata(&path) else { continue; };
        if metadata.file_type().is_symlink() { continue; }
        if metadata.is_dir() {
            if !IGNORED.contains(&name.as_str()) { collect_html(&path, files, depth + 1); }
        } else if metadata.is_file() && metadata.len() <= MAX_HTML_BYTES {
            let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("");
            if extension.eq_ignore_ascii_case("html") || extension.eq_ignore_ascii_case("htm") { files.push(path); }
        }
    }
}

fn line_for(content: &str, byte: usize) -> usize { content[..byte.min(content.len())].bytes().filter(|value| *value == b'\n').count() + 1 }

fn push(findings: &mut Vec<ProjectAuditFinding>, category: &str, severity: &str, rule: &str, path: &str, line: usize, message: impl Into<String>, suggestion: Option<&str>) {
    let ordinal = findings.len();
    findings.push(ProjectAuditFinding {
        id: format!("{path}:{rule}:{line}:{ordinal}"),
        category: category.into(), severity: severity.into(), rule: rule.into(), path: path.into(), line,
        message: message.into(), suggestion: suggestion.map(str::to_string),
    });
}

fn has_match(pattern: &str, content: &str) -> bool { Regex::new(pattern).map(|regex| regex.is_match(content)).unwrap_or(false) }

fn attr(tag: &str, name: &str) -> Option<String> {
    let pattern = format!(r#"(?is)\b{}\s*=\s*["']([^"']*)["']"#, regex::escape(name));
    Regex::new(&pattern).ok()?.captures(tag)?.get(1).map(|value| value.as_str().to_string())
}

fn audit_html(root: &Path, path: &Path, content: &str, findings: &mut Vec<ProjectAuditFinding>) {
    let relative = display_path(root, path);
    if !has_match(r"(?is)<html\b[^>]*\blang\s*=", content) {
        push(findings, "accessibility", "warning", "html-lang", &relative, 1, "Document is missing an html[lang] attribute.", Some("Set the document language, for example <html lang=\"en\">."));
    }
    let title_re = Regex::new(r"(?is)<title\b[^>]*>(.*?)</title>").unwrap();
    match title_re.captures(content).and_then(|caps| caps.get(1)) {
        Some(title) if !title.as_str().trim().is_empty() => {}
        _ => push(findings, "seo", "error", "document-title", &relative, 1, "Page has no non-empty <title>.", Some("Add a concise unique page title.")),
    }
    if !has_match(r#"(?is)<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*="#, content) && !has_match(r#"(?is)<meta\b[^>]*\bcontent\s*=\s*["'][^"']+["'][^>]*\bname\s*=\s*["']description["']"#, content) {
        push(findings, "seo", "warning", "meta-description", &relative, 1, "Page is missing a meta description.", Some("Add <meta name=\"description\" content=\"…\">."));
    }
    for (rule, pattern, message) in [
        ("canonical", r#"(?is)<link\b[^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["']"#, "Canonical URL is not declared."),
        ("open-graph-title", r#"(?is)<meta\b[^>]*\bproperty\s*=\s*["']og:title["']"#, "Open Graph title is missing."),
        ("open-graph-description", r#"(?is)<meta\b[^>]*\bproperty\s*=\s*["']og:description["']"#, "Open Graph description is missing."),
        ("twitter-card", r#"(?is)<meta\b[^>]*\bname\s*=\s*["']twitter:card["']"#, "Twitter/X card metadata is missing."),
        ("favicon", r#"(?is)<link\b[^>]*\brel\s*=\s*["'][^"']*(?:icon|shortcut icon)[^"']*["']"#, "Favicon link is missing."),
    ] {
        if !has_match(pattern, content) { push(findings, "seo", "info", rule, &relative, 1, message, None); }
    }
    if !has_match(r#"(?is)<script\b[^>]*\btype\s*=\s*["']application/ld\+json["']"#, content) {
        push(findings, "seo", "info", "structured-data", &relative, 1, "No JSON-LD structured data detected.", None);
    }

    let h1_re = Regex::new(r"(?is)<h1\b").unwrap();
    let h1_count = h1_re.find_iter(content).count();
    if h1_count == 0 { push(findings, "accessibility", "warning", "h1", &relative, 1, "Page has no H1 heading.", Some("Add one primary heading that describes the page.")); }
    else if h1_count > 1 { push(findings, "accessibility", "info", "h1-multiple", &relative, 1, format!("Page contains {h1_count} H1 headings."), Some("Verify that multiple H1 headings are intentional.")); }

    let heading_re = Regex::new(r"(?is)<h([1-6])\b").unwrap();
    let mut previous = 0usize;
    for captures in heading_re.captures_iter(content) {
        let level = captures.get(1).and_then(|value| value.as_str().parse::<usize>().ok()).unwrap_or(0);
        let position = captures.get(0).map(|value| value.start()).unwrap_or(0);
        if previous > 0 && level > previous + 1 {
            push(findings, "accessibility", "warning", "heading-order", &relative, line_for(content, position), format!("Heading level jumps from H{previous} to H{level}."), Some("Keep heading levels hierarchical without skipping levels."));
        }
        previous = level;
    }

    let img_re = Regex::new(r"(?is)<img\b[^>]*>").unwrap();
    for found in img_re.find_iter(content) {
        let tag = found.as_str();
        if !Regex::new(r"(?is)\balt\s*=").unwrap().is_match(tag) {
            push(findings, "accessibility", "error", "img-alt", &relative, line_for(content, found.start()), "Image is missing an alt attribute.", Some("Add descriptive alt text, or alt=\"\" for a decorative image."));
        }
    }

    let input_re = Regex::new(r"(?is)<(?:input|select|textarea)\b[^>]*>").unwrap();
    let labels = Regex::new(r#"(?is)<label\b[^>]*\bfor\s*=\s*["']([^"']+)["']"#).unwrap().captures_iter(content).filter_map(|caps| caps.get(1).map(|value| value.as_str().to_string())).collect::<Vec<_>>();
    for found in input_re.find_iter(content) {
        let tag = found.as_str();
        let input_type = attr(tag, "type").unwrap_or_default().to_ascii_lowercase();
        if input_type == "hidden" { continue; }
        let has_aria = attr(tag, "aria-label").filter(|value| !value.trim().is_empty()).is_some() || attr(tag, "aria-labelledby").filter(|value| !value.trim().is_empty()).is_some();
        let id = attr(tag, "id");
        let labelled = id.as_ref().map(|id| labels.iter().any(|value| value == id)).unwrap_or(false);
        if !has_aria && !labelled {
            push(findings, "accessibility", "warning", "form-label", &relative, line_for(content, found.start()), "Form control has no detected label.", Some("Associate a <label for=…> or provide aria-label/aria-labelledby."));
        }
    }

    let tabindex_re = Regex::new(r#"(?is)\btabindex\s*=\s*["']([1-9][0-9]*)["']"#).unwrap();
    for caps in tabindex_re.captures_iter(content) {
        let found = caps.get(0).unwrap();
        push(findings, "accessibility", "warning", "positive-tabindex", &relative, line_for(content, found.start()), "Positive tabindex can create an unexpected keyboard order.", Some("Prefer DOM order with tabindex=\"0\" only when needed."));
    }

    let link_re = Regex::new(r#"(?is)<(?:a|img|script|link|source|video|audio)\b[^>]*(?:href|src)\s*=\s*["']([^"']+)["'][^>]*>"#).unwrap();
    let parent = path.parent().unwrap_or(root);
    for caps in link_re.captures_iter(content) {
        let Some(target_match) = caps.get(1) else { continue; };
        let target = target_match.as_str().trim();
        if target.is_empty() || target.starts_with('#') || target.starts_with("http://") || target.starts_with("https://") || target.starts_with("//") || target.starts_with("mailto:") || target.starts_with("tel:") || target.starts_with("data:") || target.starts_with("javascript:") { continue; }
        let clean = target.split(['?', '#']).next().unwrap_or(target);
        let candidate = if clean.starts_with('/') { root.join(clean.trim_start_matches('/')) } else { parent.join(clean) };
        if !candidate.exists() {
            push(findings, "links", "warning", "broken-local-link", &relative, line_for(content, target_match.start()), format!("Local reference does not exist: {target}"), Some("Fix the relative path or add the referenced file."));
        }
    }
}

#[tauri::command]
pub fn run_project_audit(state: State<'_, WorkspaceState>) -> Result<ProjectAuditSummary, String> {
    let root = workspace_root(&state)?;
    let mut html_files = Vec::new();
    collect_html(&root, &mut html_files, 0);
    let mut findings = Vec::new();
    for path in &html_files {
        if let Ok(content) = fs::read_to_string(path) { audit_html(&root, path, &content, &mut findings); }
    }
    let landing = html_files.first().map(|path| display_path(&root, path)).unwrap_or_else(|| "index.html".into());
    if !root.join("robots.txt").is_file() { push(&mut findings, "seo", "info", "robots", &landing, 1, "robots.txt is not present at the workspace root.", None); }
    if !root.join("sitemap.xml").is_file() { push(&mut findings, "seo", "info", "sitemap", &landing, 1, "sitemap.xml is not present at the workspace root.", None); }
    if html_files.is_empty() { push(&mut findings, "seo", "info", "no-static-html", "", 1, "No static HTML files were found. Source audit cannot inspect framework-rendered DOM.", Some("Run the app preview and use browser-level accessibility tooling for rendered pages.")); }
    findings.sort_by(|a, b| {
        let weight = |severity: &str| match severity { "error" => 0, "warning" => 1, _ => 2 };
        weight(&a.severity).cmp(&weight(&b.severity)).then_with(|| a.path.cmp(&b.path)).then_with(|| a.line.cmp(&b.line))
    });
    let errors = findings.iter().filter(|item| item.severity == "error").count();
    let warnings = findings.iter().filter(|item| item.severity == "warning").count();
    let infos = findings.iter().filter(|item| item.severity == "info").count();
    Ok(ProjectAuditSummary { findings, files_scanned: html_files.len(), errors, warnings, infos })
}
