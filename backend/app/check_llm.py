"""Verifica chiave e modello Gemini prima di una demo:  python -m app.check_llm"""

import asyncio
import logging

from pydantic import BaseModel

from app.llm import LlmClient
from app.settings import get_settings

logger = logging.getLogger(__name__)


class _Ping(BaseModel):
    ok: bool


async def _check() -> None:
    settings = get_settings()
    llm = LlmClient(settings)
    result = await llm.generate_structured(system="Rispondi in JSON.", prompt="Restituisci ok=true.", schema=_Ping)
    logger.info("modello %s raggiungibile, output strutturato: %s", settings.gemini_model, result.ok)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(_check())
