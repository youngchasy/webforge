export type WorkspaceEntry = {
  name: string;
  relativePath: string;
  kind: "file" | "directory";
  children?: WorkspaceEntry[];
};

export type ExternalChange = "modified" | "deleted" | null;

export type EditorFile = {
  name: string;
  relativePath: string;
  language: string;
  content: string;
  savedContent: string;
  dirty: boolean;
  externalChange: ExternalChange;
};

export type WorkspaceSnapshot = {
  root: WorkspaceEntry;
  name: string;
};

export type WorkspaceWrite = {
  relativePath: string;
  content: string;
};

export type WorkspaceChanges = {
  created: string[];
  modified: string[];
  removed: string[];
  rescan?: boolean;
  native?: boolean;
};
