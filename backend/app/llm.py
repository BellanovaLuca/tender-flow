"""Client Gemini condiviso: timeout e retry espliciti, output strutturato, streaming e conteggio token."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol, TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.settings import Settings

T = TypeVar("T", bound=BaseModel)

_TRANSIENT_STATUS = [408, 429, 500, 502, 503, 504]


@dataclass
class TokenUsage:
    calls: int = 0
    input_tokens: int = 0
    # Gemini fattura il "thinking" come output: lo teniamo separato solo per trasparenza.
    output_tokens: int = 0
    thinking_tokens: int = 0

    def add(self, metadata: types.GenerateContentResponseUsageMetadata | None) -> None:
        self.calls += 1
        if metadata is None:
            return
        self.input_tokens += metadata.prompt_token_count or 0
        self.output_tokens += metadata.candidates_token_count or 0
        self.thinking_tokens += metadata.thoughts_token_count or 0

    def cost_usd(self, input_price_per_m: float, output_price_per_m: float) -> float:
        billed_output = self.output_tokens + self.thinking_tokens
        return (self.input_tokens * input_price_per_m + billed_output * output_price_per_m) / 1_000_000


class TextModel(Protocol):
    """Interfaccia usata dagli agenti: la implementano il client reale, quello misurato e i fake di test."""

    async def generate_structured(self, *, system: str, prompt: str, schema: type[T]) -> T: ...

    def stream_text(self, *, system: str, prompt: str) -> AsyncIterator[str]: ...


class LlmClient:
    def __init__(self, settings: Settings) -> None:
        self._model = settings.gemini_model
        self._client = genai.Client(
            api_key=settings.gemini_api_key.get_secret_value(),
            http_options=types.HttpOptions(
                timeout=settings.gemini_timeout_ms,
                retry_options=types.HttpRetryOptions(
                    attempts=settings.gemini_max_attempts,
                    initial_delay=2.0,
                    max_delay=30.0,
                    exp_base=2.0,
                    jitter=1.0,
                    http_status_codes=_TRANSIENT_STATUS,
                ),
            ),
        )

    async def generate_structured(
        self, *, system: str, prompt: str, schema: type[T], usage: TokenUsage | None = None
    ) -> T:
        response = await self._client.aio.models.generate_content(
            model=self._model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system,
                temperature=0.2,
                response_mime_type="application/json",
                response_schema=schema,
            ),
        )
        if usage is not None:
            usage.add(response.usage_metadata)
        return schema.model_validate_json(response.text or "{}")

    async def stream_text(self, *, system: str, prompt: str, usage: TokenUsage | None = None) -> AsyncIterator[str]:
        stream = await self._client.aio.models.generate_content_stream(
            model=self._model,
            contents=prompt,
            config=types.GenerateContentConfig(system_instruction=system, temperature=0.6),
        )
        last_metadata: types.GenerateContentResponseUsageMetadata | None = None
        async for chunk in stream:
            # Nello streaming i contatori sono cumulativi: vale l'ultimo ricevuto.
            last_metadata = chunk.usage_metadata or last_metadata
            if chunk.text:
                yield chunk.text
        if usage is not None:
            usage.add(last_metadata)


class MeteredLlm:
    """Vista per-run del client condiviso che accumula i token consumati dalla run."""

    def __init__(self, client: LlmClient, usage: TokenUsage) -> None:
        self._client = client
        self.usage = usage

    async def generate_structured(self, *, system: str, prompt: str, schema: type[T]) -> T:
        return await self._client.generate_structured(system=system, prompt=prompt, schema=schema, usage=self.usage)

    async def stream_text(self, *, system: str, prompt: str) -> AsyncIterator[str]:
        async for delta in self._client.stream_text(system=system, prompt=prompt, usage=self.usage):
            yield delta
