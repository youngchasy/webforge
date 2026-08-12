import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";

export type CommandPaletteAction = {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  keywords?: string[];
  disabled?: boolean;
  run: () => void;
};

type Props = {
  open: boolean;
  actions: CommandPaletteAction[];
  onClose: () => void;
};

export function CommandPalette({ open, actions, onClose }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return actions;
    return actions.filter((action) => [action.label, action.detail, ...(action.keywords ?? [])]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalized)));
  }, [actions, query]);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(Math.max(0, filtered.length - 1));
  }, [activeIndex, filtered.length]);

  if (!open) return null;
  const execute = (action: CommandPaletteAction | undefined) => {
    if (!action || action.disabled) return;
    onClose();
    action.run();
  };

  return (
    <div className="command-palette-backdrop" onMouseDown={onClose}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label={t("palette.aria")} onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-palette-input-row">
          <span>⌘</span>
          <input
            ref={inputRef}
            value={query}
            placeholder={t("palette.placeholder")}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
              if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((value) => Math.min(filtered.length - 1, value + 1)); return; }
              if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((value) => Math.max(0, value - 1)); return; }
              if (event.key === "Enter") { event.preventDefault(); execute(filtered[activeIndex]); }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-palette-results">
          {filtered.length ? filtered.map((action, index) => (
            <button
              key={action.id}
              className={index === activeIndex ? "active" : ""}
              disabled={action.disabled}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => execute(action)}
            >
              <span><strong>{action.label}</strong>{action.detail && <small>{action.detail}</small>}</span>
              {action.shortcut && <kbd>{action.shortcut}</kbd>}
            </button>
          )) : <div className="command-palette-empty">{t("palette.noMatches")}</div>}
        </div>
        <div className="command-palette-footer"><span>{t("palette.navigate")}</span><span>{t("palette.run")}</span><span>WebForge 1.0.0</span></div>
      </div>
    </div>
  );
}
