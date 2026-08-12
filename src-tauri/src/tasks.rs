use crate::{
    project::detect_project_at,
    runtime::{choose_manager, configure_process_group, environment, force_terminate_process_tree, resolve_tool, terminate_process_tree},
    security::{require_terminal_allowed, WorkspaceSecurityState},
    workspace::{clean_relative_path, workspace_root, WorkspaceState},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::VecDeque,
    env,
    fs,
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::State;

const MAX_TASK_LOG_LINES: usize = 2000;
const MAX_TASKS: usize = 160;
const MAX_TEST_REPORT_BYTES: u64 = 8 * 1024 * 1024;
const MAX_TEST_REPORT_CASES: usize = 4000;
const MAX_TEST_HISTORY: usize = 30;
const MAX_TEST_HISTORY_BYTES: u64 = 512 * 1024;
const MAX_FAILED_RERUN_CASES: usize = 80;


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageMetric {
    total: u64,
    covered: u64,
    skipped: u64,
    percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverageSummary {
    lines: CoverageMetric,
    statements: CoverageMetric,
    functions: CoverageMetric,
    branches: CoverageMetric,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestHistoryEntry {
    framework: String,
    finished_at_ms: u64,
    path: Option<String>,
    requested_test: Option<String>,
    success: bool,
    duration_ms: Option<u64>,
    total: usize,
    passed: usize,
    failed: usize,
    skipped: usize,
    coverage: Option<CoverageSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCaseResult {
    id: String,
    path: String,
    title: String,
    full_name: String,
    suite: Option<String>,
    status: String,
    duration_ms: Option<u64>,
    failure_message: Option<String>,
    stack: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRunReport {
    framework: String,
    path: Option<String>,
    requested_test: Option<String>,
    success: bool,
    duration_ms: Option<u64>,
    total: usize,
    passed: usize,
    failed: usize,
    skipped: usize,
    cases: Vec<TestCaseResult>,
    coverage: Option<CoverageSummary>,
    finished_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTask {
    id: String,
    name: String,
    script: String,
    category: String,
    package_manager: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatus {
    running: bool,
    task_id: Option<String>,
    name: Option<String>,
    category: Option<String>,
    command: Option<String>,
    package_manager: Option<String>,
    exit_code: Option<i32>,
    test_path: Option<String>,
    test_name: Option<String>,
    test_framework: Option<String>,
    coverage: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskLogBatch {
    cursor: usize,
    lines: Vec<String>,
    status: TaskStatus,
}

#[derive(Debug, Clone)]
struct TaskMeta {
    running: bool,
    task_id: Option<String>,
    name: Option<String>,
    category: Option<String>,
    command: Option<String>,
    package_manager: Option<String>,
    exit_code: Option<i32>,
    test_path: Option<String>,
    test_name: Option<String>,
    test_framework: Option<String>,
    coverage: bool,
}

struct TaskLogBuffer {
    base_cursor: usize,
    lines: VecDeque<String>,
}

impl TaskLogBuffer {
    fn new() -> Self { Self { base_cursor: 0, lines: VecDeque::new() } }
    fn clear(&mut self) { self.base_cursor = 0; self.lines.clear(); }
    fn push(&mut self, line: String) {
        self.lines.push_back(line);
        while self.lines.len() > MAX_TASK_LOG_LINES {
            self.lines.pop_front();
            self.base_cursor += 1;
        }
    }
    fn current_cursor(&self) -> usize { self.base_cursor + self.lines.len() }
}

#[derive(Debug, Clone)]
struct TestRunArtifacts {
    root: std::path::PathBuf,
    framework: String,
    report_path: std::path::PathBuf,
    coverage_path: Option<std::path::PathBuf>,
}

pub struct TaskState {
    child: Mutex<Option<Child>>,
    logs: Arc<Mutex<TaskLogBuffer>>,
    meta: Mutex<TaskMeta>,
    report_path: Mutex<Option<TestRunArtifacts>>,
    test_report: Mutex<Option<TestRunReport>>,
}

impl TaskState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            logs: Arc::new(Mutex::new(TaskLogBuffer::new())),
            meta: Mutex::new(TaskMeta { running: false, task_id: None, name: None, category: None, command: None, package_manager: None, exit_code: None, test_path: None, test_name: None, test_framework: None, coverage: false }),
            report_path: Mutex::new(None),
            test_report: Mutex::new(None),
        }
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut child_guard = self.child.lock().map_err(|_| "task child lock is poisoned".to_string())?;
        if let Some(mut child) = child_guard.take() {
            let pid = child.id();
            terminate_process_tree(pid, &mut child);
            let mut exited = false;
            for _ in 0..12 {
                match child.try_wait() {
                    Ok(Some(_)) => { exited = true; break; }
                    Ok(None) => thread::sleep(Duration::from_millis(50)),
                    Err(_) => break,
                }
            }
            if !exited { force_terminate_process_tree(pid, &mut child); }
            let _ = child.wait();
            append_log(&self.logs, format!("[task] stopped process {pid}"));
        }
        if let Ok(mut report_path) = self.report_path.lock() {
            if let Some(artifacts) = report_path.take() {
                let _ = fs::remove_file(artifacts.report_path);
                if let Some(path) = artifacts.coverage_path { cleanup_coverage_artifact(&path); }
            }
        }
        let mut meta = self.meta.lock().map_err(|_| "task metadata lock is poisoned".to_string())?;
        meta.running = false;
        meta.exit_code = None;
        Ok(())
    }

    fn refresh_status(&self) -> Result<TaskStatus, String> {
        let mut exited = false;
        let mut exit_code = None;
        {
            let mut child_guard = self.child.lock().map_err(|_| "task child lock is poisoned".to_string())?;
            if let Some(child) = child_guard.as_mut() {
                if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                    exited = true;
                    exit_code = status.code();
                    *child_guard = None;
                }
            }
        }
        let mut meta = self.meta.lock().map_err(|_| "task metadata lock is poisoned".to_string())?;
        if exited {
            meta.running = false;
            meta.exit_code = exit_code;
            append_log(&self.logs, format!("[task] exited with code {}", exit_code.unwrap_or(-1)));
            if let Ok(mut report_path) = self.report_path.lock() {
                if let Some(artifacts) = report_path.take() {
                    match parse_test_report(&artifacts.root, &artifacts.framework, &artifacts.report_path, meta.test_path.as_deref(), meta.test_name.as_deref()) {
                        Ok(Some(mut report)) => {
                            if let Some(coverage_path) = artifacts.coverage_path.as_ref() {
                                match parse_coverage_summary(coverage_path) {
                                    Ok(coverage) => report.coverage = coverage,
                                    Err(error) => append_log(&self.logs, format!("[coverage] {error}")),
                                }
                            }
                            if let Err(error) = append_test_history(&artifacts.root, &report) { append_log(&self.logs, format!("[test-history] {error}")); }
                            if let Ok(mut slot) = self.test_report.lock() { *slot = Some(report); }
                        },
                        Ok(None) => {},
                        Err(error) => append_log(&self.logs, format!("[test-report] {error}")),
                    }
                    let _ = fs::remove_file(&artifacts.report_path);
                    if let Some(path) = artifacts.coverage_path { cleanup_coverage_artifact(&path); }
                }
            }
        }
        Ok(status_from_meta(&meta))
    }
}

fn status_from_meta(meta: &TaskMeta) -> TaskStatus {
    TaskStatus {
        running: meta.running,
        task_id: meta.task_id.clone(),
        name: meta.name.clone(),
        category: meta.category.clone(),
        command: meta.command.clone(),
        package_manager: meta.package_manager.clone(),
        exit_code: meta.exit_code,
        test_path: meta.test_path.clone(),
        test_name: meta.test_name.clone(),
        test_framework: meta.test_framework.clone(),
        coverage: meta.coverage,
    }
}

fn append_log(logs: &Arc<Mutex<TaskLogBuffer>>, line: String) {
    if let Ok(mut guard) = logs.lock() { guard.push(line); }
}

fn test_report_path(framework: &str) -> std::path::PathBuf {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_nanos()).unwrap_or(0);
    env::temp_dir().join(format!("webforge-test-{framework}-{}-{stamp}.json", std::process::id()))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis() as u64).unwrap_or(0)
}

fn coverage_report_path(framework: &str) -> std::path::PathBuf {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_nanos()).unwrap_or(0);
    env::temp_dir().join(format!("webforge-coverage-{framework}-{}-{stamp}", std::process::id())).join("coverage-summary.json")
}

fn cleanup_coverage_artifact(path: &std::path::Path) {
    let _ = fs::remove_file(path);
    if let Some(parent) = path.parent() {
        let owned = parent.file_name().and_then(|value| value.to_str()).is_some_and(|value| value.starts_with("webforge-coverage-"));
        if owned && parent.parent() == Some(env::temp_dir().as_path()) { let _ = fs::remove_dir_all(parent); }
    }
}

fn coverage_metric(value: &Value) -> CoverageMetric {
    CoverageMetric {
        total: value.get("total").and_then(Value::as_u64).unwrap_or(0),
        covered: value.get("covered").and_then(Value::as_u64).unwrap_or(0),
        skipped: value.get("skipped").and_then(Value::as_u64).unwrap_or(0),
        percent: value.get("pct").and_then(Value::as_f64).unwrap_or(0.0),
    }
}

fn parse_coverage_summary(path: &std::path::Path) -> Result<Option<CoverageSummary>, String> {
    if !path.is_file() { return Ok(None); }
    let metadata = fs::metadata(path).map_err(|error| format!("unable to inspect coverage report: {error}"))?;
    if metadata.len() > MAX_TEST_REPORT_BYTES { return Err("coverage report exceeds 8 MiB limit".into()); }
    let raw = fs::read_to_string(path).map_err(|error| format!("unable to read coverage report: {error}"))?;
    let value: Value = serde_json::from_str(&raw).map_err(|error| format!("invalid coverage report: {error}"))?;
    let total = value.get("total").unwrap_or(&value);
    Ok(Some(CoverageSummary {
        lines: coverage_metric(total.get("lines").unwrap_or(&Value::Null)),
        statements: coverage_metric(total.get("statements").unwrap_or(&Value::Null)),
        functions: coverage_metric(total.get("functions").unwrap_or(&Value::Null)),
        branches: coverage_metric(total.get("branches").unwrap_or(&Value::Null)),
    }))
}

fn history_path(root: &std::path::Path) -> std::path::PathBuf { root.join(".webforge").join("test-history.json") }

fn load_test_history(root: &std::path::Path) -> Result<Vec<TestHistoryEntry>, String> {
    let path = history_path(root);
    if !path.is_file() { return Ok(Vec::new()); }
    let metadata = fs::metadata(&path).map_err(|error| format!("unable to inspect test history: {error}"))?;
    if metadata.len() > MAX_TEST_HISTORY_BYTES { return Err("test history exceeds 512 KiB limit".into()); }
    let raw = fs::read_to_string(path).map_err(|error| format!("unable to read test history: {error}"))?;
    let mut entries: Vec<TestHistoryEntry> = serde_json::from_str(&raw).map_err(|error| format!("invalid test history: {error}"))?;
    entries.truncate(MAX_TEST_HISTORY);
    Ok(entries)
}

fn append_test_history(root: &std::path::Path, report: &TestRunReport) -> Result<(), String> {
    let path = history_path(root);
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| format!("unable to create .webforge directory: {error}"))?; }
    let mut entries = load_test_history(root).unwrap_or_default();
    entries.insert(0, TestHistoryEntry {
        framework: report.framework.clone(), finished_at_ms: report.finished_at_ms, path: report.path.clone(), requested_test: report.requested_test.clone(), success: report.success,
        duration_ms: report.duration_ms, total: report.total, passed: report.passed, failed: report.failed, skipped: report.skipped, coverage: report.coverage.clone(),
    });
    entries.truncate(MAX_TEST_HISTORY);
    let raw = serde_json::to_string_pretty(&entries).map_err(|error| format!("unable to serialize test history: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("unable to write test history: {error}"))
}

fn normalize_report_path(root: &std::path::Path, value: &str) -> String {
    let path = std::path::PathBuf::from(value);
    if let Ok(relative) = path.strip_prefix(root) { return relative.to_string_lossy().replace('\\', "/"); }
    value.replace('\\', "/")
}

fn parse_jest_compatible_report(root: &std::path::Path, value: &Value, framework: &str, requested_path: Option<&str>, requested_test: Option<&str>) -> TestRunReport {
    let mut cases = Vec::new();
    let mut min_start = None::<u64>;
    let mut max_end = None::<u64>;
    for file in value.get("testResults").and_then(Value::as_array).into_iter().flatten() {
        let raw_path = file.get("name").and_then(Value::as_str).unwrap_or(requested_path.unwrap_or(""));
        let path = normalize_report_path(root, raw_path);
        if let Some(start) = file.get("startTime").and_then(Value::as_u64) { min_start = Some(min_start.map_or(start, |current| current.min(start))); }
        if let Some(end) = file.get("endTime").and_then(Value::as_u64) { max_end = Some(max_end.map_or(end, |current| current.max(end))); }
        for assertion in file.get("assertionResults").and_then(Value::as_array).into_iter().flatten() {
            if cases.len() >= MAX_TEST_REPORT_CASES { break; }
            let title = assertion.get("title").and_then(Value::as_str).unwrap_or("test").to_string();
            let full_name = assertion.get("fullName").and_then(Value::as_str).unwrap_or(&title).trim().to_string();
            let suite_parts = assertion.get("ancestorTitles").and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).filter(|item| !item.is_empty()).collect::<Vec<_>>()).unwrap_or_default();
            let status = assertion.get("status").and_then(Value::as_str).unwrap_or("unknown").to_string();
            let failures = assertion.get("failureMessages").and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>()).unwrap_or_default();
            let failure_message = failures.first().map(|value| value.lines().next().unwrap_or(value).to_string());
            let stack = if failures.is_empty() { None } else { Some(failures.join("\n\n")) };
            let location = assertion.get("location");
            cases.push(TestCaseResult {
                id: format!("{}:{}:{}", path, full_name, cases.len()),
                path: path.clone(),
                title,
                full_name,
                suite: if suite_parts.is_empty() { None } else { Some(suite_parts.join(" › ")) },
                status,
                duration_ms: assertion.get("duration").and_then(Value::as_u64),
                failure_message,
                stack,
                line: location.and_then(|item| item.get("line")).and_then(Value::as_u64).map(|value| value as u32),
                column: location.and_then(|item| item.get("column")).and_then(Value::as_u64).map(|value| value as u32 + if framework == "jest" { 1 } else { 0 }),
            });
        }
    }
    let passed = cases.iter().filter(|item| item.status == "passed").count();
    let failed = cases.iter().filter(|item| item.status == "failed").count();
    let skipped = cases.iter().filter(|item| matches!(item.status.as_str(), "pending" | "skipped" | "todo" | "disabled")).count();
    let duration_ms = min_start.zip(max_end).map(|(start, end)| end.saturating_sub(start));
    TestRunReport {
        framework: framework.to_string(),
        path: requested_path.map(str::to_string),
        requested_test: requested_test.map(str::to_string),
        success: value.get("success").and_then(Value::as_bool).unwrap_or(failed == 0),
        duration_ms,
        total: cases.len(), passed, failed, skipped, cases,
        coverage: None,
        finished_at_ms: now_ms(),
    }
}

