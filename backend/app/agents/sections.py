"""Ciclo per sezione: Section Retriever → Writer → Section Validator (con revisione)."""

from collections import Counter

from app.agents.context import PipelineContext
from app.retrieval import diversify, term_coverage
from app.schemas import AgentId, SearchPlan, SectionDraft, SectionReview, SourceChunk

_STAGE_LABEL = {
    AgentId.SECTION_RETRIEVER: "in ricerca",
    AgentId.WRITER: "in scrittura",
    AgentId.SECTION_VALIDATOR: "in validazione",
}


class StageTracker:
    """Aggrega lo stato dei tre agenti condivisi tra le sezioni elaborate in parallelo."""

    def __init__(self, ctx: PipelineContext) -> None:
        self._ctx = ctx
        self._active: Counter[AgentId] = Counter()
        self._completed: Counter[AgentId] = Counter()

    async def enter(self, agent: AgentId, section_id: str) -> None:
        self._active[agent] += 1
        await self._publish(agent, f"{section_id} {_STAGE_LABEL[agent]}")

    async def leave(self, agent: AgentId) -> None:
        self._active[agent] -= 1
        self._completed[agent] += 1
        await self._publish(agent, None)

    async def _publish(self, agent: AgentId, message: str | None) -> None:
        total = len(self._ctx.drafts)
        active, completed = self._active[agent], self._completed[agent]
        if active:
            text = message or f"{active} sezioni attive"
            await self._ctx.run.agent(agent, "running", text, min(completed / total, 1))
        else:
            await self._ctx.run.agent(agent, "idle", f"{completed} passaggi completati", min(completed / total, 1))


def _word_budget(ctx: PipelineContext, draft: SectionDraft) -> int:
    requirements = ctx.reqs()
    pages = requirements.page_limit or 15
    share = draft.criterion.max_points / (requirements.technical_max_points or 1)
    return max(120, min(900, round(pages * ctx.settings.words_per_page * share * 0.8)))


def _format_sources(sources: list[SourceChunk]) -> str:
    return "\n\n".join(f"[{s.origin.upper()} · {s.tender} · {s.document}]\n{s.text}" for s in sources)


# Un passaggio del bando che contiene oltre metà dei termini di un criterio è la tabella dei criteri:
# ripete la domanda e non porta dati per rispondere, quindi lo si esclude.
_RESTATES_CRITERION = 0.5


async def _plan_queries(ctx: PipelineContext, draft: SectionDraft, focus: list[str] | None) -> list[str]:
    criterion = draft.criterion
    gaps = "\n\nLACUNE DA COLMARE (cerca i dati che servono a risolverle):\n- " + "\n- ".join(focus) if focus else ""
    plan = await ctx.llm.generate_structured(
        system=(
            "Sei il Section Retriever di un team che risponde a bandi di gara. Formula ricerche per un motore a "
            "parole chiave sui documenti del bando. Non riformulare il criterio: cerca i DATI che servono per "
            "rispondere (quantità, monte ore, giorni, orari, frequenze, figure richieste, requisiti, articoli), "
            "usando il lessico tipico di capitolati e disciplinari."
        ),
        prompt=(
            f"DOCUMENTI DEL BANDO: {', '.join(d.name for d in ctx.tender_documents)}\n\n"
            f"CRITERIO {criterion.id} — {criterion.title}\n{criterion.description}{gaps}"
        ),
        schema=SearchPlan,
    )
    return [q for q in plan.queries if q.strip()][:5] or [f"{criterion.title} {criterion.description}"]


def _search_tender(ctx: PipelineContext, queries: list[str]) -> list[SourceChunk]:
    criteria_texts = [f"{c.title} {c.description}" for c in ctx.reqs().criteria]
    best: dict[str, SourceChunk] = {}
    for query in queries:
        for chunk in ctx.tender_index.search(query, 10):
            if chunk.text not in best or chunk.score > best[chunk.text].score:
                best[chunk.text] = chunk
    useful = [
        c for c in sorted(best.values(), key=lambda c: c.score, reverse=True)
        if max(term_coverage(t, c.text) for t in criteria_texts) < _RESTATES_CRITERION
    ]
    return diversify(useful, per_document=2, k=6)


