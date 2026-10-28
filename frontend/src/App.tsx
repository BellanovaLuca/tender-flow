import { useEffect, useReducer, useState, type ReactNode } from "react";

import { ActivityPanel } from "./components/ActivityLog";
import { ThemeToggle } from "./components/ThemeToggle";
import { AgentInspector } from "./components/AgentInspector";
import { GraphLegend } from "./components/GraphLegend";
import { KpiBar } from "./components/KpiBar";
import { PipelineGraph } from "./components/PipelineGraph";
import { ResultsPanel } from "./components/ResultsPanel";
import { RunControls } from "./components/RunControls";
import { SectionBoard } from "./components/SectionBoard";
import { SectionDetail } from "./components/SectionDetail";
import { UploadView } from "./components/UploadView";
import { AGENT_ORDER } from "./lib/agents";
import { createRun, createSampleRun, resumeSection, subscribeToRun, type HumanAnswer } from "./lib/api";
import { initialRunState, reduceEvent, type RunState } from "./lib/runState";
import { applyTheme, readStoredTheme, type Theme } from "./lib/theme";
import type { AgentId, PipelineEvent } from "./lib/types";

type Action = { kind: "event"; event: PipelineEvent } | { kind: "reset" };

const PHASE_BADGE: Record<RunState["phase"], { label: string; className: string }> = {
  running: { label: "Pipeline in esecuzione", className: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" },
  paused: { label: "In pausa", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  completed: { label: "Offerta pronta", className: "bg-green-500/15 text-green-700 dark:text-green-300" },
  failed: { label: "Errore", className: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  stopped: { label: "Interrotta", className: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
};

function reducer(state: RunState, action: Action): RunState {
  return action.kind === "reset" ? initialRunState() : reduceEvent(state, action.event);
}

function Panel({ title, action, children, className = "", id }: { title: string; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`flex min-h-0 flex-col rounded-2xl border border-line bg-panel p-4 shadow-panel ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold tracking-[0.12em] text-subtle uppercase">{title}</h2>
        {action}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export default function App() {
  const [runId, setRunId] = useState<string | null>(null);
  const [state, dispatch] = useReducer(reducer, undefined, initialRunState);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [pinnedAgent, setPinnedAgent] = useState<AgentId | null>(null);
  const [pinnedSection, setPinnedSection] = useState<string | null>(null);

  useEffect(() => applyTheme(theme), [theme]);

  // Dopo una ripresa dell'operatore ci si risottoscrive dall'ultimo evento ricevuto.
  const [subscription, setSubscription] = useState({ count: 0, after: -1 });
  useEffect(() => {
    if (!runId) return;
    return subscribeToRun(runId, (event) => dispatch({ kind: "event", event }), subscription.after);
  }, [runId, subscription]);

  const resume = async (sectionId: string, answers: HumanAnswer[], note: string) => {
    if (!runId) return;
    await resumeSection(runId, sectionId, answers, note);
    setSubscription((current) => ({ count: current.count + 1, after: state.lastSeq }));
  };

  const start = async (create: () => Promise<string>) => {
    setIsStarting(true);
    setStartError(null);
    try {
      dispatch({ kind: "reset" });
      setPinnedSection(null);
      setPinnedAgent(null);
      setSubscription((current) => ({ count: current.count + 1, after: -1 }));
      setRunId(await create());
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "Impossibile avviare la pipeline");
    } finally {
      setIsStarting(false);
    }
  };

  const runningAgent = [...AGENT_ORDER].reverse().find((id) => state.agents[id].status === "running");
  const selectedAgent = pinnedAgent ?? runningAgent ?? (state.phase === "running" || state.phase === "paused" ? "parser" : "assembler");
  const focusedId = pinnedSection ?? state.lastActiveSection ?? state.sections[0]?.id ?? null;
  const focused = state.sections.find((s) => s.id === focusedId) ?? null;
  const requirements = state.requirements;

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-sm font-bold text-slate-950">TF</div>
            <div>
              <p className="text-sm font-semibold text-fg">TenderFlow</p>
              <p className="text-[11px] text-subtle">Risposte a bandi di gara con agenti AI</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {runId && (
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${PHASE_BADGE[state.phase].className}`}>
                {PHASE_BADGE[state.phase].label}
              </span>
            )}
            {runId && <RunControls runId={runId} phase={state.phase} />}
            {runId && (
              <button
                type="button"
                onClick={() => setRunId(null)}
                disabled={state.phase === "running" || state.phase === "paused"}
                className="rounded-lg border border-line-strong px-3 py-1.5 text-xs text-fg-2 hover:border-subtle disabled:opacity-40"
              >
                Nuova gara
              </button>
            )}
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-6 sm:px-6">
        {!runId ? (
          <UploadView
            onStart={(files, template) => start(() => createRun(files, template))}
            onStartSample={(template) => start(() => createSampleRun(template))}
            isStarting={isStarting}
            error={startError}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] tracking-wide text-subtle uppercase" title={requirements?.contracting_authority}>{requirements?.contracting_authority ?? "Analisi del bando in corso…"}</p>
                <h1 className="line-clamp-2 max-w-5xl cursor-default text-lg font-semibold text-fg" title={requirements?.tender_object}>{requirements?.tender_object ?? "Nuova offerta tecnica"}</h1>
              </div>
              {requirements?.page_limit ? (
                <p className="text-xs text-subtle">
                  Max {requirements.page_limit} facciate · {requirements.formatting_rules}
                </p>
              ) : null}
            </div>

            {state.error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">{state.error}</p>}

            <KpiBar state={state} />

            <section className="rounded-2xl border border-line bg-panel shadow-panel p-4">
              <div className="overflow-x-auto">
                <div className="min-w-[900px]">
                  <PipelineGraph
                    agents={state.agents}
                    sections={state.sections}
                    selectedAgent={selectedAgent}
                    selectedSection={focusedId}
                    onSelectAgent={(id) => setPinnedAgent(id === pinnedAgent ? null : id)}
                    onSelectSection={setPinnedSection}
                  />
                </div>
              </div>
              <div className="mt-1 border-t border-line pt-3">
                <GraphLegend />
              </div>
              <div className="mt-3 border-t border-line pt-3">
                <AgentInspector agentId={selectedAgent} state={state.agents[selectedAgent]} logs={state.logs} />
              </div>
            </section>

            <ResultsPanel
              state={state}
              onSelectSection={(id) => {
                setPinnedSection(id);
                document.getElementById("section-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            />

            <ActivityPanel logs={state.logs} startedAt={state.startedAt} />

            {/* minmax(0, …): le colonne non si allargano in base al contenuto, quindi le larghezze restano stabili. */}
            <div className="grid gap-4 lg:h-[44rem] lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
              <Panel title={`Sezioni dell'offerta${state.sections.length ? ` · ${state.sections.length}` : ""}`} className="max-h-[44rem] lg:max-h-none">
                <div className="h-full overflow-y-auto pr-1">
                  <SectionBoard sections={state.sections} selectedId={focusedId} onSelect={setPinnedSection} />
                </div>
              </Panel>
              <Panel
                id="section-detail"
                title={pinnedSection || state.phase !== "running" ? "Sezione selezionata" : "Sezione in lavorazione · live"}
                action={
                  pinnedSection && state.phase === "running" ? (
                    <button type="button" onClick={() => setPinnedSection(null)} className="text-xs text-indigo-700 hover:text-indigo-600 dark:text-indigo-300 dark:hover:text-indigo-200">
                      Segui la sezione in lavorazione →
                    </button>
                  ) : undefined
                }
                className="h-[44rem] lg:h-auto"
              >
                <SectionDetail
                  section={focused}
                  onResume={state.phase === "completed" && focused ? (answers, note) => resume(focused.id, answers, note) : undefined}
                />
              </Panel>
            </div>

          </>
        )}
      </main>
    </div>
  );
}
