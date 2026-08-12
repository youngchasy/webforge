export type PreviewConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export type PreviewConsoleEntry = {
  id: number;
  level: PreviewConsoleLevel;
  text: string;
  sourcePath: string | null;
  line: number | null;
  column: number | null;
  timestamp: string;
};

export type InspectorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CssPseudoState = "normal" | "hover" | "focus" | "active" | "focus-visible";

export type CssAtRuleContext = {
  name: string;
  prelude: string;
};

export type CssRuleMatch = {
  selector: string;
  sourcePath: string | null;
  media: string | null;
  pseudo: CssPseudoState;
  declarations: Record<string, string>;
  contexts: CssAtRuleContext[];
  sourceLine: number | null;
  sourceStart: number | null;
  sourceEnd: number | null;
  sourceOrder: number;
  importantDeclarations: string[];
  specificity: [number, number, number];
};

export type DomTreeNode = {
  sourceId: string;
  selector: string;
  tagName: string;
  id: string;
  classes: string[];
  text: string;
  children: DomTreeNode[];
  sourcePath?: string | null;
  sourceLine?: number | null;
  sourceColumn?: number | null;
};

export type InspectorSourceConfidence = "exact" | "component" | "hint" | "runtime";

export type CssAncestorTrace = {
  selector: string;
  tagName: string;
  id: string;
  sourcePath: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
  sourceConfidence: InspectorSourceConfidence;
  styles: Record<string, string>;
  inlineStyles: Record<string, string>;
  cssRules: CssRuleMatch[];
};

export type InspectorSelection = {
  sourceId: string;
  selector: string;
  tagName: string;
  id: string;
  classes: string[];
  attributes: Record<string, string>;
  text: string;
  rect: InspectorRect;
  styles: Record<string, string>;
  inlineStyles: Record<string, string>;
  cssRules: CssRuleMatch[];
  sourcePath: string | null;
  sourceLine: number | null;
  sourceColumn: number | null;
  sourceKind: "static" | "framework" | "runtime";
  sourceConfidence: InspectorSourceConfidence;
  sourceOrigin: string | null;
  ancestors: CssAncestorTrace[];
  editableSource: boolean;
  structuralEditable?: boolean;
  textEditable?: boolean;
};

export type DesignerHistoryEntry = {
  path: string;
  before: string;
  after: string;
  label: string;
};

export type EditorTarget = {
  path: string;
  line: number;
  column: number;
  token: number;
};

export type CssVariableEntry = {
  path: string;
  selector: string;
  name: string;
  value: string;
  contexts: CssAtRuleContext[];
  sourceStart: number;
};

export type ComponentSnippet = {
  id: string;
  label: string;
  category: string;
  snippet: string;
  userDefined: boolean;
};