def _search_history(ctx: PipelineContext, query: str) -> list[SourceChunk]:
    return diversify([c for c in ctx.kb().index.search(query, 30) if c.origin == "storico"], per_document=2, k=4)


async def retrieve(ctx: PipelineContext, draft: SectionDraft, stages: StageTracker, focus: list[str] | None = None) -> None:
    """Recupera le fonti della sezione; con `focus` (lacune del validatore) cerca dati mirati e li aggiunge."""
    run, criterion = ctx.run, draft.criterion
    await run.publish("section.status", AgentId.SECTION_RETRIEVER, section_id=criterion.id, status="retrieving")
    await stages.enter(AgentId.SECTION_RETRIEVER, criterion.id)

    queries = await _plan_queries(ctx, draft, focus)
    await run.log(AgentId.SECTION_RETRIEVER, f"{criterion.id}: ricerche → " + " · ".join(f"«{q}»" for q in queries))
    if focus:
        known = {s.text for s in draft.sources}
        found = _search_history(ctx, " ".join(focus)) + _search_tender(ctx, queries)
        added = [c for c in found if c.text not in known]
        draft.sources = draft.sources + added
        summary = f"{criterion.id}: ricerca mirata sulle lacune · {len(added)} nuovi passaggi"
    else:
        template_doc = ctx.template()
        sections_by_id = {h.id: h for h in template_doc.sections}
        template = [
            SourceChunk(origin="template", document=template_doc.path.name, tender=h.title, text=f"{h.title}\n{h.body}"[:4000], score=1)
            for h in (sections_by_id[i] for i in draft.template_section_ids)
            if h.body
        ]
        history = _search_history(ctx, f"{criterion.title} {criterion.description}")
        tender = _search_tender(ctx, queries)
        draft.sources = template + history + tender
        summary = f"{criterion.id}: {len(template)} sezioni template · {len(history)} passaggi storico · {len(tender)} requisiti bando"

    await run.publish(
        "section.sources",
        AgentId.SECTION_RETRIEVER,
        section_id=criterion.id,
        sources=[
            {"origin": s.origin, "tender": s.tender, "document": s.document, "score": s.score, "snippet": s.text[:220]}
            for s in draft.sources
        ],
    )
    await run.log(AgentId.SECTION_RETRIEVER, summary)
    await stages.leave(AgentId.SECTION_RETRIEVER)


def _human_block(draft: SectionDraft) -> str:
    if not draft.human_inputs:
        return ""
    return (
        "INFORMAZIONI CONFERMATE DALL'OPERATORE — vincolanti: usale nel testo e sostituisci i [DA CONFERMARE] "
        "corrispondenti, senza segnarle di nuovo come da confermare:\n- " + "\n- ".join(draft.human_inputs) + "\n\n"
    )