fn collect_playwright_suite(root: &std::path::Path, suite: &Value, parents: &[String], cases: &mut Vec<TestCaseResult>) {
    if cases.len() >= MAX_TEST_REPORT_CASES { return; }
    let mut next_parents = parents.to_vec();
    if let Some(title) = suite.get("title").and_then(Value::as_str).filter(|value| !value.is_empty()) { next_parents.push(title.to_string()); }
    for spec in suite.get("specs").and_then(Value::as_array).into_iter().flatten() {
        if cases.len() >= MAX_TEST_REPORT_CASES { break; }
        let title = spec.get("title").and_then(Value::as_str).unwrap_or("test").to_string();
        let raw_path = spec.get("file").and_then(Value::as_str).or_else(|| suite.get("file").and_then(Value::as_str)).unwrap_or("");
        let path = normalize_report_path(root, raw_path);
        let line = spec.get("line").and_then(Value::as_u64).map(|value| value as u32);
        let column = spec.get("column").and_then(Value::as_u64).map(|value| value as u32);
        for test in spec.get("tests").and_then(Value::as_array).into_iter().flatten() {
            if cases.len() >= MAX_TEST_REPORT_CASES { break; }
            let results = test.get("results").and_then(Value::as_array).cloned().unwrap_or_default();
            let last = results.last();
            let status = last.and_then(|item| item.get("status")).and_then(Value::as_str).or_else(|| test.get("status").and_then(Value::as_str)).unwrap_or("unknown").to_string();
            let duration_ms = results.iter().filter_map(|item| item.get("duration").and_then(Value::as_u64)).sum::<u64>();
            let errors = last.and_then(|item| item.get("errors")).and_then(Value::as_array).cloned().unwrap_or_default();
            let first_error = last.and_then(|item| item.get("error")).cloned().or_else(|| errors.first().cloned());
            let failure_message = first_error.as_ref().and_then(|item| item.get("message")).and_then(Value::as_str).map(str::to_string);
            let stack = first_error.as_ref().and_then(|item| item.get("stack")).and_then(Value::as_str).map(str::to_string);
            let suite_name = if next_parents.is_empty() { None } else { Some(next_parents.join(" › ")) };
            let full_name = [suite_name.clone().unwrap_or_default(), title.clone()].into_iter().filter(|item| !item.is_empty()).collect::<Vec<_>>().join(" › ");
            cases.push(TestCaseResult {
                id: format!("{}:{}:{}", path, full_name, cases.len()), path: path.clone(), title: title.clone(), full_name, suite: suite_name, status,
                duration_ms: if duration_ms == 0 { None } else { Some(duration_ms) }, failure_message, stack, line, column,
            });
        }
    }
    for child in suite.get("suites").and_then(Value::as_array).into_iter().flatten() { collect_playwright_suite(root, child, &next_parents, cases); }
}

