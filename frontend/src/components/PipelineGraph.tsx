import { useEffect, useRef, useState } from "react";

import { AGENTS, SECTION_COLOR } from "../lib/agents";
import type { AgentState, SectionState } from "../lib/runState";
import type { AgentId } from "../lib/types";

const NODE_W = 220;
const NODE_H = 82;
const VIEW_W = 2026;
const VIEW_H = 500;
const CLUSTER = { x: 768, y: 88, w: 736, h: 262 };

// flow: passaggio di lavoro · context: dati consultati · loop: revisione della sezione
// correction: l'Offer Validator rimanda sezioni al ciclo · escalation/human: passaggio all'operatore e ritorno.
type EdgeKind = "flow" | "context" | "loop" | "correction" | "escalation" | "human";

interface Edge {
  from: AgentId;
  to: AgentId;
  kind: EdgeKind;
}

const EDGES: Edge[] = [
  { from: "parser", to: "requirements", kind: "flow" },
  { from: "parser", to: "history", kind: "flow" },
  { from: "requirements", to: "splitter", kind: "flow" },
  { from: "history", to: "splitter", kind: "flow" },
  { from: "splitter", to: "section_retriever", kind: "flow" },
  { from: "section_retriever", to: "writer", kind: "flow" },
  { from: "writer", to: "section_validator", kind: "flow" },
  { from: "section_validator", to: "writer", kind: "loop" },
  { from: "history", to: "section_retriever", kind: "context" },
  { from: "requirements", to: "section_validator", kind: "context" },
  { from: "section_validator", to: "template_validator", kind: "flow" },
  { from: "template_validator", to: "scorer", kind: "flow" },
  { from: "template_validator", to: "assembler", kind: "flow" },
  { from: "template_validator", to: "writer", kind: "correction" },
  { from: "template_validator", to: "operator", kind: "escalation" },
  { from: "operator", to: "writer", kind: "human" },
];

const CLUSTER_BOTTOM = CLUSTER.y + CLUSTER.h;
const CORRECTION_ENTRY_X = 1218;
const HUMAN_ENTRY_X = 1308;

const EDGE_LABELS: Partial<Record<EdgeKind, { text: string; x: number; y: number; anchor: "start" | "middle" }>> = {
  // Sotto la curva delle correzioni, sopra quella dell'operatore.
  correction: { text: "correzioni di coerenza", x: 1444, y: CLUSTER_BOTTOM + 40, anchor: "middle" },
  escalation: { text: "da rivedere", x: AGENTS.template_validator.x + 38, y: 330, anchor: "start" },
  human: { text: "input operatore", x: 1462, y: AGENTS.operator.y + 14, anchor: "middle" },
};

const ACCENT: Partial<Record<EdgeKind, { stroke: string; particle: string; marker: string }>> = {
  loop: { stroke: "#f59e0b", particle: "var(--flow-loop)", marker: "arrow-amber" },
  correction: { stroke: "#f59e0b", particle: "var(--flow-loop)", marker: "arrow-amber" },
  escalation: { stroke: "#ea580c", particle: "#ea580c", marker: "arrow-orange" },
  human: { stroke: "#ea580c", particle: "#fdba74", marker: "arrow-orange" },
};

