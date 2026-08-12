import { useI18n } from "../i18n";

export function SidebarPlaceholder({ kind }: { kind: "components" | "extensions" }) {
  const { t } = useI18n();
  return <div className="sidebar-feature"><div className="panel-heading"><span>{kind === "components" ? t("activity.components") : t("activity.extensions")}</span></div><div className="sidebar-empty">{kind === "components" ? t("sidebar.componentsHint") : t("sidebar.extensionsHint")}</div></div>;
}
