use serde::Serialize;
use std::{fs, path::PathBuf, process::{Command, Output}};
use tauri::State;

use crate::{
    security::{require_git_network_allowed, require_terminal_allowed, require_trusted, WorkspaceSecurityState},
    workspace::{clean_relative_path, workspace_root, WorkspaceState},
};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    path: String,
    index_status: String,
    worktree_status: String,
    staged: bool,
    untracked: bool,
    conflicted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    available: bool,
    repository: bool,
    repo_root: Option<String>,
    workspace_root_repository: bool,
    branch: Option<String>,
    ahead: usize,
    behind: usize,
    changes: Vec<GitChange>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    name: String,
    current: bool,
    upstream: Option<String>,
    commit: String,
    subject: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    hash: String,
    short_hash: String,
    author: String,
    email: String,
    date: String,
    subject: String,
    decorations: String,
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

fn git_output(root: &PathBuf, args: &[&str]) -> Result<Output, String> {
    let hooks = std::env::temp_dir().join("webforge-disabled-git-hooks");
    fs::create_dir_all(&hooks).map_err(|error| error.to_string())?;
    let hooks_config = format!("core.hooksPath={}", hooks.to_string_lossy());
    let mut command = Command::new("git");
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .current_dir(root)
        .args(["-c", hooks_config.as_str(), "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", "-c", "merge.gpgSign=false", "-c", "core.quotepath=false", "-c", "submodule.recurse=false", "--no-pager", "--no-optional-locks", "--literal-pathspecs"])
        .args(args);
    hide_console(&mut command);
    command.output().map_err(|error| format!("unable to start git: {error}"))
}

fn output_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn output_error(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() { output_text(output) } else { stderr }
}

fn git_ok(root: &PathBuf, args: &[&str]) -> Result<String, String> {
    let output = git_output(root, args)?;
    if output.status.success() { Ok(output_text(&output)) } else { Err(output_error(&output)) }
}

fn git_ok_verbose(root: &PathBuf, args: &[&str]) -> Result<String, String> {
    let output = git_output(root, args)?;
    if !output.status.success() { return Err(output_error(&output)); }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok([stdout, stderr].into_iter().filter(|value| !value.is_empty()).collect::<Vec<_>>().join("\n"))
}

fn normalized_git_path(value: &str) -> Result<String, String> {
    let path = clean_relative_path(value)?;
    if path.as_os_str().is_empty() { return Err("git file path cannot be the workspace root".into()); }
    Ok(path.to_string_lossy().replace('\\', "/"))
}

fn parse_branch(line: &str) -> (Option<String>, usize, usize) {
    let value = line.strip_prefix("## ").unwrap_or(line);
    let branch = if let Some(name) = value.strip_prefix("No commits yet on ") {
        Some(name.split(' ').next().unwrap_or(name).to_string())
    } else {
        let name = value.split("...").next().unwrap_or(value).split(' ').next().unwrap_or(value).trim();
        if name == "HEAD" { None } else { Some(name.to_string()) }
    };
    let ahead = value.split("ahead ").nth(1).and_then(|rest| rest.split(|c: char| !c.is_ascii_digit()).next()).and_then(|n| n.parse().ok()).unwrap_or(0);
    let behind = value.split("behind ").nth(1).and_then(|rest| rest.split(|c: char| !c.is_ascii_digit()).next()).and_then(|n| n.parse().ok()).unwrap_or(0);
    (branch, ahead, behind)
}

fn is_conflicted(x: char, y: char) -> bool {
    matches!((x, y), ('D','D') | ('A','U') | ('U','D') | ('U','A') | ('D','U') | ('A','A') | ('U','U'))
}

