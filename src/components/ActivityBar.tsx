import { useI18n } from "../i18n";

export type SidebarSection = "explorer" | "search" | "sourceControl" | "packages" | "assets" | "health" | "devtools" | "deploy" | "components" | "extensions";

type Props = {
  active: SidebarSection;
  onChange: (section: SidebarSection) => void;
  onOpenSettings: () => void;
};

export function ActivityBar({ active, onChange, onOpenSettings }: Props) {
  const { t } = useI18n();
  const button = (section: SidebarSection, glyph: string, title: string) => <button className={`activity-button ${active === section ? "active" : ""}`} title={title} onClick={() => onChange(section)}>{glyph}</button>;
  return (
    <nav className="activity-bar" aria-label={t("activity.aria")}>
      {button("explorer", "▱", t("activity.explorer"))}
      {button("search", "⌕", t("activity.search"))}
      {button("sourceControl", "⑂", t("activity.sourceControl"))}
      {button("packages", "◫", t("activity.packages"))}
      {button("assets", "▧", t("activity.assets"))}
      {button("health", "✓", t("activity.health"))}
      {button("devtools", "◈", t("activity.devtools"))}
      {button("deploy", "⇧", t("activity.deploy"))}
      {button("components", "◇", t("activity.components"))}
      {button("extensions", "▦", t("activity.extensions"))}
      <div className="activity-spacer" />
      <button className="activity-button" title={t("activity.settings")} onClick={onOpenSettings}>⚙</button>
    </nav>
  );
}
