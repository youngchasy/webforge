import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { ResponsivePanel } from "./ResponsivePanel";
import type { ResponsiveBreakpoint, ResponsiveBreakpointMode } from "../lib/responsive";
import type { CssAncestorTrace, CssAtRuleContext, CssPseudoState, CssRuleMatch, DomTreeNode, InspectorSelection, InspectorSourceConfidence, PreviewConsoleEntry, PreviewConsoleLevel } from "../types/designer";
import { calculateSpecificity } from "../lib/specificity";
import type { DevToolsNetworkEntry, DevToolsPerformanceSnapshot, DevToolsStorageSnapshot, PreviewDevToolsCommand, RuntimeAccessibilitySnapshot } from "../types/devtools";

export type PreviewPreset = "desktop" | "tablet" | "mobile" | "custom";

export type PreviewStyleCommand = {
  sourceId: string;
  selector: string;
  property: string;
  value: string;
  token: number;
};

export type PreviewStyleCommit = {
  sourceId: string;
  selector: string;
  declarations: Record<string, string>;
};

type Props = {
  html: string;
  baseUrl?: string;
  entryPath?: string;
  revision: number;
  preset: PreviewPreset;
  onPresetChange: (preset: PreviewPreset) => void;
  customWidth: number;
  onCustomWidthChange: (width: number) => void;
  multiViewport: boolean;
  onMultiViewportChange: (enabled: boolean) => void;
  breakpoints: ResponsiveBreakpoint[];
  onUpdateBreakpoint: (breakpoint: ResponsiveBreakpoint, width: number) => void;
  onCreateBreakpoint: (width: number, mode: ResponsiveBreakpointMode) => void;
  onRevealBreakpoint: (breakpoint: ResponsiveBreakpoint) => void;
  workspacePath?: string;
  runtimeUrl?: string | null;
  runtimeRunning?: boolean;
  runtimeReady?: boolean;
  requiresRuntime?: boolean;
  runtimeSupported?: boolean;
  onStartRuntime?: () => void;
  unsavedRuntimeChanges?: boolean;
  productionUrl?: string | null;
  productionActive?: boolean;
  productionOutputDir?: string | null;
  onUseSourcePreview?: () => void;
  onUseProductionPreview?: () => void;
  inspectorEnabled: boolean;
  onInspectorEnabledChange: (enabled: boolean) => void;
  onInspectSelection: (selection: InspectorSelection) => void;
  onDomTree: (tree: DomTreeNode | null) => void;
  onConsoleEntry: (entry: Omit<PreviewConsoleEntry, "id" | "timestamp">) => void;
  onDesignerStyleCommit?: (commit: PreviewStyleCommit) => void;
  styleCommand?: PreviewStyleCommand | null;
  selectedSourceId?: string | null;
  selectedSelector?: string | null;
  devToolsCommand?: PreviewDevToolsCommand | null;
  onDevToolsReady?: (ready: boolean) => void;
  onDevToolsNetwork?: (entry: DevToolsNetworkEntry) => void;
  onDevToolsStorage?: (snapshot: DevToolsStorageSnapshot) => void;
  onDevToolsPerformance?: (snapshot: DevToolsPerformanceSnapshot) => void;
  onDevToolsAccessibility?: (snapshot: RuntimeAccessibilitySnapshot) => void;
};

type FrameSpec = {
  id: string;
  label: string;
  width: number | "100%";
};

const widths: Record<Exclude<PreviewPreset, "custom">, number | "100%"> = {
  desktop: "100%",
  tablet: 768,
  mobile: 390,
};



function previewUrl(baseUrl: string, path: string): string {
  const encoded = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return encoded ? `${baseUrl}/${encoded}` : `${baseUrl}/`;
}