function edgePath({ from, to, kind }: Edge): string {
  const a = AGENTS[from];
  const b = AGENTS[to];
  if (kind === "loop") {
    const top = a.y - NODE_H / 2;
    return `M ${a.x - 30} ${top} C ${a.x - 40} ${top - 58}, ${b.x + 40} ${top - 58}, ${b.x + 30} ${top}`;
  }
  if (kind === "correction") {
    const x1 = a.x - 40;
    return `M ${x1} ${a.y + NODE_H / 2} C ${x1} ${CLUSTER_BOTTOM + 48}, ${CORRECTION_ENTRY_X} ${CLUSTER_BOTTOM + 48}, ${CORRECTION_ENTRY_X} ${CLUSTER_BOTTOM}`;
  }
  if (kind === "escalation") {
    return `M ${a.x + 30} ${a.y + NODE_H / 2} L ${b.x + 30} ${b.y - NODE_H / 2}`;
  }
  if (kind === "human") {
    const x1 = a.x - NODE_W / 2;
    return `M ${x1} ${a.y} C ${x1 - 120} ${a.y}, ${HUMAN_ENTRY_X} ${a.y - 10}, ${HUMAN_ENTRY_X} ${CLUSTER_BOTTOM}`;
  }
  if (kind === "context" && from === "history") {
    const x2 = b.x - NODE_W / 2;
    return `M ${a.x + NODE_W / 2} ${a.y + 14} C ${a.x + 200} ${a.y + 20}, ${x2 - 60} ${b.y + 40}, ${x2} ${b.y + 24}`;
  }
  if (kind === "context") {
    return `M ${a.x + NODE_W / 2} ${a.y - 14} C ${a.x + 330} ${a.y - 120}, ${b.x} ${b.y - 190}, ${b.x} ${b.y - NODE_H / 2}`;
  }
  const x1 = a.x + NODE_W / 2;
  const x2 = b.x - NODE_W / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${x2} ${b.y}`;
}

const MIN_VISIBLE_MS = 1500;
// Il messaggio deve finire prima dell'icona di stato in alto a destra.
const MESSAGE_MAX_CHARS = 28;

/**
 * Agenti da mostrare attivi: quelli in esecuzione più quelli attivati negli ultimi MIN_VISIBLE_MS.
 * Agenti senza LLM (es. Section Retriever, BM25 locale) restano "running" pochi millisecondi:
 * senza questa tenuta minima il grafo non li mostrerebbe mai al lavoro.
 */
function useVisiblyActive(agents: Record<AgentId, AgentState>): Set<AgentId> {
  const seenActivations = useRef<Partial<Record<AgentId, number>>>({});
  const [holdUntil, setHoldUntil] = useState<Partial<Record<AgentId, number>>>({});
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    const fresh: Partial<Record<AgentId, number>> = {};
    for (const id of Object.keys(agents) as AgentId[]) {
      if (agents[id].activations !== (seenActivations.current[id] ?? 0)) {
        seenActivations.current[id] = agents[id].activations;
        fresh[id] = performance.now() + MIN_VISIBLE_MS;
      }
    }
    if (Object.keys(fresh).length) setHoldUntil((current) => ({ ...current, ...fresh }));
  }, [agents]);

  const latestHold = Math.max(0, ...Object.values(holdUntil));
  useEffect(() => {
    if (latestHold <= now) return;
    const timer = window.setTimeout(() => setNow(performance.now()), latestHold - now + 20);
    return () => window.clearTimeout(timer);
  }, [latestHold, now]);

  return new Set(
    (Object.keys(agents) as AgentId[]).filter((id) => agents[id].status === "running" || (holdUntil[id] ?? 0) > now),
  );
}

function isEdgeActive(edge: Edge, agents: Record<AgentId, AgentState>, active: Set<AgentId>, sections: SectionState[]): boolean {
  if (edge.kind === "loop") return sections.some((s) => s.status === "revision");
  if (edge.kind === "correction") {
    return agents.template_validator.status === "running" && (active.has("writer") || active.has("section_validator"));
  }
  if (edge.kind === "escalation") return agents.operator.status === "warning" || agents.operator.status === "running";
  if (edge.kind === "human") return agents.operator.status === "running";
  if (edge.kind === "context") return active.has(edge.to);
  // Flusso dati: il destinatario lavora e la sorgente ha già prodotto qualcosa in questa run.
  return active.has(edge.to) && agents[edge.from].activations > 0;
}

function StatusGlyph({ status, color }: { status: AgentState["status"]; color: string }) {
  if (status === "done") {
    return (
      <g transform={`translate(${NODE_W - 28}, 48)`}>
        <circle cx="8" cy="8" r="8" fill="#22c55e" />
        <path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="#052e16" strokeWidth="2" fill="none" strokeLinecap="round" />
      </g>
    );
  }
  if (status === "warning" || status === "error") {
    return (
      <g transform={`translate(${NODE_W - 28}, 48)`}>
        <circle cx="8" cy="8" r="8" fill={status === "error" ? "#f43f5e" : "#f59e0b"} />
        <path d="M8 4.5v4.5M8 11.2v.3" stroke="#1c1917" strokeWidth="2" strokeLinecap="round" />
      </g>
    );
  }
  if (status === "running") {
    return (
      <g transform={`translate(${NODE_W - 28}, 48)`}>
        <circle cx="8" cy="8" r="6.5" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="2.5" />
        <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" className="tf-spin" />
      </g>
    );
  }
  return null;
}

function AgentNode({ id, state, isActive, onSelect, selected }: { id: AgentId; state: AgentState; isActive: boolean; onSelect: (id: AgentId) => void; selected: boolean }) {
  const meta = AGENTS[id];
  const border = isActive ? meta.color : state.status === "done" ? "var(--node-border-done)" : state.status === "warning" ? "#d97706" : "var(--node-border)";
  const progress = state.progress ?? (state.status === "done" ? 1 : 0);
  const message = state.message.length > MESSAGE_MAX_CHARS ? `${state.message.slice(0, MESSAGE_MAX_CHARS - 1)}…` : state.message;

  return (
    <g
      transform={`translate(${meta.x - NODE_W / 2}, ${meta.y - NODE_H / 2})`}
      className="cursor-pointer"
      onClick={() => onSelect(id)}
      role="button"
      aria-label={meta.name}
    >
      {isActive && (
        <rect x="-6" y="-6" width={NODE_W + 12} height={NODE_H + 12} rx="20" fill={meta.color} opacity="0.16" className="tf-pulse" />
      )}
      <rect
        width={NODE_W}
        height={NODE_H}
        rx="15"
        fill={isActive ? "var(--node-bg-active)" : "var(--node-bg)"}
        stroke={selected ? "var(--fg-2)" : border}
        strokeWidth={isActive || selected ? 2 : 1.25}
      />
      <rect x="12" y="13" width="30" height="30" rx="9" fill={meta.color} opacity={state.status === "idle" ? 0.12 : 0.2} />
      <g transform="translate(18, 19) scale(0.75)">
        <path d={meta.icon} fill="none" stroke={meta.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity={state.status === "idle" ? 0.6 : 1} />
      </g>
      <text x="52" y="26" className="fill-fg text-[13px] font-semibold">{meta.name}</text>
      <text x="52" y="42" className="fill-muted text-[11px]">{meta.role}</text>
      <text x="14" y="62" className={`text-[10.5px] ${isActive ? "fill-fg-2" : "fill-subtle"}`}>{message}</text>
      <rect x="14" y="69" width={NODE_W - 28} height="3" rx="1.5" fill="var(--track)" />
      <rect x="14" y="69" width={(NODE_W - 28) * Math.min(progress, 1)} height="3" rx="1.5" fill={meta.color} className="transition-all duration-500" />
      <StatusGlyph status={state.status} color={meta.color} />
    </g>
  );
}

function SectionChips({ sections, onSelect, selectedId }: { sections: SectionState[]; onSelect: (id: string) => void; selectedId: string | null }) {
  // Al massimo due righe dentro il cluster: i chip si rimpiccioliscono se i criteri sono molti.
  const gap = 6;
  const perRow = Math.max(1, sections.length <= 16 ? sections.length : Math.ceil(sections.length / 2));
  const size = Math.min(30, Math.floor((CLUSTER.w - 40) / perRow) - gap);
  const rows = Math.ceil(sections.length / perRow);
  const centerX = CLUSTER.x + CLUSTER.w / 2;
  const top = CLUSTER.y + CLUSTER.h - 22 - rows * (size + gap);

  return (
    <g>
      {sections.map((section, index) => {
        const row = Math.floor(index / perRow);
        const inRow = Math.min(perRow, sections.length - row * perRow);
        const x = centerX - (inRow * (size + gap) - gap) / 2 + (index % perRow) * (size + gap);
        const y = top + row * (size + gap);
        const color = SECTION_COLOR[section.status];
        const isBusy = ["retrieving", "writing", "validating", "revision"].includes(section.status);
        return (
          <g key={section.id} transform={`translate(${x}, ${y})`} onClick={() => onSelect(section.id)} className="cursor-pointer">
            <title>{`${section.id} · ${section.title}`}</title>
            <rect
              width={size}
              height={size}
              rx="7"
              fill={color}
              fillOpacity={section.status === "planned" ? 0.35 : 0.22}
              stroke={selectedId === section.id ? "var(--fg)" : color}
              strokeWidth={selectedId === section.id ? 2 : 1}
              className={isBusy ? "tf-pulse" : undefined}
            />
            <text x={size / 2} y={size / 2 + 3.5} textAnchor="middle" className="fill-fg text-[9.5px] font-semibold">
              {section.id}
            </text>
          </g>
        );
      })}
    </g>
  );
}

interface Props {
  agents: Record<AgentId, AgentState>;
  sections: SectionState[];
  selectedAgent: AgentId | null;
  selectedSection: string | null;
  onSelectAgent: (id: AgentId) => void;
  onSelectSection: (id: string) => void;
}

export function PipelineGraph({ agents, sections, selectedAgent, selectedSection, onSelectAgent, onSelectSection }: Props) {
  const active = useVisiblyActive(agents);
  const clusterActive = (["section_retriever", "writer", "section_validator"] as AgentId[]).some((id) => active.has(id));

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="h-auto w-full" role="img" aria-label="Grafo della pipeline di agenti">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--edge)" />
        </marker>
        <marker id="arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#f59e0b" />
        </marker>
        <marker id="arrow-orange" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#ea580c" />
        </marker>
        <marker id="arrow-active" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--edge-active)" />
        </marker>
      </defs>

      <rect
        x={CLUSTER.x}
        y={CLUSTER.y}
        width={CLUSTER.w}
        height={CLUSTER.h}
        rx="22"
        fill="var(--cluster-bg)"
        stroke={clusterActive ? "#6366f1" : "var(--cluster-border)"}
        strokeDasharray="6 6"
        strokeWidth="1.5"
      />
      <text x={CLUSTER.x + 20} y={CLUSTER.y + 26} className="fill-muted text-[11px] font-semibold uppercase tracking-[0.12em]">
        Ciclo per sezione {sections.length ? `× ${sections.length}` : ""}
      </text>

      {EDGES.map((edge) => {
        const isActiveEdge = isEdgeActive(edge, agents, active, sections);
        const d = edgePath(edge);
        const isLoop = edge.kind === "loop";
        const accent = ACCENT[edge.kind];
        const isStatic = edge.kind === "context" || edge.kind === "escalation";
        const isDashed = edge.kind === "context" || edge.kind === "escalation" || edge.kind === "human";
        const baseColor = edge.kind === "context" ? "var(--edge-context)" : "var(--edge)";
        const label = EDGE_LABELS[edge.kind];
        return (
          <g key={`${edge.from}-${edge.to}-${edge.kind}`}>
            <path
              d={d}
              fill="none"
              stroke={isActiveEdge ? (accent?.stroke ?? "var(--edge-active)") : baseColor}
              strokeWidth={isActiveEdge && edge.kind !== "context" ? 2.25 : 1.5}
              strokeDasharray={isDashed ? "4 6" : undefined}
              markerEnd={isActiveEdge ? `url(#${accent?.marker ?? "arrow-active"})` : "url(#arrow)"}
              opacity={isActiveEdge ? (edge.kind === "context" ? 0.55 : 1) : 0.8}
            />
            {/* Particella solo dove scorre lavoro: contesto ed escalation restano accesi ma fermi. */}
            {isActiveEdge && !isStatic && (
              <path d={d} fill="none" stroke={accent?.particle ?? "var(--flow)"} strokeWidth="2.5" strokeLinecap="round" className="tf-flow" />
            )}
            {isLoop && (
              <text x={(AGENTS.writer.x + AGENTS.section_validator.x) / 2} y={AGENTS.writer.y - NODE_H / 2 - 50} textAnchor="middle" className={`text-[10.5px] ${isActiveEdge ? "fill-amber-600 dark:fill-amber-300" : "fill-subtle"}`}>
                revisione
              </text>
            )}
            {label && (
              <text x={label.x} y={label.y} textAnchor={label.anchor} className={`text-[10.5px] ${isActiveEdge ? "fill-orange-600 dark:fill-orange-300" : "fill-subtle"}`}>
                {label.text}
              </text>
            )}
          </g>
        );
      })}

      {(Object.keys(AGENTS) as AgentId[]).map((id) => (
        <AgentNode key={id} id={id} state={agents[id]} isActive={active.has(id)} onSelect={onSelectAgent} selected={selectedAgent === id} />
      ))}

      <SectionChips sections={sections} onSelect={onSelectSection} selectedId={selectedSection} />
    </svg>
  );
}
