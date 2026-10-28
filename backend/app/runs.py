"""Registro delle esecuzioni e log append-only degli eventi.

Limite noto: lo stato è in memoria nel processo, quindi va eseguito con un solo worker uvicorn.
Per più istanze sostituire RunStore con un backend condiviso (es. Redis Streams) mantenendo
la stessa interfaccia publish/follow.
"""

import asyncio
import shutil
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import JsonValue

from app.schemas import AgentId, AgentStatus, EventType, PipelineEvent


def _set_event() -> asyncio.Event:
    event = asyncio.Event()
    event.set()
    return event


@dataclass
class Run:
    id: str
    directory: Path
    events: list[PipelineEvent] = field(default_factory=list)
    finished: bool = False
    document_path: Path | None = None
    # Template aziendale caricato per questa gara; None = template predefinito della knowledge base.
    template_path: Path | None = None
    # Task che esegue la pipeline (o la ripresa dell'operatore): lo stop la cancella.
    task: asyncio.Task[None] | None = None
    _changed: asyncio.Condition = field(default_factory=asyncio.Condition)
    _unpaused: asyncio.Event = field(default_factory=lambda: _set_event())

    async def publish(self, type_: EventType, agent: AgentId | None = None, **data: JsonValue) -> None:
        async with self._changed:
            self.events.append(
                PipelineEvent(seq=len(self.events), ts=time.time(), type=type_, agent=agent, data=data)
            )
            if type_ in ("run.completed", "run.failed", "run.stopped"):
                self.finished = True
            self._changed.notify_all()

    def reopen(self) -> None:
        """Una run completata riprende (intervento dell'operatore): i client devono risottoscriversi."""
        self.finished = False
        self.document_path = None

    @property
    def is_paused(self) -> bool:
        return not self._unpaused.is_set()

    async def pause(self) -> None:
        if self.is_paused:
            return
        self._unpaused.clear()
        await self.publish("run.paused")

    async def unpause(self) -> None:
        if not self.is_paused:
            return
        self._unpaused.set()
        await self.publish("run.continued")

    async def wait_if_paused(self) -> None:
        """Punto di attesa degli agenti: blocca finché la run è in pausa."""
        await self._unpaused.wait()

    def stop(self) -> None:
        """Cancella la task in corso; la pipeline pubblica `run.stopped` mentre si chiude."""
        self._unpaused.set()
        if self.task is not None:
            self.task.cancel()

    async def agent(self, agent: AgentId, status: AgentStatus, message: str, progress: float | None = None) -> None:
        await self.publish("agent.status", agent, status=status, message=message, progress=progress)

    async def log(self, agent: AgentId, message: str, level: str = "info") -> None:
        await self.publish("log", agent, level=level, message=message)

    async def follow(self, after: int = -1, heartbeat_s: float = 15.0) -> AsyncIterator[PipelineEvent | None]:
        """Rigioca gli eventi dopo `after` e poi segue i nuovi; None = heartbeat."""
        cursor = after + 1
        while True:
            while cursor < len(self.events):
                yield self.events[cursor]
                cursor += 1
            if self.finished:
                return
            async with self._changed:
                try:
                    await asyncio.wait_for(self._changed.wait_for(lambda: cursor < len(self.events)), heartbeat_s)
                except TimeoutError:
                    yield None


class RunStore:
    def __init__(self, root: Path) -> None:
        self._root = root
        self._runs: dict[str, Run] = {}

    def create(self) -> Run:
        run_id = uuid.uuid4().hex
        directory = self._root / run_id
        (directory / "uploads").mkdir(parents=True)
        run = Run(run_id, directory)
        self._runs[run_id] = run
        return run

    def get(self, run_id: str) -> Run | None:
        return self._runs.get(run_id)

    def discard(self, run_id: str) -> None:
        run = self._runs.pop(run_id, None)
        if run is not None:
            shutil.rmtree(run.directory, ignore_errors=True)
