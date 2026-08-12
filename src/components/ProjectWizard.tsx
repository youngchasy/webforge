import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { chooseDirectory } from "../lib/tauri";
import type { ExtensionTemplateSummary } from "../types/extensions";
import type { CreateProjectRequest, CssPreset, ProjectTemplateId } from "../types/project";

type Props = {
  open: boolean;
  native: boolean;
  extensionTemplates?: ExtensionTemplateSummary[];
  onClose: () => void;
  onCreate: (request: CreateProjectRequest) => Promise<void>;
};

type TemplateCard = {
  key: string;
  title: string;
  note: string;
  mark: string;
  core?: ProjectTemplateId;
  extension?: ExtensionTemplateSummary;
};

function coreTemplateForFramework(framework: string): ProjectTemplateId {
  if (framework === "react" || framework === "vue" || framework === "svelte") return framework;
  return "static";
}

export function ProjectWizard({ open, native, extensionTemplates = [], onClose, onCreate }: Props) {
  const { t } = useI18n();
  const [parentPath, setParentPath] = useState("");
  const [name, setName] = useState("my-webforge-site");
  const [templateKey, setTemplateKey] = useState("core:static");
  const [typescript, setTypescript] = useState(true);
  const [cssPreset, setCssPreset] = useState<CssPreset>("css");
  const [creating, setCreating] = useState(false);
  const templates = useMemo<TemplateCard[]>(() => [
    { key: "core:static", core: "static", title: "HTML / CSS / JS", note: t("wizard.staticNote"), mark: "</>" },
    { key: "core:react", core: "react", title: "React + Vite", note: t("wizard.reactNote"), mark: "⚛" },
    { key: "core:vue", core: "vue", title: "Vue + Vite", note: t("wizard.vueNote"), mark: "V" },
    { key: "core:svelte", core: "svelte", title: "Svelte + Vite", note: t("wizard.svelteNote"), mark: "S" },
    ...extensionTemplates.map((template) => ({
      key: `extension:${template.extensionId}:${template.id}`,
      extension: template,
      title: template.name,
      note: template.description || t("wizard.extensionTemplateNote", { extension: template.extensionId }),
      mark: "✦",
    })),
  ], [extensionTemplates, t]);
  const selected = templates.find((item) => item.key === templateKey) ?? templates[0];
  const selectedCore = selected.core ?? coreTemplateForFramework(selected.extension?.framework ?? "static");
  const frameworkProject = !selected.extension && selectedCore !== "static";
  const targetLabel = useMemo(() => parentPath ? `${parentPath.replace(/[\\/]$/, "")}/${name || "…"}` : t("wizard.chooseParent"), [name, parentPath, t]);

  if (!open) return null;

  const chooseParent = async () => {
    const path = await chooseDirectory(t("wizard.chooseParentTitle"));
    if (path) setParentPath(path);
  };

  const submit = async () => {
    if (!native || !parentPath || !name.trim() || creating) return;
    setCreating(true);
    try {
      await onCreate({
        parentPath,
        name: name.trim(),
        template: selectedCore,
        typescript: frameworkProject && typescript,
        cssPreset: frameworkProject ? cssPreset : "css",
        extensionTemplate: selected.extension ? { extensionId: selected.extension.extensionId, templateId: selected.extension.id } : null,
      });
      onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) onClose(); }}>
      <section className="project-wizard" role="dialog" aria-modal="true" aria-label={t("wizard.aria")}>
        <div className="wizard-header">
          <div><span>{t("wizard.newProject")}</span><h2>{t("wizard.heading")}</h2></div>
          <button onClick={onClose} disabled={creating}>×</button>
        </div>

        {!native && <div className="wizard-warning">{t("wizard.desktopOnly")}</div>}

        <div className="wizard-body">
          <div className="wizard-section">
            <label>{t("wizard.template")}</label>
            <div className="template-grid">
              {templates.map((item) => (
                <button key={item.key} className={templateKey === item.key ? "template-card active" : "template-card"} onClick={() => setTemplateKey(item.key)}>
                  <span className="template-mark">{item.mark}</span>
                  <strong>{item.title}</strong>
                  <small>{item.note}</small>
                  {item.extension && <em>{t("wizard.extensionBadge", { extension: item.extension.extensionId })}</em>}
                </button>
              ))}
            </div>
          </div>

          <div className="wizard-form-grid">
            <label className="field-label">{t("wizard.projectName")}<input value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} /></label>
            <label className="field-label">{t("wizard.location")}<div className="folder-field"><input value={parentPath} readOnly placeholder={t("wizard.chooseFolder")} /><button onClick={() => void chooseParent()}>{t("common.browse")}</button></div></label>
          </div>

          {frameworkProject && (
            <div className="wizard-options">
              <label className="option-toggle"><input type="checkbox" checked={typescript} onChange={(event) => setTypescript(event.target.checked)} /><span><strong>TypeScript</strong><small>{t("wizard.tsNote")}</small></span></label>
              <div className="css-choice"><span>{t("wizard.styling")}</span><button className={cssPreset === "css" ? "active" : ""} onClick={() => setCssPreset("css")}>{t("wizard.plainCss")}</button><button className={cssPreset === "tailwind" ? "active" : ""} onClick={() => setCssPreset("tailwind")}>Tailwind</button></div>
            </div>
          )}

          {selected.extension && <div className="wizard-extension-note">{t("wizard.extensionSecurityNote")}</div>}
          <div className="wizard-target"><span>{t("wizard.projectPath")}</span><code>{targetLabel}</code></div>
        </div>

        <div className="wizard-footer">
          <span>{selected.extension ? t("wizard.extensionReady") : frameworkProject ? t("wizard.depsNotInstalled") : t("wizard.staticReady")}</span>
          <div><button onClick={onClose} disabled={creating}>{t("common.cancel")}</button><button className="primary-button" disabled={!native || !parentPath || !name.trim() || creating} onClick={() => void submit()}>{creating ? t("common.creating") : t("common.createProject")}</button></div>
        </div>
      </section>
    </div>
  );
}