fn parse_playwright_report(root: &std::path::Path, value: &Value, requested_path: Option<&str>, requested_test: Option<&str>) -> TestRunReport {
    let mut cases = Vec::new();
    for suite in value.get("suites").and_then(Value::as_array).into_iter().flatten() { collect_playwright_suite(root, suite, &[], &mut cases); }
    let passed = cases.iter().filter(|item| matches!(item.status.as_str(), "passed" | "expected")).count();
    let failed = cases.iter().filter(|item| matches!(item.status.as_str(), "failed" | "timedOut" | "unexpected" | "interrupted")).count();
    let skipped = cases.iter().filter(|item| matches!(item.status.as_str(), "skipped" | "disabled")).count();
    let duration_ms = value.get("stats").and_then(|stats| stats.get("duration")).and_then(Value::as_u64);
    TestRunReport { framework: "playwright".into(), path: requested_path.map(str::to_string), requested_test: requested_test.map(str::to_string), success: failed == 0, duration_ms, total: cases.len(), passed, failed, skipped, cases, coverage: None, finished_at_ms: now_ms() }
}

fn parse_test_report(root: &std::path::Path, framework: &str, path: &std::path::Path, requested_path: Option<&str>, requested_test: Option<&str>) -> Result<Option<TestRunReport>, String> {
    if !path.is_file() { return Ok(None); }
    let metadata = fs::metadata(path).map_err(|error| format!("unable to inspect structured test report: {error}"))?;
    if metadata.len() > MAX_TEST_REPORT_BYTES { return Err("structured test report exceeds 8 MiB limit".into()); }
    let raw = fs::read_to_string(path).map_err(|error| format!("unable to read structured test report: {error}"))?;
    let value: Value = serde_json::from_str(&raw).map_err(|error| format!("invalid structured test report: {error}"))?;
    let report = if framework == "playwright" { parse_playwright_report(root, &value, requested_path, requested_test) } else { parse_jest_compatible_report(root, &value, framework, requested_path, requested_test) };
    Ok(Some(report))
}

