export type DevToolsHeader = { name: string; value: string };

export type DevToolsNetworkEntry = {
  id: string;
  method: string;
  url: string;
  status: number | null;
  statusText: string;
  resourceType: string;
  startTime: number;
  durationMs: number | null;
  requestHeaders: DevToolsHeader[];
  responseHeaders: DevToolsHeader[];
  requestBody: string | null;
  responseBody: string | null;
  transferSize: number | null;
  error: string | null;
};

export type DevToolsStorageEntry = { key: string; value: string; redacted: boolean };
export type DevToolsCookieEntry = { name: string; value: string; redacted: boolean };
export type DevToolsIndexedDbEntry = { name: string; version: number };

export type DevToolsStorageSnapshot = {
  origin: string;
  cookies: DevToolsCookieEntry[];
  localStorage: DevToolsStorageEntry[];
  sessionStorage: DevToolsStorageEntry[];
  indexedDb: DevToolsIndexedDbEntry[];
  capturedAt: number;
};

export type DevToolsPerformanceSnapshot = {
  url: string;
  domContentLoadedMs: number | null;
  loadMs: number | null;
  firstPaintMs: number | null;
  firstContentfulPaintMs: number | null;
  largestContentfulPaintMs: number | null;
  cumulativeLayoutShift: number;
  longTaskCount: number;
  longTaskTimeMs: number;
  resourceCount: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  capturedAt: number;
};

export type RuntimeAccessibilityFinding = {
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  selector: string;
  sourceId: string | null;
  contrastRatio: number | null;
};

export type RuntimeAccessibilitySnapshot = {
  findings: RuntimeAccessibilityFinding[];
  checkedNodes: number;
  capturedAt: number;
};

export type PreviewDevToolsCommand = {
  action: "refresh" | "clearLocalStorage" | "clearSessionStorage" | "clearCookies";
  token: number;
};

export type BundleAsset = {
  path: string;
  extension: string;
  sizeBytes: number;
};

export type BundleGroup = {
  kind: string;
  files: number;
  sizeBytes: number;
};

export type BundleAnalysis = {
  outputDir: string;
  exists: boolean;
  fileCount: number;
  totalBytes: number;
  groups: BundleGroup[];
  largest: BundleAsset[];
  sourcemapBytes: number;
};
