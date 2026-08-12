export type ExtensionCapability =
  | "workspace.read"
  | "workspace.write"
  | "editor.commands"
  | "ui.panels"
  | "designer.components"
  | "project.templates"
  | "editor.theme"
  | "project.adapters"
  | "diagnostics.contribute"
  | "formatters.contribute"
  | "languages.contribute";

export type ExtensionContributionCounts = {
  commands: number;
  panels: number;
  components: number;
  templates: number;
  themes: number;
  projectAdapters: number;
  linters: number;
  formatters: number;
  languages: number;
};

export type ExtensionCommandSummary = {
  extensionId: string;
  id: string;
  title: string;
  detail: string;
  capability: ExtensionCapability | null;
  available: boolean;
};

export type ExtensionPanelSummary = {
  extensionId: string;
  id: string;
  title: string;
  body: string;
};

export type ExtensionThemeSummary = {
  extensionId: string;
  id: string;
  label: string;
  tokens: Record<string, string>;
};

export type ExtensionRecord = {
  id: string;
  name: string;
  version: string;
  description: string;
  publisher: string;
  enabled: boolean;
  requestedCapabilities: ExtensionCapability[];
  grantedCapabilities: ExtensionCapability[];
  missingCapabilities: ExtensionCapability[];
  contributions: ExtensionContributionCounts;
  commands: ExtensionCommandSummary[];
  panels: ExtensionPanelSummary[];
  themes: ExtensionThemeSummary[];
};

export type ExtensionCatalogEntry = {
  id: string;
  name: string;
  version: string;
  description: string;
  publisher: string;
  installed: boolean;
  capabilities: ExtensionCapability[];
  contributions: ExtensionContributionCounts;
};

export type ExtensionComponentContribution = {
  extensionId: string;
  packId: string;
  id: string;
  label: string;
  category: string;
  snippet: string;
};

export type ExtensionTemplateSummary = {
  extensionId: string;
  id: string;
  name: string;
  description: string;
  framework: string;
};

export type ExtensionCommandAction =
  | { type: "showMessage"; message: string }
  | { type: "openFile"; path: string; line?: number | null; column?: number | null }
  | { type: "createFile"; path: string; content: string };

export type CreatedExtensionProject = {
  path: string;
  name: string;
  extensionId: string;
  templateId: string;
  filesCreated: number;
};
