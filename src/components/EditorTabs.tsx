import type { EditorFile } from "../types/workspace";
import { useI18n } from "../i18n";

type Props = {
  tabs: EditorFile[];
  activePath?: string;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
};

export function EditorTabs({ tabs, activePath, onSelect, onClose }: Props) {
  const { t } = useI18n();
  return (
    <div className="editor-tabs">
      <div className="tab-strip">
        {tabs.map((file) => (
          <button
            key={file.relativePath}
            className={activePath === file.relativePath ? "editor-tab active" : "editor-tab"}
            onClick={() => onSelect(file.relativePath)}
            title={file.externalChange ? `${file.relativePath} — ${t("tabs.changedOutside")}` : file.relativePath}
          >
            <span className={`tab-dot language-${file.language}`} />
            <span className="tab-name">{file.name}</span>
            {file.externalChange && <span className="external-change" title={t("tabs.changedOutside")}>!</span>}
            <span
              className={file.dirty ? "tab-close dirty" : "tab-close"}
              onClick={(event) => {
                event.stopPropagation();
                onClose(file.relativePath);
              }}
              title={file.dirty ? t("tabs.unsaved") : t("tabs.close")}
            >
              {file.dirty ? "●" : "×"}
            </span>
          </button>
        ))}
      </div>
      <div className="editor-toolbar">
        <button title={t("tabs.split")}>▥</button>
        <button title={t("tabs.actions")}>•••</button>
      </div>
    </div>
  );
}
