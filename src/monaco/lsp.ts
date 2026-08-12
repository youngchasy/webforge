import "./setup";
import * as monaco from "monaco-editor";
import { executeLanguageCommand, requestLanguageFeature } from "../lib/tauri";
import { languageFromPath } from "../lib/language";
import type { LanguageServerRuntimeStatus } from "../types/languageServices";

let disposables: monaco.IDisposable[] = [];
let activeWorkspace = "";
let serverStatuses: LanguageServerRuntimeStatus[] = [];
let sourceContents = new Map<string, string>();
let applyBufferEdit: ((path: string, content: string, baseContent: string) => void) | null = null;
let semanticTokenTypes: string[] = [];
let semanticTokenModifiers: string[] = [];
const hiddenModels = new Map<string, { model: monaco.editor.ITextModel; disposable: monaco.IDisposable; baseContent: string }>();

const languages = ["typescript", "javascript", "html"];

type LspPosition = { line: number; character: number };
type LspRange = { start: LspPosition; end: LspPosition };
type LspLocation = { uri: string; range: LspRange };
type LspLocationLink = { targetUri: string; targetRange: LspRange; targetSelectionRange?: LspRange };
type LspTextEdit = { range: LspRange; newText: string };
type LspWorkspaceEdit = { changes?: Record<string, LspTextEdit[]>; documentChanges?: Array<{ textDocument?: { uri?: string }; edits?: LspTextEdit[] }> };
type LspInlayHint = { position?: LspPosition; label?: string | Array<{ value?: string }>; kind?: number; tooltip?: unknown; paddingLeft?: boolean; paddingRight?: boolean; textEdits?: LspTextEdit[] };
type LspCodeLens = { range?: LspRange; command?: { title?: string; command?: string; arguments?: unknown[] }; data?: unknown };

function relativeFromServerUri(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:") return null;
    let pathname = decodeURIComponent(parsed.pathname).replaceAll("\\", "/");
    if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1);
    const root = activeWorkspace.replaceAll("\\", "/").replace(/\/$/, "");
    const caseInsensitive = /^[A-Za-z]:\//.test(root);
    const comparablePath = caseInsensitive ? pathname.toLocaleLowerCase() : pathname;
    const comparableRoot = caseInsensitive ? root.toLocaleLowerCase() : root;
    if (!comparablePath.startsWith(`${comparableRoot}/`) && comparablePath !== comparableRoot) return null;
    return pathname.slice(root.length).replace(/^\//, "");
  } catch {
    return null;
  }
}

function modelUriForServerUri(uri: string, ensureModel = false): monaco.Uri | null {
  const relative = relativeFromServerUri(uri);
  if (!relative) return null;
  const modelUri = monaco.Uri.parse(`file:///${relative}`);
  if (ensureModel && !monaco.editor.getModel(modelUri)) {
    const content = sourceContents.get(relative);
    if (content !== undefined) {
      const model = monaco.editor.createModel(content, languageFromPath(relative), modelUri);
      const baseContent = content;
      const disposable = model.onDidChangeContent(() => applyBufferEdit?.(relative, model.getValue(), baseContent));
      hiddenModels.set(relative, { model, disposable, baseContent });
    }
  }
  return modelUri;
}

function clearHiddenModels() {
  for (const { model, disposable } of hiddenModels.values()) { disposable.dispose(); model.dispose(); }
  hiddenModels.clear();
}

function toMonacoRange(range: LspRange): monaco.Range {
  return new monaco.Range(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1);
}

function textDocumentPosition(model: monaco.editor.ITextModel, position: monaco.IPosition) {
  return { path: model.uri.path.replace(/^\//, ""), line: position.lineNumber, column: position.column };
}

function requiredServerId(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".vue")) return "vue";
  if (lower.endsWith(".svelte")) return "svelte";
  if (/\.(?:[cm]?[jt]sx?)$/.test(lower)) return "typescript";
  return null;
}

function serverForPath(path: string): LanguageServerRuntimeStatus | null {
  const id = requiredServerId(path);
  if (!id) return null;
  return serverStatuses.find((server) => server.serverId === id && server.running) ?? null;
}