fn inferred_test_framework(script: &str) -> Option<&'static str> {
    let lower = script.to_ascii_lowercase();
    if lower.contains("playwright test") { Some("playwright") }
    else if lower.contains("vitest") { Some("vitest") }
    else if lower.contains("jest") { Some("jest") }
    else { None }
}

fn category_for(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower == "test" || lower.starts_with("test:") || lower.contains("vitest") || lower.contains("jest") { "test" }
    else if lower == "lint" || lower.starts_with("lint:") { "lint" }
    else if lower == "typecheck" || lower == "type-check" || lower == "check" || lower.starts_with("typecheck:") { "typecheck" }
    else if lower == "build" || lower.starts_with("build:") { "build" }
    else if lower == "format" || lower.starts_with("format:") { "format" }
    else { "other" }
}

fn task_category(name: &str, script: &str) -> &'static str {
    let category = category_for(name);
    if category != "other" { return category; }
    let lower = script.to_ascii_lowercase();
    if lower.contains("vitest") || lower.contains("jest") || lower.contains("playwright test") { "test" } else { "other" }
}

fn package_scripts(root: &std::path::Path) -> Result<Vec<(String, String)>, String> {
    let raw = fs::read_to_string(root.join("package.json")).map_err(|error| format!("unable to read package.json: {error}"))?;
    let package: Value = serde_json::from_str(&raw).map_err(|error| format!("invalid package.json: {error}"))?;
    let mut scripts: Vec<_> = package.get("scripts")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(name, value)| value.as_str().map(|script| (name.clone(), script.to_string())))
        .take(MAX_TASKS)
        .collect();
    scripts.sort_by(|a, b| task_category(&a.0, &a.1).cmp(task_category(&b.0, &b.1)).then_with(|| a.0.cmp(&b.0)));
    Ok(scripts)
}

