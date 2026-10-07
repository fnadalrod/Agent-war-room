import { useState } from "react";
import type { WarRoomStore } from "../application/warRoomStore";
import type { SessionView } from "../domain/attention";
import { copy } from "../domain/copy";

/** Answers a live structured question through the provider's waiting hook. */
export function QuestionForm({ session, store }: { session: SessionView; store: WarRoomStore }) {
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [sending, setSending] = useState(false);

  const answerAt = (index: number) => custom[index]?.trim() || selected[index]?.join(", ") || "";
  const complete = session.questions.length > 0 && session.questions.every((_, index) => answerAt(index));

  const choose = (index: number, label: string, multiple: boolean) => {
    setCustom((current) => ({ ...current, [index]: "" }));
    setSelected((current) => {
      const chosen = current[index] ?? [];
      const next = multiple
        ? chosen.includes(label)
          ? chosen.filter((item) => item !== label)
          : [...chosen, label]
        : [label];
      return { ...current, [index]: next };
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!complete) return;
    const answers = Object.fromEntries(session.questions.map((question, index) => [question.question, answerAt(index)]));
    setSending(true);
    await store.answerQuestion(session, answers);
    setSending(false);
  };

  return (
    <form className="question-form" onSubmit={submit}>
      {session.questions.map((question, index) => (
        <fieldset key={`${index}:${question.question}`} disabled={sending}>
          <legend>
            {question.header && <span className="tag">{question.header}</span>}
            <span>{question.question}</span>
          </legend>
          {question.multi_select && <span className="muted small">{copy.quickInput.multipleAllowed}</span>}
          {question.options.length > 0 && (
            <div className="question-options">
              {question.options.map((option) => {
                const checked = selected[index]?.includes(option.label) ?? false;
                return (
                  <label key={option.label} className="question-option" data-selected={checked}>
                    <input
                      type={question.multi_select ? "checkbox" : "radio"}
                      name={`question-${index}`}
                      checked={checked}
                      onChange={() => choose(index, option.label, question.multi_select)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      {option.description && <small>{option.description}</small>}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <input
            className="question-other"
            value={custom[index] ?? ""}
            onChange={(event) => setCustom((current) => ({ ...current, [index]: event.target.value }))}
            placeholder={copy.quickInput.otherAnswer}
            aria-label={copy.quickInput.answerLabel}
          />
        </fieldset>
      ))}
      <button className="primary" type="submit" disabled={sending || !complete}>
        {session.questions.length === 1 ? copy.quickInput.sendAnswers : copy.quickInput.sendAnswersOther}
      </button>
      <span className="muted small">{copy.detail.answerInTerminal}</span>
    </form>
  );
}
