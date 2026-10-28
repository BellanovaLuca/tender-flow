from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: SecretStr
    gemini_model: str = "gemini-2.5-flash"
    gemini_timeout_ms: int = Field(default=120_000, ge=5_000, le=600_000)
    gemini_max_attempts: int = Field(default=4, ge=1, le=8)
    # Listino in USD per 1M token (output include il thinking); solo per la stima dei costi.
    gemini_price_input_per_m: float = Field(default=0.30, ge=0)
    gemini_price_output_per_m: float = Field(default=2.50, ge=0)

    knowledge_base_dir: Path = Path("../docs")
    sample_tender_dir: Path = Path("../docs/Capitolato target")
    data_dir: Path = Path("./data")
    company_name: str = Field(default="l'operatore economico", max_length=120)

    section_concurrency: int = Field(default=3, ge=1, le=10)
    max_section_revisions: int = Field(default=1, ge=0, le=3)
    # Giri di correzione dopo l'Offer Validator prima di passare le incoerenze residue all'operatore.
    max_document_revisions: int = Field(default=1, ge=0, le=3)

    max_upload_files: int = Field(default=20, ge=1, le=100)
    max_upload_bytes: int = Field(default=50 * 1024 * 1024, ge=1024)
    # Stima per relazione A4, Arial 11, interlinea 1,5.
    words_per_page: int = Field(default=420, ge=100)

    cors_origins: list[str] = ["http://localhost:5173"]

    @property
    def runs_dir(self) -> Path:
        return self.data_dir / "runs"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # i valori arrivano da env/.env
