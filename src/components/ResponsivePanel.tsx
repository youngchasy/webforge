import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { ResponsiveBreakpoint, ResponsiveBreakpointMode } from "../lib/responsive";

export type ResponsivePanelProps = {
  open: boolean;
  breakpoints: ResponsiveBreakpoint[];
  multiViewport: boolean;
  customWidth: number;
  onMultiViewportChange: (enabled: boolean) => void;
  onCustomWidthChange: (width: number) => void;
  onUseBreakpoint: (breakpoint: ResponsiveBreakpoint) => void;
  onUpdateBreakpoint: (breakpoint: ResponsiveBreakpoint, width: number) => void;
  onCreateBreakpoint: (width: number, mode: ResponsiveBreakpointMode) => void;
  onRevealBreakpoint: (breakpoint: ResponsiveBreakpoint) => void;
};

function clampWidth(value: number): number {
  return Math.max(240, Math.min(3840, Math.round(value || 0)));
}

function resolvedWidth(value: string | number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? clampWidth(parsed) : clampWidth(fallback);
}

export function ResponsivePanel({
  open, breakpoints, multiViewport, customWidth, onMultiViewportChange, onCustomWidthChange,
  onUseBreakpoint, onUpdateBreakpoint, onCreateBreakpoint, onRevealBreakpoint,
}: ResponsivePanelProps) {
  const { t } = useI18n();
  const [createWidth, setCreateWidth] = useState(768);
  const [createMode, setCreateMode] = useState<ResponsiveBreakpointMode>("max");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setDrafts(Object.fromEntries(breakpoints.filter((item) => item.width !== null).map((item) => [item.id, String(item.width)])));
  }, [breakpoints]);

  if (!open) return null;
  return (
    <div className="responsive-panel">
      <div className="responsive-panel-section responsive-overview">
        <div>
          <strong>{t("responsive.workspace")}</strong>
          <span>{t("responsive.description")}</span>
        </div>
        <label className="multi-toggle"><input type="checkbox" checked={multiViewport} onChange={(event) => onMultiViewportChange(event.target.checked)} /><span>{t("responsive.multi")}</span></label>
      </div>

      <div className="responsive-panel-section custom-viewport-row">
        <span>{t("responsive.customViewport")}</span>
        <input type="number" min={240} max={3840} value={customWidth} onChange={(event) => onCustomWidthChange(clampWidth(Number(event.target.value)))} />
        <span>px</span>
      </div>


      <div className="responsive-ruler" aria-label={t("responsive.rulerAria")}>
        <div className="ruler-head"><strong>{t("responsive.viewportRuler")}</strong><span>{customWidth}px</span></div>
        <div className="ruler-track-wrap">
          <div className="ruler-track">
            {[320, 480, 768, 1024, 1280, 1440, 1920].map((width) => <span key={width} className="ruler-tick" style={{ left: `${((width - 240) / (1920 - 240)) * 100}%` }}><i />{width}</span>)}
            {breakpoints.filter((item) => item.width !== null && item.width! >= 240 && item.width! <= 1920).map((item) => <button key={item.id} className={`ruler-breakpoint-marker ${item.mode}`} style={{ left: `${((item.width! - 240) / (1920 - 240)) * 100}%` }} title={`@media ${item.condition}`} onClick={() => onUseBreakpoint(item)} />)}
          </div>
          <input className="viewport-range" type="range" min={240} max={1920} step={1} value={Math.min(1920, Math.max(240, customWidth))} onChange={(event) => onCustomWidthChange(Number(event.target.value))} />
        </div>
        <small>{t("responsive.rulerHelp")}</small>
      </div>

      <div className="breakpoint-list">
        {breakpoints.length ? breakpoints.map((breakpoint) => (
          <div className="breakpoint-row" key={breakpoint.id}>
            <button className="breakpoint-condition" onClick={() => onUseBreakpoint(breakpoint)} title={t("responsive.previewBreakpoint")}>
              <code>@media {breakpoint.condition}</code>
              <small>{breakpoint.path}:{breakpoint.line}</small>
            </button>
            {breakpoint.editable && breakpoint.width !== null ? (
              <div className="breakpoint-width-editor">
                <span>{breakpoint.mode}</span>
                <input
                  value={drafts[breakpoint.id] ?? String(breakpoint.width)}
                  inputMode="numeric"
                  onChange={(event) => setDrafts((current) => ({ ...current, [breakpoint.id]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    const width = resolvedWidth(drafts[breakpoint.id] ?? breakpoint.width, breakpoint.width ?? 240);
                    setDrafts((current) => ({ ...current, [breakpoint.id]: String(width) }));
                    onUpdateBreakpoint(breakpoint, width);
                  }}
                  onBlur={() => {
                    const width = resolvedWidth(drafts[breakpoint.id] ?? breakpoint.width, breakpoint.width ?? 240);
                    setDrafts((current) => ({ ...current, [breakpoint.id]: String(width) }));
                    onUpdateBreakpoint(breakpoint, width);
                  }}
                />
                <span>px</span>
              </div>
            ) : <span className="complex-breakpoint">{t("responsive.complex")}</span>}
            <button className="breakpoint-source" onClick={() => onRevealBreakpoint(breakpoint)} title={t("responsive.openSource")}>↗</button>
          </div>
        )) : <div className="breakpoint-empty">{t("responsive.none")}</div>}
      </div>

      <div className="responsive-panel-section create-breakpoint-row">
        <strong>{t("responsive.newBreakpoint")}</strong>
        <select value={createMode} onChange={(event) => setCreateMode(event.target.value as ResponsiveBreakpointMode)}><option value="max">max-width</option><option value="min">min-width</option></select>
        <input type="number" min={240} max={3840} value={createWidth} onChange={(event) => setCreateWidth(clampWidth(Number(event.target.value)))} />
        <span>px</span>
        <button onClick={() => onCreateBreakpoint(clampWidth(createWidth), createMode)}>+ {t("common.add")}</button>
      </div>
    </div>
  );
}
