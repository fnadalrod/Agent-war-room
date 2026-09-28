import { useState } from "react";
import { copy } from "../domain/copy";
import { CheckIcon, CopyIcon } from "./icons";

/** Copies `text` to the clipboard and ticks for a moment. */
export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="icon"
      title={copy.detail.copy}
      aria-label={copy.detail.copy}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        })
      }
    >
      {done ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    </button>
  );
}
