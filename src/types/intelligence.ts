export type ProjectLanguageFile = {
  relativePath: string;
  content: string;
  declaration: boolean;
};

export type ProjectLanguageSnapshot = {
  files: ProjectLanguageFile[];
  sourceCount: number;
  declarationCount: number;
  totalBytes: number;
  truncated: boolean;
};
