export type DeployProviderId = "github-pages" | "cloudflare" | "netlify" | "vercel";

export type DeployProviderConfig = {
  outputDir: string;
  projectName: string;
  accountId: string;
  siteId: string;
  production: boolean;
};

export type DeployConfig = {
  githubPages: DeployProviderConfig;
  cloudflare: DeployProviderConfig;
  netlify: DeployProviderConfig;
  vercel: DeployProviderConfig;
};

export type DeployProviderState = {
  id: DeployProviderId;
  cliAvailable: boolean;
  cliVersion: string | null;
  credentialStored: boolean;
};

export type DeployResult = {
  provider: DeployProviderId | string;
  success: boolean;
  command: string;
  output: string;
  url: string | null;
};
