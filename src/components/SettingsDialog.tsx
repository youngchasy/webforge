import { useState } from "react";
import { useI18n, type LanguagePreference } from "../i18n";
import type { WorkspaceIndexStatus } from "../types/search";
import type { IdeSettings, WebForgeCommandId, WorkspaceSettings } from "../types/settings";
import { BUILTIN_THEMES } from "../lib/themes";

type Section = "general" | "editor" | "files" | "search" | "keybindings";
type Scope = "user" | "workspace";

type Props = {
  open: boolean;
  onClose: () => void;
  settings: IdeSettings;
  workspaceSettings: WorkspaceSettings;
  effectiveSettings: IdeSettings;
  workspaceAvailable: boolean;
  indexStatus: WorkspaceIndexStatus;
  onChangeSettings: (next: IdeSettings | ((current: IdeSettings) => IdeSettings)) => void;
  onChangeWorkspaceSettings: (next: WorkspaceSettings) => Promise<void>;
  onResetSettings: () => void;
  onRebuildIndex: () => Promise<WorkspaceIndexStatus>;
};

const KEYBINDING_COMMANDS: Array<[WebForgeCommandId, string]> = [
  ["commandPalette", "settings.keyCommandPalette"],
  ["openFolder", "settings.keyOpenFolder"],
  ["search", "settings.keySearch"],
  ["sourceControl", "settings.keySourceControl"],
  ["settings", "settings.keySettings"],
  ["save", "settings.keySave"],
  ["saveAll", "settings.keySaveAll"],
  ["newProject", "settings.keyNewProject"],
  ["runProject", "settings.keyRunProject"],
];