#[tauri::command]
pub fn list_project_tasks(
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceState>,
) -> Result<Vec<ProjectTask>, String> {
    let root = workspace_root(&workspace)?;
    if !root.join("package.json").is_file() { return Ok(Vec::new()); }
    let project = detect_project_at(&root)?;
    let env = environment(&app);
    let manager = choose_manager(&project, &env).unwrap_or_else(|_| project.preferred_package_manager.clone().unwrap_or_else(|| "npm".into()));
    Ok(package_scripts(&root)?.into_iter().map(|(name, script)| {
        let category = task_category(&name, &script).to_string();
        ProjectTask { id: name.clone(), name: name.clone(), script, category, package_manager: manager.clone() }
    }).collect())
}

fn validate_test_path(root: &std::path::Path, path: String) -> Result<String, String> {
    let clean = clean_relative_path(&path)?;
    let normalized = clean.to_string_lossy().replace('\\', "/");
    let lower = normalized.to_ascii_lowercase();
    if !(lower.contains(".test.") || lower.contains(".spec.") || lower.starts_with("tests/") || lower.contains("/tests/") || lower.starts_with("__tests__/") || lower.contains("/__tests__/")) {
        return Err("selected path is not recognized as a test file".to_string());
    }
    if !root.join(&clean).is_file() { return Err("selected test file does not exist".to_string()); }
    Ok(normalized)
}

