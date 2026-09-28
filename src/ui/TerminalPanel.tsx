import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import type { OpenTerminal, WarRoomStore } from "../application/warRoomStore";
import { copy } from "../domain/copy";

type Props = { terminal: OpenTerminal; store: WarRoomStore };

/** In-app terminal: replays the buffered output and follows it live. */
export function TerminalPanel({ terminal, store }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [exited, setExited] = useState(false);
  const gateway = store.terminals;

  useEffect(() => {
    if (!host.current) return;
    setExited(false);
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      theme: { background: "#050912", foreground: "#e2e8f0", cursor: "#38bdf8" },
      scrollback: 10_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);

    let disposed = false;
    const cleanups: Array<() => void> = [];
    const resize = () => {
      fit.fit();
      void gateway.resize(terminal.id, term.cols, term.rows).catch(() => {});
    };

    void (async () => {
      // Subscribe before requesting the snapshot so nothing is lost in between (at worst a chunk is
      // repeated, which is harmless for a screen repaint).
      const pending: Uint8Array[] = [];
      let ready = false;
      const offOutput = await gateway.onOutput((id, data) => {
        if (id !== terminal.id) return;
        if (ready) term.write(data);
        else pending.push(data);
      });
      const offExit = await gateway.onExit((id) => id === terminal.id && setExited(true));
      cleanups.push(offOutput, offExit);
      if (disposed) return cleanups.forEach((c) => c());

      try {
        term.write(await gateway.snapshot(terminal.id));
      } catch {
        setExited(true);
      }
      pending.forEach((d) => term.write(d));
      ready = true;
      resize();
      term.focus();
    })();

    const input = term.onData((data) => void gateway.write(terminal.id, data).catch(() => setExited(true)));
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);

    return () => {
      disposed = true;
      input.dispose();
      observer.disconnect();
      cleanups.forEach((c) => c());
      term.dispose();
    };
  }, [terminal.id, gateway]);

  const close = () => {
    void gateway.close(terminal.id);
    store.closeTerminalPanel();
  };

  return (
    <aside className="terminal-panel" aria-label={copy.terminal.label(terminal.label)}>
      <header>
        <span className="dot" data-attention={exited ? "offline" : "working"} />
        <strong>{terminal.label}</strong>
        {exited && <span className="muted">{copy.terminal.exited}</span>}
        <span className="spacer" />
        <button onClick={() => store.closeTerminalPanel()} title={copy.terminal.hideTitle}>
          {copy.terminal.hide}
        </button>
        <button onClick={close} title={exited ? copy.terminal.forget : copy.terminal.kill}>
          {exited ? copy.terminal.close : copy.terminal.terminate}
        </button>
      </header>
      <div className="terminal-host" ref={host} />
    </aside>
  );
}
