"""Orchestratore: esegue gli agenti nell'ordine del grafo e pubblica gli eventi della run."""

import asyncio
import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

from pydantic import JsonValue

from app.agents import analysis, review, sections
from app.agents.context import PipelineContext
from app.llm import T, TextModel, TokenUsage
from app.runs import Run
from app.schemas import AgentId, SectionReview
from app.settings import Settings

logger = logging.getLogger(__name__)

_PLACEHOLDER = re.compile(r"\[DA CONFERMARE[^\]]*\]")


@dataclass
class RunState:
    ctx: PipelineContext
    usage: TokenUsage | None


# Stato delle run riprendibili dall'operatore. In memoria come RunStore: un solo worker (vedi app/runs.py).
_states: dict[str, RunState] = {}


class PausableLlm:
    """Ogni chiamata al modello attende la fine della pausa: le chiamate già partite terminano,
    le successive non partono finché l'operatore non riprende."""

    def __init__(self, llm: TextModel, run: Run) -> None:
        self._llm = llm
        self._run = run

    async def generate_structured(self, *, system: str, prompt: str, schema: type[T]) -> T:
        await self._run.wait_if_paused()
        return await self._llm.generate_structured(system=system, prompt=prompt, schema=schema)

    async def stream_text(self, *, system: str, prompt: str) -> AsyncIterator[str]:
        await self._run.wait_if_paused()
        async for delta in self._llm.stream_text(system=system, prompt=prompt):
            yield delta


async def _publish_stopped(run: Run) -> None:
    # Una run fermata non è riprendibile: l'offerta è incompleta e non c'è documento.
    _states.pop(run.id, None)
    await run.publish("run.stopped")
    logger.info("run %s fermata dall'operatore", run.id)


def resumable_sections(run_id: str) -> set[str] | None:
    """Sezioni su cui l'operatore può intervenire; None se la run non è riprendibile."""
    state = _states.get(run_id)
    if state is None or state.ctx.requirements is None or not state.ctx.drafts:
        return None
    return {d.criterion.id for d in state.ctx.drafts}


def _usage_summary(usage: TokenUsage | None, settings: Settings) -> dict[str, JsonValue] | None:
    if usage is None:
        return None
    cost = usage.cost_usd(settings.gemini_price_input_per_m, settings.gemini_price_output_per_m)
    logger.info(
        "consumo: %d chiamate, %d token input, %d output, %d thinking, ~$%.3f",
        usage.calls, usage.input_tokens, usage.output_tokens, usage.thinking_tokens, cost,
    )
    return {
        "calls": usage.calls,
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "thinking_tokens": usage.thinking_tokens,
        "cost_usd": round(cost, 4),
    }


async def _escalate(ctx: PipelineContext, unresolved: dict[str, list[str]]) -> None:
    """Ciò che gli agenti non sono riusciti a risolvere passa all'operatore umano."""
    run = ctx.run
    for draft in ctx.drafts:
        issues = unresolved.get(draft.criterion.id)
        if not issues:
            continue
        coefficient = draft.review.expected_coefficient if draft.review else 0.0
        draft.review = SectionReview(is_compliant=False, expected_coefficient=coefficient, issues=issues, strengths=[])
        await run.publish(
            "section.validation", AgentId.TEMPLATE_VALIDATOR, section_id=draft.criterion.id, passed=False,
            coefficient=coefficient, issues=issues, strengths=[], revision=draft.revisions,
        )
        await run.publish("section.status", AgentId.TEMPLATE_VALIDATOR, section_id=draft.criterion.id, status="flagged")

    flagged = [d.criterion.id for d in ctx.drafts if not (d.review and d.review.is_compliant)]
    to_confirm = sum(len(_PLACEHOLDER.findall(d.text)) for d in ctx.drafts)
    if flagged or to_confirm:
        message = f"{len(flagged)} sezioni da rivedere · {to_confirm} dati da confermare"
        detail = f" ({', '.join(flagged)})" if flagged else ""
        await run.log(AgentId.OPERATOR, f"In attesa di intervento: {message}{detail}", "warning")
        await run.agent(AgentId.OPERATOR, "warning", message)
    else:
        await run.agent(AgentId.OPERATOR, "done", "Nessun intervento richiesto")


