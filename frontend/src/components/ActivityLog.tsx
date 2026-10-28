import { useEffect, useRef, useState } from "react";

import { AGENTS } from "../lib/agents";
import type { LogEntry } from "../lib/runState";

function elapsed(ts: number, start: number | null): string {
  const seconds = Math.max(0, Math.round(ts - (start ?? ts)));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function LogRow({ log, startedAt, isCompact = false }: { log: LogEntry; startedAt: number | null; isCompact?: boolean }) {
  const meta = log.agent ? AGENTS[log.agent] : null;
  const tone = log.level === "warning" ? "text-amber-700 dark:text-amber-300" : log.level === "error" ? "text-rose-700 dark:text-rose-300" : "text-fg-2";
  return (
    <div className="tf-fade-in grid grid-cols-[3rem_9.5rem_minmax(0,1fr)] gap-3 font-mono text-[12px] leading-relaxed">
      <span className="text-faint">{elapsed(log.ts, startedAt)}</span>
      <span className="truncate font-semibold" style={{ color: meta?.color ?? "#94a3b8" }}>
        {meta?.name ?? "Orchestrator"}
      </span>
      <span className={`${tone} ${isCompact ? "truncate" : ""}`} title={isCompact ? log.message : undefined}>
        {log.message}
      </span>
    </div>
  );
}

function ActivityLog({ logs, startedAt }: { logs: LogEntry[]; startedAt: number | null }) {
  const scroller = useRef<HTMLDivElement>(null);

  // Scroll del solo contenitore: scrollIntoView farebbe scorrere anche la pagina.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  return (
    <div ref={scroller} className="h-full overflow-y-auto pr-1">
      {logs.map((log) => (
        <div key={log.seq} className="border-b border-line/60 py-1 last:border-0">
          <LogRow log={log} startedAt={startedAt} />
        </div>
      ))}
      {logs.length === 0 && <p className="text-sm text-subtle">In attesa dei primi eventi…</p>}
    </div>
  );
}

/** Log degli agenti compresso su una riga (l'ultimo evento); espandibile per il dettaglio completo. */
export function ActivityPanel({ logs, startedAt }: { logs: LogEntry[]; startedAt: number | null }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const warnings = logs.filter((log) => log.level !== "info").length;
  const last = logs.at(-1);

  return (
    <section className="rounded-2xl border border-line bg-panel shadow-panel">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 text-left"
      >
        <span className="text-[11px] font-semibold tracking-[0.12em] text-subtle uppercase">
          Attività degli agenti
          <span className="ml-2 font-normal tracking-normal normal-case">
            {logs.length} eventi{warnings ? ` · ${warnings} avvisi` : ""}
          </span>
        </span>
        <span className="min-w-0">{!isExpanded && last && <LogRow log={last} startedAt={startedAt} isCompact />}</span>
        <span className="flex items-center gap-1 text-xs text-indigo-700 dark:text-indigo-300">
          {isExpanded ? "Comprimi" : "Espandi"}
          <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {isExpanded && (
        <div className="h-[20rem] border-t border-line px-4 py-2">
          <ActivityLog logs={logs} startedAt={startedAt} />
        </div>
      )}
    </section>
  );
}
