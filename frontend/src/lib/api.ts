import type { KnowledgeBaseSummary, PipelineEvent } from "./types";

const BASE = "/api/v1";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof body?.detail === "string" ? body.detail : `Errore ${response.status}`;
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export async function fetchKnowledgeBase(): Promise<KnowledgeBaseSummary> {
  return readJson(await fetch(`${BASE}/knowledge-base`));
}

/** `template`: template aziendale per questa gara; senza, il backend usa quello predefinito. */
export async function createRun(files: File[], template: File | null): Promise<string> {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  if (template) form.append("template", template);
  const { run_id } = await readJson<{ run_id: string }>(await fetch(`${BASE}/runs`, { method: "POST", body: form }));
  return run_id;
}

export async function createSampleRun(template: File | null): Promise<string> {
  const form = new FormData();
  if (template) form.append("template", template);
  const init: RequestInit = template ? { method: "POST", body: form } : { method: "POST" };
  const { run_id } = await readJson<{ run_id: string }>(await fetch(`${BASE}/runs/sample`, init));
  return run_id;
}

export interface HumanAnswer {
  placeholder: string;
  value: string;
}

/** Intervento dell'operatore: la catena riparte dal Writer della sezione. */
export async function resumeSection(runId: string, sectionId: string, answers: HumanAnswer[], note: string): Promise<void> {
  await readJson(
    await fetch(`${BASE}/runs/${runId}/sections/${encodeURIComponent(sectionId)}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers, note }),
    }),
  );
}

async function controlRun(runId: string, action: "pause" | "continue" | "stop"): Promise<void> {
  await readJson(await fetch(`${BASE}/runs/${runId}/${action}`, { method: "POST" }));
}

/** Pausa: le chiamate al modello già partite terminano, le successive attendono `continueRun`. */
export const pauseRun = (runId: string) => controlRun(runId, "pause");
export const continueRun = (runId: string) => controlRun(runId, "continue");
/** Interruzione definitiva: la run non produce il documento e non è più riprendibile. */
export const stopRun = (runId: string) => controlRun(runId, "stop");

/**
 * Sottoscrive lo stream SSE dall'evento successivo ad `after`.
 * EventSource gestisce da solo la riconnessione con Last-Event-ID.
 */
export function subscribeToRun(runId: string, onEvent: (event: PipelineEvent) => void, after = -1): () => void {
  const source = new EventSource(`${BASE}/runs/${runId}/events?after=${after}`);
  source.onmessage = (message: MessageEvent<string>) => {
    const event = JSON.parse(message.data) as PipelineEvent;
    onEvent(event);
    if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.stopped") source.close();
  };
  return () => source.close();
}
