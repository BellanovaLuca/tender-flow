import { useState } from "react";

import { continueRun, pauseRun, stopRun } from "../lib/api";
import type { RunState } from "../lib/runState";

/** Pausa, ripresa e interruzione definitiva della run in corso. Lo stato arriva poi dagli eventi SSE. */
export function RunControls({ runId, phase }: { runId: string; phase: RunState["phase"] }) {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phase !== "running" && phase !== "paused") return null;

  const act = async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Comando non riuscito");
    } finally {
      setIsBusy(false);
    }
  };

  const stop = () => {
    if (window.confirm("Interrompere definitivamente l'elaborazione? La bozza non verrà generata e la gara andrà riavviata.")) {
      void act(() => stopRun(runId));
    }
  };

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-rose-600 dark:text-rose-300">{error}</span>}
      {phase === "running" ? (
        <button
          type="button"
          onClick={() => void act(() => pauseRun(runId))}
          disabled={isBusy}
          title="Le chiamate già partite terminano, le successive attendono la ripresa"
          className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-xs text-fg-2 hover:border-subtle disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
          Pausa
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void act(() => continueRun(runId))}
          disabled={isBusy}
          className="flex items-center gap-1.5 rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-700 hover:border-indigo-500 disabled:opacity-40 dark:text-indigo-300"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true"><path d="M7 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L8.5 4.64A1 1 0 0 0 7 5.5z" /></svg>
          Riprendi
        </button>
      )}
      <button
        type="button"
        onClick={stop}
        disabled={isBusy}
        className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs text-rose-700 hover:border-rose-500 hover:bg-rose-500/10 disabled:opacity-40 dark:text-rose-300"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
        Stop
      </button>
    </div>
  );
}