async def write(ctx: PipelineContext, draft: SectionDraft, stages: StageTracker) -> None:
    run, criterion, requirements = ctx.run, draft.criterion, ctx.reqs()
    is_revision = draft.review is not None and not draft.review.is_compliant
    status = "revision" if is_revision else "writing"
    await run.publish("section.status", AgentId.WRITER, section_id=criterion.id, status=status)
    await stages.enter(AgentId.WRITER, criterion.id)

    revision_block = ""
    if is_revision and draft.review:
        revision_block = (
            "\n\nBOZZA PRECEDENTE (da migliorare, mantieni ciò che funziona):\n"
            f"{draft.text}\n\nMantieni una lunghezza simile alla bozza precedente (il limite di facciate è stretto).\n"
            "LACUNE SEGNALATE DAL VALIDATORE (risolvile tutte):\n- "
            + "\n- ".join(draft.review.issues)
        )
        await run.publish("section.reset", AgentId.WRITER, section_id=criterion.id)
    draft.text = ""

    profile = ctx.company_profile
    profile_block = (
        "PROFILO AZIENDALE — riferimento per avere dati corretti, prevale sulle fonti storiche se in contrasto. "
        "NON usarlo come presentazione in apertura della sezione (l'offerta ha già una premessa): cita un dato "
        f"solo se serve a rispondere al criterio.\n{profile.summary}\n"
        f"Certificazioni attuali: {'; '.join(profile.certifications) or 'nessuna indicata'}\n"
        f"Dati: {'; '.join(profile.facts)}\n\n"
        if profile
        else ""
    )
    prompt = (
        f"{profile_block}{_human_block(draft)}BANDO: {requirements.tender_object}\nSTAZIONE APPALTANTE: {requirements.contracting_authority}\n\n"
        f"CRITERIO {criterion.id} — {criterion.title} (max {criterion.max_points:g} punti, tipo {criterion.scoring_type})\n"
        f"Cosa valuta la commissione: {criterion.description}\n\n"
        f"LUNGHEZZA: circa {_word_budget(ctx, draft)} parole.\n\n"
        f"FONTI (template aziendale, offerte storiche, testo del nuovo bando):\n{_format_sources(draft.sources)}"
        f"{revision_block}"
    )
    async for delta in ctx.llm.stream_text(
        system=(
            f"Sei il bid writer senior di {ctx.settings.company_name}. Scrivi in italiano la sezione dell'offerta "
            "tecnica che risponde al criterio indicato, punto per punto, nell'ordine in cui la commissione lo valuta. "
            "Riusa contenuti, numeri e soluzioni dalle fonti storiche e dal template, adattandoli alla nuova "
            "stazione appaltante e alle sue strutture: non citare mai i nomi di committenti o strutture delle gare "
            "precedenti. Non inventare certificazioni, numeri o impegni assenti dalle fonti: se servono, scrivi "
            "[DA CONFERMARE: ...]. "
            "Ruoli, figure e assetto organizzativo devono seguire quanto previsto dai documenti del NUOVO bando "
            "(es. le figure di coordinamento richieste dal capitolato, con i loro requisiti): non importare figure o "
            "assetti della gara da cui proviene il template se il nuovo bando non li prevede. "
            "Quando il criterio riguarda organizzazione, turni o personale, usa i dati quantitativi del bando "
            "(monte ore, giorni di servizio, fasce orarie, frequenze) distinti per struttura o unità d'offerta. "
            "Cita le certificazioni aziendali solo se il criterio le riguarda direttamente, senza elencarle in ogni "
            "sezione. Se le fonti si contraddicono (es. versioni diverse di una norma o certificazione), usa la più recente e "
            "non citare norme superate. Se servono schede, prospetti turni o altri allegati, sintetizza nel testo i "
            "dati essenziali e rimanda all'allegato corrispondente, senza affermare che sia già compilato. "
            "Testo semplice, paragrafi brevi, elenchi con '- ', niente titoli né markdown."
        ),
        prompt=prompt,
    ):
        draft.text += delta
        await run.publish("section.delta", AgentId.WRITER, section_id=criterion.id, text=delta)

    words = len(draft.text.split())
    await run.log(AgentId.WRITER, f"{criterion.id}: {'revisione' if is_revision else 'bozza'} completata · {words} parole")
    await stages.leave(AgentId.WRITER)


