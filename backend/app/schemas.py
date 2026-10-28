"""Modelli di dominio e contratto degli eventi della pipeline (consumati dal frontend via SSE)."""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, JsonValue


class AgentId(StrEnum):
    PARSER = "parser"
    REQUIREMENTS = "requirements"
    HISTORY = "history"
    SPLITTER = "splitter"
    SECTION_RETRIEVER = "section_retriever"
    WRITER = "writer"
    SECTION_VALIDATOR = "section_validator"
    TEMPLATE_VALIDATOR = "template_validator"
    SCORER = "scorer"
    ASSEMBLER = "assembler"
    OPERATOR = "operator"


AgentStatus = Literal["idle", "running", "done", "warning", "error"]
SectionStatus = Literal["planned", "retrieving", "writing", "validating", "revision", "approved", "flagged"]
EventType = Literal[
    "run.started",
    "run.completed",
    "run.resumed",
    "run.failed",
    "run.paused",
    "run.continued",
    "run.stopped",
    "agent.status",
    "log",
    "documents.parsed",
    "requirements.extracted",
    "history.indexed",
    "sections.planned",
    "section.status",
    "section.sources",
    "section.delta",
    "section.reset",
    "section.validation",
    "template.validation",
    "score.estimated",
]


class PipelineEvent(BaseModel):
    seq: int
    ts: float
    type: EventType
    agent: AgentId | None = None
    data: dict[str, JsonValue] = Field(default_factory=dict)


# --- Output strutturati richiesti al modello (usati come response_schema) ---


class Criterion(BaseModel):
    id: str = Field(description="Codice del sub-criterio foglia, es. 'A.1' oppure 'B' se il criterio non ha sub-criteri")
    title: str
    description: str = Field(description="Cosa valuterà la commissione, riportato fedelmente dal disciplinare")
    max_points: float
    scoring_type: Literal["D", "T"] = Field(description="D = discrezionale, T = tabellare")


class TenderRequirements(BaseModel):
    contracting_authority: str
    tender_object: str
    technical_max_points: float
    economic_max_points: float
    technical_threshold: float = Field(description="Soglia di sbarramento sul punteggio tecnico, 0 se assente")
    page_limit: int = Field(description="Numero massimo di facciate della relazione tecnica, 0 se assente")
    formatting_rules: str = Field(description="Sintesi breve (max 80 caratteri), es. 'A4, Arial 11, interlinea 1,5'")
    mandatory_attachments: list[str] = Field(
        description="Solo gli allegati da inserire nella busta dell'offerta TECNICA (schede, piani, ecc.), "
        "esclusi i documenti amministrativi"
    )
    criteria: list[Criterion]


class SectionMapping(BaseModel):
    criterion_id: str
    template_section_ids: list[str] = Field(description="Id delle sezioni del template aziendale da riusare, anche vuoto")
    rationale: str = Field(description="Una frase su perché queste sezioni sono pertinenti")


class SectionPlan(BaseModel):
    mappings: list[SectionMapping]


class CompanyProfile(BaseModel):
    summary: str = Field(description="Chi è l'azienda in 2-3 frasi")
    certifications: list[str] = Field(
        description="Certificazioni ATTUALI con norma ed edizione (es. 'UNI ISO 45001:2018'); escluse quelle superate"
    )
    facts: list[str] = Field(description="Dati societari ricorrenti e verificabili: sede, anni di attività, numeri chiave")


class SearchPlan(BaseModel):
    queries: list[str] = Field(
        description="3-5 ricerche brevi (4-8 parole) con il lessico dei capitolati per trovare dati concreti"
    )


class SectionReview(BaseModel):
    is_compliant: bool = Field(description="True se la bozza risponde a tutti i punti richiesti dal criterio")
    expected_coefficient: float = Field(description="Coefficiente atteso dalla commissione tra 0 e 1")
    issues: list[str] = Field(description="Lacune bloccanti da correggere, vuota se conforme")
    strengths: list[str]


class DocumentIssue(BaseModel):
    section_ids: list[str] = Field(description="Codici delle sezioni coinvolte, es. ['A.1', 'C.1']")
    description: str
    severity: Literal["bloccante", "minore"] = Field(
        description="bloccante: numeri, ruoli o impegni in contraddizione che la commissione penalizzerebbe; "
        "minore: ripetizioni, differenze di nome o di stile"
    )


class DocumentReview(BaseModel):
    is_consistent: bool
    issues: list[DocumentIssue] = Field(description="Incoerenze tra sezioni, ripetizioni, contraddizioni")


class CheckItem(BaseModel):
    """Singolo punto di un controllo finale; section_id permette alla UI di aprire la sezione."""

    section_id: str | None
    text: str


# --- Stato interno ---


class SourceChunk(BaseModel):
    origin: Literal["storico", "bando", "template"]
    document: str
    tender: str
    text: str
    score: float


class SectionDraft(BaseModel):
    criterion: Criterion
    template_section_ids: list[str] = []
    sources: list[SourceChunk] = []
    text: str = ""
    review: SectionReview | None = None
    revisions: int = 0
    # Informazioni fornite dall'operatore: vincolanti per tutte le riscritture successive.
    human_inputs: list[str] = []
