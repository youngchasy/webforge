export type LanguageServerInfo = {
  id: "typescript" | "vue" | "svelte" | string;
  label: string;
  available: boolean;
  source: "workspace" | "system" | string | null;
  command: string | null;
};

export type LanguageServerRuntimeStatus = {
  serverId: string;
  label: string;
  running: boolean;
  pid: number | null;
  error: string | null;
  semanticTokenTypes: string[];
  semanticTokenModifiers: string[];
  supportsCallHierarchy: boolean;
  supportsTypeHierarchy: boolean;
  supportsInlayHints: boolean;
  supportsFormatting: boolean;
  supportsCodeLens: boolean;
  supportsWorkspaceDiagnostics: boolean;
  crashCount: number;
};

export type LanguageServerStatus = {
  running: boolean;
  serverId: string | null;
  label: string | null;
  pid: number | null;
  error: string | null;
  semanticTokenTypes: string[];
  semanticTokenModifiers: string[];
  supportsCallHierarchy: boolean;
  supportsTypeHierarchy: boolean;
  supportsInlayHints: boolean;
  supportsFormatting: boolean;
  supportsCodeLens: boolean;
  supportsWorkspaceDiagnostics: boolean;
  servers: LanguageServerRuntimeStatus[];
};

export type LanguageServerLogEntry = {
  serverId: string;
  level: "info" | "warning" | "error" | "stderr" | string;
  message: string;
  timestampMs: number;
};

export type LanguageDiagnostic = {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: "error" | "warning" | "info" | "hint" | string;
  message: string;
  code: string | null;
  source: string | null;
};

export type LanguageSymbolLocation = {
  uri?: string;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
};

export type LanguageSymbol = {
  name: string;
  kind: number;
  detail?: string;
  location?: LanguageSymbolLocation;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
  selectionRange?: { start: { line: number; character: number }; end: { line: number; character: number } };
  children?: LanguageSymbol[];
};

export type LanguageRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

export type LanguageHierarchyItem = {
  name: string;
  kind: number;
  tags?: number[];
  detail?: string;
  uri: string;
  range: LanguageRange;
  selectionRange: LanguageRange;
  data?: unknown;
};

export type LanguageIncomingCall = { from: LanguageHierarchyItem; fromRanges?: LanguageRange[] };
export type LanguageOutgoingCall = { to: LanguageHierarchyItem; fromRanges?: LanguageRange[] };
