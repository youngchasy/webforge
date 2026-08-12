export type AuditCategory = "seo" | "accessibility" | "links";
export type AuditSeverity = "error" | "warning" | "info";

export type ProjectAuditFinding = {
  id: string;
  category: AuditCategory;
  severity: AuditSeverity;
  rule: string;
  path: string;
  line: number;
  message: string;
  suggestion: string | null;
};

export type ProjectAuditSummary = {
  findings: ProjectAuditFinding[];
  filesScanned: number;
  errors: number;
  warnings: number;
  infos: number;
};