#[tauri::command]
pub fn get_git_status(state: State<'_, WorkspaceState>) -> Result<GitStatus, String> {
    let root = workspace_root(&state)?;
    let version = git_output(&root, &["--version"]);
    if version.is_err() {
        return Ok(GitStatus { available: false, repository: false, repo_root: None, workspace_root_repository: false, branch: None, ahead: 0, behind: 0, changes: vec![], error: Some("Git executable was not found in PATH".into()) });
    }

    let repo_root = match git_ok(&root, &["rev-parse", "--show-toplevel"]) {
        Ok(value) => value,
        Err(error) => return Ok(GitStatus { available: true, repository: false, repo_root: None, workspace_root_repository: false, branch: None, ahead: 0, behind: 0, changes: vec![], error: Some(error) }),
    };

    let workspace_root_repository = fs::canonicalize(&repo_root).map(|path| path == root).unwrap_or(false);
    let status = git_ok(&root, &["status", "--porcelain=v1", "--branch", "--untracked-files=all", "--", "."])?;
    let mut branch = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut changes = Vec::new();
    for (index, line) in status.lines().enumerate() {
        if index == 0 && line.starts_with("## ") {
            (branch, ahead, behind) = parse_branch(line);
            continue;
        }
        let chars: Vec<char> = line.chars().collect();
        if chars.len() < 3 { continue; }
        let x = chars[0];
        let y = chars[1];
        let raw_path = line.get(3..).unwrap_or("").trim();
        let path = raw_path.rsplit(" -> ").next().unwrap_or(raw_path).trim_matches('"').replace('\\', "/");
        changes.push(GitChange {
            path,
            index_status: x.to_string(),
            worktree_status: y.to_string(),
            staged: x != ' ' && x != '?',
            untracked: x == '?' && y == '?',
            conflicted: is_conflicted(x, y),
        });
    }
    Ok(GitStatus { available: true, repository: true, repo_root: Some(repo_root), workspace_root_repository, branch, ahead, behind, changes, error: None })
}

fn require_workspace_repository(root: &PathBuf) -> Result<(), String> {
    let repo_root = git_ok(root, &["rev-parse", "--show-toplevel"])?;
    let canonical_repo = fs::canonicalize(&repo_root).map_err(|error| error.to_string())?;
    if canonical_repo != *root {
        return Err("Git write operations are disabled when the selected workspace is only a subdirectory of a larger repository".into());
    }
    Ok(())
}

#[tauri::command]
pub fn get_git_diff(relative_path: String, staged: bool, state: State<'_, WorkspaceState>) -> Result<String, String> {
    let root = workspace_root(&state)?;
    let path = normalized_git_path(&relative_path)?;
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv", "--unified=3"];
    if staged { args.push("--cached"); }
    args.push("--");
    args.push(&path);
    git_ok(&root, &args)
}

