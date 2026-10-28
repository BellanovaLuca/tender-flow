"""Agenti di analisi: parsing del bando, estrazione requisiti, storico, split del template."""

import asyncio
from pathlib import Path

from app.agents.context import CompanyTemplate, PipelineContext
from app.documents import ParsedDocument, extract, read_template_headings
from app.knowledge_base import get_knowledge_base
from app.retrieval import chunk_text
from app.schemas import AgentId, CompanyProfile, SectionDraft, SectionPlan, SourceChunk, TenderRequirements

# ~150k token: entra nel contesto dei modelli Gemini lasciando margine all'output.
_MAX_PROMPT_CHARS = 600_000
_EVALUATION_TERMS = ("criteri di valutazione", "sub-criteri", "punteggio", "offerta tecnica", "punti max")


async def parse_tender(ctx: PipelineContext, paths: list[Path]) -> None:
    run, agent = ctx.run, AgentId.PARSER
    await run.agent(agent, "running", f"Lettura di {len(paths)} documenti", 0)
    for position, path in enumerate(paths, start=1):
        parsed = await extract(path, ctx.settings.cache_dir)
        ctx.tender_documents.append(parsed)
        for text in chunk_text(parsed.text):
            ctx.tender_index.add(SourceChunk(origin="bando", document=parsed.name, tender="Bando", text=text, score=0))
        pages = f"{parsed.pages} pagine · " if parsed.pages else ""
        await run.log(agent, f"{parsed.name} — {pages}{len(parsed.text):,} caratteri estratti".replace(",", "."))
        await run.agent(agent, "running", f"Letto {parsed.name}", position / len(paths))
    await run.publish(
        "documents.parsed",
        agent,
        documents=[{"name": d.name, "pages": d.pages, "chars": len(d.text)} for d in ctx.tender_documents],
        chunks=len(ctx.tender_index.chunks),
    )
    await run.agent(agent, "done", f"{len(paths)} documenti · {len(ctx.tender_index.chunks)} chunk indicizzati", 1)


def _evaluation_relevance(document: ParsedDocument) -> int:
    """Quanto un documento parla di criteri di valutazione: non si assume alcun nome di file."""
    text = document.text.lower()
    return sum(text.count(term) for term in _EVALUATION_TERMS)


def _requirements_corpus(documents: list[ParsedDocument]) -> tuple[str, list[str]]:
    """Tutti i documenti del bando, dal più pertinente ai criteri, fino al budget di caratteri."""
    ranked = sorted(documents, key=_evaluation_relevance, reverse=True)
    parts: list[str] = []
    included: list[str] = []
    budget = _MAX_PROMPT_CHARS
    for document in ranked:
        if budget <= 0:
            break
        text = document.text[:budget]
        parts.append(f"=== DOCUMENTO: {document.name} ===\n{text}")
        included.append(document.name)
        budget -= len(text)
    return "\n\n".join(parts), included


async def extract_requirements(ctx: PipelineContext) -> None:
    run, agent = ctx.run, AgentId.REQUIREMENTS
    corpus, included = _requirements_corpus(ctx.tender_documents)
    await run.agent(agent, "running", f"Analisi di {len(included)} documenti")
    await run.log(agent, f"Documento più rilevante per i criteri: {included[0]}")
    skipped = len(ctx.tender_documents) - len(included)
    if skipped:
        await run.log(agent, f"{skipped} documenti esclusi per limite di contesto", "warning")

    requirements = await ctx.llm.generate_structured(
        system=(
            "Sei un analista esperto di gare d'appalto. Tra i documenti forniti individua quello che definisce "
            "le regole di valutazione (disciplinare, lettera d'invito, bando o equivalente) ed estrai, in modo "
            "fedele e senza inventare, i dati richiesti. In 'criteria' elenca SOLO i criteri foglia dell'offerta "
            "tecnica con il loro codice originale; se un criterio non ha sub-criteri inseriscilo come foglia. "
            "Se i criteri non hanno codice, assegna codici progressivi C1, C2, ... La somma dei punti deve "
            "coincidere con il punteggio tecnico massimo."
        ),
        prompt=corpus,
        schema=TenderRequirements,
    )
    if not requirements.criteria:
        raise ValueError("Nessun criterio di valutazione dell'offerta tecnica trovato nei documenti")
    ctx.requirements = requirements
    total = sum(c.max_points for c in requirements.criteria)
    await run.log(agent, f"Stazione appaltante: {requirements.contracting_authority}")
    await run.log(agent, f"Estratti {len(requirements.criteria)} criteri di valutazione · {total:g}/{requirements.technical_max_points:g} punti tecnici")
    if requirements.technical_threshold:
        await run.log(agent, f"Soglia di sbarramento: {requirements.technical_threshold:g} punti", "warning")
    if requirements.page_limit:
        await run.log(agent, f"Vincolo formale: max {requirements.page_limit} facciate · {requirements.formatting_rules}")
    if abs(total - requirements.technical_max_points) > 0.01:
        await run.log(agent, "La somma dei punti dei criteri non coincide con il massimo tecnico: verificare", "warning")
    await run.publish("requirements.extracted", agent, requirements=requirements.model_dump(mode="json"))
    await run.agent(agent, "done", f"{len(requirements.criteria)} criteri · {requirements.technical_max_points:g} punti")


