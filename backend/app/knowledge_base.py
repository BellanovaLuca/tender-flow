"""Base di conoscenza aziendale: offerte tecniche storiche, progetti gold e template.

Struttura attesa sotto KNOWLEDGE_BASE_DIR:
    Storico/<Gara>/<cartella con "offerta" nel nome>/*.pdf|*.docx
    Progetti Gold/*.pdf|*.docx        (opzionale)
    Template/*.docx                   (il primo in ordine alfabetico)
Gli atti di gara storici (disciplinari, capitolati) non vengono indicizzati: servono le risposte.

Uso da CLI per pre-indicizzare prima di una demo:  python -m app.knowledge_base
"""

import asyncio
import hashlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from app.documents import Heading, extract, read_template_headings
from app.retrieval import Bm25Index, chunk_text
from app.schemas import SourceChunk
from app.settings import Settings, get_settings

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, int, int], Awaitable[None]]
_SUPPORTED_SUFFIXES = {".pdf", ".docx"}


@dataclass
class KnowledgeBase:
    index: Bm25Index
    tenders: list[str]
    documents: list[str]
    template_path: Path
    template_sections: list[Heading]


def _documents_in(directory: Path) -> list[Path]:
    return sorted(p for p in directory.rglob("*") if p.suffix.lower() in _SUPPORTED_SUFFIXES and p.is_file())


def _discover(root: Path) -> list[tuple[str, Path]]:
    found: list[tuple[str, Path]] = []
    for tender_dir in sorted(p for p in (root / "Storico").glob("*") if p.is_dir()):
        for offer_dir in sorted(p for p in tender_dir.glob("*") if p.is_dir() and "offerta" in p.name.lower()):
            found += [(tender_dir.name, p) for p in _documents_in(offer_dir)]
    gold = root / "Progetti Gold"
    if gold.is_dir():
        found += [("Progetto Gold", p) for p in _documents_in(gold)]
    return found


async def build(settings: Settings, on_progress: ProgressCallback | None = None) -> KnowledgeBase:
    root = settings.knowledge_base_dir
    templates = sorted((root / "Template").glob("*.docx"))
    if not templates:
        raise FileNotFoundError("Nessun template .docx trovato in Template/")
    template_path = templates[0]

    sources = _discover(root)
    index = Bm25Index()
    seen_hashes: set[str] = set()
    documents: list[str] = []
    for position, (tender, path) in enumerate(sources, start=1):
        if on_progress:
            await on_progress(f"{tender} · {path.name}", position, len(sources))
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in seen_hashes:
            continue
        seen_hashes.add(digest)
        parsed = await extract(path, settings.cache_dir)
        documents.append(f"{tender}/{path.name}")
        for text in chunk_text(parsed.text):
            index.add(SourceChunk(origin="storico", document=path.name, tender=tender, text=text, score=0))

    headings = await asyncio.to_thread(read_template_headings, template_path)
    for heading in headings:
        if heading.body:
            index.add(
                SourceChunk(
                    origin="template",
                    document=template_path.name,
                    tender=heading.title,
                    text=f"{heading.title}\n{heading.body}"[:4000],
                    score=0,
                )
            )

    tenders = sorted({tender for tender, _ in sources if tender != "Progetto Gold"})
    logger.info("knowledge base pronta: %d documenti, %d chunk", len(documents), len(index.chunks))
    return KnowledgeBase(index, tenders, documents, template_path, headings)


_kb: KnowledgeBase | None = None
_kb_lock = asyncio.Lock()


async def get_knowledge_base(settings: Settings, on_progress: ProgressCallback | None = None) -> KnowledgeBase:
    """Singleton lazy per processo: l'indicizzazione dello storico è costosa."""
    global _kb
    async with _kb_lock:
        if _kb is None:
            _kb = await build(settings, on_progress)
        return _kb


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    async def _print_progress(label: str, position: int, total: int) -> None:
        logger.info("[%d/%d] %s", position, total, label)

    asyncio.run(build(get_settings(), _print_progress))
