import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useI18n } from "../i18n";
import type { TranslationKey } from "../i18n/messages";
import { componentPalette, type HtmlInsertPosition } from "../lib/htmlSource";
import { contextKey } from "../lib/cssAst";
import type { ComponentSnippet, CssPseudoState, CssRuleMatch, CssVariableEntry, DomTreeNode, InspectorSelection } from "../types/designer";
import { specificityLabel } from "../lib/specificity";
import { VisualStyleControls } from "./VisualStyleControls";

type Props = {
  open: boolean;
  supported: boolean;
  selection: InspectorSelection | null;
  domTree: DomTreeNode | null;
  cssVariables: CssVariableEntry[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClose: () => void;
  onSelectNode: (sourceId: string, selector: string) => void;
  onMoveNode: (sourceId: string, targetSourceId: string, position: HtmlInsertPosition) => void;
  onApplyStyle: (property: string, value: string, rule: CssRuleMatch | null, pseudo: CssPseudoState) => void;
  onApplyInlineStyle: (property: string, value: string) => void;
  onSetClasses: (classes: string[]) => void;
  onSetText: (value: string) => void;
  onSetAttribute: (name: string, value: string) => void;
  onRemoveAttribute: (name: string) => void;
  onDeleteNode: () => void;
  onDuplicateNode: () => void;
  onInsertComponent: (snippet: string, label: string, position: HtmlInsertPosition) => void;
  onRevealSource: () => void;
  onSetCssVariable: (variable: CssVariableEntry, value: string) => void;
  onCreateAnimationPreset: (preset: "fade" | "slide" | "pulse") => void;
  onCreateContainerQuery: (mode: "min" | "max", width: number, property: string, value: string) => void;
  projectCssFrameworks: string[];
  userComponents: ComponentSnippet[];
  onAddUserComponent: (component: ComponentSnippet) => void;
  onDeleteUserComponent: (id: string) => void;
};

type InspectorTab = "tree" | "components" | "style" | "attributes";

const editableStyles: ReadonlyArray<readonly [string, TranslationKey]> = [
  ["display", "inspector.display"], ["position", "inspector.position"], ["gap", "inspector.gap"],
  ["color", "inspector.color"], ["background-color", "inspector.background"], ["font-size", "inspector.fontSize"],
  ["font-weight", "inspector.fontWeight"], ["border-radius", "inspector.radius"],
  ["align-items", "inspector.alignItems"], ["justify-content", "inspector.justifyContent"],
];

const boxStyles = [
  ["width", "W"], ["height", "H"],
  ["margin-top", "MT"], ["margin-right", "MR"], ["margin-bottom", "MB"], ["margin-left", "ML"],
  ["padding-top", "PT"], ["padding-right", "PR"], ["padding-bottom", "PB"], ["padding-left", "PL"],
] as const;

const pseudoStates: Array<{ value: CssPseudoState; label: string | TranslationKey; translated?: boolean }> = [
  { value: "normal", label: "inspector.normal", translated: true },
  { value: "hover", label: ":hover" },
  { value: "focus", label: ":focus" },
  { value: "focus-visible", label: ":focus-visible" },
  { value: "active", label: ":active" },
];

function styleKey(property: string): string {
  return property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function nodeLabel(node: DomTreeNode): string {
  const id = node.id ? `#${node.id}` : "";
  const classes = node.classes.slice(0, 2).map((value) => `.${value}`).join("");
  return `${node.tagName}${id}${classes}`;
}

const inheritedProperties = ["color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align", "visibility", "cursor"] as const;

function ruleWinsProperty(candidate: CssRuleMatch, current: CssRuleMatch, property: string): boolean {
  const important = candidate.importantDeclarations.includes(property);
  const currentImportant = current.importantDeclarations.includes(property);
  if (important !== currentImportant) return important;
  const specificityCompare = candidate.specificity[0] - current.specificity[0]
    || candidate.specificity[1] - current.specificity[1]
    || candidate.specificity[2] - current.specificity[2];
  return specificityCompare > 0 || (specificityCompare === 0 && candidate.sourceOrder >= current.sourceOrder);
}

function winnerForProperty(rules: CssRuleMatch[], property: string): CssRuleMatch | null {
  let winner: CssRuleMatch | null = null;
  for (const rule of rules) {
    if (!(property in rule.declarations)) continue;
    if (!winner || ruleWinsProperty(rule, winner, property)) winner = rule;
  }
  return winner;
}

function DomRow({ node, depth, activeSourceId, onSelect, onMove }: {
  node: DomTreeNode;
  depth: number;
  activeSourceId?: string;
  onSelect: Props["onSelectNode"];
  onMove: Props["onMoveNode"];
}) {
  const { t } = useI18n();
  const protectedNode = ["html", "head", "body"].includes(node.tagName) || (!/^b\d+$/.test(node.sourceId) && !node.sourceId.startsWith("f:"));
  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/webforge-source-id");
    if (!sourceId || sourceId === node.sourceId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
    const position: HtmlInsertPosition = ratio < 0.25 ? "before" : ratio > 0.95 ? "after" : "inside";
    onMove(sourceId, node.sourceId, position);
  };
  return (
    <>
      <button
        className={`dom-tree-row ${activeSourceId === node.sourceId ? "active" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        draggable={!protectedNode}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/webforge-source-id", node.sourceId);
        }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
        onDrop={onDrop}
        onClick={() => onSelect(node.sourceId, node.selector)}
        title={t("inspector.dragNode")}
      >
        <span className="dom-caret">{node.children.length ? "⌄" : "·"}</span>
        <code>{nodeLabel(node)}</code>
        {node.text && <small>{node.text}</small>}
      </button>
      {node.children.map((child) => <DomRow key={child.sourceId || child.selector} node={child} depth={depth + 1} activeSourceId={activeSourceId} onSelect={onSelect} onMove={onMove} />)}
    </>
  );
}

export function InspectorPanel({
  open, supported, selection, domTree, cssVariables, canUndo, canRedo, onUndo, onRedo, onClose,
  onSelectNode, onMoveNode, onApplyStyle, onApplyInlineStyle, onSetClasses, onSetText, onSetAttribute,
  onRemoveAttribute, onDeleteNode, onDuplicateNode, onInsertComponent, onRevealSource, onSetCssVariable,
  onCreateAnimationPreset, onCreateContainerQuery, projectCssFrameworks, userComponents, onAddUserComponent, onDeleteUserComponent,
}: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<InspectorTab>("style");
  const [pseudo, setPseudo] = useState<CssPseudoState>("normal");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [classesDraft, setClassesDraft] = useState("");
  const [textDraft, setTextDraft] = useState("");
  const [newAttributeName, setNewAttributeName] = useState("");
  const [newAttributeValue, setNewAttributeValue] = useState("");
  const [insertPosition, setInsertPosition] = useState<HtmlInsertPosition>("inside");
  const [newDeclarationName, setNewDeclarationName] = useState("");
  const [newDeclarationValue, setNewDeclarationValue] = useState("");
  const [variableDrafts, setVariableDrafts] = useState<Record<string, string>>({});
  const [componentName, setComponentName] = useState("");
  const [componentCategory, setComponentCategory] = useState(() => t("inspector.custom"));
  const [componentMarkup, setComponentMarkup] = useState(() => t("inspector.customMarkup"));

  const localRules = useMemo(() => selection?.cssRules.filter((rule) => rule.sourcePath && rule.pseudo === pseudo) ?? [], [pseudo, selection]);
  const ruleKey = (rule: CssRuleMatch) => `${rule.sourcePath ?? ""}::${rule.sourceStart ?? ""}::${rule.selector}::${contextKey(rule.contexts)}::${rule.pseudo}`;
  const [sourceKey, setSourceKey] = useState("inline");
  const selectedRule = localRules.find((rule) => ruleKey(rule) === sourceKey) ?? null;
  const inlineMode = pseudo === "normal" && sourceKey === "inline";
  const sourceEditable = selection?.editableSource === true;
  const structuralEditable = selection?.structuralEditable ?? sourceEditable;
  const textEditable = selection?.textEditable ?? false;
  const palette = useMemo<ComponentSnippet[]>(() => [
    ...componentPalette.map((item) => ({
      ...item,
      label: t(`component.${item.id}` as TranslationKey),
      category: t((item.category === "Layout" ? "component.layout" : item.category === "Content" ? "component.content" : item.category === "Media" ? "component.media" : item.category === "Forms" ? "component.forms" : "component.components") as TranslationKey),
      userDefined: false,
    } as ComponentSnippet)),
    ...userComponents,
  ], [t, userComponents]);
  const winningDeclarations = useMemo(() => {
    const rules = selection?.cssRules.filter((rule) => rule.pseudo === pseudo) ?? [];
    const winner = new Map<string, CssRuleMatch>();
    for (const rule of rules) {
      for (const property of Object.keys(rule.declarations)) {
        const current = winner.get(property);
        if (!current) { winner.set(property, rule); continue; }
        if (ruleWinsProperty(rule, current, property)) winner.set(property, rule);
      }
    }
    return winner;
  }, [pseudo, selection]);
  const inheritanceTrace = useMemo(() => {
    if (!selection) return [];
    return inheritedProperties.flatMap((property) => {
      for (const ancestor of selection.ancestors) {
        const inlineValue = ancestor.inlineStyles[property];
        if (inlineValue) return [{ property, value: ancestor.styles[property] || inlineValue, ancestor, rule: null as CssRuleMatch | null, inline: true }];
        const rule = winnerForProperty(ancestor.cssRules.filter((item) => item.pseudo === "normal"), property);
        if (rule) return [{ property, value: ancestor.styles[property] || rule.declarations[property], ancestor, rule, inline: false }];
      }
      return [];
    });
  }, [selection]);

  useEffect(() => {
    if (!selection) return;
    const properties = [...editableStyles.map(([property]) => property), ...boxStyles.map(([property]) => property)];
    setDrafts(Object.fromEntries(properties.map((property) => [property, selection.styles[styleKey(property)] ?? ""])));
    setClassesDraft(selection.classes.join(" "));
    setTextDraft(selection.text);
  }, [selection]);

  useEffect(() => {
    const available = selection?.cssRules.filter((rule) => rule.sourcePath && rule.pseudo === pseudo) ?? [];
    setSourceKey((current) => available.some((rule) => ruleKey(rule) === current)
      ? current
      : (available[0] ? ruleKey(available[0]) : (pseudo === "normal" && selection?.sourceKind !== "framework" ? "inline" : "generated")));
  }, [pseudo, selection]);

  useEffect(() => {
    setVariableDrafts(Object.fromEntries(cssVariables.map((variable) => [`${variable.path}:${variable.sourceStart}:${contextKey(variable.contexts)}:${variable.selector}:${variable.name}`, variable.value])));
  }, [cssVariables]);

  const contextLabel = (rule: CssRuleMatch) => rule.contexts.length ? rule.contexts.map((context) => `@${context.name} ${context.prelude}`).join(" › ") : t("inspector.base");

  if (!open) return null;
  const applyDraft = (property: string) => {
    const value = drafts[property] ?? "";
    if (inlineMode) onApplyInlineStyle(property, value);
    else onApplyStyle(property, value, selectedRule, pseudo);
  };
  const protectedSelection = Boolean(selection && ["html", "head", "body"].includes(selection.tagName));

  return (
    <aside className="inspector-panel panel-surface">
      <div className="inspector-heading">
        <div><span>{t("inspector.title")}</span><strong>{t("inspector.subtitle")}</strong></div>
        <div className="designer-history-controls">
          <button disabled={!canUndo} onClick={onUndo} title={t("inspector.undo")}>↶</button>
          <button disabled={!canRedo} onClick={onRedo} title={t("inspector.redo")}>↷</button>
          <button onClick={onClose} title={t("inspector.close")}>×</button>
        </div>
      </div>
      {!supported ? (
        <div className="inspector-empty"><strong>{t("inspector.bridgeUnavailable")}</strong><p>{t("inspector.bridgeHelp")}</p></div>
      ) : (
        <>
          <div className="designer-tabs four-tabs">
            <button className={tab === "tree" ? "active" : ""} onClick={() => setTab("tree")}>DOM</button>
            <button className={tab === "components" ? "active" : ""} onClick={() => setTab("components")}> {t("inspector.add")}</button>
            <button className={tab === "style" ? "active" : ""} onClick={() => setTab("style")}> {t("inspector.styles")}</button>
            <button className={tab === "attributes" ? "active" : ""} onClick={() => setTab("attributes")}> {t("inspector.attrs")}</button>
          </div>

          {tab === "tree" ? (
            <div className="dom-tree">
              {domTree ? <DomRow node={domTree} depth={0} activeSourceId={selection?.sourceId} onSelect={onSelectNode} onMove={onMoveNode} /> : <div className="inspector-empty compact"><strong>{t("inspector.domUnavailable")}</strong><p>{t("inspector.reloadTree")}</p></div>}
            </div>
          ) : tab === "components" ? (
            <div className="inspector-content">
              <div className="inspector-section">
                <h4>{t("inspector.insertTarget")} <small>{t("inspector.sourcePatch")}</small></h4>
                <select className="rule-source-select" value={insertPosition} onChange={(event) => setInsertPosition(event.target.value as HtmlInsertPosition)}>
                  <option value="inside">{t("inspector.insideSelected")}</option><option value="before">{t("inspector.beforeSelected")}</option><option value="after">{t("inspector.afterSelected")}</option>
                </select>
                <p className="inspector-note">{t("inspector.chooseNode")}</p>
              </div>
              <div className="component-palette">
                {palette.map((component) => (
                  <div className="component-palette-item" key={component.id}>
                    <button disabled={!selection || !sourceEditable || (insertPosition !== "inside" && !structuralEditable)} onClick={() => onInsertComponent(component.snippet, `Insert ${component.label}`, insertPosition)}>
                      <span>{component.category}</span><strong>{component.label}</strong><code>{component.snippet.split("\n")[0]}</code>
                    </button>
                    {component.userDefined && <button className="component-delete" onClick={() => onDeleteUserComponent(component.id)} title={t("inspector.removeLibrary")}>×</button>}
                  </div>
                ))}
                <div className="component-library-editor">
                  <strong>{t("inspector.saveSnippet")}</strong>
                  <div><input placeholder={t("inspector.name")} value={componentName} onChange={(event) => setComponentName(event.target.value)} /><input placeholder={t("inspector.category")} value={componentCategory} onChange={(event) => setComponentCategory(event.target.value)} /></div>
                  <textarea value={componentMarkup} onChange={(event) => setComponentMarkup(event.target.value)} rows={5} spellCheck={false} />
                  <button disabled={!componentName.trim() || !componentMarkup.trim()} onClick={() => { const id = `user-${Date.now()}`; onAddUserComponent({ id, label: componentName.trim(), category: componentCategory.trim() || t("inspector.custom"), snippet: componentMarkup, userDefined: true }); setComponentName(""); }}> {t("inspector.saveLibrary")}</button>
                  <small>{t("inspector.libraryNote")}</small>
                </div>
              </div>
            </div>
          ) : !selection ? (
            <div className="inspector-empty"><div className="inspect-cursor">⌖</div><strong>{t("inspector.pickElement")}</strong><p>{t("inspector.pickHelp")}</p></div>
          ) : tab === "attributes" ? (
            <div className="inspector-content">
              <div className="element-card">
                <code>{selection.selector}</code><div><strong>&lt;{selection.tagName}&gt;</strong><span>{Math.round(selection.rect.width)} × {Math.round(selection.rect.height)}</span></div>
                <div className="element-actions"><button disabled={!selection.sourcePath && !selection.sourceId} onClick={onRevealSource}> {t("inspector.source")}</button><button disabled={protectedSelection || !structuralEditable} onClick={onDuplicateNode}> {t("common.duplicate")}</button><button className="danger" disabled={protectedSelection || !structuralEditable} onClick={onDeleteNode}> {t("common.delete")}</button></div>
              </div>
              {selection.sourceKind === "framework" && <div className="inspector-section"><h4>{t("inspector.textContent")} <small>{textEditable ? t("inspector.safeStaticText") : t("inspector.readOnly")}</small></h4><div className="single-field"><input disabled={!textEditable} value={textDraft} onChange={(event) => setTextDraft(event.target.value)} onBlur={() => onSetText(textDraft)} onKeyDown={(event) => { if (event.key === "Enter") onSetText(textDraft); }} /></div></div>}
              <div className="inspector-section"><h4>{t("inspector.classes")} <small>{sourceEditable ? t("inspector.rangePatch") : t("inspector.readOnly")}</small></h4><div className="single-field"><input disabled={!sourceEditable} value={classesDraft} onChange={(event) => setClassesDraft(event.target.value)} onBlur={() => onSetClasses(classesDraft.split(/\s+/).filter(Boolean))} onKeyDown={(event) => { if (event.key === "Enter") onSetClasses(classesDraft.split(/\s+/).filter(Boolean)); }} /></div></div>
              <div className="inspector-section">
                <h4>{t("inspector.attributes")} <small>{sourceEditable ? t("inspector.rangePatch") : t("inspector.readOnly")}</small></h4>
                <div className="attribute-list">
                  {Object.entries(selection.attributes).map(([name, value]) => <div className="attribute-row" key={name}><code>{name}</code><input disabled={!sourceEditable} defaultValue={value} key={`${selection.sourceId}:${name}:${value}`} onBlur={(event) => onSetAttribute(name, event.target.value)} /><button disabled={!sourceEditable} onClick={() => onRemoveAttribute(name)} title={t("inspector.removeAttribute", { name })}>×</button></div>)}
                </div>
                <div className="attribute-add"><input disabled={!sourceEditable} placeholder={t("inspector.attribute")} value={newAttributeName} onChange={(event) => setNewAttributeName(event.target.value)} /><input disabled={!sourceEditable} placeholder={t("inspector.value")} value={newAttributeValue} onChange={(event) => setNewAttributeValue(event.target.value)} /><button disabled={!sourceEditable} onClick={() => { if (!newAttributeName.trim()) return; onSetAttribute(newAttributeName.trim(), newAttributeValue); setNewAttributeName(""); setNewAttributeValue(""); }}>+</button></div>
              </div>
              <p className="designer-success">{sourceEditable ? (selection.sourceKind === "framework" ? t("inspector.frameworkEnabled") : t("inspector.staticEnabled")) : selection.sourcePath ? t("inspector.frameworkHint", { path: selection.sourcePath, line: selection.sourceLine ?? 1 }) : t("inspector.runtimeNode")}</p>
            </div>
          ) : (
            <div className="inspector-content">
              <div className="element-card"><code>{selection.selector}</code><div><strong>&lt;{selection.tagName}&gt;</strong><span>{Math.round(selection.rect.width)} × {Math.round(selection.rect.height)}</span></div>{selection.sourcePath && <button className="source-hint-button" onClick={onRevealSource}>↗ {selection.sourcePath}:{selection.sourceLine ?? 1}</button>}<div className="source-confidence-row"><span>{selection.sourceKind}</span><span>{selection.sourceConfidence}</span>{selection.sourceOrigin && <span>{selection.sourceOrigin}</span>}</div>{selection.text && <p>{selection.text}</p>}</div>
              <div className="inspector-section">
                <h4>{t("inspector.pseudo")}</h4>
                <div className="pseudo-state-row">{pseudoStates.map((state) => <button key={state.value} className={pseudo === state.value ? "active" : ""} onClick={() => setPseudo(state.value)}>{state.translated ? t(state.label as TranslationKey) : state.label}</button>)}</div>
              </div>
              <div className="inspector-section">
                <h4>{t("inspector.writeTarget")}</h4>
                <select className="rule-source-select" value={inlineMode ? "inline" : sourceKey} onChange={(event) => setSourceKey(event.target.value)}>
                  {localRules.map((rule, index) => <option key={`${ruleKey(rule)}:${index}`} value={ruleKey(rule)}>{rule.sourcePath}{rule.sourceLine ? `:${rule.sourceLine}` : ""} · {rule.selector}{rule.contexts.length ? ` · ${contextLabel(rule)}` : ""}</option>)}
                  {pseudo === "normal" && selection?.sourceKind !== "framework" && <option value="inline">{t("inspector.inlineHtml")}</option>}
                  <option value="generated">{t("inspector.generatedRule", { suffix: pseudo === "normal" ? t("inspector.rule") : `:${pseudo} ${t("inspector.rule")}` })}</option>
                </select>
                <p className="inspector-note">{t("inspector.authoredRuleNote")}</p>
              </div>
              <div className="inspector-section"><h4>{t("inspector.boxModel")} <small>{sourceEditable ? (pseudo === "normal" ? t("inspector.sourceBacked") : `:${pseudo}`) : t("inspector.computedReadOnly")}</small></h4><div className="box-model-grid">{boxStyles.map(([property, label]) => <label key={property}><span>{label}</span><input disabled={!sourceEditable} value={drafts[property] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [property]: event.target.value }))} onBlur={() => applyDraft(property)} onKeyDown={(event) => { if (event.key === "Enter") applyDraft(property); }} /></label>)}</div></div>
              <div className="inspector-section"><h4>{t("inspector.styles")} <small>{sourceEditable ? (inlineMode ? t("inspector.htmlInline") : pseudo === "normal" ? t("inspector.cssRule") : `CSS :${pseudo}`) : t("inspector.computedReadOnly")}</small></h4><div className="style-fields">{editableStyles.map(([property, label]) => <label key={property}><span>{t(label)}</span><input disabled={!sourceEditable} value={drafts[property] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [property]: event.target.value }))} onBlur={() => applyDraft(property)} onKeyDown={(event) => { if (event.key === "Enter") applyDraft(property); }} /></label>)}</div></div>
              <VisualStyleControls selection={selection} sourceEditable={sourceEditable} projectCssFrameworks={projectCssFrameworks} onApply={(property, value) => inlineMode ? onApplyInlineStyle(property, value) : onApplyStyle(property, value, selectedRule, pseudo)} onSetClasses={onSetClasses} onCreateAnimationPreset={onCreateAnimationPreset} onCreateContainerQuery={onCreateContainerQuery} />
              <div className="inspector-section">
                <h4>{t("inspector.addDeclaration")} <small>{t("inspector.cascadeTarget")}</small></h4>
                <div className="declaration-add"><input disabled={!sourceEditable} placeholder={t("inspector.property")} value={newDeclarationName} onChange={(event) => setNewDeclarationName(event.target.value)} /><input disabled={!sourceEditable} placeholder={t("inspector.value")} value={newDeclarationValue} onChange={(event) => setNewDeclarationValue(event.target.value)} /><button disabled={!sourceEditable} onClick={() => { if (!newDeclarationName.trim()) return; onApplyStyle(newDeclarationName.trim(), newDeclarationValue, selectedRule, pseudo); setNewDeclarationName(""); setNewDeclarationValue(""); }}>+</button></div>
              </div>
              {cssVariables.length > 0 && <div className="inspector-section css-variable-section"><h4>{t("inspector.cssVariables")} <small>{cssVariables.length}</small></h4>{cssVariables.slice(0, 18).map((variable) => { const key = `${variable.path}:${variable.sourceStart}:${contextKey(variable.contexts)}:${variable.selector}:${variable.name}`; return <label key={key}><code>{variable.name}</code><input disabled={!sourceEditable} value={variableDrafts[key] ?? variable.value} onChange={(event) => setVariableDrafts((current) => ({ ...current, [key]: event.target.value }))} onBlur={() => onSetCssVariable(variable, variableDrafts[key] ?? variable.value)} title={`${variable.path} · ${contextKey(variable.contexts) || t("inspector.base")} · ${variable.selector}`} /></label>; })}</div>}
              <div className="inspector-section inheritance-section">
                <h4>{t("inspector.inheritance")} <small>{inheritanceTrace.length}</small></h4>
                {inheritanceTrace.length ? inheritanceTrace.map((entry) => (
                  <div className="inheritance-row" key={`${entry.property}:${entry.ancestor.selector}`}>
                    <code>{entry.property}</code><strong>{entry.value || "—"}</strong>
                    <span>{t("inspector.from", { selector: entry.ancestor.selector })}</span>
                    <small>{entry.inline ? "inline" : entry.rule ? `${entry.rule.sourcePath ?? t("inspector.embedded")}${entry.rule.sourceLine ? `:${entry.rule.sourceLine}` : ""} · ${contextLabel(entry.rule)}` : entry.ancestor.sourcePath ? `${entry.ancestor.sourcePath}:${entry.ancestor.sourceLine ?? 1}` : entry.ancestor.sourceConfidence}</small>
                  </div>
                )) : <p className="inspector-note">{t("inspector.noInheritance")}</p>}
              </div>
              <div className="inspector-section css-rules-section">
                <h4>{t("inspector.matchedCascade")}</h4>
                {selection.cssRules.length ? selection.cssRules.slice().reverse().map((rule, index) => (
                  <button className={`css-rule-card selectable ${selectedRule && ruleKey(selectedRule) === ruleKey(rule) ? "selected" : ""}`} key={`${rule.selector}:${rule.sourcePath}:${index}`} onClick={() => { setPseudo(rule.pseudo); setSourceKey(ruleKey(rule)); }}>
                    <div><code>{rule.selector}</code><span>{rule.sourcePath ?? t("inspector.inlineEmbedded")}{rule.sourceLine ? `:${rule.sourceLine}` : ""} · {contextLabel(rule)}{rule.pseudo !== "normal" ? ` · :${rule.pseudo}` : ""}</span></div>
                    <div className="cascade-metrics"><span>{t("inspector.specificity", { value: specificityLabel(rule.specificity) })}</span><span>{t("inspector.order", { value: rule.sourceOrder })}</span>{rule.importantDeclarations.length > 0 && <span>!important {rule.importantDeclarations.length}</span>}</div>
                    <pre>{Object.entries(rule.declarations).slice(0, 10).map(([name, value]) => `${winningDeclarations.get(name) === rule ? "✓" : "×"} ${name}: ${value}${rule.importantDeclarations.includes(name) ? " !important" : ""};`).join("\n") || t("inspector.emptyRule")}</pre>
                  </button>
                )) : <p className="inspector-note">{t("inspector.noRules")}</p>}
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
