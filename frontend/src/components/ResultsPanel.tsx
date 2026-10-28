import { useState } from "react";

import type { RunState } from "../lib/runState";
import type { Check } from "../lib/types";

const PREVIEW_ITEMS = 2;

function CheckCard({ check, onSelectSection }: { check: Check; onSelectSection: (id: string) => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const visible = isExpanded ? check.items : check.items.slice(0, PREVIEW_ITEMS);
  const hidden = check.items.length - visible.length;

  return (
    <li className="rounded-xl border border-line bg-inset px-3 py-2">
      <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
        <span className={`h-2 w-2 shrink-0 rounded-full ${check.status === "ok" ? "bg-green-400" : "bg-amber-400"}`} />
        {check.label}
        <span className="font-normal text-muted">· {check.detail}</span>
      </p>
      {visible.length > 0 && (
        <ul className="mt-1.5 space-y-1 pl-4 text-[12px] text-fg-2">
          {visible.map((item, index) => (
            <li key={`${item.text}-${index}`} className="list-disc break-words marker:text-subtle">
              {item.section_id ? (
                <button
                  type="button"
                  onClick={() => onSelectSection(item.section_id ?? "")}
                  className="text-left hover:text-indigo-700 hover:underline dark:hover:text-indigo-300"
                  title="Apri la sezione"
                >
                  {item.text}
                </button>
              ) : (
                item.text
              )}
            </li>
          ))}
        </ul>
      )}
      {check.items.length > PREVIEW_ITEMS && (
        <button type="button" onClick={() => setIsExpanded(!isExpanded)} className="mt-1 pl-4 text-[12px] text-indigo-700 hover:underline dark:text-indigo-300">
          {isExpanded ? "Mostra meno" : `Mostra altri ${hidden}`}
        </button>
      )}
    </li>
  );
}

export function ResultsPanel({ state, onSelectSection }: { state: RunState; onSelectSection: (id: string) => void }) {
  const { score, checks, documentUrl, usage } = state;
  if (!score) return null;
  const passes = !score.threshold || score.total >= score.threshold;
  const thresholdPct = score.threshold ? (score.threshold / score.max) * 100 : null;

  return (
    <section className="tf-fade-in grid gap-4 rounded-2xl border border-line bg-panel p-5 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] tracking-wide text-subtle uppercase">Punteggio tecnico stimato</p>
            <p className="font-mono text-4xl font-semibold text-fg">
              {score.total.toFixed(1)}
              <span className="text-xl text-subtle"> / {score.max}</span>
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${passes ? "bg-green-500/15 text-green-700 dark:text-green-300" : "bg-rose-500/15 text-rose-700 dark:text-rose-300"}`}>
            {score.threshold ? `Soglia ${score.threshold} ${passes ? "superata" : "non superata"}` : "Nessuna soglia"}
          </span>
        </div>
        <div className="relative mt-3 h-2.5 rounded-full bg-track">
          <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400" style={{ width: `${(score.total / score.max) * 100}%` }} />
          {thresholdPct !== null && <div className="absolute -top-1 h-4.5 w-0.5 bg-amber-300" style={{ left: `${thresholdPct}%` }} title="Soglia di sbarramento" />}
        </div>

        <div className="mt-5 space-y-2">
          {score.rows.map((row) => (
            <div key={row.id} className="grid grid-cols-[2.75rem_1fr_4.5rem] items-center gap-3 text-[12px]">
              <span className="font-mono text-fg-2">{row.id}</span>
              <div className="h-2 rounded-full bg-track" title={row.title}>
                <div className="h-full rounded-full bg-indigo-400" style={{ width: `${row.max_points ? (row.points / row.max_points) * 100 : 0}%` }} />
              </div>
              <span className="text-right font-mono text-muted">
                {row.points.toFixed(1)}/{row.max_points}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-[11px] tracking-wide text-subtle uppercase">Controlli sull'offerta</p>
        <ul className="space-y-2">
          {checks.map((check) => (
            <CheckCard key={check.label} check={check} onSelectSection={onSelectSection} />
          ))}
        </ul>
        {usage && (
          <p className="text-[12px] text-subtle">
            Consumo Gemini: {usage.calls} chiamate · {Math.round((usage.input_tokens + usage.output_tokens + usage.thinking_tokens) / 1000).toLocaleString("it-IT")}k token ·{" "}
            <span className="font-medium text-fg-2">≈ ${usage.cost_usd.toFixed(2)}</span>
          </p>
        )}
        {documentUrl && (
          <a
            href={documentUrl}
            className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-400"
          >
            Scarica Offerta_Tecnica.docx
          </a>
        )}
      </div>
    </section>
  );
}
