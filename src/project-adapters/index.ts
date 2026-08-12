import type { ProjectAdapterId, ProjectInfo } from "../types/runtime";

export type ProjectAdapter = {
  id: ProjectAdapterId;
  title: string;
  accent: string;
  description: string;
  devServer: boolean;
};

const adapters: Record<string, ProjectAdapter> = {
  static: {
    id: "static",
    title: "Static",
    accent: "HTML",
    description: "Direct HTML/CSS/JS preview through WebForge's local static server.",
    devServer: false,
  },
  vite: {
    id: "vite",
    title: "Vite",
    accent: "VITE",
    description: "Vanilla Vite project with supervised local dev server.",
    devServer: true,
  },
  react: {
    id: "react",
    title: "React",
    accent: "REACT",
    description: "React project detected. WebForge 1.0.0 can supervise Vite and safely edit mapped native JSX markup in bridge-enabled previews.",
    devServer: false,
  },
  "react-vite": {
    id: "react-vite",
    title: "React + Vite",
    accent: "REACT",
    description: "React project using the Vite development workflow.",
    devServer: true,
  },
  vue: {
    id: "vue",
    title: "Vue",
    accent: "VUE",
    description: "Vue project detected. WebForge 1.0.0 can supervise Vite and safely edit mapped Vue template markup in bridge-enabled previews.",
    devServer: false,
  },
  "vue-vite": {
    id: "vue-vite",
    title: "Vue + Vite",
    accent: "VUE",
    description: "Vue project using the Vite development workflow.",
    devServer: true,
  },
  svelte: {
    id: "svelte",
    title: "Svelte",
    accent: "SVELTE",
    description: "Svelte project detected. WebForge 1.0.0 can supervise Vite and safely edit mapped Svelte markup in bridge-enabled previews.",
    devServer: false,
  },
  "svelte-vite": {
    id: "svelte-vite",
    title: "Svelte + Vite",
    accent: "SVELTE",
    description: "Svelte project using the Vite development workflow.",
    devServer: true,
  },
  node: {
    id: "node",
    title: "Node project",
    accent: "NODE",
    description: "Package-based web project. Runtime execution is restricted to supported adapters.",
    devServer: false,
  },
};

export function adapterFor(project: ProjectInfo | null): ProjectAdapter {
  if (!project) return adapters.static;
  return adapters[project.adapter] ?? {
    id: project.adapter,
    title: project.label,
    accent: "WEB",
    description: "Detected web project.",
    devServer: project.vite,
  };
}

export function projectStackLabel(project: ProjectInfo | null): string {
  if (!project) return "Static demo";
  const pieces = [project.label];
  if (project.typescript) pieces.push("TypeScript");
  if (project.cssFrameworks.length) pieces.push(project.cssFrameworks.join(" + "));
  return pieces.join(" · ");
}
