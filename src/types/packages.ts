export type PackageDependencyKind = "dependency" | "devDependency";

export type PackageDependency = {
  name: string;
  requested: string;
  kind: PackageDependencyKind;
};

export type PackageScript = { name: string; command: string };

export type PackageManifest = {
  available: boolean;
  manager: string | null;
  packageManagerField: string | null;
  lockfile: string | null;
  dependencies: PackageDependency[];
  scripts: PackageScript[];
};

export type PackageOutdatedEntry = {
  name: string;
  current: string | null;
  wanted: string | null;
  latest: string | null;
  kind: PackageDependencyKind | null;
};

export type PackageCommandResult = {
  success: boolean;
  exitCode: number | null;
  command: string;
  output: string;
  outdated: PackageOutdatedEntry[];
};