function sourcePathFromUrl(source: unknown, staticBaseUrl?: string, workspacePath?: string): string | null {
  if (typeof source !== "string" || !source) return null;
  const normalizedWorkspace = workspacePath?.replace(/\\/g, "/").replace(/\/$/, "") ?? "";
  const normalizeCandidate = (candidate: string): string | null => {
    let value = decodeURIComponent(candidate).replace(/\\/g, "/");
    if (value.startsWith("/@fs/")) value = value.slice(5);
    if (normalizedWorkspace) {
      const lower = value.toLowerCase();
      const rootLower = normalizedWorkspace.toLowerCase();
      const index = lower.indexOf(rootLower);
      if (index >= 0) value = value.slice(index + normalizedWorkspace.length);
    }
    value = value.replace(/^\/+/, "");
    return value || null;
  };
  if (/^[A-Za-z]:[\\/]/.test(source)) return normalizeCandidate(source);
  try {
    const url = new URL(source);
    if (staticBaseUrl) {
      const expected = new URL(staticBaseUrl);
      if (url.origin !== expected.origin && !url.pathname.startsWith("/@fs/")) return normalizeCandidate(url.pathname);
    }
    return normalizeCandidate(url.pathname) ?? "index.html";
  } catch {
    return normalizeCandidate(source.split(/[?#]/, 1)[0]);
  }
}

function parsePseudo(value: unknown): CssPseudoState {
  return (["normal", "hover", "focus", "active", "focus-visible"] as const).includes(value as CssPseudoState)
    ? value as CssPseudoState
    : "normal";
}

function parseContexts(value: unknown): CssAtRuleContext[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.name !== "string") return [];
    return [{ name: item.name, prelude: typeof item.prelude === "string" ? item.prelude : "" }];
  });
}

function parseCssRules(value: unknown, baseUrl?: string, workspacePath?: string): CssRuleMatch[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.selector !== "string") return [];
    return [{
      selector: item.selector,
      sourcePath: sourcePathFromUrl(item.source, baseUrl, workspacePath),
      media: typeof item.media === "string" ? item.media : null,
      pseudo: parsePseudo(item.pseudo),
      declarations: item.declarations && typeof item.declarations === "object" ? item.declarations as Record<string, string> : {},
      contexts: parseContexts(item.contexts),
      sourceLine: null,
      sourceStart: null,
      sourceEnd: null,
      sourceOrder: typeof item.sourceOrder === "number" ? item.sourceOrder : 0,
      importantDeclarations: Array.isArray(item.importantDeclarations) ? item.importantDeclarations.filter((entry): entry is string => typeof entry === "string") : [],
      specificity: calculateSpecificity(item.selector),
    }];
  });
}


function parseSourceConfidence(value: unknown): InspectorSourceConfidence {
  return (["exact", "component", "hint", "runtime"] as const).includes(value as InspectorSourceConfidence)
    ? value as InspectorSourceConfidence
    : "runtime";
}

function parseAncestors(value: unknown, baseUrl?: string, workspacePath?: string): CssAncestorTrace[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.selector !== "string" || typeof item.tagName !== "string") return [];
    return [{
      selector: item.selector,
      tagName: item.tagName,
      id: typeof item.id === "string" ? item.id : "",
      sourcePath: sourcePathFromUrl(item.sourcePath, baseUrl, workspacePath),
      sourceLine: typeof item.sourceLine === "number" ? item.sourceLine : null,
      sourceColumn: typeof item.sourceColumn === "number" ? item.sourceColumn : null,
      sourceConfidence: parseSourceConfidence(item.sourceConfidence),
      styles: item.styles && typeof item.styles === "object" ? item.styles as Record<string, string> : {},
      inlineStyles: item.inlineStyles && typeof item.inlineStyles === "object" ? item.inlineStyles as Record<string, string> : {},
      cssRules: parseCssRules(item.cssRules, baseUrl, workspacePath),
    }];
  });
}
function parseDomTree(value: unknown, baseUrl?: string, workspacePath?: string): DomTreeNode | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.sourceId !== "string" || typeof item.selector !== "string" || typeof item.tagName !== "string") return null;
  return {
    sourceId: item.sourceId,
    selector: item.selector,
    tagName: item.tagName,
    id: typeof item.id === "string" ? item.id : "",
    classes: Array.isArray(item.classes) ? item.classes.filter((entry): entry is string => typeof entry === "string") : [],
    text: typeof item.text === "string" ? item.text : "",
    children: Array.isArray(item.children) ? item.children.map((child) => parseDomTree(child, baseUrl, workspacePath)).filter((entry): entry is DomTreeNode => Boolean(entry)) : [],
    sourcePath: sourcePathFromUrl(item.sourcePath, baseUrl, workspacePath),
    sourceLine: typeof item.sourceLine === "number" ? item.sourceLine : null,
    sourceColumn: typeof item.sourceColumn === "number" ? item.sourceColumn : null,
  };
}

