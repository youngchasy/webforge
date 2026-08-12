export type WorkspaceSearchOptions = {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  include: string;
  exclude: string;
  maxResults?: number;
};

export type WorkspaceSearchRequest = WorkspaceSearchOptions & {
  overlays: Record<string, string>;
  useIndex?: boolean;
};

export type WorkspaceSearchMatch = {
  path: string;
  line: number;
  column: number;
  endColumn: number;
  preview: string;
  matched: string;
};

export type WorkspaceIndexStatus = {
  indexed: boolean;
  files: number;
  totalBytes: number;
  revision: number;
  truncated: boolean;
};

export type WorkspaceSearchResponse = {
  matches: WorkspaceSearchMatch[];
  filesScanned: number;
  truncated: boolean;
  indexed?: boolean;
  indexRevision?: number;
  indexedFiles?: number;
  indexTruncated?: boolean;
};

export type WorkspaceReplacement = {
  relativePath: string;
  before: string;
  content: string;
  replacements: number;
};