#[tauri::command]
pub fn git_stage(relative_path: String, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<(), String> {
    // `git add` may execute repository-defined clean/process filters from .gitattributes.
    // Treat it as arbitrary-command authority and require the explicit session-only Terminal Access grant.
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    let path = normalized_git_path(&relative_path)?;
    git_ok(&root, &["add", "--", &path]).map(|_| ())
}

#[tauri::command]
pub fn git_unstage(relative_path: String, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<(), String> {
    require_trusted(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    let path = normalized_git_path(&relative_path)?;
    if git_ok(&root, &["restore", "--staged", "--", &path]).is_ok() { return Ok(()); }
    if git_ok(&root, &["reset", "HEAD", "--", &path]).is_ok() { return Ok(()); }
    git_ok(&root, &["rm", "--cached", "--", &path]).map(|_| ())
}

#[tauri::command]
pub fn git_commit(message: String, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_trusted(&security)?;
    let message = message.trim();
    if message.is_empty() { return Err("commit message cannot be empty".into()); }
    if message.len() > 10_000 { return Err("commit message is too long".into()); }
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    git_ok(&root, &["commit", "--no-verify", "-m", message])
}

#[tauri::command]
pub fn git_init(state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_trusted(&security)?;
    let root = workspace_root(&state)?;
    git_ok(&root, &["init"])
}

fn require_clean_worktree(root: &PathBuf) -> Result<(), String> {
    let status = git_ok(root, &["status", "--porcelain=v1", "--untracked-files=all"])?;
    if status.trim().is_empty() { Ok(()) } else { Err("Git branch switching requires a clean working tree".into()) }
}

fn validate_branch_name(root: &PathBuf, name: &str) -> Result<String, String> {
    let value = name.trim();
    if value.is_empty() || value.len() > 240 { return Err("invalid branch name".into()); }
    git_ok(root, &["check-ref-format", "--branch", value])?;
    Ok(value.to_string())
}

#[tauri::command]
pub fn list_git_branches(state: State<'_, WorkspaceState>) -> Result<Vec<GitBranch>, String> {
    let root = workspace_root(&state)?;
    let output = git_ok(&root, &["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(objectname:short)%09%(subject)", "refs/heads"])?;
    let mut branches = Vec::new();
    for line in output.lines() {
        let mut fields = line.splitn(5, '\t');
        let Some(name) = fields.next() else { continue; };
        if name.is_empty() { continue; }
        let head = fields.next().unwrap_or("");
        let upstream = fields.next().unwrap_or("");
        let commit = fields.next().unwrap_or("");
        let subject = fields.next().unwrap_or("");
        branches.push(GitBranch {
            name: name.to_string(),
            current: head.trim() == "*",
            upstream: if upstream.is_empty() { None } else { Some(upstream.to_string()) },
            commit: commit.to_string(),
            subject: subject.to_string(),
        });
    }
    Ok(branches)
}

#[tauri::command]
pub fn get_git_history(limit: Option<usize>, state: State<'_, WorkspaceState>) -> Result<Vec<GitCommit>, String> {
    let root = workspace_root(&state)?;
    if git_ok(&root, &["rev-parse", "--verify", "HEAD"]).is_err() { return Ok(Vec::new()); }
    let count = limit.unwrap_or(40).clamp(1, 200).to_string();
    let output = git_ok(&root, &["log", "-n", &count, "--date=iso-strict", "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e"])?;
    let mut commits = Vec::new();
    for record in output.split('\x1e') {
        let record = record.trim_matches(|c| c == '\r' || c == '\n');
        if record.is_empty() { continue; }
        let fields = record.split('\x1f').collect::<Vec<_>>();
        if fields.len() < 7 { continue; }
        commits.push(GitCommit {
            hash: fields[0].to_string(),
            short_hash: fields[1].to_string(),
            author: fields[2].to_string(),
            email: fields[3].to_string(),
            date: fields[4].to_string(),
            subject: fields[5].to_string(),
            decorations: fields[6].trim().to_string(),
        });
    }
    Ok(commits)
}

#[tauri::command]
pub fn git_switch_branch(name: String, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    // Checkout/switch may execute smudge/process filters; require explicit Terminal Access.
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    require_clean_worktree(&root)?;
    let branch = validate_branch_name(&root, &name)?;
    match git_ok(&root, &["switch", &branch]) {
        Ok(output) => Ok(output),
        Err(_) => git_ok(&root, &["checkout", &branch]),
    }
}

#[tauri::command]
pub fn git_create_branch(name: String, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    // Creating and switching to a branch populates the worktree and may execute filters.
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    require_clean_worktree(&root)?;
    let branch = validate_branch_name(&root, &name)?;
    match git_ok(&root, &["switch", "-c", &branch]) {
        Ok(output) => Ok(output),
        Err(_) => git_ok(&root, &["checkout", "-b", &branch]),
    }
}

#[tauri::command]
pub fn git_merge_branch(name: String, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    // Merge can execute repository-defined merge drivers / filters while updating the worktree.
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    require_clean_worktree(&root)?;
    let branch = validate_branch_name(&root, &name)?;
    git_ok(&root, &["merge", "--no-edit", &branch])
}

#[tauri::command]
pub fn git_merge_continue(state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    git_ok_verbose(&root, &["merge", "--continue"])
}

#[tauri::command]
pub fn git_merge_abort(state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    git_ok_verbose(&root, &["merge", "--abort"])
}

#[cfg(test)]
mod tests {
    use super::{is_conflicted, parse_branch};

    #[test]
    fn parses_branch_tracking() {
        let (branch, ahead, behind) = parse_branch("## main...origin/main [ahead 2, behind 1]");
        assert_eq!(branch.as_deref(), Some("main"));
        assert_eq!(ahead, 2);
        assert_eq!(behind, 1);
    }

    #[test]
    fn recognizes_conflicts() {
        assert!(is_conflicted('U', 'U'));
        assert!(is_conflicted('A', 'A'));
        assert!(!is_conflicted('M', ' '));
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitRemote {
    name: String,
    fetch_url: String,
    push_url: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictSnapshot {
    path: String,
    base: Option<String>,
    ours: Option<String>,
    theirs: Option<String>,
    working: Option<String>,
}

fn sanitize_remote_url(value: String) -> String {
    if let Ok(mut parsed) = url::Url::parse(&value) {
        // Remote URLs are display-only in the WebView. Remove all URL credential/query surfaces before IPC.
        let _ = parsed.set_username("");
        let _ = parsed.set_password(None);
        parsed.set_query(None);
        parsed.set_fragment(None);
        return parsed.to_string();
    }
    // Also remove the user part from SCP-style SSH remotes (`user@host:path`) before IPC.
    if !value.contains("://") {
        if let Some((_, host_path)) = value.split_once('@') {
            if host_path.contains(':') { return host_path.to_string(); }
        }
    }
    value
}

#[tauri::command]
pub fn list_git_remotes(state: State<'_, WorkspaceState>) -> Result<Vec<GitRemote>, String> {
    let root = workspace_root(&state)?;
    let names = git_ok(&root, &["remote"])?;
    let mut remotes = Vec::new();
    for name in names.lines().map(str::trim).filter(|name| !name.is_empty()).take(64) {
        let fetch_url = git_ok(&root, &["remote", "get-url", name]).unwrap_or_default();
        let push_url = git_ok(&root, &["remote", "get-url", "--push", name]).unwrap_or_else(|_| fetch_url.clone());
        remotes.push(GitRemote {
            name: name.to_string(),
            fetch_url: sanitize_remote_url(fetch_url),
            push_url: sanitize_remote_url(push_url),
        });
    }
    Ok(remotes)
}

fn read_conflict_stage(root: &PathBuf, stage: &str, path: &str) -> Option<String> {
    let spec = format!(":{stage}:{path}");
    let output = git_output(root, &["show", &spec]).ok()?;
    if !output.status.success() || output.stdout.len() > 2 * 1024 * 1024 { return None; }
    Some(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn get_git_conflict(relative_path: String, state: State<'_, WorkspaceState>) -> Result<GitConflictSnapshot, String> {
    let root = workspace_root(&state)?;
    let path = normalized_git_path(&relative_path)?;
    let status = git_ok(&root, &["status", "--porcelain=v1", "--", &path])?;
    let conflicted = status.lines().any(|line| {
        let chars: Vec<char> = line.chars().collect();
        chars.len() >= 2 && is_conflicted(chars[0], chars[1])
    });
    if !conflicted { return Err("requested path is not currently conflicted".into()); }
    Ok(GitConflictSnapshot {
        path: path.clone(),
        base: read_conflict_stage(&root, "1", &path),
        ours: read_conflict_stage(&root, "2", &path),
        theirs: read_conflict_stage(&root, "3", &path),
        working: fs::read_to_string(root.join(&path)).ok().filter(|value| value.len() <= 2 * 1024 * 1024),
    })
}


#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitNetworkResult {
    operation: String,
    remote: String,
    branch: Option<String>,
    output: String,
}

fn validate_remote(root: &PathBuf, remote: &str) -> Result<String, String> {
    let value = remote.trim();
    if value.is_empty() || value.len() > 200 || value.starts_with('-') || value.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return Err("invalid Git remote name".into());
    }
    let configured = git_ok(root, &["remote"])?;
    if !configured.lines().any(|name| name.trim() == value) { return Err("Git remote is not configured in this repository".into()); }
    Ok(value.to_string())
}

fn current_branch(root: &PathBuf) -> Result<String, String> {
    let branch = git_ok(root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if branch.trim().is_empty() || branch.trim() == "HEAD" { return Err("Git network pull requires a named current branch".into()); }
    Ok(branch.trim().to_string())
}

fn git_network_result(operation: &str, remote: &str, branch: Option<String>, output: String) -> GitNetworkResult {
    GitNetworkResult { operation: operation.into(), remote: remote.into(), branch, output }
}

#[tauri::command]
pub fn git_fetch_remote(remote: String, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<GitNetworkResult, String> {
    require_git_network_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    let remote = validate_remote(&root, &remote)?;
    let output = git_ok_verbose(&root, &["fetch", "--prune", "--no-tags", &remote])?;
    Ok(git_network_result("fetch", &remote, None, output))
}

#[tauri::command]
pub fn git_pull_remote(remote: String, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<GitNetworkResult, String> {
    require_git_network_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    require_clean_worktree(&root)?;
    let remote = validate_remote(&root, &remote)?;
    let branch = current_branch(&root)?;
    // Managed pull is intentionally fast-forward only. Diverged histories require an explicit merge/rebase workflow.
    let output = git_ok_verbose(&root, &["pull", "--ff-only", "--no-rebase", "--no-tags", &remote, &branch])?;
    Ok(git_network_result("pull", &remote, Some(branch), output))
}

#[tauri::command]
pub fn git_push_remote(remote: String, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<GitNetworkResult, String> {
    require_git_network_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    let remote = validate_remote(&root, &remote)?;
    let branch = current_branch(&root)?;
    // No force, no tags and no arbitrary refspecs are exposed through the managed UI.
    let output = git_ok_verbose(&root, &["push", &remote, "HEAD"])?;
    Ok(git_network_result("push", &remote, Some(branch), output))
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteBranch {
    name: String,
    remote: String,
    branch: String,
    commit: String,
    subject: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationState {
    merge: bool,
    rebase: bool,
    cherry_pick: bool,
}

fn validate_commitish(root: &PathBuf, value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 512 || value.starts_with('-') || value.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return Err("invalid Git revision".into());
    }
    let verify = format!("{value}^{{commit}}");
    git_ok(root, &["rev-parse", "--verify", &verify])?;
    Ok(value.to_string())
}

#[tauri::command]
pub fn list_git_remote_branches(state: State<'_, WorkspaceState>) -> Result<Vec<GitRemoteBranch>, String> {
    let root = workspace_root(&state)?;
    let output = git_ok(&root, &["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)%x09%(objectname:short)%x09%(subject)", "refs/remotes"])?;
    let mut branches = Vec::new();
    for line in output.lines().take(500) {
        let mut fields = line.splitn(3, '\t');
        let name = fields.next().unwrap_or("").trim();
        if name.is_empty() || name.ends_with("/HEAD") { continue; }
        let Some((remote, branch)) = name.split_once('/') else { continue; };
        branches.push(GitRemoteBranch {
            name: name.to_string(),
            remote: remote.to_string(),
            branch: branch.to_string(),
            commit: fields.next().unwrap_or("").to_string(),
            subject: fields.next().unwrap_or("").to_string(),
        });
    }
    Ok(branches)
}

#[tauri::command]
pub fn get_git_operation_state(state: State<'_, WorkspaceState>) -> Result<GitOperationState, String> {
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    let git_path_exists = |name: &str| -> bool {
        git_ok(&root, &["rev-parse", "--git-path", name]).ok().map(PathBuf::from).is_some_and(|path| {
            let path = if path.is_absolute() { path } else { root.join(path) };
            path.exists()
        })
    };
    Ok(GitOperationState {
        merge: git_path_exists("MERGE_HEAD"),
        rebase: git_path_exists("rebase-merge") || git_path_exists("rebase-apply"),
        cherry_pick: git_path_exists("CHERRY_PICK_HEAD"),
    })
}

#[tauri::command]
pub fn git_rebase_branch(name: String, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    require_clean_worktree(&root)?;
    let revision = validate_commitish(&root, &name)?;
    git_ok_verbose(&root, &["rebase", &revision])
}

#[tauri::command]
pub fn git_rebase_continue(state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    git_ok_verbose(&root, &["rebase", "--continue"])
}

#[tauri::command]
pub fn git_rebase_abort(state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    git_ok_verbose(&root, &["rebase", "--abort"])
}

#[tauri::command]
pub fn git_cherry_pick(commit: String, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    require_clean_worktree(&root)?;
    let commit = validate_commitish(&root, &commit)?;
    git_ok_verbose(&root, &["cherry-pick", &commit])
}

#[tauri::command]
pub fn git_cherry_pick_continue(state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    git_ok_verbose(&root, &["cherry-pick", "--continue"])
}

#[tauri::command]
pub fn git_cherry_pick_abort(state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    git_ok_verbose(&root, &["cherry-pick", "--abort"])
}

// WebForge 1.8 — advanced Git workbench
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStashEntry {
    reference: String,
    hash: String,
    date: String,
    message: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitTag {
    name: String,
    commit: String,
    date: String,
    subject: String,
    annotated: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphCommit {
    hash: String,
    short_hash: String,
    parents: Vec<String>,
    author: String,
    email: String,
    date: String,
    subject: String,
    decorations: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameLine {
    line_number: usize,
    commit: String,
    short_commit: String,
    author: String,
    email: String,
    author_time: i64,
    summary: String,
    content: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitCredentialState {
    credential_helper_configured: bool,
    credential_helper_kind: String,
    ssh_agent_available: bool,
    https_remote_configured: bool,
    ssh_remote_configured: bool,
    interactive_prompt_disabled: bool,
    secrets_exposed_to_webview: bool,
}

#[tauri::command]
pub fn list_git_stashes(state: State<'_, WorkspaceState>) -> Result<Vec<GitStashEntry>, String> {
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    let output = git_ok(&root, &["stash", "list", "--format=%gd%x09%H%x09%aI%x09%s"])?;
    Ok(output.lines().take(200).filter_map(|line| {
        let mut fields = line.splitn(4, '\t');
        let reference = fields.next()?.trim();
        if reference.is_empty() { return None; }
        Some(GitStashEntry {
            reference: reference.to_string(),
            hash: fields.next().unwrap_or("").to_string(),
            date: fields.next().unwrap_or("").to_string(),
            message: fields.next().unwrap_or("").to_string(),
        })
    }).collect())
}

fn validate_stash_ref(root: &PathBuf, reference: &str) -> Result<String, String> {
    let value = reference.trim();
    if value.is_empty() || value.len() > 128 || value.starts_with('-') || value.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return Err("invalid Git stash reference".into());
    }
    let stashes = list_git_stash_refs(root)?;
    if !stashes.iter().any(|item| item == value) { return Err("Git stash reference does not exist".into()); }
    Ok(value.to_string())
}

fn list_git_stash_refs(root: &PathBuf) -> Result<Vec<String>, String> {
    let output = git_ok(root, &["stash", "list", "--format=%gd"])?;
    Ok(output.lines().map(str::trim).filter(|item| !item.is_empty()).take(200).map(str::to_string).collect())
}

#[tauri::command]
pub fn git_stash_push(message: Option<String>, include_untracked: Option<bool>, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    let clean = git_ok(&root, &["status", "--porcelain=v1", "--untracked-files=all"])?;
    if clean.trim().is_empty() { return Err("working tree has no changes to stash".into()); }
    let message = message.unwrap_or_default();
    if message.len() > 500 { return Err("stash message is too long".into()); }
    let mut args = vec!["stash", "push"];
    if include_untracked.unwrap_or(true) { args.push("--include-untracked"); }
    if !message.trim().is_empty() {
        args.push("-m");
        args.push(message.trim());
    }
    git_ok_verbose(&root, &args)
}

#[tauri::command]
pub fn git_stash_apply(reference: String, pop: Option<bool>, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_terminal_allowed(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    require_clean_worktree(&root)?;
    let reference = validate_stash_ref(&root, &reference)?;
    if pop.unwrap_or(false) { git_ok_verbose(&root, &["stash", "pop", "--index", &reference]) }
    else { git_ok_verbose(&root, &["stash", "apply", "--index", &reference]) }
}

#[tauri::command]
pub fn git_stash_drop(reference: String, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_trusted(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    let reference = validate_stash_ref(&root, &reference)?;
    git_ok_verbose(&root, &["stash", "drop", &reference])
}

#[tauri::command]
pub fn list_git_tags(state: State<'_, WorkspaceState>) -> Result<Vec<GitTag>, String> {
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    let output = git_ok(&root, &["for-each-ref", "--sort=-creatordate", "--format=%(refname:short)%09%(*objectname)%09%(objectname)%09%(creatordate:iso-strict)%09%(subject)%09%(objecttype)", "refs/tags"])?;
    Ok(output.lines().take(500).filter_map(|line| {
        let mut fields = line.splitn(6, '\t');
        let name = fields.next()?.trim();
        if name.is_empty() { return None; }
        let peeled = fields.next().unwrap_or("");
        let object = fields.next().unwrap_or("");
        let date = fields.next().unwrap_or("");
        let subject = fields.next().unwrap_or("");
        let object_type = fields.next().unwrap_or("");
        Some(GitTag {
            name: name.to_string(),
            commit: if peeled.is_empty() { object } else { peeled }.to_string(),
            date: date.to_string(),
            subject: subject.to_string(),
            annotated: object_type == "tag",
        })
    }).collect())
}

fn validate_tag_name(root: &PathBuf, name: &str) -> Result<String, String> {
    let value = name.trim();
    if value.is_empty() || value.len() > 240 || value.starts_with('-') || value.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return Err("invalid Git tag name".into());
    }
    let full = format!("refs/tags/{value}");
    git_ok(root, &["check-ref-format", &full])?;
    Ok(value.to_string())
}

#[tauri::command]
pub fn git_create_tag(name: String, commit: Option<String>, message: Option<String>, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_trusted(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    let name = validate_tag_name(&root, &name)?;
    let target = match commit { Some(value) if !value.trim().is_empty() => validate_commitish(&root, &value)?, _ => "HEAD".into() };
    let message = message.unwrap_or_else(|| name.clone());
    if message.len() > 10_000 { return Err("tag message is too long".into()); }
    git_ok_verbose(&root, &["tag", "-a", &name, "-m", message.trim(), &target])
}

#[tauri::command]
pub fn git_delete_tag(name: String, state: State<'_, WorkspaceState>, security: State<'_, WorkspaceSecurityState>) -> Result<String, String> {
    require_trusted(&security)?;
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    let name = validate_tag_name(&root, &name)?;
    git_ok_verbose(&root, &["tag", "-d", &name])
}

fn parse_graph_commits(output: &str) -> Vec<GitGraphCommit> {
    output.split('\x1e').filter_map(|record| {
        let record = record.trim_matches(|c| c == '\r' || c == '\n');
        if record.is_empty() { return None; }
        let fields = record.split('\x1f').collect::<Vec<_>>();
        if fields.len() < 8 { return None; }
        Some(GitGraphCommit {
            hash: fields[0].to_string(),
            short_hash: fields[1].to_string(),
            parents: fields[2].split_whitespace().map(str::to_string).collect(),
            author: fields[3].to_string(),
            email: fields[4].to_string(),
            date: fields[5].to_string(),
            subject: fields[6].to_string(),
            decorations: fields[7].trim().to_string(),
        })
    }).collect()
}

#[tauri::command]
pub fn get_git_graph(limit: Option<usize>, state: State<'_, WorkspaceState>) -> Result<Vec<GitGraphCommit>, String> {
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    if git_ok(&root, &["rev-parse", "--verify", "HEAD"]).is_err() { return Ok(Vec::new()); }
    let count = limit.unwrap_or(120).clamp(1, 500).to_string();
    let output = git_ok(&root, &["log", "HEAD", "--branches", "--remotes", "--tags", "--topo-order", "-n", &count, "--date=iso-strict", "--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e"])?;
    Ok(parse_graph_commits(&output))
}

#[tauri::command]
pub fn get_git_file_history(relative_path: String, limit: Option<usize>, state: State<'_, WorkspaceState>) -> Result<Vec<GitGraphCommit>, String> {
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    let path = normalized_git_path(&relative_path)?;
    let count = limit.unwrap_or(80).clamp(1, 300).to_string();
    let output = git_ok(&root, &["log", "--follow", "-n", &count, "--date=iso-strict", "--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x1e", "--", &path])?;
    Ok(parse_graph_commits(&output))
}

#[tauri::command]
pub fn get_git_blame(relative_path: String, state: State<'_, WorkspaceState>) -> Result<Vec<GitBlameLine>, String> {
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    let path = normalized_git_path(&relative_path)?;
    if let Ok(metadata) = fs::metadata(root.join(&path)) {
        if metadata.len() > 2 * 1024 * 1024 { return Err("Git blame is limited to files up to 2 MiB".into()); }
    }
    let blame_output = git_output(&root, &["blame", "--line-porcelain", "--", &path])?;
    if !blame_output.status.success() { return Err(output_error(&blame_output)); }
    if blame_output.stdout.len() > 16 * 1024 * 1024 { return Err("Git blame output is too large".into()); }
    let output = String::from_utf8_lossy(&blame_output.stdout);
    let mut result = Vec::new();
    let mut commit = String::new();
    let mut line_number = 0usize;
    let mut author = String::new();
    let mut email = String::new();
    let mut author_time = 0i64;
    let mut summary = String::new();
    for line in output.lines() {
        if line.starts_with('\t') {
            if result.len() >= 10_000 { break; }
            let short_commit = if commit.chars().all(|ch| ch == '0') { "working".into() } else { commit.chars().take(8).collect() };
            result.push(GitBlameLine {
                line_number,
                commit: commit.clone(),
                short_commit,
                author: author.clone(),
                email: email.trim_matches(|ch| ch == '<' || ch == '>').to_string(),
                author_time,
                summary: summary.clone(),
                content: line[1..].to_string(),
            });
            continue;
        }
        if let Some(value) = line.strip_prefix("author ") { author = value.to_string(); continue; }
        if let Some(value) = line.strip_prefix("author-mail ") { email = value.to_string(); continue; }
        if let Some(value) = line.strip_prefix("author-time ") { author_time = value.parse().unwrap_or(0); continue; }
        if let Some(value) = line.strip_prefix("summary ") { summary = value.to_string(); continue; }
        let mut fields = line.split_whitespace();
        if let (Some(raw_hash), Some(_original), Some(final_line)) = (fields.next(), fields.next(), fields.next()) {
            let hash = raw_hash.strip_prefix('^').unwrap_or(raw_hash);
            if hash.len() >= 8 && hash.chars().all(|ch| ch.is_ascii_hexdigit()) {
                commit = hash.to_string();
                line_number = final_line.parse().unwrap_or(result.len() + 1);
                author.clear(); email.clear(); author_time = 0; summary.clear();
            }
        }
    }
    Ok(result)
}

fn remote_transport_flags(root: &PathBuf) -> (bool, bool) {
    let names = git_ok(root, &["remote"]).unwrap_or_default();
    let mut https = false;
    let mut ssh = false;
    for name in names.lines().map(str::trim).filter(|name| !name.is_empty()).take(64) {
        let url = git_ok(root, &["remote", "get-url", name]).unwrap_or_default();
        let lower = url.to_ascii_lowercase();
        https |= lower.starts_with("https://") || lower.starts_with("http://");
        ssh |= lower.starts_with("ssh://") || (!url.contains("://") && url.contains('@') && url.contains(':'));
    }
    (https, ssh)
}

#[tauri::command]
pub fn get_git_credential_state(state: State<'_, WorkspaceState>) -> Result<GitCredentialState, String> {
    let root = workspace_root(&state)?;
    require_workspace_repository(&root)?;
    // Never return helper commands, usernames, passwords or tokens. Only sanitized capability metadata crosses IPC.
    let helpers = git_ok(&root, &["config", "--get-all", "credential.helper"]).unwrap_or_default();
    let helper_lower = helpers.to_ascii_lowercase();
    let helper_kind = if helpers.trim().is_empty() { "none" }
        else if helper_lower.contains("manager") { "credential-manager" }
        else if helper_lower.contains("osxkeychain") { "os-keychain" }
        else if helper_lower.contains("libsecret") { "libsecret" }
        else if helper_lower.contains("wincred") { "windows-credential-store" }
        else { "custom-helper" };
    let (https_remote_configured, ssh_remote_configured) = remote_transport_flags(&root);
    let ssh_agent_available = std::env::var_os("SSH_AUTH_SOCK").is_some() || std::env::var_os("SSH_AGENT_PID").is_some();
    Ok(GitCredentialState {
        credential_helper_configured: !helpers.trim().is_empty(),
        credential_helper_kind: helper_kind.into(),
        ssh_agent_available,
        https_remote_configured,
        ssh_remote_configured,
        interactive_prompt_disabled: true,
        secrets_exposed_to_webview: false,
    })
}
