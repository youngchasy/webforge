import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { ComponentSnippet } from "../types/designer";
import type { ExtensionComponentContribution } from "../types/extensions";

type Props = {
  workspaceComponents: ComponentSnippet[];
  extensionComponents: ExtensionComponentContribution[];
  onDeleteWorkspaceComponent: (id: string) => Promise<void>;
  onOpenExtensions: () => void;
};

export function ComponentMarketplacePanel({ workspaceComponents, extensionComponents, onDeleteWorkspaceComponent, onOpenExtensions }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState("");
  const items = useMemo(() => [
    ...workspaceComponents.map((component) => ({ ...component, source: t("components.workspaceSource"), removable: true, key: `workspace:${component.id}` })),
    ...extensionComponents.map((component) => ({ id: component.id, label: component.label, category: component.category, snippet: component.snippet, userDefined: false, source: component.extensionId, removable: false, key: `extension:${component.extensionId}:${component.packId}:${component.id}` })),
  ].filter((component) => {
    const needle = query.trim().toLowerCase();
    return !needle || `${component.label} ${component.category} ${component.source}`.toLowerCase().includes(needle);
  }), [extensionComponents, query, t, workspaceComponents]);

  const copy = async (key: string, snippet: string) => {
    await navigator.clipboard.writeText(snippet);
    setCopied(key);
    window.setTimeout(() => setCopied((current) => current === key ? "" : current), 1200);
  };

  return <div className="sidebar-feature tool-sidebar components-panel">
    <div className="panel-heading"><span>{t("components.title")}</span><button title={t("activity.extensions")} onClick={onOpenExtensions}>▦</button></div>
    <div className="component-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("components.search")} /></div>
    <div className="component-library-summary"><strong>{items.length}</strong><span>{t("components.available")}</span><small>{t("components.designerHint")}</small></div>
    <div className="component-browser-list">
      {!items.length && <div className="sidebar-empty compact">{t("components.empty")}</div>}
      {items.map((component) => <article className="component-browser-card" key={component.key}>
        <header><span><strong>{component.label}</strong><small>{component.category || t("components.uncategorized")}</small></span><code>{component.source}</code></header>
        <pre>{component.snippet.slice(0, 260)}{component.snippet.length > 260 ? "…" : ""}</pre>
        <footer>
          <button onClick={() => void copy(component.key, component.snippet)}>{copied === component.key ? t("components.copied") : t("components.copySnippet")}</button>
          {component.removable && <button className="danger-lite" onClick={() => void onDeleteWorkspaceComponent(component.id)}>{t("common.delete")}</button>}
        </footer>
      </article>)}
    </div>
  </div>;
}