function clampWidth(value: number): number {
  return Math.max(240, Math.min(3840, Math.round(value || 0)));
}

export function PreviewPane({
  html, baseUrl, entryPath, revision, preset, onPresetChange, customWidth, onCustomWidthChange,
  multiViewport, onMultiViewportChange, breakpoints, onUpdateBreakpoint, onCreateBreakpoint, onRevealBreakpoint,
  workspacePath, runtimeUrl, runtimeRunning = false, runtimeReady = false, requiresRuntime = false, runtimeSupported = true,
  onStartRuntime, unsavedRuntimeChanges = false, productionUrl, productionActive = false, productionOutputDir, onUseSourcePreview, onUseProductionPreview, inspectorEnabled, onInspectorEnabledChange, onInspectSelection,
  onDomTree, onConsoleEntry, onDesignerStyleCommit, styleCommand, selectedSourceId, selectedSelector,
  devToolsCommand, onDevToolsReady, onDevToolsNetwork, onDevToolsStorage, onDevToolsPerformance, onDevToolsAccessibility,
}: Props) {
  const { t } = useI18n();
  const [manualReload, setManualReload] = useState(0);
  const [responsiveOpen, setResponsiveOpen] = useState(false);
  const [readyFrames, setReadyFrames] = useState<Record<string, boolean>>({});
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const staticUrl = baseUrl && entryPath ? previewUrl(baseUrl, entryPath) : "";
  const activeUrl = productionActive && productionUrl ? productionUrl : runtimeReady && runtimeUrl ? runtimeUrl : staticUrl;
  const waitingForRuntime = !productionActive && runtimeRunning && !runtimeReady;
  const runtimeRequiredButStopped = !productionActive && requiresRuntime && !runtimeRunning;
  const singleWidth = preset === "custom" ? clampWidth(customWidth) : widths[preset];
  const singleLabel = typeof singleWidth === "number" ? `${singleWidth}px` : t("preview.responsive");
  const presetLabel = preset === "desktop" ? t("preview.desktop") : preset === "tablet" ? t("preview.tablet") : preset === "mobile" ? t("preview.mobile") : t("preview.responsive");
  const frames = useMemo<FrameSpec[]>(() => multiViewport
    ? [
        { id: "desktop", label: `${t("preview.desktop")} · 1200px`, width: 1200 },
        { id: "tablet", label: `${t("preview.tablet")} · 768px`, width: 768 },
        { id: "mobile", label: `${t("preview.mobile")} · 390px`, width: 390 },
      ]
    : [{ id: "single", label: `${presetLabel} · ${singleLabel}`, width: singleWidth }],
  [multiViewport, presetLabel, singleLabel, singleWidth, t]);
  const primaryFrameId = frames[0]?.id ?? "single";
  const bridgeReady = Boolean(readyFrames[primaryFrameId]);
  const inspectorSupported = Boolean(activeUrl) && bridgeReady && !multiViewport;

  useEffect(() => { setReadyFrames({}); onDevToolsReady?.(false); }, [activeUrl, manualReload, revision, multiViewport, onDevToolsReady]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const sourceFrame = Object.entries(iframeRefs.current).find(([, iframe]) => event.source === iframe?.contentWindow)?.[0];
      if (!sourceFrame) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.__webforge !== true) return;
      if (data.kind === "bridge-ready") {
        setReadyFrames((current) => ({ ...current, [sourceFrame]: true }));
        if (sourceFrame === primaryFrameId) onDevToolsReady?.(true);
        return;
      }
      if (data.kind === "devtools-network" && sourceFrame === primaryFrameId && data.entry && typeof data.entry === "object") { onDevToolsNetwork?.(data.entry as DevToolsNetworkEntry); return; }
      if (data.kind === "devtools-storage" && sourceFrame === primaryFrameId && data.snapshot && typeof data.snapshot === "object") { onDevToolsStorage?.(data.snapshot as DevToolsStorageSnapshot); return; }
      if (data.kind === "devtools-performance" && sourceFrame === primaryFrameId && data.snapshot && typeof data.snapshot === "object") { onDevToolsPerformance?.(data.snapshot as DevToolsPerformanceSnapshot); return; }
      if (data.kind === "devtools-accessibility" && sourceFrame === primaryFrameId && data.snapshot && typeof data.snapshot === "object") { onDevToolsAccessibility?.(data.snapshot as RuntimeAccessibilitySnapshot); return; }
      if (data.kind === "viewport-scroll" && multiViewport) {
        const xRatio = typeof data.xRatio === "number" ? data.xRatio : 0;
        const yRatio = typeof data.yRatio === "number" ? data.yRatio : 0;
        for (const [id, iframe] of Object.entries(iframeRefs.current)) {
          if (id !== sourceFrame) iframe?.contentWindow?.postMessage({ __webforge: true, action: "syncScroll", xRatio, yRatio }, "*");
        }
        return;
      }
      if (multiViewport && sourceFrame !== primaryFrameId) return;
      if (data.kind === "dom-tree") { onDomTree(parseDomTree(data.tree, runtimeReady && runtimeUrl ? runtimeUrl : baseUrl, workspacePath)); return; }
      if (data.kind === "console") {
        const level = (["log", "info", "warn", "error", "debug"] as const).includes(data.level as PreviewConsoleLevel)
          ? data.level as PreviewConsoleLevel
          : "log";
        onConsoleEntry({
          level,
          text: typeof data.text === "string" ? data.text : String(data.text ?? ""),
          sourcePath: sourcePathFromUrl(data.source, runtimeReady && runtimeUrl ? runtimeUrl : baseUrl, workspacePath),
          line: typeof data.line === "number" ? data.line : null,
          column: typeof data.column === "number" ? data.column : null,
        });
        return;
      }
      if (data.kind === "designer-style-commit" && typeof data.sourceId === "string" && typeof data.selector === "string" && data.declarations && typeof data.declarations === "object") {
        const declarations = Object.fromEntries(Object.entries(data.declarations as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
        if (Object.keys(declarations).length) onDesignerStyleCommit?.({ sourceId: data.sourceId, selector: data.selector, declarations });
        return;
      }
      if (data.kind === "inspect" && typeof data.sourceId === "string" && typeof data.selector === "string" && typeof data.tagName === "string") {
        onInspectSelection({
          sourceId: data.sourceId,
          selector: data.selector,
          tagName: data.tagName,
          id: typeof data.id === "string" ? data.id : "",
          classes: Array.isArray(data.classes) ? data.classes.filter((item): item is string => typeof item === "string") : [],
          attributes: data.attributes && typeof data.attributes === "object" ? data.attributes as Record<string, string> : {},
          text: typeof data.text === "string" ? data.text : "",
          rect: (data.rect ?? { x: 0, y: 0, width: 0, height: 0 }) as InspectorSelection["rect"],
          styles: (data.styles ?? {}) as Record<string, string>,
          inlineStyles: data.inlineStyles && typeof data.inlineStyles === "object" ? data.inlineStyles as Record<string, string> : {},
          cssRules: parseCssRules(data.cssRules, runtimeReady && runtimeUrl ? runtimeUrl : baseUrl, workspacePath),
          sourcePath: typeof data.sourcePath === "string" ? sourcePathFromUrl(data.sourcePath, runtimeReady && runtimeUrl ? runtimeUrl : undefined, workspacePath) : null,
          sourceLine: typeof data.sourceLine === "number" ? data.sourceLine : null,
          sourceColumn: typeof data.sourceColumn === "number" ? data.sourceColumn : null,
          sourceKind: data.sourceKind === "framework" ? "framework" : data.sourceKind === "runtime" ? "runtime" : "static",
          sourceConfidence: parseSourceConfidence(data.sourceConfidence),
          sourceOrigin: typeof data.sourceOrigin === "string" ? data.sourceOrigin : null,
          ancestors: parseAncestors(data.ancestors, runtimeReady && runtimeUrl ? runtimeUrl : baseUrl, workspacePath),
          editableSource: data.editableSource === true,
        });
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [baseUrl, multiViewport, onConsoleEntry, onDesignerStyleCommit, onDevToolsAccessibility, onDevToolsNetwork, onDevToolsPerformance, onDevToolsReady, onDevToolsStorage, onDomTree, onInspectSelection, primaryFrameId, runtimeReady, runtimeUrl, workspacePath]);

  useEffect(() => {
    if (!bridgeReady || !devToolsCommand) return;
    const action = devToolsCommand.action === "refresh" ? "requestDevtools" : devToolsCommand.action;
    iframeRefs.current[primaryFrameId]?.contentWindow?.postMessage({ __webforge: true, action }, "*");
  }, [bridgeReady, devToolsCommand?.token, devToolsCommand?.action, primaryFrameId]);

  useEffect(() => {
    if (!inspectorSupported && inspectorEnabled) onInspectorEnabledChange(false);
  }, [inspectorEnabled, inspectorSupported, onInspectorEnabledChange]);

  useEffect(() => {
    if (!bridgeReady || !inspectorSupported) return;
    const target = iframeRefs.current[primaryFrameId]?.contentWindow;
    target?.postMessage({ __webforge: true, action: "setInspector", enabled: inspectorEnabled }, "*");
    target?.postMessage({ __webforge: true, action: "requestTree" }, "*");
    if (selectedSourceId || selectedSelector) target?.postMessage({ __webforge: true, action: "select", sourceId: selectedSourceId, selector: selectedSelector }, "*");
  }, [bridgeReady, inspectorEnabled, inspectorSupported, primaryFrameId, selectedSelector, selectedSourceId]);

  useEffect(() => {
    if (!bridgeReady || !styleCommand || !inspectorSupported) return;
    iframeRefs.current[primaryFrameId]?.contentWindow?.postMessage({
      __webforge: true,
      action: "applyStyle",
      sourceId: styleCommand.sourceId,
      selector: styleCommand.selector,
      property: styleCommand.property,
      value: styleCommand.value,
    }, "*");
  }, [bridgeReady, inspectorSupported, primaryFrameId, styleCommand]);

  const useBreakpoint = (breakpoint: ResponsiveBreakpoint) => {
    if (breakpoint.width === null) return;
    onCustomWidthChange(clampWidth(breakpoint.width));
    onPresetChange("custom");
    if (multiViewport) onMultiViewportChange(false);
  };

  const renderFrame = (frame: FrameSpec) => (
    <div className={`viewport-card ${multiViewport ? "multi" : "single"}`} key={frame.id} style={{ width: frame.width }}>
      <div className="browser-frame" style={{ width: frame.width }}>
        <div className="browser-chrome">
          <span className="browser-dot" /><span className="browser-dot" /><span className="browser-dot" />
          <span className="viewport-card-label">{frame.label}</span>
          <div className="address-bar" title={activeUrl || "webforge://preview"}>{productionActive && productionUrl ? productionUrl : runtimeReady && runtimeUrl ? runtimeUrl : activeUrl || "webforge://preview"}</div>
          {productionActive ? <span className="bridge-badge dist">DIST</span> : readyFrames[frame.id] && <span className="bridge-badge">{runtimeReady ? t("preview.viteBridge") : t("preview.sourceBridge")}</span>}
        </div>
        {waitingForRuntime ? (
          <div className="preview-runtime-state"><div className="preview-spinner" /><strong>{t("preview.startingVite")}</strong><span>{t("preview.waitingVite")}</span></div>
        ) : runtimeRequiredButStopped ? (
          <div className="preview-runtime-state">
            <div className="preview-runtime-mark">V</div><strong>{t("preview.needsVite")}</strong>
            <span>{runtimeSupported ? t("preview.startTrusted") : t("preview.unsupportedScript")}</span>
            {runtimeSupported && onStartRuntime && <button className="primary-button" onClick={onStartRuntime}>{t("preview.startDev")}</button>}
          </div>
        ) : activeUrl ? (
          <iframe ref={(node) => { iframeRefs.current[frame.id] = node; }} key={`server-${frame.id}-${revision}-${manualReload}-${activeUrl}`} title={t("preview.liveTitle", { label: frame.label })} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups" src={activeUrl} />
        ) : (
          <iframe ref={(node) => { iframeRefs.current[frame.id] = node; }} key={`srcdoc-${frame.id}-${revision}-${manualReload}`} title={t("preview.liveTitle", { label: frame.label })} sandbox="allow-scripts allow-forms allow-modals allow-popups" srcDoc={html} />
        )}
      </div>
    </div>
  );

  return (
    <section className="preview-pane panel-surface">
      <div className="preview-toolbar">
        <div className="preview-title"><span className={`live-dot ${runtimeReady ? "runtime" : ""}`} /> {t("preview.live")}</div>
        {productionUrl && (
          <div className="preview-mode-switch">
            <button className={!productionActive ? "active" : ""} onClick={onUseSourcePreview}>{t("common.source")}</button>
            <button className={productionActive ? "active" : ""} onClick={onUseProductionPreview} title={productionOutputDir ? `${t("preview.builtOutput")}: ${productionOutputDir}/` : t("preview.builtOutput")}>{t("common.dist")}</button>
          </div>
        )}
        <button
          className={inspectorEnabled ? "inspect-toggle active" : "inspect-toggle"}
          disabled={!inspectorSupported}
          onClick={() => onInspectorEnabledChange(!inspectorEnabled)}
          title={inspectorSupported ? (runtimeReady ? t("preview.inspectFramework") : t("preview.designStatic")) : multiViewport ? t("preview.disableMultiInspector") : t("preview.waitBridge")}
        >{runtimeReady ? t("preview.inspect") : t("preview.design")}</button>
        <button className={responsiveOpen ? "responsive-toggle active" : "responsive-toggle"} onClick={() => setResponsiveOpen((value) => !value)} title={t("preview.responsiveEditor")}>↔ {t("preview.responsive")}</button>
        <div className="device-switcher">
          <button className={!multiViewport && preset === "desktop" ? "active" : ""} onClick={() => { onMultiViewportChange(false); onPresetChange("desktop"); }} title={t("preview.desktop")}>▰</button>
          <button className={!multiViewport && preset === "tablet" ? "active" : ""} onClick={() => { onMultiViewportChange(false); onPresetChange("tablet"); }} title={t("preview.tablet")}>▯</button>
          <button className={!multiViewport && preset === "mobile" ? "active" : ""} onClick={() => { onMultiViewportChange(false); onPresetChange("mobile"); }} title={t("preview.mobile")}>▯</button>
          <button className={multiViewport ? "active" : ""} onClick={() => onMultiViewportChange(!multiViewport)} title={t("preview.multi")}>▰▯▯</button>
        </div>
        <span className="viewport-label">{multiViewport ? t("preview.viewports3") : singleLabel}</span>
        {unsavedRuntimeChanges && <span className="runtime-save-hint" title={t("preview.viteDisk")}>{t("preview.saveVite")}</span>}
        <button className="preview-reload" onClick={() => setManualReload((value) => value + 1)} title={t("preview.reload")}>↻</button>
      </div>

      <ResponsivePanel
        open={responsiveOpen}
        breakpoints={breakpoints}
        multiViewport={multiViewport}
        customWidth={customWidth}
        onMultiViewportChange={onMultiViewportChange}
        onCustomWidthChange={(width) => { onMultiViewportChange(false); onCustomWidthChange(clampWidth(width)); onPresetChange("custom"); }}
        onUseBreakpoint={useBreakpoint}
        onUpdateBreakpoint={onUpdateBreakpoint}
        onCreateBreakpoint={onCreateBreakpoint}
        onRevealBreakpoint={onRevealBreakpoint}
      />

      <div className={`preview-canvas ${multiViewport ? "multi-preview-canvas" : ""}`}>
        <div className={multiViewport ? "multi-viewport-strip" : "single-viewport-stage"}>
          {frames.map(renderFrame)}
        </div>
      </div>
    </section>
  );
}
