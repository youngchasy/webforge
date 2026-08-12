import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type {
  GitBlameLine,
  GitBranch,
  GitChange,
  GitCommit,
  GitConflictSnapshot,
  GitCredentialState,
  GitGraphCommit,
  GitNetworkResult,
  GitOperationState,
  GitRemote,
  GitRemoteBranch,
  GitStashEntry,
  GitStatus,
  GitTag,
} from "../types/git";
import { changedLineCount } from "../lib/mergeDiff";
import { GitMergeEditor } from "./GitMergeEditor";

const emptyStatus: GitStatus = { available: true, repository: false, repoRoot: null, workspaceRootRepository: false, branch: null, ahead: 0, behind: 0, changes: [], error: null };
const emptyOperations: GitOperationState = { merge: false, rebase: false, cherryPick: false };
type View = "changes" | "branches" | "history" | "stashes" | "tags" | "inspect" | "remotes";
type InspectMode = "history" | "blame";

type Props = {
  workspacePath: string;
  activePath: string;
  trusted: boolean;
  terminalAllowed: boolean;
  gitNetworkAllowed: boolean;
  dirtyPaths: string[];
  getStatus: () => Promise<GitStatus>;
  getDiff: (path: string, staged?: boolean) => Promise<string>;
  getBranches: () => Promise<GitBranch[]>;
  getRemoteBranches: () => Promise<GitRemoteBranch[]>;
  getOperationState: () => Promise<GitOperationState>;
  getHistory: (limit?: number) => Promise<GitCommit[]>;
  getGraph: (limit?: number) => Promise<GitGraphCommit[]>;
  getFileHistory: (path: string, limit?: number) => Promise<GitGraphCommit[]>;
  getBlame: (path: string) => Promise<GitBlameLine[]>;
  getRemotes: () => Promise<GitRemote[]>;
  getConflict: (path: string) => Promise<GitConflictSnapshot>;
  getStashes: () => Promise<GitStashEntry[]>;
  getTags: () => Promise<GitTag[]>;
  getCredentialState: () => Promise<GitCredentialState | null>;
  stage: (path: string) => Promise<void>;
  unstage: (path: string) => Promise<void>;
  commit: (message: string) => Promise<string>;
  init: () => Promise<string>;
  switchBranch: (name: string) => Promise<string>;
  createBranch: (name: string) => Promise<string>;
  mergeBranch: (name: string) => Promise<string>;
  mergeContinue: () => Promise<string>;
  mergeAbort: () => Promise<string>;
  rebaseBranch: (name: string) => Promise<string>;
  rebaseContinue: () => Promise<string>;
  rebaseAbort: () => Promise<string>;
  cherryPick: (commit: string) => Promise<string>;
  cherryPickContinue: () => Promise<string>;
  cherryPickAbort: () => Promise<string>;
  stashPush: (message?: string) => Promise<string>;
  stashApply: (reference: string, pop?: boolean) => Promise<string>;
  stashDrop: (reference: string) => Promise<string>;
  createTag: (name: string, commit?: string, message?: string) => Promise<string>;
  deleteTag: (name: string) => Promise<string>;
  setGitNetworkAccess: (allowed: boolean) => Promise<void> | void;
  fetchRemote: (remote: string) => Promise<GitNetworkResult>;
  pullRemote: (remote: string) => Promise<GitNetworkResult>;
  pushRemote: (remote: string) => Promise<GitNetworkResult>;
  applyConflictResult: (path: string, content: string) => void;
  resolveConflict: (path: string, content: string) => Promise<void>;
  openFile: (path: string) => void;
};

function statusLabel(change: GitChange): string {
  if (change.conflicted) return "!";
  if (change.untracked) return "U";
  const value = `${change.indexStatus}${change.worktreeStatus}`.trim();
  return value || "M";
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale === "ru" ? "ru-RU" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}

function graphRows(commits: GitGraphCommit[]) {
  let lanes: string[] = [];
  return commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) { lanes.unshift(commit.hash); lane = 0; }
    const before = [...lanes];
    lanes.splice(lane, 1, ...commit.parents);
    const seen = new Set<string>();
    lanes = lanes.filter((hash) => hash && !seen.has(hash) && Boolean(seen.add(hash))).slice(0, 12);
    return { commit, lane, lanes: before.slice(0, 12), nextLaneCount: lanes.length };
  });
}

