import type { BuiltinThemeId } from "../types/settings";

export type BuiltinThemeDefinition = {
  id: BuiltinThemeId;
  labelKey: string;
  descriptionKey: string;
  dark: boolean;
  glass: boolean;
  preview: [string, string, string];
};

export const BUILTIN_THEMES: BuiltinThemeDefinition[] = [
  { id: "midnight", labelKey: "settings.themeMidnight", descriptionKey: "settings.themeMidnightHelp", dark: true, glass: false, preview: ["#0e1014", "#171b21", "#6e96ef"] },
  { id: "graphite", labelKey: "settings.themeGraphite", descriptionKey: "settings.themeGraphiteHelp", dark: true, glass: false, preview: ["#181818", "#242424", "#8aa4d6"] },
  { id: "slate", labelKey: "settings.themeSlate", descriptionKey: "settings.themeSlateHelp", dark: true, glass: false, preview: ["#2b2f34", "#3a3f45", "#8eb3e6"] },
  { id: "light", labelKey: "settings.themeLight", descriptionKey: "settings.themeLightHelp", dark: false, glass: false, preview: ["#f4f6f8", "#ffffff", "#3d6fb6"] },
  { id: "paper", labelKey: "settings.themePaper", descriptionKey: "settings.themePaperHelp", dark: false, glass: false, preview: ["#f3efe7", "#fffdf8", "#7b6aa8"] },
  { id: "glass", labelKey: "settings.themeGlass", descriptionKey: "settings.themeGlassHelp", dark: true, glass: true, preview: ["#20252d", "rgba(45, 51, 61, .76)", "#92b8ff"] },
];

export const BUILTIN_THEME_IDS = new Set<BuiltinThemeId>(BUILTIN_THEMES.map((theme) => theme.id));

export function normalizeBuiltinTheme(value: unknown): BuiltinThemeId {
  return typeof value === "string" && BUILTIN_THEME_IDS.has(value as BuiltinThemeId)
    ? value as BuiltinThemeId
    : "graphite";
}

export function isLightTheme(theme: BuiltinThemeId): boolean {
  return theme === "light" || theme === "paper";
}

export function terminalThemeFor(theme: BuiltinThemeId) {
  if (theme === "light") return {
    background: "#ffffff", foreground: "#252a31", cursor: "#315f9a", cursorAccent: "#ffffff", selectionBackground: "#bed4ef88",
    black: "#2f3337", red: "#b4232b", green: "#16804a", yellow: "#8a6a00", blue: "#2b63a6", magenta: "#8749a8", cyan: "#137b87", white: "#d8dce2",
    brightBlack: "#6f7680", brightRed: "#d6454e", brightGreen: "#24945b", brightYellow: "#a77f00", brightBlue: "#3d79c7", brightMagenta: "#a05cc2", brightCyan: "#2094a2", brightWhite: "#ffffff",
  };
  if (theme === "paper") return {
    background: "#fffdf8", foreground: "#38342f", cursor: "#7562a3", cursorAccent: "#fffdf8", selectionBackground: "#d9ceeaaa",
    black: "#3e3a36", red: "#a83a43", green: "#4d7c50", yellow: "#8a6a2b", blue: "#526f9f", magenta: "#765aa0", cyan: "#477d80", white: "#e8e0d4",
    brightBlack: "#817a71", brightRed: "#c4515b", brightGreen: "#659665", brightYellow: "#a9843c", brightBlue: "#6988b7", brightMagenta: "#8f71b6", brightCyan: "#60969a", brightWhite: "#fffdf8",
  };
  if (theme === "slate") return {
    background: "#25292e", foreground: "#e0e4e9", cursor: "#9ec3f2", cursorAccent: "#25292e", selectionBackground: "#5278a677",
    black: "#16191d", red: "#f07178", green: "#80c990", yellow: "#e6c07b", blue: "#78a9e3", magenta: "#c593d9", cyan: "#74c7d4", white: "#d8dde4",
    brightBlack: "#747c86", brightRed: "#ff8890", brightGreen: "#98dda6", brightYellow: "#f3d18d", brightBlue: "#93bef0", brightMagenta: "#d7a7e6", brightCyan: "#8adbe7", brightWhite: "#ffffff",
  };
  if (theme === "graphite") return {
    background: "#151515", foreground: "#dedede", cursor: "#9db6e3", cursorAccent: "#151515", selectionBackground: "#46648d88",
    black: "#090909", red: "#e06c75", green: "#83c991", yellow: "#dfbf72", blue: "#74a2dc", magenta: "#bc8bd1", cyan: "#6dbcc7", white: "#d7d7d7",
    brightBlack: "#696969", brightRed: "#ef858d", brightGreen: "#98dba4", brightYellow: "#eccf8c", brightBlue: "#8bb6e8", brightMagenta: "#cda0df", brightCyan: "#85d0d8", brightWhite: "#ffffff",
  };
  if (theme === "glass") return {
    background: "#1d2229", foreground: "#e3e8f0", cursor: "#9fc1ff", cursorAccent: "#1d2229", selectionBackground: "#5d82bf88",
    black: "#0d1117", red: "#ee7b83", green: "#76d39a", yellow: "#e7c47c", blue: "#83b0ef", magenta: "#c79ade", cyan: "#7bcbd9", white: "#e2e7ee",
    brightBlack: "#6e7887", brightRed: "#fa9299", brightGreen: "#8de0ac", brightYellow: "#f0d18d", brightBlue: "#9ac1f5", brightMagenta: "#d8ace8", brightCyan: "#91dbe5", brightWhite: "#ffffff",
  };
  return {
    background: "#090c10", foreground: "#d7dce3", cursor: "#d7dce3", cursorAccent: "#090c10", selectionBackground: "#264f78aa",
    black: "#000000", red: "#f14c4c", green: "#23d18b", yellow: "#f5f543", blue: "#3b8eea", magenta: "#d670d6", cyan: "#29b8db", white: "#e5e5e5",
    brightBlack: "#666666", brightRed: "#f14c4c", brightGreen: "#23d18b", brightYellow: "#f5f543", brightBlue: "#3b8eea", brightMagenta: "#d670d6", brightCyan: "#29b8db", brightWhite: "#ffffff",
  };
}
