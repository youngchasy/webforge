export type DebugBrowserInfo = {
  id: string;
  label: string;
  available: boolean;
  path: string | null;
};

export type DebugRemoteValue = {
  type: string;
  subtype?: string | null;
  className?: string | null;
  description?: string | null;
  value?: unknown;
  unserializableValue?: string | null;
  objectId?: string | null;
};

export type DebugProperty = {
  name: string;
  value: DebugRemoteValue | null;
  enumerable: boolean;
  configurable: boolean;
  writable: boolean | null;
};

export type DebugScope = {
  type: string;
  name: string | null;
  objectId: string | null;
  description: string | null;
};

export type DebugCallFrame = {
  callFrameId: string;
  functionName: string;
  url: string;
  line: number;
  column: number;
  scopes: DebugScope[];
};

export type DebugScript = {
  scriptId: string;
  url: string;
  sourceMapUrl: string | null;
};

export type DebugLocation = {
  scriptId?: string | null;
  url?: string | null;
  line: number;
  column: number;
};

export type DebugBreakpointCommandResult = {
  breakpointId?: string;
  locations?: Array<{
    scriptId?: string;
    lineNumber?: number;
    columnNumber?: number;
  }>;
};

export type DebugBreakpoint = {
  id: string;
  path: string;
  line: number;
  column: number;
  enabled: boolean;
  resolved: boolean;
  remoteId: string | null;
  runtimeUrl: string | null;
};

export type BrowserDebugStatus = {
  running: boolean;
  connected: boolean;
  browserId: string | null;
  browserLabel: string | null;
  pid: number | null;
  port: number | null;
  targetId: string | null;
  targetTitle: string | null;
  targetUrl: string | null;
  paused: boolean;
  pauseReason: string | null;
  callFrames: DebugCallFrame[];
  scriptCount: number;
  scripts: DebugScript[];
  error: string | null;
};

export type BrowserDebugEvent = {
  cursor: number;
  kind: string;
  text: string;
  url: string | null;
  line: number | null;
  column: number | null;
};

export type BrowserDebugEventBatch = {
  cursor: number;
  events: BrowserDebugEvent[];
  status: BrowserDebugStatus;
};

export type DebugConfiguration = {
  id: string;
  label: string;
  url: string;
  available: boolean;
  browser?: string;
  target?: "dev" | "dist" | "url";
  custom?: boolean;
};

export type DebugLaunchConfiguration = {
  id: string;
  name: string;
  type: "browser";
  browser?: string;
  target?: "dev" | "dist" | "url";
  url?: string;
};

export type DebugLaunchFile = {
  version: 1;
  configurations: DebugLaunchConfiguration[];
};
