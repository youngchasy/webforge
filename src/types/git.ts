export type GitChange = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  untracked: boolean;
  conflicted: boolean;
};

export type GitStatus = {
  available: boolean;
  repository: boolean;
  repoRoot: string | null;
  workspaceRootRepository: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
  error: string | null;
};

export type GitBranch = {
  name: string;
  current: boolean;
  upstream: string | null;
  commit: string;
  subject: string;
};

export type GitCommit = {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  decorations: string;
};

export type GitRemote = {
  name: string;
  fetchUrl: string;
  pushUrl: string;
};

export type GitConflictSnapshot = {
  path: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  working: string | null;
};

export type GitNetworkResult = {
  operation: "fetch" | "pull" | "push" | string;
  remote: string;
  branch: string | null;
  output: string;
};

export type GitRemoteBranch = {
  name: string;
  remote: string;
  branch: string;
  commit: string;
  subject: string;
};

export type GitOperationState = {
  merge: boolean;
  rebase: boolean;
  cherryPick: boolean;
};

export type GitStashEntry = {
  reference: string;
  hash: string;
  date: string;
  message: string;
};

export type GitTag = {
  name: string;
  commit: string;
  date: string;
  subject: string;
  annotated: boolean;
};

export type GitGraphCommit = {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  decorations: string;
};

export type GitBlameLine = {
  lineNumber: number;
  commit: string;
  shortCommit: string;
  author: string;
  email: string;
  authorTime: number;
  summary: string;
  content: string;
};

export type GitCredentialState = {
  credentialHelperConfigured: boolean;
  credentialHelperKind: "none" | "credential-manager" | "os-keychain" | "libsecret" | "windows-credential-store" | "custom-helper" | string;
  sshAgentAvailable: boolean;
  httpsRemoteConfigured: boolean;
  sshRemoteConfigured: boolean;
  interactivePromptDisabled: boolean;
  secretsExposedToWebview: boolean;
};
