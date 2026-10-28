import { useEffect, useRef, useState, type DragEvent } from "react";

import { fetchKnowledgeBase } from "../lib/api";
import type { KnowledgeBaseSummary } from "../lib/types";

const ACCEPTED = /\.(pdf|docx)$/i;

function formatSize(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

interface Props {
  onStart: (files: File[], template: File | null) => void;
  onStartSample: (template: File | null) => void;
  isStarting: boolean;
  error: string | null;
}

export function UploadView({ onStart, onStartSample, isStarting, error }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [kb, setKb] = useState<KnowledgeBaseSummary | null>(null);
  const [template, setTemplate] = useState<File | null>(null);
  const templateInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchKnowledgeBase().then(setKb, () => setKb(null));
  }, []);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const valid = Array.from(list).filter((f) => ACCEPTED.test(f.name));
    setFiles((current) => [...current, ...valid.filter((f) => !current.some((c) => c.name === f.name))]);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.5fr_1fr]">
      <section className="rounded-2xl border border-line bg-panel p-6">
        <h2 className="text-lg font-semibold text-fg">Nuovo bando di gara</h2>
        <p className="mt-1 text-sm text-muted">Carica disciplinare, capitolati e allegati (PDF o DOCX). Gli agenti estrarranno criteri e requisiti.</p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => input.current?.click()}
          className={`mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
            isDragging ? "border-indigo-400 bg-indigo-500/10" : "border-line-strong hover:border-subtle hover:bg-inset"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-10 w-10 text-indigo-700 dark:text-indigo-300" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
          <p className="mt-3 text-sm font-medium text-fg">Trascina qui i documenti del bando</p>
          <p className="text-xs text-subtle">oppure clicca per selezionarli</p>
          <input ref={input} type="file" multiple accept=".pdf,.docx" className="hidden" onChange={(e) => addFiles(e.target.files)} />
        </div>

        {files.length > 0 && (
          <ul className="mt-4 max-h-64 space-y-1.5 overflow-y-auto">
            {files.map((file) => (
              <li key={file.name} className="tf-fade-in flex items-center justify-between rounded-lg border border-line bg-inset px-3 py-2 text-sm">
                <span className="truncate text-fg">{file.name}</span>
                <span className="ml-3 flex shrink-0 items-center gap-3 text-xs text-subtle">
                  {formatSize(file.size)}
                  <button type="button" className="text-subtle hover:text-rose-600 dark:hover:text-rose-200" onClick={() => setFiles(files.filter((f) => f !== file))} aria-label={`Rimuovi ${file.name}`}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">{error}</p>}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={files.length === 0 || isStarting}
            onClick={() => onStart(files, template)}
            className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isStarting ? "Avvio…" : `Avvia pipeline${files.length ? ` (${files.length} documenti)` : ""}`}
          </button>
          {kb && kb.sample_documents.length > 0 && (
            <button
              type="button"
              disabled={isStarting}
              onClick={() => onStartSample(template)}
              className="rounded-xl border border-line-strong px-5 py-2.5 text-sm font-medium text-fg transition hover:border-subtle disabled:opacity-40"
            >
              Usa bando di esempio ({kb.sample_documents.length} documenti)
            </button>
          )}
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-line bg-panel p-5">
          <p className="text-[11px] tracking-wide text-subtle uppercase">Base di conoscenza</p>
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <p className="text-muted">Template aziendale {template ? "· caricato per questa gara" : "· predefinito"}</p>
              <p className="truncate font-medium text-amber-700 dark:text-amber-200" title={template?.name ?? kb?.template ?? undefined}>
                {template?.name ?? kb?.template ?? "non trovato"}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                <button type="button" onClick={() => templateInput.current?.click()} className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                  {template ? "Cambia template" : "Carica un altro template (.docx)"}
                </button>
                {template && (
                  <button type="button" onClick={() => setTemplate(null)} className="text-subtle hover:text-rose-700 dark:hover:text-rose-300">
                    Usa il predefinito
                  </button>
                )}
              </div>
              <input
                ref={templateInput}
                type="file"
                accept=".docx"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file && /\.docx$/i.test(file.name)) setTemplate(file);
                  event.target.value = "";
                }}
              />
            </div>
            <div>
              <p className="text-muted">Storico gare</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(kb?.tenders ?? []).map((t) => (
                  <span key={t} className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-700 dark:text-sky-200">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-muted">Modello</p>
              <p className="font-mono text-xs text-fg-2">{kb?.model ?? "—"}</p>
            </div>
          </div>
        </section>
        <section className="rounded-2xl border border-line bg-panel p-5 text-sm text-muted">
          <p className="text-[11px] tracking-wide text-subtle uppercase">Cosa succede</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>Lettura del bando ed estrazione dei criteri di valutazione</li>
            <li>Recupero delle offerte storiche e scomposizione del template</li>
            <li>Per ogni criterio: ricerca fonti, stesura, validazione e revisione</li>
            <li>Controlli sull'offerta completa, stima del punteggio, export Word</li>
          </ol>
        </section>
      </aside>
    </div>
  );
}
