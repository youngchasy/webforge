import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { detectCssUtilityFrameworks, toggleUtilityClass, utilityToggles } from "../lib/cssFrameworks";
import type { InspectorSelection } from "../types/designer";

type Props = {
  selection: InspectorSelection;
  sourceEditable: boolean;
  projectCssFrameworks: string[];
  onApply: (property: string, value: string) => void;
  onSetClasses: (classes: string[]) => void;
  onCreateAnimationPreset: (preset: "fade" | "slide" | "pulse") => void;
  onCreateContainerQuery: (mode: "min" | "max", width: number, property: string, value: string) => void;
};

type Field = readonly [property: string, label: string, kind?: "text" | "select", options?: readonly string[]];

const layoutFields: Field[] = [
  ["display", "display", "select", ["block", "inline-block", "flex", "grid", "none"]],
  ["flex-direction", "flex direction", "select", ["row", "row-reverse", "column", "column-reverse"]],
  ["flex-wrap", "flex wrap", "select", ["nowrap", "wrap", "wrap-reverse"]],
  ["justify-content", "justify", "select", ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"]],
  ["align-items", "align items", "select", ["stretch", "flex-start", "center", "flex-end", "baseline"]],
  ["align-content", "align content", "select", ["normal", "stretch", "center", "space-between", "space-around"]],
  ["gap", "gap"], ["row-gap", "row gap"], ["column-gap", "column gap"],
  ["grid-template-columns", "grid columns"], ["grid-template-rows", "grid rows"],
  ["grid-auto-flow", "grid auto flow", "select", ["row", "column", "dense", "row dense", "column dense"]],
  ["place-items", "place items"],
];

const typographyFields: Field[] = [
  ["font-family", "font family"], ["font-size", "font size"], ["font-weight", "font weight"],
  ["line-height", "line height"], ["letter-spacing", "letter spacing"],
  ["text-align", "text align", "select", ["left", "center", "right", "justify"]],
  ["text-transform", "transform", "select", ["none", "uppercase", "lowercase", "capitalize"]],
  ["text-decoration", "decoration"],
];

const effectFields: Field[] = [
  ["background", "background"], ["background-image", "background image"], ["box-shadow", "box shadow"],
  ["text-shadow", "text shadow"], ["border", "border"], ["border-radius", "radius"], ["opacity", "opacity"],
];

const transformFields: Field[] = [
  ["transform", "transform"], ["transform-origin", "origin"], ["z-index", "z-index"],
  ["overflow", "overflow", "select", ["visible", "hidden", "clip", "auto", "scroll"]],
];

const motionFields: Field[] = [
  ["transition-property", "transition property"], ["transition-duration", "duration"],
  ["transition-timing-function", "timing"], ["transition-delay", "delay"],
  ["animation-name", "animation name"], ["animation-duration", "animation duration"],
  ["animation-timing-function", "animation timing"], ["animation-delay", "animation delay"],
  ["animation-iteration-count", "iterations"], ["animation-fill-mode", "fill mode"],
];

const containerFields: Field[] = [
  ["container-type", "container type", "select", ["normal", "inline-size", "size"]],
  ["container-name", "container name"],
];

function styleKey(property: string): string {
  return property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function FieldGrid({ fields, selection, disabled, onApply }: { fields: Field[]; selection: InspectorSelection; disabled: boolean; onApply: Props["onApply"] }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => { setDrafts({}); }, [selection.sourceId]);
  const valueFor = (property: string) => drafts[property] ?? selection.styles[styleKey(property)] ?? "";
  return <div className="visual-field-grid">{fields.map(([property, label, kind, options]) => <label key={property}><span>{label}</span>{kind === "select" ? <select disabled={disabled} value={valueFor(property)} onChange={(event) => { const value = event.target.value; setDrafts((current) => ({ ...current, [property]: value })); onApply(property, value); }}><option value="">—</option>{options?.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input disabled={disabled} value={valueFor(property)} onChange={(event) => setDrafts((current) => ({ ...current, [property]: event.target.value }))} onBlur={() => onApply(property, valueFor(property))} onKeyDown={(event) => { if (event.key === "Enter") onApply(property, valueFor(property)); }} />}</label>)}</div>;
}

export function VisualStyleControls({ selection, sourceEditable, projectCssFrameworks, onApply, onSetClasses, onCreateAnimationPreset, onCreateContainerQuery }: Props) {
  const { t } = useI18n();
  const frameworks = useMemo(() => detectCssUtilityFrameworks(projectCssFrameworks, selection.classes), [projectCssFrameworks, selection.classes]);
  const [containerWidth, setContainerWidth] = useState(480);
  const [containerMode, setContainerMode] = useState<"min" | "max">("min");
  const [containerProperty, setContainerProperty] = useState("display");
  const [containerValue, setContainerValue] = useState("block");
  const [motionDuration, setMotionDuration] = useState(450);
  const [motionDelay, setMotionDelay] = useState(0);
  useEffect(() => {
    const parseTime = (value: string | undefined, fallback: number) => {
      const raw = value?.split(",", 1)[0]?.trim() ?? "";
      if (raw.endsWith("ms")) return Math.max(0, Number.parseFloat(raw) || fallback);
      if (raw.endsWith("s")) return Math.max(0, (Number.parseFloat(raw) || 0) * 1000);
      return fallback;
    };
    setMotionDuration(parseTime(selection.styles.animationDuration || selection.styles.transitionDuration, 450));
    setMotionDelay(parseTime(selection.styles.animationDelay || selection.styles.transitionDelay, 0));
  }, [selection.sourceId, selection.styles.animationDelay, selection.styles.animationDuration, selection.styles.transitionDelay, selection.styles.transitionDuration]);

  return <>
    <div className="inspector-section visual-designer-section"><h4>{t("designer.layout")}</h4><FieldGrid fields={layoutFields} selection={selection} disabled={!sourceEditable} onApply={onApply} /></div>
    <div className="inspector-section visual-designer-section"><h4>{t("designer.typography")}</h4><FieldGrid fields={typographyFields} selection={selection} disabled={!sourceEditable} onApply={onApply} /></div>
    <div className="inspector-section visual-designer-section">
      <h4>{t("designer.effects")}</h4><FieldGrid fields={effectFields} selection={selection} disabled={!sourceEditable} onApply={onApply} />
      <div className="designer-preset-row"><button disabled={!sourceEditable} onClick={() => onApply("background-image", "linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)")}>blue gradient</button><button disabled={!sourceEditable} onClick={() => onApply("background-image", "linear-gradient(135deg, #f97316 0%, #ec4899 100%)")}>warm gradient</button><button disabled={!sourceEditable} onClick={() => onApply("box-shadow", "0 18px 45px rgba(0, 0, 0, .24)")}>soft shadow</button></div>
    </div>
    <div className="inspector-section visual-designer-section"><h4>{t("designer.transform")}</h4><FieldGrid fields={transformFields} selection={selection} disabled={!sourceEditable} onApply={onApply} /><div className="designer-preset-row"><button disabled={!sourceEditable} onClick={() => onApply("transform", "translateY(-4px)")}>lift</button><button disabled={!sourceEditable} onClick={() => onApply("transform", "scale(1.05)")}>scale</button><button disabled={!sourceEditable} onClick={() => onApply("transform", "rotate(3deg)")}>rotate</button></div></div>
    <div className="inspector-section visual-designer-section"><h4>{t("designer.motion")}</h4><FieldGrid fields={motionFields} selection={selection} disabled={!sourceEditable} onApply={onApply} /><div className="motion-timeline"><div className="motion-track"><span style={{ marginLeft: `${Math.min(80, motionDelay / 25)}%`, width: `${Math.max(8, Math.min(100, motionDuration / 25))}%` }} /></div><label><span>duration {Math.round(motionDuration)}ms</span><input disabled={!sourceEditable} type="range" min={50} max={2500} step={50} value={motionDuration} onChange={(event) => setMotionDuration(Number(event.target.value))} onPointerUp={() => onApply("animation-duration", `${motionDuration}ms`)} onBlur={() => onApply("animation-duration", `${motionDuration}ms`)} /></label><label><span>delay {Math.round(motionDelay)}ms</span><input disabled={!sourceEditable} type="range" min={0} max={2000} step={50} value={motionDelay} onChange={(event) => setMotionDelay(Number(event.target.value))} onPointerUp={() => onApply("animation-delay", `${motionDelay}ms`)} onBlur={() => onApply("animation-delay", `${motionDelay}ms`)} /></label></div><div className="designer-preset-row"><button disabled={!sourceEditable} onClick={() => onCreateAnimationPreset("fade")}>fade in</button><button disabled={!sourceEditable} onClick={() => onCreateAnimationPreset("slide")}>slide up</button><button disabled={!sourceEditable} onClick={() => onCreateAnimationPreset("pulse")}>pulse</button></div></div>
    <div className="inspector-section visual-designer-section">
      <h4>{t("designer.containerQueries")}</h4><FieldGrid fields={containerFields} selection={selection} disabled={!sourceEditable} onApply={onApply} />
      <div className="container-query-builder"><select disabled={!sourceEditable} value={containerMode} onChange={(event) => setContainerMode(event.target.value as "min" | "max")}><option value="min">min-width</option><option value="max">max-width</option></select><input disabled={!sourceEditable} type="number" min={1} max={5000} value={containerWidth} onChange={(event) => setContainerWidth(Number(event.target.value))} /><input disabled={!sourceEditable} value={containerProperty} onChange={(event) => setContainerProperty(event.target.value)} /><input disabled={!sourceEditable} value={containerValue} onChange={(event) => setContainerValue(event.target.value)} /><button disabled={!sourceEditable || !containerProperty.trim() || !containerValue.trim()} onClick={() => onCreateContainerQuery(containerMode, containerWidth, containerProperty.trim(), containerValue.trim())}>{t("designer.addQuery")}</button></div>
    </div>
    <div className="inspector-section visual-designer-section">
      <h4>{t("designer.utilities")} <small>{frameworks.length ? frameworks.join(" + ") : t("designer.utilitiesNone")}</small></h4>
      {frameworks.map((framework) => <div key={framework} className="utility-framework"><strong>{framework === "tailwind" ? "Tailwind CSS" : "Bootstrap"}</strong><div className="utility-chip-grid">{utilityToggles[framework].map((toggle) => <button key={toggle.className} disabled={!sourceEditable} className={selection.classes.includes(toggle.className) ? "active" : ""} onClick={() => onSetClasses(toggleUtilityClass(selection.classes, framework, toggle))}>{toggle.label}</button>)}</div></div>)}
      {!frameworks.length && <p className="inspector-note">{t("designer.utilitiesHint")}</p>}
    </div>
  </>;
}
