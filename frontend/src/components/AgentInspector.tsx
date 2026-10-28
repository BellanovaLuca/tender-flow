import { AGENTS } from "../lib/agents";
import type { AgentState, LogEntry } from "../lib/runState";
import type { AgentId } from "../lib/types";

const DESCRIPTION: Record<AgentId, string> = {
  parser: "Estrae il testo da tutti i documenti del bando e li indicizza per la ricerca dei requisiti.",
  requirements: "Legge il disciplinare e ricava criteri e sub-criteri di valutazione, punteggi, soglia di sbarramento e vincoli formali.",
  history: "Indicizza le offerte tecniche delle gare passate e i progetti gold dell'azienda.",
  splitter: "Scompone il template aziendale nelle sue sezioni e le associa ai criteri del nuovo bando.",
  section_retriever: "Per ogni sezione recupera i passaggi più pertinenti da template, storico e capitolato.",
  writer: "Scrive la sezione rispondendo punto per punto al criterio, adattando lo storico al nuovo committente.",
  section_validator: "Valuta la bozza come un commissario: segnala lacune e stima il coefficiente; se serve rimanda in revisione.",
  template_validator: "Controlla l'offerta completa: limite di facciate, copertura dei criteri, riferimenti residui a gare precedenti, coerenza.",
  scorer: "Stima il punteggio tecnico complessivo e lo confronta con la soglia di sbarramento.",
  assembler: "Compone il documento Word finale nel formato richiesto dal disciplinare.",
  operator: "Interviene su ciò che gli agenti non possono risolvere: conferma i dati mancanti e rivede le sezioni segnalate. Dopo il suo input la catena riparte dal Writer della sezione.",
};

export function AgentInspector({ agentId, state, logs }: { agentId: AgentId; state: AgentState; logs: LogEntry[] }) {
  const meta = AGENTS[agentId];
  const own = logs.filter((log) => log.agent === agentId).slice(-6);
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: meta.color }}>
        <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
        {meta.name}
        <span className="font-normal text-subtle">· {state.message}</span>
      </p>
      <p className="text-[13px] text-muted">{DESCRIPTION[agentId]}</p>
      {own.length > 0 && (
        <ul className="space-y-1 font-mono text-[11.5px] text-fg-2">
          {own.map((log) => (
            <li key={log.seq} className={log.level === "warning" ? "text-amber-700 dark:text-amber-300" : undefined}>
              › {log.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