async def validate(ctx: PipelineContext, draft: SectionDraft, stages: StageTracker) -> SectionReview:
    run, criterion = ctx.run, draft.criterion
    await run.publish("section.status", AgentId.SECTION_VALIDATOR, section_id=criterion.id, status="validating")
    await stages.enter(AgentId.SECTION_VALIDATOR, criterion.id)

    tender_context = _format_sources([s for s in draft.sources if s.origin == "bando"])
    other_criteria = "\n".join(f"- {c.id} {c.title}" for c in ctx.reqs().criteria if c.id != criterion.id)
    review = await ctx.llm.generate_structured(
        system=(
            "Sei un commissario di gara esperto e severo. Valuta se la sezione risponde in modo completo e "
            "specifico a TUTTI gli elementi del criterio e ai requisiti dei documenti di gara. Valuta solo il "
            "perimetro di QUESTO criterio: figure, servizi o contenuti che appartengono ad altri criteri non sono "
            "lacune di questa sezione. Segnala come 'issues' "
            "solo lacune concrete e bloccanti (elementi richiesti mancanti, riferimenti normativi richiesti "
            "assenti, impegni non quantificati quando il criterio lo chiede). Verifica anche la coerenza con gli "
            "estratti dei documenti di gara: sono lacune bloccanti i dati in contrasto con il bando (monte ore, "
            "giorni, orari), figure o ruoli non previsti o diversi da quelli richiesti, norme o certificazioni "
            "superate. Schede e allegati richiesti dal "
            "criterio (piani di formazione, turni, schede tecniche) vengono predisposti a parte: se la sezione vi "
            "rimanda non è una lacuna. Il coefficiente segue la scala della commissione: 1 ottimo, 0.8 buono, "
            "0.6 discreto, 0.4 sufficiente, 0.2 scarso, 0 assente. Sii severo come una commissione reale: 1 solo "
            "per proposte eccellenti, quantificate e innovative; un'offerta solida ma standard vale 0.6-0.8."
        ),
        prompt=(
            f"CRITERIO {criterion.id} — {criterion.title} ({criterion.max_points:g} punti)\n{criterion.description}\n\n"
            f"ALTRI CRITERI, trattati in altre sezioni (non chiedere qui i loro contenuti):\n{other_criteria}\n\n"
            f"ESTRATTI DEI DOCUMENTI DI GARA:\n{tender_context}\n\n"
            f"{_human_block(draft).replace('vincolanti', 'da considerare veri')}"
            f"SEZIONE DA VALUTARE:\n{draft.text}"
        ),
        schema=SectionReview,
    )
    review.expected_coefficient = max(0.0, min(1.0, review.expected_coefficient))
    draft.review = review
    await run.publish(
        "section.validation",
        AgentId.SECTION_VALIDATOR,
        section_id=criterion.id,
        passed=review.is_compliant,
        coefficient=review.expected_coefficient,
        issues=list(review.issues),
        strengths=list(review.strengths),
        revision=draft.revisions,
    )
    if review.is_compliant:
        await run.log(AgentId.SECTION_VALIDATOR, f"{criterion.id}: approvata · coefficiente atteso {review.expected_coefficient:.2f}")
    else:
        await run.log(AgentId.SECTION_VALIDATOR, f"{criterion.id}: {len(review.issues)} lacune — {review.issues[0] if review.issues else ''}", "warning")
    await stages.leave(AgentId.SECTION_VALIDATOR)
    return review


async def _publish_outcome(ctx: PipelineContext, draft: SectionDraft, review: SectionReview) -> None:
    status = "approved" if review.is_compliant else "flagged"
    await ctx.run.publish("section.status", AgentId.SECTION_VALIDATOR, section_id=draft.criterion.id, status=status)


async def revise_section(
    ctx: PipelineContext, draft: SectionDraft, stages: StageTracker, issues: list[str], *, retrieve_more: bool
) -> SectionReview:
    """Riscrive e rivaluta una sezione con le indicazioni date (validatore, Offer Validator o operatore)."""
    draft.revisions += 1
    coefficient = draft.review.expected_coefficient if draft.review else 0.0
    draft.review = SectionReview(is_compliant=False, expected_coefficient=coefficient, issues=issues, strengths=[])
    if retrieve_more:
        await retrieve(ctx, draft, stages, focus=issues)
    await write(ctx, draft, stages)
    review = await validate(ctx, draft, stages)
    await _publish_outcome(ctx, draft, review)
    return review


async def process_section(ctx: PipelineContext, draft: SectionDraft, stages: StageTracker) -> None:
    await retrieve(ctx, draft, stages)
    await write(ctx, draft, stages)
    review = await validate(ctx, draft, stages)
    if review.is_compliant or ctx.settings.max_section_revisions == 0:
        await _publish_outcome(ctx, draft, review)
    while not review.is_compliant and draft.revisions < ctx.settings.max_section_revisions:
        review = await revise_section(ctx, draft, stages, review.issues, retrieve_more=True)