fn failed_status(status: &str) -> bool {
    matches!(status, "failed" | "timedOut" | "unexpected" | "interrupted")
}

fn launch_project_task(
    task_id: String,
    relative_path: Option<String>,
    test_name: Option<String>,
    test_framework: Option<String>,
    coverage: bool,
    failed_cases: Option<Vec<TestCaseResult>>,
    app: &tauri::AppHandle,
    workspace: &State<'_, WorkspaceState>,
    security: &State<'_, WorkspaceSecurityState>,
    state: &State<'_, TaskState>,
) -> Result<TaskStatus, String> {
    require_terminal_allowed(security)?;
    let root = workspace_root(workspace)?;
    let scripts = package_scripts(&root)?;
    let script = scripts.into_iter().find(|(name, _)| name == &task_id).ok_or_else(|| "package script no longer exists".to_string())?;
    let category = task_category(&script.0, &script.1);
    if (relative_path.is_some() || test_name.is_some() || failed_cases.is_some() || coverage) && category != "test" {
        return Err("scoped/coverage execution is only available for test tasks".into());
    }
    let relative_path = relative_path.map(|path| validate_test_path(&root, path)).transpose()?;
    let test_name = test_name.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
    if test_name.as_ref().is_some_and(|value| value.len() > 1000) { return Err("test name is too long".into()); }
    let test_framework = test_framework.map(|value| value.to_ascii_lowercase());
    if let Some(framework) = test_framework.as_deref() {
        if !matches!(framework, "vitest" | "jest" | "playwright") { return Err("unsupported test framework selector".into()); }
    }
    if test_name.is_some() && relative_path.is_none() { return Err("test-case execution requires a test file path".into()); }

    let report_framework = test_framework.as_deref().or_else(|| inferred_test_framework(&script.1));
    if coverage && !matches!(report_framework, Some("vitest" | "jest")) {
        return Err("coverage is currently available for Vitest and Jest tasks".into());
    }
    state.stop()?;
    if let Ok(mut report) = state.test_report.lock() { *report = None; }
    if let Ok(mut report_path) = state.report_path.lock() { *report_path = None; }

    let project = detect_project_at(&root)?;
    let env = environment(app);
    let manager = choose_manager(&project, &env)?;
    let resolution = resolve_tool(app, &manager);
    let mut command = Command::new(&resolution.executable);
    command.current_dir(&root).args(["run", &task_id]);

    let report_path = if category == "test" { report_framework.map(test_report_path) } else { None };
    let coverage_path = if coverage {
        let path = coverage_report_path(report_framework.unwrap_or("test"));
        if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|error| format!("unable to prepare coverage directory: {error}"))?; }
        Some(path)
    } else { None };

    let mut paths = Vec::<String>::new();
    let mut names = Vec::<String>::new();
    if let Some(path) = &relative_path { paths.push(path.clone()); }
    if let Some(name) = &test_name { names.push(name.clone()); }
    if let Some(items) = failed_cases.as_ref() {
        for item in items.iter().take(MAX_FAILED_RERUN_CASES) {
            if !item.path.is_empty() {
                let path = validate_test_path(&root, item.path.clone())?;
                if !paths.contains(&path) { paths.push(path); }
            }
            let name = if item.full_name.is_empty() { &item.title } else { &item.full_name };
            if !name.is_empty() && !names.contains(name) { names.push(name.clone()); }
        }
    }
    let selector = if names.is_empty() { None } else { Some(names.iter().map(|name| regex::escape(name)).collect::<Vec<_>>().join("|")) };

    if let (Some(framework), Some(report)) = (report_framework, report_path.as_ref()) {
        command.arg("--");
        match framework {
            "jest" => {
                if !paths.is_empty() { command.arg("--runTestsByPath"); for path in &paths { command.arg(path); } }
                command.arg("--json").arg("--testLocationInResults").arg(format!("--outputFile={}", report.to_string_lossy()));
                if let Some(selector) = &selector { command.arg("--testNamePattern").arg(selector); }
                if coverage {
                    command.arg("--coverage").arg("--coverageReporters=json-summary");
                    if let Some(parent) = coverage_path.as_ref().and_then(|path| path.parent()) { command.arg(format!("--coverageDirectory={}", parent.to_string_lossy())); }
                }
            },
            "playwright" => {
                for path in &paths { command.arg(path); }
                command.arg("--reporter=json").env("PLAYWRIGHT_JSON_OUTPUT_FILE", report);
                if let Some(selector) = &selector { command.arg("-g").arg(selector); }
            },
            _ => {
                command.arg("--run");
                for path in &paths { command.arg(path); }
                command.arg("--reporter=json").arg(format!("--outputFile={}", report.to_string_lossy()));
                if let Some(selector) = &selector { command.arg("-t").arg(selector); }
                if coverage {
                    command.arg("--coverage").arg("--coverage.reporter=json-summary");
                    if let Some(parent) = coverage_path.as_ref().and_then(|path| path.parent()) { command.arg(format!("--coverage.reportsDirectory={}", parent.to_string_lossy())); }
                }
            }
        }
    }

    command.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    configure_process_group(&mut command);
    let mut child = command.spawn().map_err(|error| format!("unable to start task: {error}"))?;
    let pid = child.id();

    if let Ok(mut logs) = state.logs.lock() {
        logs.clear();
        logs.push(format!("[task] {} run {}{}{}{}", manager, task_id, relative_path.as_ref().map(|path| format!(" -- {path}")).unwrap_or_default(), test_name.as_ref().map(|name| format!(" [{}: {}]", report_framework.unwrap_or("test"), name)).unwrap_or_default(), if coverage { " [coverage]" } else { "" }));
        logs.push(format!("[task] script: {}", script.1));
    }
    if let Some(stdout) = child.stdout.take() {
        let logs = Arc::clone(&state.logs);
        thread::spawn(move || { for line in BufReader::new(stdout).lines().map_while(|line| line.ok()) { append_log(&logs, line); } });
    }
    if let Some(stderr) = child.stderr.take() {
        let logs = Arc::clone(&state.logs);
        thread::spawn(move || { for line in BufReader::new(stderr).lines().map_while(|line| line.ok()) { append_log(&logs, line); } });
    }

    *state.child.lock().map_err(|_| "task child lock is poisoned".to_string())? = Some(child);
    let mut meta = state.meta.lock().map_err(|_| "task metadata lock is poisoned".to_string())?;
    meta.running = true;
    meta.task_id = Some(task_id.clone());
    meta.name = Some(match (&relative_path, &test_name) {
        (Some(path), Some(name)) => format!("{task_id} · {path} · {name}"),
        (Some(path), None) => format!("{task_id} · {path}"),
        _ if failed_cases.is_some() => format!("{task_id} · failed tests"),
        _ if coverage => format!("{task_id} · coverage"),
        _ => task_id.clone(),
    });
    meta.category = Some(category.to_string());
    meta.command = Some(format!("{} run {}", manager, script.0));
    meta.package_manager = Some(manager);
    meta.exit_code = None;
    meta.test_path = relative_path.clone();
    meta.test_name = test_name.clone();
    meta.test_framework = report_framework.map(str::to_string).or(test_framework.clone());
    meta.coverage = coverage;
    if let (Some(framework), Some(path)) = (report_framework, report_path) {
        if let Ok(mut slot) = state.report_path.lock() { *slot = Some(TestRunArtifacts { root: root.clone(), framework: framework.to_string(), report_path: path, coverage_path }); }
    }
    append_log(&state.logs, format!("[task] started process {pid}"));
    Ok(status_from_meta(&meta))
}

