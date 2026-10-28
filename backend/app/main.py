"""Entry point HTTP. Avvio: uvicorn app.main:app --port 8000 (un solo worker, vedi app/runs.py)."""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.documents import UploadRejected, save_template, save_upload
from app.llm import LlmClient, MeteredLlm, TokenUsage
from app.pipeline import resumable_sections, resume_section, run_pipeline
from app.runs import Run, RunStore
from app.settings import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("tenderflow")

settings = get_settings()
store = RunStore(settings.runs_dir)
_background: set[asyncio.Task[None]] = set()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.llm = LlmClient(settings)
    yield
    for task in _background:
        task.cancel()


app = FastAPI(title="TenderFlow API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Last-Event-ID"],
)


@app.middleware("http")
async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    request_id = request.headers.get("X-Request-ID", "")[:64] or uuid.uuid4().hex
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("errore non gestito request_id=%s", request_id)
        response = JSONResponse({"detail": "Errore interno", "request_id": request_id}, status_code=500)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


class RunCreated(BaseModel):
    run_id: str


class HumanAnswer(BaseModel):
    placeholder: str = Field(min_length=1, max_length=500)
    value: str = Field(min_length=1, max_length=2000)


class ResumeRequest(BaseModel):
    answers: list[HumanAnswer] = Field(default_factory=list, max_length=30)
    note: str = Field(default="", max_length=4000)


class KnowledgeBaseSummary(BaseModel):
    company: str
    template: str | None
    tenders: list[str]
    sample_documents: list[str]
    model: str


def _sample_dir() -> Path:
    return settings.sample_tender_dir


def _track(task: asyncio.Task[None]) -> None:
    _background.add(task)
    task.add_done_callback(_background.discard)


def _start(run: Run, paths: list[Path], request: Request) -> RunCreated:
    usage = TokenUsage()
    llm = MeteredLlm(request.app.state.llm, usage)
    run.task = asyncio.create_task(run_pipeline(run, paths, llm, settings, usage))
    _track(run.task)
    return RunCreated(run_id=run.id)


def _get_run(run_id: str) -> Run:
    run = store.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run non trovata")
    return run


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> JSONResponse:
    is_ready = settings.knowledge_base_dir.is_dir()
    return JSONResponse({"ready": is_ready}, status_code=200 if is_ready else 503)


@app.get("/api/v1/knowledge-base")
async def knowledge_base() -> KnowledgeBaseSummary:
    root = settings.knowledge_base_dir
    templates = sorted((root / "Template").glob("*.docx"))
    return KnowledgeBaseSummary(
        company=settings.company_name,
        template=templates[0].name if templates else None,
        tenders=sorted(p.name for p in (root / "Storico").glob("*") if p.is_dir()),
        sample_documents=sorted(p.name for p in _sample_dir().glob("*.pdf")),
        model=settings.gemini_model,
    )


async def _attach_template(run: Run, template: UploadFile | None) -> None:
    """Template aziendale specifico della gara; senza upload si usa quello della knowledge base."""
    if template is None:
        return
    directory = run.directory / "template"
    directory.mkdir()
    run.template_path = await save_template(template, directory, settings.max_upload_bytes)


@app.post("/api/v1/runs", status_code=201)
async def create_run(
    request: Request,
    files: Annotated[list[UploadFile], File()],
    template: Annotated[UploadFile | None, File()] = None,
) -> RunCreated:
    if not files or len(files) > settings.max_upload_files:
        raise HTTPException(status_code=422, detail=f"Caricare da 1 a {settings.max_upload_files} documenti")
    run = store.create()
    paths: list[Path] = []
    try:
        for upload in files:
            paths.append(await save_upload(upload, run.directory / "uploads", settings.max_upload_bytes))
        await _attach_template(run, template)
    except UploadRejected as exc:
        store.discard(run.id)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _start(run, paths, request)


@app.post("/api/v1/runs/sample", status_code=201)
async def create_sample_run(request: Request, template: Annotated[UploadFile | None, File()] = None) -> RunCreated:
    paths = sorted(_sample_dir().glob("*.pdf"))
    if not paths:
        raise HTTPException(status_code=404, detail="Bando di esempio non disponibile")
    run = store.create()
    try:
        await _attach_template(run, template)
    except UploadRejected as exc:
        store.discard(run.id)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _start(run, paths, request)


@app.post("/api/v1/runs/{run_id}/sections/{section_id}/resume", status_code=202)
async def resume_run_section(run_id: str, section_id: str, body: ResumeRequest) -> RunCreated:
    """Intervento dell'operatore: riprende la catena dal Writer della sezione con le informazioni fornite."""
    run = _get_run(run_id)
    if not run.finished:
        raise HTTPException(status_code=409, detail="Elaborazione ancora in corso")
    sections = resumable_sections(run.id)
    if sections is None:
        raise HTTPException(status_code=409, detail="Questa elaborazione non può essere ripresa")
    if section_id not in sections:
        raise HTTPException(status_code=404, detail="Sezione non trovata")
    inputs = [f"{a.placeholder.strip()} → {a.value.strip()}" for a in body.answers]
    if body.note.strip():
        inputs.append(f"Nota dell'operatore: {body.note.strip()}")
    if not inputs:
        raise HTTPException(status_code=422, detail="Inserire almeno un dato o una nota")
    run.task = asyncio.create_task(resume_section(run, section_id, inputs))
    _track(run.task)
    return RunCreated(run_id=run.id)


def _get_active_run(run_id: str) -> Run:
    run = _get_run(run_id)
    if run.finished:
        raise HTTPException(status_code=409, detail="Elaborazione già conclusa")
    return run


@app.post("/api/v1/runs/{run_id}/pause", status_code=202)
async def pause_run(run_id: str) -> RunCreated:
    """Le chiamate al modello già partite terminano; le successive attendono la ripresa."""
    run = _get_active_run(run_id)
    await run.pause()
    return RunCreated(run_id=run.id)


@app.post("/api/v1/runs/{run_id}/continue", status_code=202)
async def continue_run(run_id: str) -> RunCreated:
    run = _get_active_run(run_id)
    await run.unpause()
    return RunCreated(run_id=run.id)


@app.post("/api/v1/runs/{run_id}/stop", status_code=202)
async def stop_run(run_id: str) -> RunCreated:
    """Interrompe definitivamente l'elaborazione: la run non è più riprendibile."""
    run = _get_active_run(run_id)
    run.stop()
    return RunCreated(run_id=run.id)


@app.get("/api/v1/runs/{run_id}/events")
async def run_events(
    run_id: str,
    last_event_id: Annotated[str | None, Header()] = None,
    after: Annotated[int | None, Query(ge=-1)] = None,
) -> StreamingResponse:
    """Stream SSE. `after` permette di risottoscriversi dopo una ripresa senza rigiocare tutto."""
    run = _get_run(run_id)
    if last_event_id and last_event_id.isdigit():
        after = int(last_event_id)
    after = -1 if after is None else after

    async def stream() -> AsyncIterator[str]:
        async for event in run.follow(after):
            if event is None:
                yield ": ping\n\n"
            else:
                yield f"id: {event.seq}\ndata: {event.model_dump_json()}\n\n"

    return StreamingResponse(
        stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@app.get("/api/v1/runs/{run_id}/document")
async def run_document(run_id: str) -> FileResponse:
    run = _get_run(run_id)
    if run.document_path is None:
        raise HTTPException(status_code=404, detail="Documento non ancora disponibile")
    return FileResponse(
        run.document_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename="Offerta_Tecnica.docx",
    )
