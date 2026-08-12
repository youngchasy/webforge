export type AutoSaveMode = "off" | "afterDelay";
export type WordWrapMode = "off" | "on";
export type BuiltinThemeId = "midnight" | "graphite" | "slate" | "light" | "paper" | "glass";

export type WebForgeCommandId =
  | "commandPalette"
  | "openFolder"
  | "search"
  | "sourceControl"
  | "settings"
  | "save"
  | "saveAll"
  | "newProject"
  | "runProject";

export type IdeSettings = {
  appearance: {
    theme: BuiltinThemeId;
  };
  editor: {
    fontSize: number;
    lineHeight: number;
    tabSize: number;
    insertSpaces: boolean;
    wordWrap: WordWrapMode;
    minimap: boolean;
    formatOnSave: boolean;
  };
  files: {
    autoSave: AutoSaveMode;
    autoSaveDelay: number;
    restoreSession: boolean;
    hotExit: boolean;
  };
  search: {
    useNativeIndex: boolean;
    defaultExclude: string;
    maxResults: number;
  };
  keybindings: Record<WebForgeCommandId, string>;
};

export type WorkspaceSettings = Partial<{
  editor: Partial<IdeSettings["editor"]>;
  files: Partial<IdeSettings["files"]>;
  search: Partial<IdeSettings["search"]>;
  keybindings: Partial<IdeSettings["keybindings"]>;
}>;

export type RecoverySnapshot = {
  version: 1 | 2;
  appVersion?: string;
  workspacePath: string;
  savedAt: number;
  openPaths: string[];
  activePath: string;
  dirtyBuffers: Array<{ path: string; content: string; savedContent: string }>;
};