async def load_history(ctx: PipelineContext) -> None:
    run, agent = ctx.run, AgentId.HISTORY
    await run.agent(agent, "running", "Indicizzazione dello storico", 0)

    async def progress(label: str, position: int, total: int) -> None:
        await run.agent(agent, "running", f"Lettura {label}", position / total)

    kb = await get_knowledge_base(ctx.settings, progress)
    ctx.knowledge_base = kb
    uploaded = run.template_path
    if uploaded is not None:
        sections = await asyncio.to_thread(read_template_headings, uploaded)
        ctx.company_template = CompanyTemplate(uploaded, sections, is_uploaded=True)
        await run.log(agent, f"Template aziendale caricato per questa gara: {uploaded.name} · {len(sections)} sezioni")
    else:
        ctx.company_template = CompanyTemplate(kb.template_path, kb.template_sections, is_uploaded=False)
        await run.log(agent, f"Template aziendale predefinito: {kb.template_path.name}")
    for tender in kb.tenders:
        await run.log(agent, f"Gara storica disponibile: {tender}")
    await run.log(agent, f"{len(kb.documents)} offerte tecniche · {len(kb.index.chunks)} passaggi indicizzati")
    await run.publish(
        "history.indexed", agent, tenders=list(kb.tenders), documents=list(kb.documents), chunks=len(kb.index.chunks)
    )
    await run.agent(agent, "done", f"{len(kb.tenders)} gare · {len(kb.index.chunks)} passaggi", 1)


_PROFILE_QUERY = "certificazioni sistema di gestione qualità norma sede cooperativa anni esperienza strutture gestite dipendenti"


async def build_company_profile(ctx: PipelineContext) -> None:
    """Scheda aziendale valida per tutte le sezioni: evita che il Writer usi dati vecchi trovati in un singolo passaggio."""
    run, agent, kb = ctx.run, AgentId.HISTORY, ctx.kb()
    await run.agent(agent, "running", "Costruzione profilo aziendale")
    template_text = "\n".join(f"{h.title}\n{h.body}" for h in ctx.template().sections)
    history = "\n\n".join(f"[{c.tender} · {c.document}]\n{c.text}" for c in kb.index.search(_PROFILE_QUERY, 15) if c.origin == "storico")
    profile = await ctx.llm.generate_structured(
        system=(
            f"Ricava il profilo aziendale di {ctx.settings.company_name} dai documenti forniti. Riporta solo dati "
            "presenti nei testi. Se trovi versioni diverse della stessa informazione (es. OHSAS 18001 e ISO 45001, "
            "edizioni diverse di una norma), tieni solo la più recente: il template aziendale è il documento più "
            "aggiornato."
        ),
        prompt=f"TEMPLATE AZIENDALE (più recente):\n{template_text[:_MAX_PROMPT_CHARS // 4]}\n\nOFFERTE STORICHE:\n{history}",
        schema=CompanyProfile,
    )
    ctx.company_profile = profile
    await run.log(agent, f"Profilo aziendale: {len(profile.certifications)} certificazioni · {len(profile.facts)} dati societari")
    for certification in profile.certifications:
        await run.log(agent, f"Certificazione attuale: {certification}")
    await run.agent(agent, "done", f"{len(kb.tenders)} gare · profilo aziendale pronto", 1)


async def split_template(ctx: PipelineContext) -> None:
    run, agent = ctx.run, AgentId.SPLITTER
    template, requirements = ctx.template(), ctx.reqs()
    await run.agent(agent, "running", f"Scomposizione di {template.path.name}")
    await run.log(agent, f"Template aziendale: {len(template.sections)} sezioni rilevate")

    outline = "\n".join(
        f"[{h.id}] {'  ' * (h.level - 1)}{h.title} — {h.body[:220]}" for h in template.sections
    )
    criteria = "\n".join(f"[{c.id}] {c.title} ({c.max_points:g} pt): {c.description}" for c in requirements.criteria)
    plan = await ctx.llm.generate_structured(
        system=(
            "Sei il responsabile della struttura delle offerte tecniche. Per ogni criterio del nuovo bando "
            "indica quali sezioni del template aziendale possono essere riutilizzate come base. "
            "Restituisci una mappatura per OGNI criterio, anche con lista vuota se non c'è nulla di pertinente."
        ),
        prompt=f"CRITERI DEL NUOVO BANDO:\n{criteria}\n\nSEZIONI DEL TEMPLATE AZIENDALE:\n{outline}",
        schema=SectionPlan,
    )
    mapping = {m.criterion_id: m for m in plan.mappings}
    valid_ids = {h.id for h in template.sections}
    ctx.drafts = [
        SectionDraft(
            criterion=c,
            template_section_ids=[i for i in (mapping[c.id].template_section_ids if c.id in mapping else []) if i in valid_ids],
        )
        for c in requirements.criteria
    ]
    gaps = [d.criterion.id for d in ctx.drafts if not d.template_section_ids]
    if gaps:
        await run.log(agent, f"Nessuna sezione di template per {', '.join(gaps)}: contenuti dallo storico", "warning")
    titles = {h.id: h.title for h in template.sections}
    await run.publish(
        "sections.planned",
        agent,
        sections=[
            {
                "id": d.criterion.id,
                "title": d.criterion.title,
                "max_points": d.criterion.max_points,
                "scoring_type": d.criterion.scoring_type,
                "template_sections": [titles[i] for i in d.template_section_ids],
            }
            for d in ctx.drafts
        ],
    )
    await run.agent(agent, "done", f"{len(ctx.drafts)} sezioni pianificate · {len(gaps)} gap")
