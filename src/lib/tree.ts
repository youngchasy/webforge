import type { WorkspaceEntry } from "../types/workspace";

export function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function findEntry(root: WorkspaceEntry, relativePath: string): WorkspaceEntry | undefined {
  if (root.relativePath === relativePath) return root;
  for (const child of root.children ?? []) {
    const found = findEntry(child, relativePath);
    if (found) return found;
  }
  return undefined;
}

export function findFirstHtml(root: WorkspaceEntry): string | undefined {
  const rootIndex = root.children?.find((child) => child.kind === "file" && /^index\.html?$/i.test(child.name));
  if (rootIndex) return rootIndex.relativePath;
  for (const child of root.children ?? []) {
    if (child.kind === "file" && /\.html?$/i.test(child.name)) return child.relativePath;
    if (child.kind === "directory") {
      const nested = findFirstHtml(child);
      if (nested) return nested;
    }
  }
  return undefined;
}

export function renamePathPrefix(path: string, from: string, to: string): string {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
}

export function pathIsInside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

function sortEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function addTreeEntry(root: WorkspaceEntry, parent: string, entry: WorkspaceEntry): WorkspaceEntry {
  if (root.relativePath === parent) {
    return { ...root, children: sortEntries([...(root.children ?? []), entry]) };
  }
  return {
    ...root,
    children: root.children?.map((child) =>
      child.kind === "directory" ? addTreeEntry(child, parent, entry) : child,
    ),
  };
}

export function removeTreeEntry(root: WorkspaceEntry, path: string): WorkspaceEntry {
  return {
    ...root,
    children: root.children
      ?.filter((child) => child.relativePath !== path)
      .map((child) => child.kind === "directory" ? removeTreeEntry(child, path) : child),
  };
}

export function renameTreeEntry(root: WorkspaceEntry, from: string, to: string): WorkspaceEntry {
  const rewrite = (entry: WorkspaceEntry): WorkspaceEntry => {
    const relativePath = renamePathPrefix(entry.relativePath, from, to);
    const renamed = entry.relativePath === from;
    return {
      ...entry,
      name: renamed ? baseName(to) : entry.name,
      relativePath,
      children: entry.children?.map(rewrite),
    };
  };
  return rewrite(root);
}