export function SettingsDialog({ open, onClose, settings, workspaceSettings, effectiveSettings, workspaceAvailable, indexStatus, onChangeSettings, onChangeWorkspaceSettings, onResetSettings, onRebuildIndex }: Props) {
  const { locale, languagePreference, systemLocale, setLanguagePreference, t } = useI18n();
  const [section, setSection] = useState<Section>("general");
  const [scope, setScope] = useState<Scope>("user");
  const [indexBusy, setIndexBusy] = useState(false);
  if (!open) return null;

  const languageName = locale === "ru" ? t("common.russian") : t("common.english");
  const systemName = systemLocale === "ru" ? t("common.russian") : t("common.english");
  const values = scope === "user" ? settings : effectiveSettings;

  const updateEditor = <K extends keyof IdeSettings["editor"]>(key: K, value: IdeSettings["editor"][K]) => {
    if (scope === "user") onChangeSettings((current) => ({ ...current, editor: { ...current.editor, [key]: value } }));
    else void onChangeWorkspaceSettings({ ...workspaceSettings, editor: { ...(workspaceSettings.editor ?? {}), [key]: value } });
  };
  const updateFiles = <K extends keyof IdeSettings["files"]>(key: K, value: IdeSettings["files"][K]) => {
    if (scope === "user") onChangeSettings((current) => ({ ...current, files: { ...current.files, [key]: value } }));
    else void onChangeWorkspaceSettings({ ...workspaceSettings, files: { ...(workspaceSettings.files ?? {}), [key]: value } });
  };
  const updateSearch = <K extends keyof IdeSettings["search"]>(key: K, value: IdeSettings["search"][K]) => {
    if (scope === "user") onChangeSettings((current) => ({ ...current, search: { ...current.search, [key]: value } }));
    else void onChangeWorkspaceSettings({ ...workspaceSettings, search: { ...(workspaceSettings.search ?? {}), [key]: value } });
  };
  const updateKeybinding = (key: WebForgeCommandId, value: string) => {
    if (scope === "user") onChangeSettings((current) => ({ ...current, keybindings: { ...current.keybindings, [key]: value } }));
    else void onChangeWorkspaceSettings({ ...workspaceSettings, keybindings: { ...(workspaceSettings.keybindings ?? {}), [key]: value } });
  };
  const resetScope = () => {
    if (scope === "user") onResetSettings();
    else void onChangeWorkspaceSettings({});
  };

  return (
    <div className="modal-backdrop settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog settings-dialog-wide" role="dialog" aria-modal="true" aria-label={t("settings.aria")}>
        <div className="wizard-header settings-header">
          <div><span>{t("settings.kicker")}</span><h2>{t("settings.title")}</h2></div>
          <div className="settings-header-actions">
            {workspaceAvailable && <select value={scope} onChange={(event) => setScope(event.target.value as Scope)}><option value="user">{t("settings.scopeUser")}</option><option value="workspace">{t("settings.scopeWorkspace")}</option></select>}
            <button onClick={resetScope} title={t("settings.reset")}>↺</button>
            <button onClick={onClose} title={t("common.close")}>×</button>
          </div>
        </div>
        <div className="settings-layout">
          <aside className="settings-nav">
            {(["general", "editor", "files", "search", "keybindings"] as Section[]).map((item) => <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>{t(`settings.${item}` as any)}</button>)}
          </aside>
          <div className="settings-content">
            {scope === "workspace" && <div className="settings-scope-note">{t("settings.workspaceNote")}</div>}

            {section === "general" && <section className="settings-section">
              <div className="settings-section-title"><strong>{t("settings.localizationTitle")}</strong><span>{t("settings.localizationNote")}</span></div>
              <label className="settings-field">
                <span><strong>{t("settings.language")}</strong><small>{t("settings.languageHelp")}</small></span>
                <select disabled={scope === "workspace"} value={languagePreference} onChange={(event) => setLanguagePreference(event.target.value as LanguagePreference)}>
                  <option value="system">{t("settings.systemLanguage", { language: systemName })}</option><option value="ru">Русский</option><option value="en">English</option>
                </select>
              </label>
              <div className="settings-fact-row"><span>{t("settings.effectiveLanguage")}</span><strong>{languageName}</strong></div>
              <div className="settings-note">{t("settings.restartNotRequired")}</div>
              <div className="settings-section-title settings-theme-heading"><strong>{t("settings.appearanceTitle")}</strong><span>{t("settings.appearanceNote")}</span></div>
              <div className="theme-grid" aria-label={t("settings.theme")}>
                {BUILTIN_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    className={`theme-card ${settings.appearance.theme === theme.id ? "active" : ""}`}
                    disabled={scope === "workspace"}
                    onClick={() => onChangeSettings((current) => ({ ...current, appearance: { ...current.appearance, theme: theme.id } }))}
                    title={t(theme.descriptionKey as any)}
                  >
                    <span className="theme-swatch" style={{ background: theme.preview[0] }}><i style={{ background: theme.preview[1] }} /><b style={{ background: theme.preview[2] }} /></span>
                    <span className="theme-card-copy"><strong>{t(theme.labelKey as any)}</strong><small>{t(theme.descriptionKey as any)}</small></span>
                  </button>
                ))}
              </div>
            </section>}

            {section === "editor" && <section className="settings-section">
              <div className="settings-section-title"><strong>{t("settings.editorTitle")}</strong><span>{t("settings.editorNote")}</span></div>
              <NumberField label={t("settings.fontSize")} help={t("settings.fontSizeHelp")} value={values.editor.fontSize} min={9} max={32} onChange={(value) => updateEditor("fontSize", value)} />
              <NumberField label={t("settings.lineHeight")} help={t("settings.lineHeightHelp")} value={values.editor.lineHeight} min={14} max={48} onChange={(value) => updateEditor("lineHeight", value)} />
              <NumberField label={t("settings.tabSize")} help={t("settings.tabSizeHelp")} value={values.editor.tabSize} min={1} max={8} onChange={(value) => updateEditor("tabSize", value)} />
              <ToggleField label={t("settings.insertSpaces")} help={t("settings.insertSpacesHelp")} checked={values.editor.insertSpaces} onChange={(value) => updateEditor("insertSpaces", value)} />
              <ToggleField label={t("settings.wordWrap")} help={t("settings.wordWrapHelp")} checked={values.editor.wordWrap === "on"} onChange={(value) => updateEditor("wordWrap", value ? "on" : "off")} />
              <ToggleField label={t("settings.minimap")} help={t("settings.minimapHelp")} checked={values.editor.minimap} onChange={(value) => updateEditor("minimap", value)} />
              <ToggleField label={t("settings.formatOnSave")} help={t("settings.formatOnSaveHelp")} checked={values.editor.formatOnSave} onChange={(value) => updateEditor("formatOnSave", value)} />
            </section>}

            {section === "files" && <section className="settings-section">
              <div className="settings-section-title"><strong>{t("settings.filesTitle")}</strong><span>{t("settings.filesNote")}</span></div>
              <label className="settings-field"><span><strong>{t("settings.autoSave")}</strong><small>{t("settings.autoSaveHelp")}</small></span><select value={values.files.autoSave} onChange={(event) => updateFiles("autoSave", event.target.value as IdeSettings["files"]["autoSave"])}><option value="off">{t("settings.off")}</option><option value="afterDelay">{t("settings.afterDelay")}</option></select></label>
              <NumberField label={t("settings.autoSaveDelay")} help={t("settings.autoSaveDelayHelp")} value={values.files.autoSaveDelay} min={250} max={10000} step={250} onChange={(value) => updateFiles("autoSaveDelay", value)} />
              <ToggleField label={t("settings.restoreSession")} help={t("settings.restoreSessionHelp")} checked={values.files.restoreSession} onChange={(value) => updateFiles("restoreSession", value)} />
              <ToggleField label={t("settings.hotExit")} help={t("settings.hotExitHelp")} checked={values.files.hotExit} onChange={(value) => updateFiles("hotExit", value)} />
              <div className="settings-note">{t("settings.recoveryStorage")}</div>
            </section>}

            {section === "search" && <section className="settings-section">
              <div className="settings-section-title"><strong>{t("settings.searchTitle")}</strong><span>{t("settings.searchNote")}</span></div>
              <ToggleField label={t("settings.nativeIndex")} help={t("settings.nativeIndexHelp")} checked={values.search.useNativeIndex} onChange={(value) => updateSearch("useNativeIndex", value)} />
              <label className="settings-field"><span><strong>{t("settings.searchExclude")}</strong><small>{t("settings.searchExcludeHelp")}</small></span><input value={values.search.defaultExclude} onChange={(event) => updateSearch("defaultExclude", event.target.value)} placeholder="*.min.js, vendor/*" /></label>
              <NumberField label={t("settings.searchLimit")} help={t("settings.searchLimitHelp")} value={values.search.maxResults} min={100} max={10000} step={100} onChange={(value) => updateSearch("maxResults", value)} />
              <div className="settings-index-card"><div><strong>{t("settings.indexStatus")}</strong><span>{indexStatus.indexed ? t("settings.indexReady", { files: indexStatus.files, size: Math.round(indexStatus.totalBytes / 1024 / 1024) }) : t("settings.indexIdle")}{indexStatus.truncated ? ` · ${t("settings.indexTruncated")}` : ""}</span></div><button disabled={!workspaceAvailable || indexBusy} onClick={() => { setIndexBusy(true); void onRebuildIndex().finally(() => setIndexBusy(false)); }}>{indexBusy ? "…" : t("settings.rebuildIndex")}</button></div>
            </section>}

            {section === "keybindings" && <section className="settings-section">
              <div className="settings-section-title"><strong>{t("settings.keybindingsTitle")}</strong><span>{t("settings.keybindingsNote")}</span></div>
              {KEYBINDING_COMMANDS.map(([key, labelKey]) => <label className="settings-field settings-keybinding" key={key}><span><strong>{t(labelKey as any)}</strong><small>{key}</small></span><input value={values.keybindings[key]} onChange={(event) => updateKeybinding(key, event.target.value)} placeholder="Ctrl+Shift+F" /></label>)}
            </section>}
          </div>
        </div>
      </section>
    </div>
  );
}

function ToggleField({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="settings-field"><span><strong>{label}</strong><small>{help}</small></span><input className="settings-checkbox" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function NumberField({ label, help, value, min, max, step = 1, onChange }: { label: string; help: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="settings-field"><span><strong>{label}</strong><small>{help}</small></span><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
