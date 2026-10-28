import { SECTION_COLOR, SECTION_STATUS } from "../lib/agents";
import type { SectionStatus } from "../lib/types";

const ORDER: SectionStatus[] = ["planned", "retrieving", "writing", "validating", "revision", "approved", "flagged"];

/** Legenda di grafo e chip: stato delle sezioni e significato dei bordi degli agenti. */
export function GraphLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-muted">
      <span className="font-semibold tracking-wide text-subtle uppercase text-[11px]">Sezioni</span>
      {ORDER.map((status) => (
        <span key={status} className="flex items-center gap-1.5" title={SECTION_STATUS[status].hint}>
          <span className="h-3 w-3 rounded" style={{ background: SECTION_COLOR[status] }} />
          {SECTION_STATUS[status].label}
        </span>
      ))}
      <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-semibold tracking-wide text-subtle uppercase text-[11px]">Agenti</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-indigo-500" />al lavoro</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-green-500" />completato</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-amber-500" />completato con avvisi</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-line-strong" />contesto condiviso</span>
      </span>
    </div>
  );
}