#[tauri::command]
pub fn start_project_task(
    task_id: String,
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, TaskState>,
) -> Result<TaskStatus, String> {
    launch_project_task(task_id, None, None, None, false, None, &app, &workspace, &security, &state)
}

#[tauri::command]
pub fn start_project_test_file(
    task_id: String,
    relative_path: String,
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, TaskState>,
) -> Result<TaskStatus, String> {
    launch_project_task(task_id, Some(relative_path), None, None, false, None, &app, &workspace, &security, &state)
}

#[tauri::command]
pub fn start_project_test_case(
    task_id: String,
    relative_path: String,
    test_name: String,
    framework: String,
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, TaskState>,
) -> Result<TaskStatus, String> {
    launch_project_task(task_id, Some(relative_path), Some(test_name), Some(framework), false, None, &app, &workspace, &security, &state)
}

#[tauri::command]
pub fn start_project_test_coverage(
    task_id: String,
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, TaskState>,
) -> Result<TaskStatus, String> {
    launch_project_task(task_id, None, None, None, true, None, &app, &workspace, &security, &state)
}

#[tauri::command]
pub fn rerun_failed_project_tests(
    task_id: String,
    app: tauri::AppHandle,
    workspace: State<'_, WorkspaceState>,
    security: State<'_, WorkspaceSecurityState>,
    state: State<'_, TaskState>,
) -> Result<TaskStatus, String> {
    let report = state.test_report.lock().map_err(|_| "test report lock is poisoned".to_string())?.clone().ok_or_else(|| "there is no structured test report to rerun".to_string())?;
    let failed = report.cases.iter().filter(|item| failed_status(&item.status)).take(MAX_FAILED_RERUN_CASES).cloned().collect::<Vec<_>>();
    if failed.is_empty() { return Err("the latest test report has no failed tests".into()); }
    launch_project_task(task_id, None, None, Some(report.framework), false, Some(failed), &app, &workspace, &security, &state)
}

