import { useState } from "react";
import type { WarRoomStore } from "../application/warRoomStore";
import type { SessionView } from "../domain/attention";
import { copy } from "../domain/copy";

/** Quick message to the session, as if typed into its terminal. */
export function QuickInput({
  session,
  store,
  autoFocus,
  onSent,
}: {
  session: SessionView;
  store: WarRoomStore;
  /** Came from a notification's "Reply": the cursor goes straight here. */
  autoFocus?: boolean;
  /** After a message is delivered (e.g. to close the menu holding it). */
  onSent?: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    if (await store.send(session, text)) {
      setText("");
      onSent?.();
    }
    setSending(false);
  };

  return (
    <form className="quick-input" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={session.awaiting_question ? copy.quickInput.answerPlaceholder : copy.quickInput.placeholder}
        disabled={sending}
        aria-label={session.awaiting_question ? copy.quickInput.answerLabel : copy.quickInput.label}
      />
      <button className="primary" type="submit" disabled={sending || !text.trim()}>
        {copy.quickInput.send}
      </button>
    </form>
  );
}
