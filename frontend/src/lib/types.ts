// Contratto degli eventi: rispecchia backend/app/schemas.py.

export type AgentId =
  | "parser"
  | "requirements"
  | "history"
  | "splitter"
  | "section_retriever"
  | "writer"
  | "section_validator"
  | "template_validator"
  | "scorer"
  | "assembler"
  | "operator";

export type AgentStatus = "idle" | "running" | "done" | "warning" | "error";

export type SectionStatus =
  | "planned"
  | "retrieving"
  | "writing"
  | "validating"
  | "revision"
  | "approved"
  | "flagged";

export interface Criterion {
  id: string;
  title: string;
  description: string;
  max_points: number;
  scoring_type: "D" | "T";
}

export interface TenderRequirements {
  contracting_authority: string;
  tender_object: string;
  technical_max_points: number;
  economic_max_points: number;
  technical_threshold: number;
  page_limit: number;
  formatting_rules: string;
  mandatory_attachments: string[];
  criteria: Criterion[];
}

export interface Source {
  origin: "storico" | "bando" | "template";
  tender: string;
  document: string;
  score: number;
  snippet: string;
}

export interface CheckItem {
  section_id: string | null;
  text: string;
}

export interface Check {
  label: string;
  status: "ok" | "warning";
  detail: string;
  items: CheckItem[];
}

export interface ScoreRow {
  id: string;
  title: string;
  max_points: number;
  points: number;
}

export interface RunUsage {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  cost_usd: number;
}

export interface KnowledgeBaseSummary {
  company: string;
  template: string | null;
  tenders: string[];
  sample_documents: string[];
  model: string;
}

interface EventBase<T extends string, D> {
  seq: number;
  ts: number;
  type: T;
  agent: AgentId | null;
  data: D;
}

export type PipelineEvent =
  | EventBase<"run.started", { documents: string[]; model: string }>
  | EventBase<"run.completed", { document_url: string; usage: RunUsage | null }>
  | EventBase<"run.resumed", { section_id: string }>
  | EventBase<"run.failed", { message: string; request_id: string }>
  | EventBase<"run.paused", Record<string, never>>
  | EventBase<"run.continued", Record<string, never>>
  | EventBase<"run.stopped", Record<string, never>>
  | EventBase<"agent.status", { status: AgentStatus; message: string; progress: number | null }>
  | EventBase<"log", { level: "info" | "warning"; message: string }>
  | EventBase<"documents.parsed", { documents: { name: string; pages: number; chars: number }[]; chunks: number }>
  | EventBase<"requirements.extracted", { requirements: TenderRequirements }>
  | EventBase<"history.indexed", { tenders: string[]; documents: string[]; chunks: number }>
  | EventBase<
      "sections.planned",
      { sections: { id: string; title: string; max_points: number; scoring_type: "D" | "T"; template_sections: string[] }[] }
    >
  | EventBase<"section.status", { section_id: string; status: SectionStatus }>
  | EventBase<"section.sources", { section_id: string; sources: Source[] }>
  | EventBase<"section.delta", { section_id: string; text: string }>
  | EventBase<"section.reset", { section_id: string }>
  | EventBase<
      "section.validation",
      { section_id: string; passed: boolean; coefficient: number; issues: string[]; strengths: string[]; revision: number }
    >
  | EventBase<"template.validation", { checks: Check[]; words: number; pages: number }>
  | EventBase<"score.estimated", { rows: ScoreRow[]; total: number; max: number; threshold: number }>;