function CommitGraph({ commits, onCherryPick, onTag, disabled, locale, t }: { commits: GitGraphCommit[]; onCherryPick: (hash: string) => void; onTag: (hash: string) => void; disabled: boolean; locale: string; t: ReturnType<typeof useI18n>["t"] }) {
  const rows = useMemo(() => graphRows(commits), [commits]);
  return <div className="scm-commit-graph">
    {rows.map(({ commit, lane, lanes, nextLaneCount }) => {
      const count = Math.max(1, lanes.length, nextLaneCount);
      return <div className="scm-graph-row" key={commit.hash} title={commit.hash}>
        <span className="scm-graph-lanes" aria-hidden="true">{Array.from({ length: Math.min(8, count) }, (_, index) => <i key={index} className={index === lane ? "node" : "rail"}>{index === lane ? "●" : "│"}</i>)}</span>
        <span className="scm-history-info"><strong>{commit.subject}</strong><small>{commit.shortHash} · {commit.author} · {formatDate(commit.date, locale)}</small>{commit.decorations && <em>{commit.decorations}</em>}{commit.parents.length > 1 && <small>{t("git.mergeParents", { count: commit.parents.length })}</small>}</span>
        <span className="scm-history-actions"><button disabled={disabled} onClick={() => onTag(commit.hash)} title={t("git.tagCommit")}>🏷</button><button disabled={disabled} onClick={() => onCherryPick(commit.hash)} title={t("git.cherryPick")}>✣</button></span>
      </div>;
    })}
  </div>;
}

