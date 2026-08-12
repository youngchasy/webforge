export type EditorDiagnosticSeverity = "error" | "warning" | "info" | "hint";

export type EditorDiagnostic = {
  id: string;
  path: string;
  message: string;
  severity: EditorDiagnosticSeverity;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  code: string | null;
  owner: string | null;
};
