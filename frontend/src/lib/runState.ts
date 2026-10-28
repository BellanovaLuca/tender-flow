import { AGENT_ORDER } from "./agents";
import type {
  AgentId,
  AgentStatus,
  Check,
  PipelineEvent,
  RunUsage,
  ScoreRow,
  SectionStatus,
  Source,
  TenderRequirements,
} from "./types";

export interface AgentState {
  status: AgentStatus;
  message: string;
  progress: number | null;
  /** Quante volte l'agente è passato a "running": permette alla UI di notare anche attivazioni di pochi ms. */
  activations: number;
}

export interface LogEntry {
  seq: number;
  ts: number;
  agent: AgentId | null;
  level: "info" | "warning" | "error";
  message: string;
}

export interface SectionState {
  id: string;
  title: string;
  maxPoints: number;
  scoringType: "D" | "T";
  templateSections: string[];
  status: SectionStatus;
  text: string;
  sources: Source[];
  coefficient: number | null;
  issues: string[];
  resolvedIssues: string[];
  strengths: string[];
  revisions: number;
}

export interface RunState {
  phase: "running" | "paused" | "completed" | "failed" | "stopped";
  startedAt: number | null;
  finishedAt: number | null;
  model: string;
  agents: Record<AgentId, AgentState>;
  logs: LogEntry[];
  documents: { name: string; pages: number; chars: number }[];
  historyChunks: number;
  historyTenders: string[];
  requirements: TenderRequirements | null;
  sections: SectionState[];
  lastActiveSection: string | null;
  checks: Check[];
  pages: number | null;
  score: { rows: ScoreRow[]; total: number; max: number; threshold: number } | null;
  documentUrl: string | null;
  usage: RunUsage | null;
  /** Ultimo evento ricevuto: dopo una ripresa ci si risottoscrive da qui. */
  lastSeq: number;
  error: string | null;
}

export function initialRunState(): RunState {
  const agents = Object.fromEntries(
    AGENT_ORDER.map((id) => [id, { status: "idle", message: "In attesa", progress: null, activations: 0 }]),
  ) as Record<AgentId, AgentState>;
  return {
    phase: "running",
    startedAt: null,
    finishedAt: null,
    model: "",
    agents,
    logs: [],
    documents: [],
    historyChunks: 0,
    historyTenders: [],
    requirements: null,
    sections: [],
    lastActiveSection: null,
    checks: [],
    pages: null,
    score: null,
    documentUrl: null,
    usage: null,
    lastSeq: -1,
    error: null,
  };
}

function updateSection(state: RunState, id: string, patch: (s: SectionState) => Partial<SectionState>): RunState {
  return { ...state, sections: state.sections.map((s) => (s.id === id ? { ...s, ...patch(s) } : s)) };
}

export function reduceEvent(previous: RunState, event: PipelineEvent): RunState {
  const state = { ...previous, lastSeq: Math.max(previous.lastSeq, event.seq) };
  switch (event.type) {
    case "run.started":
      return { ...state, startedAt: event.ts, model: event.data.model };
    case "run.completed":
      return { ...state, phase: "completed", finishedAt: event.ts, documentUrl: event.data.document_url, usage: event.data.usage };
    case "run.resumed":
      return { ...state, phase: "running", finishedAt: null, documentUrl: null, error: null };
    case "run.failed":
      return {
        ...state,
        phase: "failed",
        finishedAt: event.ts,
        error: `${event.data.message} (rif. ${event.data.request_id.slice(0, 8)})`,
        logs: [...state.logs, { seq: event.seq, ts: event.ts, agent: null, level: "error", message: event.data.message }],
      };
    case "run.paused":
      return { ...state, phase: "paused" };
    case "run.continued":
      return { ...state, phase: "running" };
    case "run.stopped": {
      // Gli agenti interrotti a metà non torneranno a "done": li si riporta a riposo.
      const agents = Object.fromEntries(
        Object.entries(state.agents).map(([id, agent]) => [id, agent.status === "running" ? { ...agent, status: "idle", message: "Interrotto" } : agent]),
      ) as RunState["agents"];
      const message = "Elaborazione interrotta dall'operatore";
      return {
        ...state,
        phase: "stopped",
        finishedAt: event.ts,
        agents,
        logs: [...state.logs, { seq: event.seq, ts: event.ts, agent: null, level: "warning", message }],
      };
    }
    case "agent.status":
      if (!event.agent) return state;
      return {
        ...state,
        agents: {
          ...state.agents,
          [event.agent]: {
            ...event.data,
            activations: state.agents[event.agent].activations + (event.data.status === "running" ? 1 : 0),
          },
        },
      };
    case "log":
      return {
        ...state,
        logs: [...state.logs, { seq: event.seq, ts: event.ts, agent: event.agent, ...event.data }],
      };
    case "documents.parsed":
      return { ...state, documents: event.data.documents };
    case "history.indexed":
      return { ...state, historyChunks: event.data.chunks, historyTenders: event.data.tenders };
    case "requirements.extracted":
      return { ...state, requirements: event.data.requirements };
    case "sections.planned":
      return {
        ...state,
        sections: event.data.sections.map((s) => ({
          id: s.id,
          title: s.title,
          maxPoints: s.max_points,
          scoringType: s.scoring_type,
          templateSections: s.template_sections,
          status: "planned",
          text: "",
          sources: [],
          coefficient: null,
          issues: [],
          resolvedIssues: [],
          strengths: [],
          revisions: 0,
        })),
      };
    case "section.status": {
      const next = updateSection(state, event.data.section_id, () => ({ status: event.data.status }));
      const isActive = event.data.status === "writing" || event.data.status === "revision";
      return isActive ? { ...next, lastActiveSection: event.data.section_id } : next;
    }
    case "section.sources":
      return updateSection(state, event.data.section_id, () => ({ sources: event.data.sources }));
    case "section.delta":
      return updateSection(state, event.data.section_id, (s) => ({ text: s.text + event.data.text }));
    case "section.reset":
      return updateSection(state, event.data.section_id, (s) => ({ text: "", revisions: s.revisions + 1 }));
    case "section.validation":
      return updateSection(state, event.data.section_id, (s) => ({
        coefficient: event.data.coefficient,
        resolvedIssues: event.data.passed ? [...s.resolvedIssues, ...s.issues] : s.resolvedIssues,
        issues: event.data.issues,
        strengths: event.data.strengths,
      }));
    case "template.validation":
      return { ...state, checks: event.data.checks, pages: event.data.pages };
    case "score.estimated":
      return { ...state, score: event.data };
  }
}
