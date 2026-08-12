export type ProjectTemplateId = "static" | "react" | "vue" | "svelte";
export type CssPreset = "css" | "tailwind";

export type ExtensionTemplateSelection = {
  extensionId: string;
  templateId: string;
};

export type CreateProjectRequest = {
  parentPath: string;
  name: string;
  template: ProjectTemplateId;
  typescript: boolean;
  cssPreset: CssPreset;
  extensionTemplate?: ExtensionTemplateSelection | null;
};

export type CreatedProject = {
  path: string;
  name: string;
  template: string;
  filesCreated: number;
};
