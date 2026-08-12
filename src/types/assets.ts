export type AssetKind = "image" | "svg" | "font" | "video" | "audio" | "other";

export type AssetEntry = {
  path: string;
  name: string;
  extension: string;
  kind: AssetKind;
  sizeBytes: number;
  references: number;
  unused: boolean;
};

export type AssetInventory = {
  assets: AssetEntry[];
  totalBytes: number;
  scannedTextFiles: number;
};

export type AssetOptimizeResult = {
  path: string;
  beforeBytes: number;
  afterBytes: number;
  savedBytes: number;
};