#[tauri::command]
pub fn get_project_test_history(workspace: State<'_, WorkspaceState>) -> Result<Vec<TestHistoryEntry>, String> {
    let root = workspace_root(&workspace)?;
    load_test_history(&root)
}

#[tauri::command]
pub fn clear_project_test_history(workspace: State<'_, WorkspaceState>) -> Result<(), String> {
    let root = workspace_root(&workspace)?;
    let path = history_path(&root);
    if path.is_file() { fs::remove_file(path).map_err(|error| format!("unable to clear test history: {error}"))?; }
    Ok(())
}

#[tauri::command]
pub fn stop_project_task(state: State<'_, TaskState>) -> Result<TaskStatus, String> {
    state.stop()?;
    state.refresh_status()
}

#[tauri::command]
pub fn get_project_task_status(state: State<'_, TaskState>) -> Result<TaskStatus, String> {
    state.refresh_status()
}

#[tauri::command]
pub fn poll_project_task_logs(cursor: usize, state: State<'_, TaskState>) -> Result<TaskLogBatch, String> {
    let status = state.refresh_status()?;
    let logs = state.logs.lock().map_err(|_| "task log lock is poisoned".to_string())?;
    let start = cursor.max(logs.base_cursor).saturating_sub(logs.base_cursor).min(logs.lines.len());
    Ok(TaskLogBatch {
        cursor: logs.current_cursor(),
        lines: logs.lines.iter().skip(start).cloned().collect(),
        status,
    })
}

#[tauri::command]
pub fn get_project_test_report(state: State<'_, TaskState>) -> Result<Option<TestRunReport>, String> {
    state.refresh_status()?;
    state.test_report.lock().map_err(|_| "test report lock is poisoned".to_string()).map(|value| value.clone())
}


#[cfg(test)]
mod tests {
    use super::{category_for, inferred_test_framework, task_category};

    #[test]
    fn classifies_common_scripts() {
        assert_eq!(category_for("test"), "test");
        assert_eq!(category_for("test:unit"), "test");
        assert_eq!(category_for("lint"), "lint");
        assert_eq!(category_for("typecheck"), "typecheck");
        assert_eq!(category_for("build:docs"), "build");
        assert_eq!(category_for("preview"), "other");
        assert_eq!(task_category("e2e", "playwright test"), "test");
        assert_eq!(task_category("verify", "vitest run"), "test");
        assert_eq!(inferred_test_framework("vitest run"), Some("vitest"));
        assert_eq!(inferred_test_framework("playwright test"), Some("playwright"));
    }
}
