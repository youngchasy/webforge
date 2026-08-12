export type CssUtilityFramework = "tailwind" | "bootstrap";

export type UtilityToggle = {
  label: string;
  className: string;
  group?: string;
};

const TAILWIND_HINTS = /^(?:sm:|md:|lg:|xl:|2xl:|hover:|focus:|dark:|group-|peer-|flex$|grid$|hidden$|block$|inline-|items-|justify-|content-|self-|gap-|space-[xy]-|p[trblxy]?[-[]|m[trblxy]?[-[]|w-|h-|min-w-|max-w-|min-h-|max-h-|text-|font-|leading-|tracking-|bg-|border-|rounded|shadow|opacity-|z-|overflow-|translate-|rotate-|scale-|transition|duration-|ease-|animate-)/;
const BOOTSTRAP_HINTS = /^(?:container(?:-fluid)?$|row$|col(?:-|$)|d-|flex-|justify-content-|align-items-|align-self-|gap-|g[xy]?[-]|m[trblxy]?[-]|p[trblxy]?[-]|w-|h-|text-|fw-|lh-|bg-|border|rounded|shadow|opacity-|position-|top-|bottom-|start-|end-|translate-middle)/;

export function detectCssUtilityFrameworks(projectFrameworks: string[], classes: string[]): CssUtilityFramework[] {
  const names = projectFrameworks.map((value) => value.toLowerCase());
  const result = new Set<CssUtilityFramework>();
  if (names.some((value) => value.includes("tailwind")) || classes.some((value) => TAILWIND_HINTS.test(value))) result.add("tailwind");
  if (names.some((value) => value.includes("bootstrap")) || classes.some((value) => BOOTSTRAP_HINTS.test(value))) result.add("bootstrap");
  return [...result];
}

export const utilityToggles: Record<CssUtilityFramework, UtilityToggle[]> = {
  tailwind: [
    { label: "flex", className: "flex", group: "display" },
    { label: "grid", className: "grid", group: "display" },
    { label: "block", className: "block", group: "display" },
    { label: "hidden", className: "hidden", group: "display" },
    { label: "row", className: "flex-row", group: "direction" },
    { label: "column", className: "flex-col", group: "direction" },
    { label: "justify center", className: "justify-center", group: "justify" },
    { label: "justify between", className: "justify-between", group: "justify" },
    { label: "items center", className: "items-center", group: "items" },
    { label: "gap 2", className: "gap-2", group: "gap" },
    { label: "gap 4", className: "gap-4", group: "gap" },
    { label: "w full", className: "w-full", group: "width" },
    { label: "h full", className: "h-full", group: "height" },
    { label: "rounded", className: "rounded-lg", group: "radius" },
    { label: "shadow", className: "shadow-lg", group: "shadow" },
  ],
  bootstrap: [
    { label: "flex", className: "d-flex", group: "display" },
    { label: "grid", className: "d-grid", group: "display" },
    { label: "block", className: "d-block", group: "display" },
    { label: "hidden", className: "d-none", group: "display" },
    { label: "row", className: "flex-row", group: "direction" },
    { label: "column", className: "flex-column", group: "direction" },
    { label: "justify center", className: "justify-content-center", group: "justify" },
    { label: "justify between", className: "justify-content-between", group: "justify" },
    { label: "items center", className: "align-items-center", group: "items" },
    { label: "gap 2", className: "gap-2", group: "gap" },
    { label: "gap 3", className: "gap-3", group: "gap" },
    { label: "w 100", className: "w-100", group: "width" },
    { label: "h 100", className: "h-100", group: "height" },
    { label: "rounded", className: "rounded", group: "radius" },
    { label: "shadow", className: "shadow", group: "shadow" },
  ],
};

export function toggleUtilityClass(classes: string[], framework: CssUtilityFramework, toggle: UtilityToggle): string[] {
  const known = utilityToggles[framework];
  const next = new Set(classes);
  if (next.has(toggle.className)) {
    next.delete(toggle.className);
    return [...next];
  }
  if (toggle.group) {
    for (const candidate of known) if (candidate.group === toggle.group) next.delete(candidate.className);
  }
  next.add(toggle.className);
  return [...next];
}
