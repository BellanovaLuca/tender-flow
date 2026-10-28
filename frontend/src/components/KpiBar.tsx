import { useEffect, useState } from "react";

import type { RunState } from "../lib/runState";

function useElapsed(start: number | null, end: number | null): string {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (end !== null) return;
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [end]);
  if (start === null) return "00:00";
  const seconds = Math.max(0, Math.round((end ?? now) - start));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <p className="text-[11px] tracking-wide text-subtle uppercase">{label}</p>
      <p className="mt-0.5 font-mono text-xl font-semibold text-fg tabular-nums">{value}</p>
      {hint && <p className="truncate text-[11px] text-subtle" title={hint}>{hint}</p>}
    </div>
  );
}

export function KpiBar({ state }: { state: RunState }) {
  const elapsed = useElapsed(state.startedAt, state.finishedAt);
  const approved = state.sections.filter((s) => s.status === "approved").length;
  const pages = state.documents.reduce((sum, d) => sum + d.pages, 0);
  const estimate = state.sections.reduce((sum, s) => sum + (s.coefficient ?? 0) * s.maxPoints, 0);
  const max = state.requirements?.technical_max_points;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi label="Tempo" value={elapsed} hint={state.model} />
      <Kpi label="Documenti bando" value={String(state.documents.length)} hint={pages ? `${pages} pagine lette` : undefined} />
      <Kpi label="Criteri estratti" value={state.requirements ? String(state.requirements.criteria.length) : "–"} hint={max ? `${max} punti tecnici` : undefined} />
      <Kpi label="Passaggi storico" value={state.historyChunks ? String(state.historyChunks) : "–"} hint={state.historyTenders.join(" · ")} />
      <Kpi label="Sezioni approvate" value={state.sections.length ? `${approved}/${state.sections.length}` : "–"} />
      <Kpi
        label="Punteggio stimato"
        value={max ? `${(state.score?.total ?? estimate).toFixed(1)}` : "–"}
        hint={max ? `su ${max}${state.requirements?.technical_threshold ? ` · soglia ${state.requirements.technical_threshold}` : ""}` : undefined}
      />
    </div>
  );
}
