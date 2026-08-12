import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import type { TerminalSessionStatus } from "../types/terminal";
import { useI18n } from "../i18n";
import type { BuiltinThemeId } from "../types/settings";
import { terminalThemeFor } from "../lib/themes";

type Props = {
  session: TerminalSessionStatus;
  uiTheme: BuiltinThemeId;
  output: string;
  onInput: (sessionId: string, data: string) => void;
  onResize: (sessionId: string, cols: number, rows: number) => void;
};

export function XtermTerminalSurface({ session, uiTheme, output, onInput, onResize }: Props) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const writtenRef = useRef("");
  const lastSizeRef = useRef("");
  const inputRef = useRef(onInput);
  const resizeRef = useRef(onResize);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);

  useEffect(() => { inputRef.current = onInput; }, [onInput]);
  useEffect(() => { resizeRef.current = onResize; }, [onResize]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      convertEol: false,
      allowProposedApi: false,
      scrollback: 10_000,
      linkHandler: { activate: () => { /* terminal OSC links stay inert inside the privileged workbench */ } },
      fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'Liberation Mono', monospace",
      fontSize: 12,
      lineHeight: 1.15,
      letterSpacing: 0,
      theme: terminalThemeFor(uiTheme),
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;
    searchRef.current = search;
    writtenRef.current = "";

    const dataDisposable = terminal.onData((data) => inputRef.current(session.id, data));
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      const key = `${cols}:${rows}`;
      if (key === lastSizeRef.current) return;
      lastSizeRef.current = key;
      resizeRef.current(session.id, cols, rows);
    });
    terminal.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && event.type === "keydown") {
        setSearchOpen(true);
        return false;
      }
      return true;
    });

    const fitNow = () => {
      try { fit.fit(); } catch { /* host can be mid-layout */ }
    };
    const observer = new ResizeObserver(() => fitNow());
    observer.observe(host);
    requestAnimationFrame(() => {
      fitNow();
      terminal.focus();
    });

    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, [session.id]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalThemeFor(uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const previous = writtenRef.current;
    if (!previous) {
      if (output) terminal.write(output);
    } else if (output.startsWith(previous)) {
      const delta = output.slice(previous.length);
      if (delta) terminal.write(delta);
    } else if (output !== previous) {
      terminal.reset();
      terminal.write(output);
    }
    writtenRef.current = output;
  }, [output]);

  useEffect(() => {
    if (searchOpen) window.setTimeout(() => document.querySelector<HTMLInputElement>(".xterm-search-input")?.focus(), 0);
    else {
      searchRef.current?.clearDecorations();
      terminalRef.current?.focus();
    }
  }, [searchOpen]);

  const findTerm = (term: string, next: boolean) => {
    if (!term) return;
    const options = { caseSensitive: matchCase, incremental: true, decorations: { matchOverviewRuler: "#5a86d6", activeMatchColorOverviewRuler: "#f5c542", matchBackground: "#264f78", activeMatchBackground: "#515c6a" } };
    if (next) searchRef.current?.findNext(term, options);
    else searchRef.current?.findPrevious(term, options);
  };
  const find = (next: boolean) => findTerm(query, next);

  return (
    <div className="xterm-terminal-wrap">
      {searchOpen && (
        <div className="xterm-search-bar">
          <input
            className="xterm-search-input"
            value={query}
            placeholder={t("terminal.searchPlaceholder")}
            onChange={(event) => { const value = event.target.value; setQuery(value); if (value) findTerm(value, true); else searchRef.current?.clearDecorations(); }}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); find(!event.shiftKey); }
              if (event.key === "Escape") { event.preventDefault(); setSearchOpen(false); }
            }}
          />
          <button className={matchCase ? "active" : ""} title={t("search.matchCase")} onClick={() => setMatchCase((value) => !value)}>Aa</button>
          <button title={t("terminal.previousMatch")} onClick={() => find(false)}>↑</button>
          <button title={t("terminal.nextMatch")} onClick={() => find(true)}>↓</button>
          <button title={t("common.close")} onClick={() => setSearchOpen(false)}>×</button>
        </div>
      )}
      <div ref={hostRef} className="xterm-terminal-host" />
      <div className="pty-terminal-status">{session.shell} · {session.cols}×{session.rows}{session.running ? ` · ${t("bottom.terminalRunning")}` : ` · ${t("bottom.terminalExit", { code: session.exitCode ?? "—" })}`}</div>
    </div>
  );
}
