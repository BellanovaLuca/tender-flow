from dataclasses import dataclass, field
from pathlib import Path

from app.documents import Heading, ParsedDocument
from app.knowledge_base import KnowledgeBase
from app.llm import TextModel
from app.retrieval import Bm25Index
from app.runs import Run
from app.schemas import CompanyProfile, SectionDraft, TenderRequirements
from app.settings import Settings


@dataclass(frozen=True)
class CompanyTemplate:
    path: Path
    sections: list[Heading]
    is_uploaded: bool


@dataclass
class PipelineContext:
    """Stato condiviso tra gli agenti di una singola esecuzione."""

    run: Run
    llm: TextModel
    settings: Settings
    tender_documents: list[ParsedDocument] = field(default_factory=list)
    tender_index: Bm25Index = field(default_factory=Bm25Index)
    knowledge_base: KnowledgeBase | None = None
    requirements: TenderRequirements | None = None
    company_profile: CompanyProfile | None = None
    company_template: CompanyTemplate | None = None
    drafts: list[SectionDraft] = field(default_factory=list)

    def kb(self) -> KnowledgeBase:
        if self.knowledge_base is None:
            raise RuntimeError("knowledge base non ancora caricata")
        return self.knowledge_base

    def template(self) -> CompanyTemplate:
        if self.company_template is None:
            raise RuntimeError("template aziendale non ancora caricato")
        return self.company_template

    def reqs(self) -> TenderRequirements:
        if self.requirements is None:
            raise RuntimeError("requisiti non ancora estratti")
        return self.requirements
