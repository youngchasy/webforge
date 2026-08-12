import { useState } from "react";
import { useI18n } from "../i18n";
import { baseName } from "../lib/tree";
import type { WorkspaceEntry } from "../types/workspace";

type ExplorerProps = {
  root: WorkspaceEntry;
  workspaceName: string;
  activePath?: string;
  onOpenFile: (path: string) => void;
  onCreateFile: (parentPath: string, name: string) => void;
  onCreateFolder: (parentPath: string, name: string) => void;
  onRename: (path: string, newName: string) => void;
  onDelete: (path: string) => void;
  onRefresh: () => void;
};

type EntryProps = Omit<ExplorerProps, "root" | "workspaceName" | "onRefresh"> & {
  entry: WorkspaceEntry;
  depth: number;
};

function askName(label: string, initial = ""): string | null {
  const value = window.prompt(label, initial);
  return value?.trim() || null;
}

function EntryActions({ entry, onCreateFile, onCreateFolder, onRename, onDelete }: Pick<EntryProps, "entry" | "onCreateFile" | "onCreateFolder" | "onRename" | "onDelete">) {
  const { t } = useI18n();
  return (
    <span className="tree-actions">
      {entry.kind === "directory" && (
        <>
          <button
            title={t("explorer.newFile")}
            onClick={(event) => {
              event.stopPropagation();
              const name = askName(t("explorer.newFileIn", { path: entry.relativePath || t("explorer.workspace") }));
              if (name) onCreateFile(entry.relativePath, name);
            }}
          >+F</button>
          <button
            title={t("explorer.newFolder")}
            onClick={(event) => {
              event.stopPropagation();
              const name = askName(t("explorer.newFolderIn", { path: entry.relativePath || t("explorer.workspace") }));
              if (name) onCreateFolder(entry.relativePath, name);
            }}
          >+D</button>
        </>
      )}
      <button
        title={t("explorer.rename")}
        onClick={(event) => {
          event.stopPropagation();
          const name = askName(t("explorer.renamePrompt", { name: entry.name }), baseName(entry.relativePath));
          if (name) onRename(entry.relativePath, name);
        }}
      >R</button>
      <button
        className="danger-action"
        title={t("explorer.delete")}
        onClick={(event) => {
          event.stopPropagation();
          onDelete(entry.relativePath);
        }}
      >×</button>
    </span>
  );
}

function TreeEntry({ entry, depth, activePath, onOpenFile, onCreateFile, onCreateFolder, onRename, onDelete }: EntryProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isDirectory = entry.kind === "directory";

  if (isDirectory) {
    return (
      <div>
        <div className="tree-entry-line">
          <button
            className="tree-row directory-row"
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => setExpanded((value) => !value)}
          >
            <span className="tree-chevron">{expanded ? "⌄" : "›"}</span>
            <span className="tree-icon">{expanded ? "▾" : "▸"}</span>
            <span className="tree-label">{entry.name}</span>
          </button>
          <EntryActions
            entry={entry}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRename={onRename}
            onDelete={onDelete}
          />
        </div>
        {expanded && entry.children?.map((child) => (
          <TreeEntry
            key={child.relativePath || child.name}
            entry={child}
            depth={depth + 1}
            activePath={activePath}
            onOpenFile={onOpenFile}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </div>
    );
  }

  const extension = entry.name.split(".").pop()?.toUpperCase() ?? "";
  const short = extension === "HTML" ? "<>" : extension === "CSS" ? "#" : extension === "JS" ? "JS" : extension.slice(0, 2);

  return (
    <div className={activePath === entry.relativePath ? "tree-entry-line active" : "tree-entry-line"}>
      <button
        className="tree-row file-row"
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => onOpenFile(entry.relativePath)}
        title={entry.relativePath}
      >
        <span className={`file-type type-${extension.toLowerCase()}`}>{short}</span>
        <span className="tree-label">{entry.name}</span>
      </button>
      <EntryActions
        entry={entry}
        onCreateFile={onCreateFile}
        onCreateFolder={onCreateFolder}
        onRename={onRename}
        onDelete={onDelete}
      />
    </div>
  );
}

export function Explorer({
  root,
  workspaceName,
  activePath,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onRefresh,
}: ExplorerProps) {
  const { t } = useI18n();
  return (
    <div className="explorer">
      <div className="panel-heading">
        <span>{t("explorer.title")}</span>
        <button onClick={onRefresh} title={t("explorer.refresh")}>↻</button>
      </div>
      <div className="workspace-heading">
        <span title={workspaceName}>{workspaceName.toUpperCase()}</span>
        <span className="workspace-actions">
          <button
            title={t("explorer.newFile")}
            onClick={() => {
              const name = askName(t("explorer.newFileIn", { path: t("explorer.workspace") }));
              if (name) onCreateFile("", name);
            }}
          >+F</button>
          <button
            title={t("explorer.newFolder")}
            onClick={() => {
              const name = askName(t("explorer.newFolderIn", { path: t("explorer.workspace") }));
              if (name) onCreateFolder("", name);
            }}
          >+D</button>
        </span>
      </div>
      <div className="tree-scroll">
        {root.children?.map((entry) => (
          <TreeEntry
            key={entry.relativePath || entry.name}
            entry={entry}
            depth={0}
            activePath={activePath}
            onOpenFile={onOpenFile}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </div>
      <div className="explorer-section collapsed-section"><span>›</span> {t("explorer.outline")}</div>
      <div className="explorer-section collapsed-section"><span>›</span> {t("explorer.timeline")}</div>
    </div>
  );
}
