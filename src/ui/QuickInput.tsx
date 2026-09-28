import { useState } from "react";
import type { WarRoomStore } from "../application/warRoomStore";
import type { SessionView } from "../domain/attention";
import { copy } from "../domain/copy";

/** Quick message to the session, as if typed into its terminal. */
export function QuickInput({ session, store }: { session: SessionView; store: WarRoomStore }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    if (await store.send(session, text)) setText("");
    setSending(false);
  };

  return (
    <form className="quick-input" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={copy.quickInput.placeholder}
        disabled={sending}
        aria-label={copy.quickInput.label}
      />
    </form>
  );
}
