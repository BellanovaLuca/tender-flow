import { useEffect, useRef } from "react";

import { SECTION_STATUS } from "../lib/agents";
import type { HumanAnswer } from "../lib/api";
import type { SectionState } from "../lib/runState";
import { OperatorForm } from "./OperatorForm";

const ORIGIN_STYLE: Record<string, string> = {
  storico: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  template: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  bando: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
};

const MARKUP = /(\[DA CONFERMARE[^\]]*\]|\*\*[^*]+\*\*)/;

/**
 * Evidenzia i dati da confermare e rende il **grassetto** che il modello a volte usa nonostante il prompt,
 * così nel testo non compaiono asterischi.
 */
function HighlightedText({ text }: { text: string }) {
  return (
    <>
      {text.split(MARKUP).map((part, index) => {
        if (index % 2 === 0) return part.replace(/(^|\s)\*(\S)/g, "$1$2").replace(/(\S)\*(\s|$)/g, "$1$2");
        if (part.startsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
        return (
          <mark key={index} className="rounded bg-amber-200 px-0.5 text-amber-900 dark:bg-amber-400/25 dark:text-amber-200">
            {part}
          </mark>
        );
      })}
    </>
  );
}

interface Props {
  section: SectionState | null;
  /** Presente solo a run conclusa: abilita l'intervento dell'operatore sulla sezione. */
  onResume?: (answers: HumanAnswer[], note: string) => Promise<void>;
}

export function SectionDetail({ section, onResume }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const isStreaming = section?.status === "writing" || section?.status === "revision";

  useEffect(() => {
    const el = scroller.current;
    if (isStreaming && el) el.scrollTop = el.scrollHeight;
  }, [section?.text, isStreaming]);

  if (!section) {
    return <p className="text-sm text-subtle">Seleziona una sezione per vedere fonti, bozza e revisione.</p>;
  }
  const status = SECTION_STATUS[section.status];
  const needsOperator = Boolean(onResume) && (section.status === "flagged" || section.text.includes("[DA CONFERMARE"));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-subtle">
            {section.id} · {section.maxPoints} punti · {section.scoringType === "D" ? "discrezionale" : "tabellare"}
          </p>
          <h3 className="truncate text-base font-semibold text-fg" title={section.title}>{section.title}</h3>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${status.tone}`}>{status.label}</span>
      </div>

      {section.sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {section.sources.map((source, index) => (
            <span
              key={`${source.document}-${index}`}
              title={`${source.document}\n\n${source.snippet}`}
              className={`max-w-[16rem] truncate rounded-md border px-2 py-0.5 text-[11px] ${ORIGIN_STYLE[source.origin] ?? ""}`}
            >
              {source.origin === "template" ? "Template" : source.tender} · {source.origin === "template" ? source.tender : source.document}
            </span>
          ))}
        </div>
      )}

      <div ref={scroller} className="min-h-[7rem] flex-1 overflow-y-auto rounded-xl border border-line bg-inset p-4 text-[13.5px] leading-relaxed whitespace-pre-wrap text-fg">
        {section.text ? <HighlightedText text={section.text} /> : <span className="text-subtle">Il Bid Writer non ha ancora iniziato questa sezione.</span>}
        {isStreaming && <span className="tf-caret ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-indigo-500 dark:bg-indigo-300" />}
      </div>

      {(section.issues.length > 0 || section.resolvedIssues.length > 0 || needsOperator) && (
        // Lacune e intervento operatore: al massimo metà pannello, poi scorrono, così non escono dal riquadro.
        <div className="max-h-[50%] min-h-0 shrink-0 space-y-1.5 overflow-y-auto pr-1 text-[12px] break-words">
          {section.status !== "approved" &&
            section.issues.map((issue) => (
              <p key={issue} className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-amber-700 dark:text-amber-200">
                ⚠ {issue}
              </p>
            ))}
          {section.resolvedIssues.map((issue) => (
            <p key={issue} className="rounded-lg border border-green-500/25 bg-green-500/10 px-3 py-1.5 text-green-700 dark:text-green-200 line-through decoration-green-400/50">
              {issue}
            </p>
          ))}
          {needsOperator && onResume && <OperatorForm key={`${section.id}-${section.revisions}`} section={section} onResume={onResume} />}
        </div>
      )}
    </div>
  );
}
