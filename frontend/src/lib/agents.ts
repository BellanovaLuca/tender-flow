import type { AgentId, SectionStatus } from "./types";

export interface AgentMeta {
  name: string;
  role: string;
  color: string;
  icon: string;
  x: number;
  y: number;
}

// Icone stile lucide (path SVG 24x24).
const ICON = {
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  list: "M3 17l2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8",
  history: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2",
  split: "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  pen: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4",
  layout: "M3 3h18v18H3zM3 9h18M9 21V9",
  chart: "M3 3v18h18M18 17V9M13 17V5M8 17v-3",
  user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  package: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12",
};

export const AGENTS: Record<AgentId, AgentMeta> = {
  parser: { name: "Document Parser", role: "Lettura bando", color: "#3b82f6", icon: ICON.file, x: 128, y: 210 },
  requirements: { name: "Requirements Analyst", role: "Criteri e vincoli", color: "#8b5cf6", icon: ICON.list, x: 384, y: 100 },
  history: { name: "History Retriever", role: "Storico gare", color: "#0ea5e9", icon: ICON.history, x: 384, y: 320 },
  splitter: { name: "Template Splitter", role: "Piano sezioni", color: "#d97706", icon: ICON.split, x: 640, y: 210 },
  section_retriever: { name: "Section Retriever", role: "Fonti per sezione", color: "#0891b2", icon: ICON.search, x: 896, y: 210 },
  writer: { name: "Bid Writer", role: "Stesura", color: "#6366f1", icon: ICON.pen, x: 1138, y: 210 },
  section_validator: { name: "Section Validator", role: "Verifica criterio", color: "#059669", icon: ICON.shield, x: 1380, y: 210 },
  template_validator: { name: "Offer Validator", role: "Controlli globali", color: "#0d9488", icon: ICON.layout, x: 1647, y: 210 },
  scorer: { name: "Score Simulator", role: "Stima commissione", color: "#db2777", icon: ICON.chart, x: 1898, y: 110 },
  assembler: { name: "Assembler", role: "Documento finale", color: "#16a34a", icon: ICON.package, x: 1898, y: 310 },
  operator: { name: "Operatore", role: "Revisione umana", color: "#ea580c", icon: ICON.user, x: 1647, y: 440 },
};

export const AGENT_ORDER = Object.keys(AGENTS) as AgentId[];

// Un colore per stato, distinti anche tra loro: grigio coda, azzurro ricerca, viola scrittura,
// ambra validazione, magenta revisione, verde approvata, rosso da rivedere.
export const SECTION_STATUS: Record<SectionStatus, { label: string; tone: string; hint: string }> = {
  planned: { label: "In coda", tone: "bg-track text-fg-2", hint: "pianificata, non ancora iniziata" },
  retrieving: { label: "Ricerca fonti", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300", hint: "recupero da storico, template e bando" },
  writing: { label: "Scrittura", tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300", hint: "il Bid Writer sta scrivendo" },
  validating: { label: "Validazione", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300", hint: "il validatore la sta valutando" },
  revision: { label: "Revisione", tone: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300", hint: "lacune trovate, riscrittura in corso" },
  approved: { label: "Approvata", tone: "bg-green-500/15 text-green-700 dark:text-green-300", hint: "conforme al criterio" },
  flagged: { label: "Da rivedere", tone: "bg-red-500/15 text-red-700 dark:text-red-300", hint: "lacune rimaste dopo la revisione: serve una persona" },
};

export const SECTION_COLOR: Record<SectionStatus, string> = {
  planned: "var(--chip-planned)",
  retrieving: "#0ea5e9",
  writing: "#8b5cf6",
  validating: "#f59e0b",
  revision: "#d946ef",
  approved: "#22c55e",
  flagged: "#ef4444",
};
