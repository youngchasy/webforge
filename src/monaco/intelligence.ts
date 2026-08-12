import * as monaco from "monaco-editor";
import type { EditorDiagnostic, EditorDiagnosticSeverity } from "../types/diagnostics";
import type { ProjectLanguageSnapshot } from "../types/intelligence";

let configured = false;

export function configureMonacoIntelligence(): void {
  if (configured) return;
  configured = true;

  for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
    defaults.setEagerModelSync(true);
    defaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      noSuggestionDiagnostics: false,
      diagnosticCodesToIgnore: [2307, 2792, 2875],
    });
  }

  monaco.typescript.javascriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: true,
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.typescript.JsxEmit.ReactJSX,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
  });

  monaco.typescript.typescriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.typescript.JsxEmit.ReactJSX,
    allowJs: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
  });
}

function severity(value: monaco.MarkerSeverity): EditorDiagnosticSeverity {
  if (value === monaco.MarkerSeverity.Error) return "error";
  if (value === monaco.MarkerSeverity.Warning) return "warning";
  if (value === monaco.MarkerSeverity.Info) return "info";
  return "hint";
}

function pathFor(uri: monaco.Uri): string {
  return decodeURIComponent(uri.path).replace(/^\/+/, "");
}

export function collectMonacoDiagnostics(): EditorDiagnostic[] {
  return monaco.editor.getModelMarkers({}).map((marker, index) => ({
    id: `${marker.resource.toString()}:${marker.startLineNumber}:${marker.startColumn}:${marker.code ?? ""}:${index}`,
    path: pathFor(marker.resource),
    message: marker.message,
    severity: severity(marker.severity),
    line: marker.startLineNumber,
    column: marker.startColumn,
    endLine: marker.endLineNumber,
    endColumn: marker.endColumn,
    code: marker.code === undefined ? null : String(marker.code),
    owner: marker.owner ?? null,
  })).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);
}

let projectLibraryDisposables: monaco.IDisposable[] = [];

function projectUri(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  return monaco.Uri.from({ scheme: "file", path: `/${normalized}` }).toString();
}

export function clearProjectIntelligence(): void {
  for (const disposable of projectLibraryDisposables.splice(0)) disposable.dispose();
}

export function applyProjectLanguageSnapshot(snapshot: ProjectLanguageSnapshot): void {
  configureMonacoIntelligence();
  clearProjectIntelligence();
  for (const file of snapshot.files) {
    const uri = projectUri(file.relativePath);
    projectLibraryDisposables.push(monaco.typescript.typescriptDefaults.addExtraLib(file.content, uri));
    projectLibraryDisposables.push(monaco.typescript.javascriptDefaults.addExtraLib(file.content, uri));
  }
}
