"""Indice lessicale BM25 (stdlib) su chunk di documenti: storico gare e bando corrente."""

import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

from app.schemas import SourceChunk

_TOKEN = re.compile(r"[a-z0-9]{3,}")
_STOPWORDS = frozenset(
    "che con del della delle dei degli per una uno nel nella nelle negli dal dalla alle agli sono come "
    "anche più tra fra sul sulla sui suo sua loro questo questa quale quali ogni essere viene vengono "
    "inoltre stesso stessa dovrà dovranno parte modo caso tutti tutte".split()
)
_K1, _B = 1.5, 0.75


def _stem(token: str) -> str:
    """Stemming minimo per l'italiano: unifica singolare/plurale e genere (turno/turni, prevista/previste)."""
    return token[:-1] if len(token) > 4 and token[-1] in "aeio" else token


def _tokens(text: str) -> list[str]:
    folded = unicodedata.normalize("NFKD", text.lower()).encode("ascii", "ignore").decode()
    return [_stem(t) for t in _TOKEN.findall(folded) if t not in _STOPWORDS]


def chunk_text(text: str, target_chars: int = 1400) -> list[str]:
    """Raggruppa paragrafi contigui in chunk di dimensione simile, senza spezzare le frasi."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n|(?<=[.:;])\n", text) if len(p.strip()) > 40]
    chunks: list[str] = []
    buffer = ""
    for paragraph in paragraphs:
        if buffer and len(buffer) + len(paragraph) > target_chars:
            chunks.append(buffer)
            buffer = ""
        buffer = f"{buffer}\n{paragraph}".strip()
    if buffer:
        chunks.append(buffer)
    return chunks


@dataclass
class Bm25Index:
    chunks: list[SourceChunk] = field(default_factory=list)
    _tf: list[Counter[str]] = field(default_factory=list)
    _df: Counter[str] = field(default_factory=Counter)
    _total_len: int = 0

    def add(self, chunk: SourceChunk) -> None:
        tf = Counter(_tokens(chunk.text))
        self.chunks.append(chunk)
        self._tf.append(tf)
        self._df.update(tf.keys())
        self._total_len += sum(tf.values())

    def search(self, query: str, k: int) -> list[SourceChunk]:
        if not self.chunks:
            return []
        n = len(self.chunks)
        avg_len = self._total_len / n
        terms = set(_tokens(query))
        scored: list[tuple[float, int]] = []
        for i, tf in enumerate(self._tf):
            length = sum(tf.values()) or 1
            score = 0.0
            for term in terms:
                freq = tf.get(term, 0)
                if freq:
                    idf = math.log(1 + (n - self._df[term] + 0.5) / (self._df[term] + 0.5))
                    score += idf * freq * (_K1 + 1) / (freq + _K1 * (1 - _B + _B * length / avg_len))
            if score > 0:
                scored.append((score, i))
        scored.sort(reverse=True)
        return [self.chunks[i].model_copy(update={"score": round(s, 2)}) for s, i in scored[:k]]


def term_coverage(reference: str, text: str) -> float:
    """Quota dei termini di `reference` presenti in `text` (0-1)."""
    reference_terms = set(_tokens(reference))
    if not reference_terms:
        return 0.0
    return len(reference_terms & set(_tokens(text))) / len(reference_terms)


def diversify(chunks: list[SourceChunk], per_document: int, k: int) -> list[SourceChunk]:
    """Tiene l'ordine di rilevanza ma limita i chunk per documento, così un solo file non monopolizza le fonti."""
    picked: list[SourceChunk] = []
    per_doc: dict[str, int] = {}
    for chunk in chunks:
        key = f"{chunk.tender}/{chunk.document}"
        if per_doc.get(key, 0) < per_document:
            picked.append(chunk)
            per_doc[key] = per_doc.get(key, 0) + 1
        if len(picked) == k:
            break
    return picked
