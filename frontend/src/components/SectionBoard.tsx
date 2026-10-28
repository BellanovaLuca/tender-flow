import { SECTION_STATUS } from "../lib/agents";
import type { SectionState } from "../lib/runState";

interface Props {
  sections: SectionState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SectionBoard({ sections, selectedId, onSelect }: Props) {
  if (sections.length === 0) {
    return <p className="text-sm text-subtle">Le sezioni compariranno quando il Template Splitter avrà pianificato l'offerta.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {sections.map((section) => {
        const status = SECTION_STATUS[section.status];
        const points = section.coefficient === null ? null : section.coefficient * section.maxPoints;
        return (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onSelect(section.id)}
              className={`tf-fade-in grid w-full grid-cols-[3rem_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${
                selectedId === section.id ? "border-indigo-400/60 bg-indigo-500/10" : "border-line bg-panel hover:border-line-strong"
              }`}
            >
              <span className="font-mono text-sm font-semibold text-fg">{section.id}</span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-fg" title={section.title}>{section.title}</span>
                <span className="block truncate text-[11px] text-subtle" title={section.templateSections.join(" · ")}>
                  {section.templateSections.length ? `Template: ${section.templateSections.join(" · ")}` : "Nessuna sezione template · solo storico"}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${status.tone}`}>
                  {status.label}
                  {section.revisions > 0 ? ` · rev ${section.revisions}` : ""}
                </span>
                <span className="font-mono text-[11px] text-muted">
                  {points === null ? "–" : points.toFixed(1)} / {section.maxPoints}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