async def _finalize(ctx: PipelineContext, usage: TokenUsage | None) -> None:
    """Offer Validator con giri di correzione, escalation, stima del punteggio e documento finale."""
    run, settings = ctx.run, ctx.settings
    drafts = {d.criterion.id: d for d in ctx.drafts}
    stages = sections.StageTracker(ctx)

    fixes = await review.validate_document(ctx)
    for _ in range(settings.max_document_revisions):
        if not fixes:
            break
        await run.agent(AgentId.TEMPLATE_VALIDATOR, "running", f"Correzioni su {', '.join(fixes)}")
        await run.log(AgentId.TEMPLATE_VALIDATOR, f"Rimando al Writer per coerenza: {', '.join(fixes)}", "warning")
        # In sequenza: ogni sezione corretta vede già allineate quelle precedenti.
        for section_id, issues in fixes.items():
            await sections.revise_section(ctx, drafts[section_id], stages, issues, retrieve_more=False)
        for agent in (AgentId.WRITER, AgentId.SECTION_VALIDATOR):
            await run.agent(agent, "done", f"{len(ctx.drafts)} sezioni elaborate", 1)
        fixes = await review.validate_document(ctx)

    await _escalate(ctx, fixes)
    await run.wait_if_paused()
    await review.estimate_score(ctx)
    run.document_path = await review.assemble(ctx)
    await run.publish(
        "run.completed", document_url=f"/api/v1/runs/{run.id}/document", usage=_usage_summary(usage, settings)
    )


async def run_pipeline(
    run: Run, paths: list[Path], llm: TextModel, settings: Settings, usage: TokenUsage | None = None
) -> None:
    ctx = PipelineContext(run=run, llm=PausableLlm(llm, run), settings=settings)
    _states[run.id] = RunState(ctx, usage)
    await run.publish("run.started", documents=[p.name for p in paths], model=settings.gemini_model)
    logger.info("run %s avviata con %d documenti", run.id, len(paths))
    try:
        # Parsing del bando e indicizzazione dello storico sono indipendenti.
        await asyncio.gather(analysis.parse_tender(ctx, paths), analysis.load_history(ctx))
        await run.wait_if_paused()
        await asyncio.gather(analysis.extract_requirements(ctx), analysis.build_company_profile(ctx))
        await run.wait_if_paused()
        await analysis.split_template(ctx)

        stages = sections.StageTracker(ctx)
        limit = asyncio.Semaphore(settings.section_concurrency)

        async def bounded(draft_index: int) -> None:
            async with limit:
                await sections.process_section(ctx, ctx.drafts[draft_index], stages)

        await asyncio.gather(*(bounded(i) for i in range(len(ctx.drafts))))
        for agent in (AgentId.SECTION_RETRIEVER, AgentId.WRITER, AgentId.SECTION_VALIDATOR):
            await run.agent(agent, "done", f"{len(ctx.drafts)} sezioni elaborate", 1)

        await run.wait_if_paused()
        await _finalize(ctx, usage)
        logger.info("run %s completata", run.id)
    except asyncio.CancelledError:
        await _publish_stopped(run)
        raise
    except Exception:
        # Confine del job in background: si logga lo stack lato server e si notifica un errore generico.
        logger.exception("run %s fallita", run.id)
        await run.publish("run.failed", message="Elaborazione interrotta per un errore interno.", request_id=run.id)


async def resume_section(run: Run, section_id: str, human_inputs: list[str]) -> None:
    """Riprende la catena dal Writer della sezione indicata con le informazioni fornite dall'operatore,
    poi ripete tutti i passi successivi: validazione, controlli sull'offerta, punteggio, documento."""
    state = _states[run.id]
    ctx = state.ctx
    draft = next(d for d in ctx.drafts if d.criterion.id == section_id)
    run.reopen()
    await run.publish("run.resumed", AgentId.OPERATOR, section_id=section_id)
    logger.info("run %s ripresa dall'operatore sulla sezione %s", run.id, section_id)
    try:
        await run.agent(AgentId.OPERATOR, "running", f"Input su {section_id} in rielaborazione")
        await run.log(AgentId.OPERATOR, f"{section_id}: {len(human_inputs)} informazioni fornite dall'operatore")
        open_issues = draft.review.issues if draft.review and not draft.review.is_compliant else []
        draft.human_inputs.extend(human_inputs)
        await sections.revise_section(
            ctx,
            draft,
            sections.StageTracker(ctx),
            ["Integra le informazioni confermate dall'operatore", *open_issues],
            retrieve_more=False,
        )
        await _finalize(ctx, state.usage)
    except asyncio.CancelledError:
        await _publish_stopped(run)
        raise
    except Exception:
        logger.exception("ripresa della run %s fallita", run.id)
        await run.publish("run.failed", message="Rielaborazione interrotta per un errore interno.", request_id=run.id)
