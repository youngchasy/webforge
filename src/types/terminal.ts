export type TerminalSessionStatus = {
  id: string;
  title: string;
  shell: string;
  running: boolean;
  exitCode: number | null;
  cols: number;
  rows: number;
};

export type TerminalOutputBatch = {
  cursor: number;
  chunks: string[];
  status: TerminalSessionStatus;
};

export type ReleaseUpdateConfig = {
  configured: boolean;
  channel: string;
  endpoint: string | null;
};

export type ReleaseUpdateInfo = {
  available: boolean;
  version: string | null;
  currentVersion: string;
  date: string | null;
  body: string | null;
};