export function SourceControlPanel(props: Props) {
  const { locale, t } = useI18n();
  const {
    workspacePath, activePath, trusted, terminalAllowed, gitNetworkAllowed, dirtyPaths,
    getStatus, getDiff, getBranches, getRemoteBranches, getOperationState, getHistory, getGraph, getFileHistory, getBlame, getRemotes, getConflict, getStashes, getTags, getCredentialState,
    stage, unstage, commit, init, switchBranch, createBranch, mergeBranch, mergeContinue, mergeAbort, rebaseBranch, rebaseContinue, rebaseAbort, cherryPick, cherryPickContinue, cherryPickAbort,
    stashPush, stashApply, stashDrop, createTag, deleteTag, setGitNetworkAccess, fetchRemote, pullRemote, pushRemote, applyConflictResult, resolveConflict, openFile,
  } = props;
  const [status, setStatus] = useState<GitStatus>(emptyStatus);
  const [view, setView] = useState<View>("changes");
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<GitRemoteBranch[]>([]);
  const [operationState, setOperationState] = useState<GitOperationState>(emptyOperations);
  const [history, setHistory] = useState<GitCommit[]>([]);
  const [graph, setGraph] = useState<GitGraphCommit[]>([]);
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [tags, setTags] = useState<GitTag[]>([]);
  const [credentialState, setCredentialState] = useState<GitCredentialState | null>(null);
  const [conflict, setConflict] = useState<GitConflictSnapshot | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeResult, setMergeResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [diff, setDiff] = useState("");
  const [diffPath, setDiffPath] = useState("");
  const [error, setError] = useState("");
  const [networkOutput, setNetworkOutput] = useState("");
  const [inspectMode, setInspectMode] = useState<InspectMode>("history");
  const [fileHistory, setFileHistory] = useState<GitGraphCommit[]>([]);
  const [blame, setBlame] = useState<GitBlameLine[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);

  const dirty = useMemo(() => new Set(dirtyPaths), [dirtyPaths]);
  const canWrite = trusted && status.workspaceRootRepository;
  const canRunFilterCapableGit = canWrite && terminalAllowed;
  const canSwitch = canRunFilterCapableGit && dirtyPaths.length === 0 && status.changes.length === 0;
  const staged = status.changes.filter((item) => item.staged);
  const unstaged = status.changes.filter((item) => !item.staged || item.worktreeStatus.trim());
  const conflicts = status.changes.filter((item) => item.conflicted);

  const refresh = useCallback(async (withDetails = false) => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const next = await getStatus();
      setStatus(next);
      if (next.repository && withDetails) {
        const results = await Promise.all([
          getBranches().catch(() => []), getRemoteBranches().catch(() => []), getOperationState().catch(() => emptyOperations),
          getHistory(80).catch(() => []), getGraph(160).catch(() => []), getRemotes().catch(() => []), getStashes().catch(() => []), getTags().catch(() => []), getCredentialState().catch(() => null),
        ]);
        setBranches(results[0]); setRemoteBranches(results[1]); setOperationState(results[2]); setHistory(results[3]); setGraph(results[4]); setRemotes(results[5]); setStashes(results[6]); setTags(results[7]); setCredentialState(results[8]);
      }
      setError("");
    } catch (reason) { setError(String(reason)); }
    finally { setLoading(false); }
  }, [getBranches, getCredentialState, getGraph, getHistory, getOperationState, getRemoteBranches, getRemotes, getStashes, getStatus, getTags, workspacePath]);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 2400);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => { if (view !== "changes" && status.repository) void refresh(true); }, [view]);

  useEffect(() => {
    if (view !== "inspect" || !activePath || !status.repository) return;
    let disposed = false;
    setInspectLoading(true);
    const request = inspectMode === "history" ? getFileHistory(activePath, 120) : getBlame(activePath);
    void request.then((value) => {
      if (disposed) return;
      if (inspectMode === "history") setFileHistory(value as GitGraphCommit[]); else setBlame(value as GitBlameLine[]);
      setError("");
    }).catch((reason) => { if (!disposed) setError(String(reason)); }).finally(() => { if (!disposed) setInspectLoading(false); });
    return () => { disposed = true; };
  }, [activePath, getBlame, getFileHistory, inspectMode, status.repository, view]);

  const mutate = async (action: () => Promise<void>) => {
    setLoading(true);
    try { await action(); await refresh(true); setError(""); } catch (reason) { setError(String(reason)); }
    finally { setLoading(false); }
  };

  const showDiff = async (change: GitChange, stagedView = change.staged && !change.worktreeStatus.trim()) => {
    setConflict(null); setMergeOpen(false); setDiffPath(change.path);
    try { setDiff((await getDiff(change.path, stagedView)) || (change.untracked ? t("git.untrackedNoDiff") : t("git.noDiff"))); setError(""); }
    catch (reason) { setError(String(reason)); }
  };

  const showConflict = async (change: GitChange) => {
    setDiffPath(""); setDiff("");
    try { const snapshot = await getConflict(change.path); setConflict(snapshot); setMergeOpen(false); setMergeResult(snapshot.working ?? snapshot.ours ?? snapshot.theirs ?? ""); setError(""); }
    catch (reason) { setError(String(reason)); }
  };

  const navigateConflict = (direction: -1 | 1) => {
    if (!conflicts.length) return;
    const current = conflict ? conflicts.findIndex((item) => item.path === conflict.path) : -1;
    const index = (current + direction + conflicts.length) % conflicts.length;
    void showConflict(conflicts[index]);
  };

  const doSwitch = (name: string) => void mutate(async () => { await switchBranch(name); });
  const doMerge = (name: string) => { if (window.confirm(t("git.mergeConfirm", { branch: name }))) void mutate(async () => { await mergeBranch(name); }); };
  const doRebase = (name: string) => { if (window.confirm(t("git.rebaseConfirm", { branch: name }))) void mutate(async () => { await rebaseBranch(name); }); };
  const doCherryPick = (hash: string) => { if (window.confirm(t("git.cherryPickConfirm", { hash: hash.slice(0, 8) }))) void mutate(async () => { await cherryPick(hash); }); };
  const doCreateBranch = () => { const name = window.prompt(t("git.newBranchPrompt")); if (name?.trim()) void mutate(async () => { await createBranch(name.trim()); }); };
  const doCreateTag = (commitHash?: string) => {
    const name = window.prompt(t("git.newTagPrompt")); if (!name?.trim()) return;
    const tagMessage = window.prompt(t("git.tagMessagePrompt"), name.trim()) ?? name.trim();
    void mutate(async () => { await createTag(name.trim(), commitHash, tagMessage); });
  };
  const doStashPush = () => {
    const stashMessage = window.prompt(t("git.stashMessagePrompt"), "WebForge work in progress");
    if (stashMessage === null) return;
    void mutate(async () => { await stashPush(stashMessage.trim() || undefined); });
  };
  const doNetwork = (operation: "fetch" | "pull" | "push", remote: string) => {
    if (!gitNetworkAllowed) { setError(t("git.networkEnableFirst")); return; }
    if (!window.confirm(t(`git.${operation}Confirm` as any, { remote }))) return;
    void mutate(async () => {
      const result = operation === "fetch" ? await fetchRemote(remote) : operation === "pull" ? await pullRemote(remote) : await pushRemote(remote);
      setNetworkOutput(result.output || t("git.networkCompleted", { operation, remote }));
    });
  };

  if (!workspacePath) return <div className="sidebar-feature"><div className="panel-heading"><span>{t("git.title")}</span></div><div className="sidebar-empty">{t("git.openWorkspace")}</div></div>;
  if (!status.available) return <div className="sidebar-feature"><div className="panel-heading"><span>{t("git.title")}</span></div><div className="sidebar-empty">{t("git.notInstalled")}</div></div>;
  if (!status.repository) return <div className="sidebar-feature source-control-panel"><div className="panel-heading"><span>{t("git.title")}</span><button onClick={() => void refresh(true)}>↻</button></div><div className="scm-not-repo"><strong>{t("git.notRepository")}</strong><span>{t("git.notRepositoryHint")}</span><button className="primary-button" disabled={!trusted || loading} onClick={() => void mutate(async () => { await init(); })}>{t("git.initialize")}</button>{!trusted && <small>{t("git.trustToWrite")}</small>}</div>{error && <div className="sidebar-error">{error}</div>}</div>;

  const renderChange = (change: GitChange, stagedSection: boolean) => <div className="scm-change-row" key={`${stagedSection ? "s" : "u"}:${change.path}`}>
    <button className="scm-change-main" onClick={() => void (change.conflicted ? showConflict(change) : showDiff(change, stagedSection))} onDoubleClick={() => openFile(change.path)} title={change.path}><span className="scm-file-name">{change.path.split("/").pop()}</span><span className="scm-file-path">{change.path.includes("/") ? change.path.slice(0, change.path.lastIndexOf("/")) : ""}</span></button>
    {dirty.has(change.path) && <span className="scm-dirty" title={t("git.unsaved")}>●</span>}<span className={`scm-status ${change.conflicted ? "conflict" : ""}`}>{statusLabel(change)}</span>
    <button className="scm-action" disabled={!(stagedSection ? canWrite : canRunFilterCapableGit) || loading || (!stagedSection && dirty.has(change.path))} title={stagedSection ? t("git.unstage") : t("git.stage")} onClick={() => void mutate(() => stagedSection ? unstage(change.path) : stage(change.path))}>{stagedSection ? "−" : "+"}</button>
  </div>;

  return <div className="sidebar-feature source-control-panel">
    <div className="panel-heading"><span>{t("git.title")}</span><button onClick={() => void refresh(true)} title={t("common.refresh")}>↻</button></div>
    <div className="scm-branch"><span>⑂</span><strong>{status.branch ?? t("git.detached")}</strong>{status.ahead > 0 && <small>↑{status.ahead}</small>}{status.behind > 0 && <small>↓{status.behind}</small>}</div>
    <div className="scm-view-tabs scm-view-tabs-18">
      {(["changes", "branches", "history", "stashes", "tags", "inspect", "remotes"] as View[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{t(`git.view${item[0].toUpperCase()}${item.slice(1)}` as any)}</button>)}
    </div>
    {error && <div className="sidebar-error">{error}</div>}
    {(operationState.merge || operationState.rebase || operationState.cherryPick) && <div className="scm-operation-banner">
      <strong>{operationState.rebase ? t("git.rebaseInProgress") : operationState.cherryPick ? t("git.cherryPickInProgress") : t("git.mergeInProgress")}</strong><span>{t("git.operationResolveHint")}</span>
      {operationState.rebase && <div><button disabled={!canRunFilterCapableGit || loading} onClick={() => void mutate(async () => { await rebaseContinue(); })}>{t("git.continue")}</button><button className="danger-soft" disabled={!canRunFilterCapableGit || loading} onClick={() => void mutate(async () => { await rebaseAbort(); })}>{t("git.abort")}</button></div>}
      {operationState.cherryPick && <div><button disabled={!canRunFilterCapableGit || loading} onClick={() => void mutate(async () => { await cherryPickContinue(); })}>{t("git.continue")}</button><button className="danger-soft" disabled={!canRunFilterCapableGit || loading} onClick={() => void mutate(async () => { await cherryPickAbort(); })}>{t("git.abort")}</button></div>}
      {operationState.merge && !operationState.rebase && !operationState.cherryPick && <div><button disabled={!canRunFilterCapableGit || loading || conflicts.length > 0} onClick={() => void mutate(async () => { await mergeContinue(); })}>{t("git.continue")}</button><button className="danger-soft" disabled={!canRunFilterCapableGit || loading} onClick={() => void mutate(async () => { await mergeAbort(); })}>{t("git.abort")}</button></div>}
    </div>}

    {view === "changes" && <>
      <div className="scm-commit-box"><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t("git.commitPlaceholder")} rows={3} /><button className="primary-button" disabled={!canWrite || loading || !message.trim() || staged.length === 0 || dirtyPaths.length > 0} onClick={() => void mutate(async () => { await commit(message); setMessage(""); })}>{t("git.commit")}</button>{dirtyPaths.length > 0 && <small>{t("git.commitDirtyHint", { count: dirtyPaths.length })}</small>}{!trusted && <small>{t("git.trustToWrite")}</small>}{trusted && !status.workspaceRootRepository && <small>{t("git.workspaceRootRequired")}</small>}{canWrite && !terminalAllowed && <small>{t("git.terminalForFilters")}</small>}</div>
      {conflicts.length > 0 && <div className="scm-conflict-nav"><strong>{t("git.conflicts", { count: conflicts.length })}</strong><div><button onClick={() => navigateConflict(-1)}>←</button><button onClick={() => navigateConflict(1)}>→</button></div></div>}
      <div className="scm-section"><div className="scm-section-title"><span>{t("git.staged")}</span><strong>{staged.length}</strong></div>{staged.map((change) => renderChange(change, true))}</div>
      <div className="scm-section"><div className="scm-section-title"><span>{t("git.changes")}</span><strong>{unstaged.length}</strong></div>{unstaged.map((change) => renderChange(change, false))}</div>
      {!status.changes.length && <div className="sidebar-empty">{t("git.clean")}</div>}
      {diffPath && <div className="scm-diff"><div className="scm-diff-title"><span>{diffPath}</span><button onClick={() => { setDiffPath(""); setDiff(""); }}>×</button></div><pre>{diff}</pre></div>}
      {conflict && <div className="scm-conflict-card"><div><strong>{conflict.path}</strong><small>{t("git.oursChanged", { count: changedLineCount(conflict.base ?? "", conflict.ours ?? "") })} · {t("git.theirsChanged", { count: changedLineCount(conflict.base ?? "", conflict.theirs ?? "") })}</small></div><div className="scm-conflict-card-actions"><button className="primary-button" onClick={() => { setMergeResult(conflict.working ?? conflict.ours ?? conflict.theirs ?? ""); setMergeOpen(true); }}>{t("git.openMergeEditor")}</button><button onClick={() => { setConflict(null); setMergeOpen(false); }}>×</button></div></div>}
    </>}

    {view === "branches" && <div className="scm-branches-view">
      <div className="scm-branch-actions"><button className="primary-button" disabled={!canSwitch || loading} onClick={doCreateBranch}>＋ {t("git.newBranch")}</button>{canWrite && !terminalAllowed ? <small>{t("git.terminalForFilters")}</small> : !canSwitch ? <small>{t("git.cleanToSwitch")}</small> : null}</div>
      {branches.length ? branches.map((branch) => <div key={branch.name} className={`scm-branch-row ${branch.current ? "current" : ""}`}><button className="scm-branch-main" disabled={branch.current || !canSwitch || loading} onClick={() => doSwitch(branch.name)}><span>{branch.current ? "●" : "○"}</span><span className="scm-branch-info"><strong>{branch.name}</strong><small>{branch.subject || branch.commit}{branch.upstream ? ` · ${branch.upstream}` : ""}</small></span></button>{!branch.current && <><button className="scm-merge-action" disabled={!canSwitch || loading} onClick={() => doMerge(branch.name)} title={t("git.mergeBranch")}>⇢</button><button className="scm-merge-action" disabled={!canSwitch || loading} onClick={() => doRebase(branch.name)} title={t("git.rebaseOnto")}>↥</button></>}</div>) : <div className="sidebar-empty">{t("git.noBranches")}</div>}
      {remoteBranches.length > 0 && <><div className="scm-section-title"><span>{t("git.remoteBranches")}</span><strong>{remoteBranches.length}</strong></div>{remoteBranches.map((branch) => <div key={branch.name} className="scm-branch-row remote"><div className="scm-branch-main"><span>☁</span><span className="scm-branch-info"><strong>{branch.name}</strong><small>{branch.subject || branch.commit}</small></span></div><button className="scm-merge-action" disabled={!canSwitch || loading} onClick={() => doRebase(branch.name)} title={t("git.rebaseOnto")}>↥</button></div>)}</>}
    </div>}

    {view === "history" && <div className="scm-history-view"><div className="scm-section-title"><span>{t("git.commitGraph")}</span><strong>{graph.length}</strong></div>{graph.length ? <CommitGraph commits={graph} onCherryPick={doCherryPick} onTag={doCreateTag} disabled={!canWrite || loading} locale={locale} t={t} /> : history.length ? history.map((item) => <div className="scm-history-row" key={item.hash}><span className="scm-history-node">●</span><span className="scm-history-info"><strong>{item.subject}</strong><small>{item.shortHash} · {item.author} · {formatDate(item.date, locale)}</small></span></div>) : <div className="sidebar-empty">{t("git.noHistory")}</div>}</div>}

    {view === "stashes" && <div className="scm-stash-view"><div className="scm-tool-actions"><button className="primary-button" disabled={!canRunFilterCapableGit || loading || status.changes.length === 0 || dirtyPaths.length > 0} onClick={doStashPush}>＋ {t("git.createStash")}</button><small>{t("git.stashIncludesUntracked")}</small></div>{stashes.length ? stashes.map((item) => <div className="scm-stash-row" key={item.reference}><div><strong>{item.message || item.reference}</strong><small>{item.reference} · {formatDate(item.date, locale)}</small></div><div><button disabled={!canSwitch || loading} onClick={() => void mutate(async () => { await stashApply(item.reference, false); })}>{t("git.applyStash")}</button><button disabled={!canSwitch || loading} onClick={() => void mutate(async () => { await stashApply(item.reference, true); })}>{t("git.popStash")}</button><button className="danger-soft" disabled={!canWrite || loading} onClick={() => { if (window.confirm(t("git.dropStashConfirm", { reference: item.reference }))) void mutate(async () => { await stashDrop(item.reference); }); }}>{t("git.dropStash")}</button></div></div>) : <div className="sidebar-empty">{t("git.noStashes")}</div>}</div>}

    {view === "tags" && <div className="scm-tags-view"><div className="scm-tool-actions"><button className="primary-button" disabled={!canWrite || loading} onClick={() => doCreateTag()}>＋ {t("git.newTag")}</button></div>{tags.length ? tags.map((tag) => <div className="scm-tag-row" key={tag.name}><span>🏷</span><div><strong>{tag.name}</strong><small>{tag.commit.slice(0, 8)}{tag.date ? ` · ${formatDate(tag.date, locale)}` : ""}{tag.annotated ? ` · ${t("git.annotatedTag")}` : ""}</small>{tag.subject && <em>{tag.subject}</em>}</div><button className="danger-soft" disabled={!canWrite || loading} onClick={() => { if (window.confirm(t("git.deleteTagConfirm", { tag: tag.name }))) void mutate(async () => { await deleteTag(tag.name); }); }}>×</button></div>) : <div className="sidebar-empty">{t("git.noTags")}</div>}</div>}

    {view === "inspect" && <div className="scm-inspect-view">
      <div className="scm-inspect-header"><strong>{activePath || t("git.noActiveFile")}</strong><div><button className={inspectMode === "history" ? "active" : ""} onClick={() => setInspectMode("history")}>{t("git.fileHistory")}</button><button className={inspectMode === "blame" ? "active" : ""} onClick={() => setInspectMode("blame")}>{t("git.blame")}</button></div></div>
      {!activePath ? <div className="sidebar-empty">{t("git.selectFileToInspect")}</div> : inspectLoading ? <div className="sidebar-empty">{t("common.loading")}</div> : inspectMode === "history" ? (fileHistory.length ? <CommitGraph commits={fileHistory} onCherryPick={doCherryPick} onTag={doCreateTag} disabled={!canWrite || loading} locale={locale} t={t} /> : <div className="sidebar-empty">{t("git.noFileHistory")}</div>) : (blame.length ? <div className="scm-blame-list">{blame.map((line) => <div className="scm-blame-line" key={`${line.lineNumber}:${line.commit}`} title={`${line.author} · ${line.summary}`}><span>{line.lineNumber}</span><button title={line.commit}>{line.shortCommit}</button><small>{line.author}</small><code>{line.content || " "}</code></div>)}</div> : <div className="sidebar-empty">{t("git.noBlame")}</div>)}
    </div>}

    {view === "remotes" && <div className="scm-remotes-view">
      <div className="git-credential-state"><strong>{t("git.credentialState")}</strong><span>{credentialState?.credentialHelperConfigured ? t("git.credentialHelper", { kind: credentialState.credentialHelperKind }) : t("git.noCredentialHelper")}</span><span>{credentialState?.sshAgentAvailable ? t("git.sshAgentAvailable") : t("git.sshAgentUnavailable")}</span><small>{t("git.credentialsNeverExposed")}</small></div>
      <div className="git-network-policy"><div><strong>{gitNetworkAllowed ? t("git.networkEnabled") : t("git.networkDisabled")}</strong><small>{t("git.remoteNetworkHint")}</small></div><button className={gitNetworkAllowed ? "danger-soft" : "primary-button"} disabled={!terminalAllowed || !canWrite || loading} onClick={() => void setGitNetworkAccess(!gitNetworkAllowed)}>{gitNetworkAllowed ? t("git.networkDisable") : t("git.networkEnable")}</button></div>
      {!terminalAllowed && <div className="tasks-security-note">{t("git.networkTerminalRequired")}</div>}
      {remotes.length ? remotes.map((remote) => <div className="scm-remote-row" key={remote.name}><strong>{remote.name}</strong><label>{t("git.fetchUrl")}<code>{remote.fetchUrl}</code></label><label>{t("git.pushUrl")}<code>{remote.pushUrl}</code></label><div className="scm-remote-actions"><button disabled={!gitNetworkAllowed || loading} onClick={() => doNetwork("fetch", remote.name)}>↓ {t("git.fetchRemote")}</button><button disabled={!gitNetworkAllowed || loading || status.changes.length > 0 || dirtyPaths.length > 0} onClick={() => doNetwork("pull", remote.name)}>⇣ {t("git.pullRemote")}</button><button disabled={!gitNetworkAllowed || loading || dirtyPaths.length > 0} onClick={() => doNetwork("push", remote.name)}>↑ {t("git.pushRemote")}</button></div></div>) : <div className="sidebar-empty">{t("git.noRemotes")}</div>}
      {networkOutput && <div className="scm-network-output"><button onClick={() => setNetworkOutput("")}>×</button><pre>{networkOutput}</pre></div>}
    </div>}

    {conflict && mergeOpen && <GitMergeEditor conflict={conflict} value={mergeResult} onChange={setMergeResult} onClose={() => setMergeOpen(false)} onAcceptOurs={() => setMergeResult(conflict.ours ?? "")} onAcceptTheirs={() => setMergeResult(conflict.theirs ?? "")} onAcceptBoth={() => setMergeResult([conflict.ours ?? "", conflict.theirs ?? ""].filter(Boolean).join("\n"))} onApply={() => { applyConflictResult(conflict.path, mergeResult); openFile(conflict.path); setMergeOpen(false); }} canResolve={canRunFilterCapableGit && !loading} onResolve={() => void mutate(async () => { await resolveConflict(conflict.path, mergeResult); setMergeOpen(false); setConflict(null); })} />}
  </div>;
}
