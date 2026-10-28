import { useState, type FormEvent } from "react";

import type { HumanAnswer } from "../lib/api";
import type { SectionState } from "../lib/runState";

const PLACEHOLDER = /\[DA CONFERMARE[^\]]*\]/g;

function questionOf(placeholder: string): string {
  return placeholder.replace(/^\[DA CONFERMARE:?\s*/, "").replace(/\]$/, "") || "Dato da confermare";
}

interface Props {
  section: SectionState;
  onResume: (answers: HumanAnswer[], note: string) => Promise<void>;
}

/** Intervento umano: conferma i dati mancanti e rilancia la catena dal Writer della sezione. */
export function OperatorForm({ section, onResume }: Props) {
  const placeholders = [...new Set(section.text.match(PLACEHOLDER) ?? [])];
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answers = placeholders
    .map((placeholder) => ({ placeholder, value: (values[placeholder] ?? "").trim() }))
    .filter((answer) => answer.value);
  const canSubmit = (answers.length > 0 || note.trim().length > 0) && !isSending;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSending(true);
    setError(null);
    try {
      await onResume(answers, note.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossibile riprendere l'elaborazione");
      setIsSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border border-orange-500/30 bg-orange-500/5 p-3">
      <div>
        <p className="text-[12px] font-semibold text-orange-700 dark:text-orange-300">Intervento operatore</p>
        <p className="text-[11.5px] text-muted">
          La sezione verrà riscritta con queste informazioni e ricontrollata da tutti gli agenti successivi; poi verrà rigenerato il documento.
        </p>
      </div>
      {placeholders.map((placeholder) => (
        <label key={placeholder} className="block text-[12px] text-fg-2">
          {questionOf(placeholder)}
          <input
            value={values[placeholder] ?? ""}
            onChange={(event) => setValues({ ...values, [placeholder]: event.target.value })}
            maxLength={2000}
            className="mt-1 w-full rounded-lg border border-line-strong bg-panel px-2.5 py-1.5 text-[13px] text-fg outline-none focus:border-orange-500"
            placeholder="Valore confermato"
          />
        </label>
      ))}
      <label className="block text-[12px] text-fg-2">
        Indicazioni per il Writer {placeholders.length ? "(facoltative)" : ""}
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={4000}
          rows={2}
          className="mt-1 w-full resize-y rounded-lg border border-line-strong bg-panel px-2.5 py-1.5 text-[13px] text-fg outline-none focus:border-orange-500"
          placeholder="Es. il coordinatore delle pulizie ha 20 ore settimanali; non citare il Direttore di Struttura"
        />
      </label>
      {error && <p className="text-[12px] text-rose-700 dark:text-rose-300">{error}</p>}
      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-lg bg-orange-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSending ? "Invio…" : "Conferma e rielabora"}
      </button>
    </form>
  );
}