function supportsModel(model: monaco.editor.ITextModel): boolean {
  return Boolean(activeWorkspace && serverForPath(model.uri.path.replace(/^\//, "")));
}

function markdown(value: unknown): monaco.IMarkdownString[] {
  if (typeof value === "string") return [{ value }];
  if (value && typeof value === "object") {
    const record = value as { value?: unknown; language?: unknown };
    if (typeof record.language === "string" && typeof record.value === "string") return [{ value: `\`\`\`${record.language}\n${record.value}\n\`\`\`` }];
    if (typeof record.value === "string") return [{ value: record.value }];
  }
  if (Array.isArray(value)) return value.flatMap(markdown);
  return [];
}

function completionKind(kind: unknown): monaco.languages.CompletionItemKind {
  const numeric = typeof kind === "number" ? Math.max(0, Math.min(24, kind - 1)) : monaco.languages.CompletionItemKind.Text;
  return numeric as monaco.languages.CompletionItemKind;
}

function toWorkspaceEdit(response: LspWorkspaceEdit | null | undefined): any {
  const edits: any[] = [];
  if (!response) return { edits };
  for (const [uriText, changes] of Object.entries(response.changes ?? {})) {
    const resource = modelUriForServerUri(uriText, true);
    if (!resource) continue;
    for (const edit of changes) edits.push({ resource, textEdit: { range: toMonacoRange(edit.range), text: edit.newText } });
  }
  for (const change of response.documentChanges ?? []) {
    const uriText = change.textDocument?.uri;
    const resource = uriText ? modelUriForServerUri(uriText, true) : null;
    if (!resource) continue;
    for (const edit of change.edits ?? []) edits.push({ resource, textEdit: { range: toMonacoRange(edit.range), text: edit.newText } });
  }
  return { edits };
}

function rebuildSemanticLegend() {
  semanticTokenTypes = [];
  semanticTokenModifiers = [];
  for (const server of serverStatuses) {
    for (const token of server.semanticTokenTypes) if (!semanticTokenTypes.includes(token)) semanticTokenTypes.push(token);
    for (const modifier of server.semanticTokenModifiers) if (!semanticTokenModifiers.includes(modifier)) semanticTokenModifiers.push(modifier);
  }
}

function remapSemanticData(data: number[], server: LanguageServerRuntimeStatus): Uint32Array {
  const mapped = data.slice();
  for (let index = 0; index + 4 < mapped.length; index += 5) {
    const sourceType = server.semanticTokenTypes[mapped[index + 3]];
    mapped[index + 3] = sourceType ? Math.max(0, semanticTokenTypes.indexOf(sourceType)) : 0;
    const sourceMask = mapped[index + 4] >>> 0;
    let targetMask = 0;
    for (let bit = 0; bit < Math.min(server.semanticTokenModifiers.length, 31); bit += 1) {
      if ((sourceMask & (1 << bit)) === 0) continue;
      const modifier = server.semanticTokenModifiers[bit];
      const targetBit = semanticTokenModifiers.indexOf(modifier);
      if (targetBit >= 0 && targetBit < 31) targetMask |= (1 << targetBit);
    }
    mapped[index + 4] = targetMask >>> 0;
  }
  return Uint32Array.from(mapped);
}

function install() {
  const selector = languages;

  disposables.push(monaco.editor.registerCommand("webforge.lsp.executeCommand", (_accessor, payload: { serverId?: string; command?: string; arguments?: unknown[] } | undefined) => {
    if (!payload?.serverId || !payload.command) return;
    void executeLanguageCommand(payload.serverId, payload.command, payload.arguments ?? []).catch(() => undefined);
  }));

  disposables.push(monaco.languages.registerDocumentSemanticTokensProvider(selector, {
    getLegend() { return { tokenTypes: semanticTokenTypes, tokenModifiers: semanticTokenModifiers }; },
    async provideDocumentSemanticTokens(model) {
      const target = textDocumentPosition(model, { lineNumber: 1, column: 1 });
      const server = serverForPath(target.path);
      if (!server || server.semanticTokenTypes.length === 0 || semanticTokenTypes.length === 0) return { data: new Uint32Array() };
      const response = await requestLanguageFeature<any>("semanticTokensFull", target.path, 1, 1, undefined, model.getValue(), model.getVersionId()).catch(() => null);
      const data = Array.isArray(response?.data) ? response.data.filter((value: unknown): value is number => typeof value === "number") : [];
      return { data: remapSemanticData(data, server) };
    },
    releaseDocumentSemanticTokens() {},
  }));

  disposables.push(monaco.languages.registerCompletionItemProvider(selector, {
    triggerCharacters: [".", "\"", "'", "/", "@", "<"],
    async provideCompletionItems(model, position) {
      if (!supportsModel(model)) return { suggestions: [] };
      const target = textDocumentPosition(model, position);
      const response = await requestLanguageFeature<any>("completion", target.path, target.line, target.column, undefined, model.getValue(), model.getVersionId()).catch(() => null);
      const items = Array.isArray(response) ? response : response?.items;
      if (!Array.isArray(items)) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const defaultRange = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      return {
        suggestions: items.slice(0, 500).map((item: any) => ({
          label: typeof item.label === "string" ? item.label : String(item.label?.label ?? ""),
          kind: completionKind(item.kind),
          detail: item.detail,
          documentation: markdown(item.documentation)[0],
          insertText: typeof item.insertText === "string" ? item.insertText : typeof item.textEdit?.newText === "string" ? item.textEdit.newText : String(item.label ?? ""),
          insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          range: item.textEdit?.range ? toMonacoRange(item.textEdit.range) : defaultRange,
          sortText: item.sortText,
          filterText: item.filterText,
          preselect: Boolean(item.preselect),
        })),
      };
    },
  }));

  disposables.push(monaco.languages.registerHoverProvider(selector, {
    async provideHover(model, position) {
      if (!supportsModel(model)) return null;
      const target = textDocumentPosition(model, position);
      const response = await requestLanguageFeature<any>("hover", target.path, target.line, target.column, undefined, model.getValue(), model.getVersionId()).catch(() => null);
      if (!response) return null;
      const contents = markdown(response.contents);
      return contents.length ? { contents, range: response.range ? toMonacoRange(response.range) : undefined } : null;
    },
  }));

  disposables.push(monaco.languages.registerDefinitionProvider(selector, {
    async provideDefinition(model, position) {
      if (!supportsModel(model)) return [];
      const target = textDocumentPosition(model, position);
      const response = await requestLanguageFeature<any>("definition", target.path, target.line, target.column, undefined, model.getValue(), model.getVersionId()).catch(() => null);
      const locations = Array.isArray(response) ? response : response ? [response] : [];
      return locations.flatMap((entry: LspLocation | LspLocationLink) => {
        const uriText = "uri" in entry ? entry.uri : entry.targetUri;
        const range = "range" in entry ? entry.range : entry.targetSelectionRange ?? entry.targetRange;
        const uri = modelUriForServerUri(uriText, true);
        return uri ? [{ uri, range: toMonacoRange(range) }] : [];
      });
    },
  }));

  disposables.push(monaco.languages.registerReferenceProvider(selector, {
    async provideReferences(model, position) {
      if (!supportsModel(model)) return [];
      const target = textDocumentPosition(model, position);
      const response = await requestLanguageFeature<LspLocation[]>("references", target.path, target.line, target.column, undefined, model.getValue(), model.getVersionId()).catch(() => []);
      return (Array.isArray(response) ? response : []).flatMap((entry) => {
        const uri = modelUriForServerUri(entry.uri, true);
        return uri ? [{ uri, range: toMonacoRange(entry.range) }] : [];
      });
    },
  }));

  disposables.push(monaco.languages.registerRenameProvider(selector, {
    async provideRenameEdits(model, position, newName) {
      if (!supportsModel(model)) return { edits: [], rejectReason: "Language server is not running for this file" };
      const target = textDocumentPosition(model, position);
      const response = await requestLanguageFeature<LspWorkspaceEdit>("rename", target.path, target.line, target.column, newName, model.getValue(), model.getVersionId()).catch(() => null);
      if (!response) return { edits: [], rejectReason: "Language server did not return rename edits" };
      return toWorkspaceEdit(response);
    },
    resolveRenameLocation(model, position) {
      if (!supportsModel(model)) return null;
      const word = model.getWordAtPosition(position);
      return word ? { range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn), text: word.word } : null;
    },
  }));

  disposables.push(monaco.languages.registerCodeActionProvider(selector, {
    async provideCodeActions(model, range) {
      if (!supportsModel(model)) return { actions: [], dispose() {} };
      const target = textDocumentPosition(model, range.getStartPosition());
      const response = await requestLanguageFeature<any[]>("codeAction", target.path, target.line, target.column, undefined, model.getValue(), model.getVersionId()).catch(() => []);
      const actions = (Array.isArray(response) ? response : []).slice(0, 100).map((action: any) => ({
        title: String(action.title ?? "LSP action"),
        kind: action.kind,
        isPreferred: Boolean(action.isPreferred),
        edit: action.edit ? toWorkspaceEdit(action.edit) : undefined,
      })).filter((action: any) => action.edit?.edits?.length);
      return { actions, dispose() {} } as any;
    },
  }));

  disposables.push(monaco.languages.registerSignatureHelpProvider(selector, {
    signatureHelpTriggerCharacters: ["(", ","],
    async provideSignatureHelp(model, position) {
      if (!supportsModel(model)) return null;
      const target = textDocumentPosition(model, position);
      const response = await requestLanguageFeature<any>("signatureHelp", target.path, target.line, target.column, undefined, model.getValue(), model.getVersionId()).catch(() => null);
      if (!response?.signatures) return null;
      return {
        value: {
          activeParameter: response.activeParameter ?? 0,
          activeSignature: response.activeSignature ?? 0,
          signatures: response.signatures.map((signature: any) => ({
            label: signature.label,
            documentation: markdown(signature.documentation)[0],
            parameters: (signature.parameters ?? []).map((parameter: any) => ({ label: parameter.label, documentation: markdown(parameter.documentation)[0] })),
          })),
        },
        dispose() {},
      };
    },
  }));

  disposables.push(monaco.languages.registerInlayHintsProvider(selector, {
    async provideInlayHints(model) {
      const target = textDocumentPosition(model, { lineNumber: 1, column: 1 });
      const server = serverForPath(target.path);
      if (!server?.supportsInlayHints) return { hints: [], dispose() {} };
      const response = await requestLanguageFeature<LspInlayHint[]>("inlayHint", target.path, 1, 1, undefined, model.getValue(), model.getVersionId()).catch(() => []);
      const hints = (Array.isArray(response) ? response : []).slice(0, 2000).flatMap((hint) => {
        if (!hint.position) return [];
        const label = typeof hint.label === "string" ? hint.label : Array.isArray(hint.label) ? hint.label.map((part) => part.value ?? "").join("") : "";
        if (!label) return [];
        return [{
          label,
          position: { lineNumber: hint.position.line + 1, column: hint.position.character + 1 },
          kind: hint.kind === 2 ? monaco.languages.InlayHintKind.Parameter : monaco.languages.InlayHintKind.Type,
          tooltip: markdown(hint.tooltip)[0],
          paddingLeft: Boolean(hint.paddingLeft),
          paddingRight: Boolean(hint.paddingRight),
          textEdits: hint.textEdits?.map((edit) => ({ range: toMonacoRange(edit.range), text: edit.newText })),
        }];
      });
      return { hints, dispose() {} };
    },
  }));

  disposables.push(monaco.languages.registerDocumentFormattingEditProvider(selector, {
    async provideDocumentFormattingEdits(model) {
      const target = textDocumentPosition(model, { lineNumber: 1, column: 1 });
      const server = serverForPath(target.path);
      if (!server?.supportsFormatting) return [];
      const response = await requestLanguageFeature<LspTextEdit[]>("formatting", target.path, 1, 1, undefined, model.getValue(), model.getVersionId()).catch(() => []);
      return (Array.isArray(response) ? response : []).slice(0, 5000).map((edit) => ({ range: toMonacoRange(edit.range), text: edit.newText }));
    },
  }));

  disposables.push(monaco.languages.registerCodeLensProvider(selector, {
    async provideCodeLenses(model) {
      const target = textDocumentPosition(model, { lineNumber: 1, column: 1 });
      const server = serverForPath(target.path);
      if (!server?.supportsCodeLens) return { lenses: [], dispose() {} };
      const response = await requestLanguageFeature<LspCodeLens[]>("codeLens", target.path, 1, 1, undefined, model.getValue(), model.getVersionId()).catch(() => []);
      const lenses = (Array.isArray(response) ? response : []).slice(0, 1000).flatMap((lens) => {
        if (!lens.range) return [];
        const command = lens.command?.command && lens.command.title ? {
          id: "webforge.lsp.executeCommand",
          title: lens.command.title,
          arguments: [{ serverId: server.serverId, command: lens.command.command, arguments: lens.command.arguments ?? [] }],
        } : undefined;
        return [{ range: toMonacoRange(lens.range), command }];
      });
      return { lenses, dispose() {} } as any;
    },
  }));
}

export function configureExternalLsp(
  workspacePath: string,
  statuses: LanguageServerRuntimeStatus[] = [],
  sources: Record<string, string> = {},
  onBufferEdit?: (path: string, content: string, baseContent: string) => void,
) {
  if (activeWorkspace && activeWorkspace !== workspacePath) clearHiddenModels();
  activeWorkspace = workspacePath;
  serverStatuses = statuses;
  sourceContents = new Map(Object.entries(sources));
  applyBufferEdit = onBufferEdit ?? null;
  rebuildSemanticLegend();
  if (!disposables.length) install();
}

export function disposeExternalLsp() {
  for (const disposable of disposables) disposable.dispose();
  disposables = [];
  clearHiddenModels();
  activeWorkspace = "";
  serverStatuses = [];
  sourceContents.clear();
  applyBufferEdit = null;
  semanticTokenTypes = [];
  semanticTokenModifiers = [];
}
