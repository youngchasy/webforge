export type ProjectAdapterId = "static" | "vite" | "react-vite" | "vue-vite" | "svelte-vite" | "node" | string;

export type ProjectInfo = {
  adapter: ProjectAdapterId;
  label: string;
  framework: string | null;
  frameworkVersion: string | null;
  vite: boolean;
  viteConfigPath: string | null;
  typescript: boolean;
  packageJson: boolean;
  dependenciesInstalled: boolean;
  preferredPackageManager: string | null;
  devScript: string | null;
  devServerSupported: boolean;
  buildScript: string | null;
  buildSupported: boolean;
  buildOutputDir: string | null;
  scripts: string[];
  cssFrameworks: string[];
  entryPath: string | null;
};

export type WorkspaceSecurity = {
  trusted: boolean;
  terminalAllowed: boolean;
  gitNetworkAllowed: boolean;
};

export type RuntimeTool = {
  available: boolean;
  version: string | null;
  source: "bundled" | "system" | "override" | string | null;
};

export type RuntimeEnvironment = {
  node: RuntimeTool;
  npm: RuntimeTool;
  pnpm: RuntimeTool;
  yarn: RuntimeTool;
  bun: RuntimeTool;
};

export type RuntimeStatus = {
  running: boolean;
  ready: boolean;
  mode: "dev" | "install" | string | null;
  command: string | null;
  previewUrl: string | null;
  packageManager: string | null;
  exitCode: number | null;
};

export type RuntimeLogBatch = {
  cursor: number;
  lines: string[];
  status: RuntimeStatus;
};
