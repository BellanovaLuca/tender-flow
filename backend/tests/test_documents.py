import io
from pathlib import Path

import docx
import pytest
from fastapi import UploadFile

from app.documents import UploadRejected, detect_kind, sanitize_filename, save_template, save_upload
from app.retrieval import Bm25Index, diversify, term_coverage
from app.schemas import SourceChunk
from tests.conftest import make_pdf


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("../../etc/passwd", "passwd"),
        ("C:\\x\\bando gara.pdf", "bando gara.pdf"),
        ("a\r\nb\x00.pdf", "a__b_.pdf"),
        ("", "documento"),
    ],
)
def test_sanitize_filename(raw: str, expected: str) -> None:
    assert sanitize_filename(raw) == expected


def test_detect_kind_uses_magic_bytes() -> None:
    assert detect_kind(b"%PDF-1.7 ...") == "pdf"
    assert detect_kind(b"PK\x03\x04...") == "docx"
    assert detect_kind(b"MZ\x90\x00") is None


@pytest.mark.anyio
async def test_save_upload_rejects_spoofed_extension(tmp_path: Path) -> None:
    upload = UploadFile(io.BytesIO(b"#!/bin/sh\necho hi"), filename="bando.pdf")
    with pytest.raises(UploadRejected):
        await save_upload(upload, tmp_path, max_bytes=1024)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.anyio
async def test_save_upload_enforces_size_cap(tmp_path: Path) -> None:
    upload = UploadFile(io.BytesIO(make_pdf("x") + b"0" * 5000), filename="big.pdf")
    with pytest.raises(UploadRejected):
        await save_upload(upload, tmp_path, max_bytes=1000)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.anyio
async def test_save_upload_names_file_by_detected_type(tmp_path: Path) -> None:
    upload = UploadFile(io.BytesIO(make_pdf("ok")), filename="disciplinare.docx")
    saved = await save_upload(upload, tmp_path, max_bytes=100_000)
    assert saved.name == "disciplinare.pdf"


def test_bm25_ranks_relevant_chunk_first() -> None:
    index = Bm25Index()
    for text in ("Piano di formazione continua ECM", "Servizio di lavanderia e guardaroba", "Pulizia ambienti"):
        index.add(SourceChunk(origin="storico", document="d", tender="t", text=text, score=0))
    results = index.search("formazione del personale", k=2)
    assert results[0].text.startswith("Piano di formazione")
    assert len(results) == 1


def test_stemming_matches_singular_and_plural() -> None:
    index = Bm25Index()
    index.add(SourceChunk(origin="bando", document="d", tender="t", text="Turno notturno degli operatori", score=0))
    assert index.search("turni", k=1)


def test_term_coverage_detects_restated_criterion() -> None:
    criterion = "modello organizzativo del servizio di pulizia con ipotesi di turno"
    assert term_coverage(criterion, "Verrà valutato il modello organizzativo del servizio di pulizia e le ipotesi di turno") > 0.8
    assert term_coverage(criterion, "RSA Bianchi 4,5 ore al giorno per 7 giorni su 7") < 0.2


def test_diversify_caps_chunks_per_document() -> None:
    chunks = [SourceChunk(origin="bando", document=doc, tender="t", text=f"{doc}{i}", score=10 - i) for i, doc in enumerate("AAAB")]
    picked = diversify(chunks, per_document=2, k=5)
    assert [c.document for c in picked] == ["A", "A", "B"]


@pytest.mark.anyio
async def test_save_template_accepts_docx(tmp_path: Path) -> None:
    buffer = io.BytesIO()
    docx.Document().save(buffer)
    upload = UploadFile(io.BytesIO(buffer.getvalue()), filename="Template_Offerta.docx")

    saved = await save_template(upload, tmp_path, max_bytes=1_000_000)

    assert saved.name == "Template_Offerta.docx"


@pytest.mark.anyio
async def test_save_template_rejects_pdf_and_broken_docx(tmp_path: Path) -> None:
    with pytest.raises(UploadRejected, match="Word"):
        await save_template(UploadFile(io.BytesIO(make_pdf("x")), filename="t.pdf"), tmp_path, max_bytes=100_000)
    with pytest.raises(UploadRejected, match="non leggibile"):
        await save_template(UploadFile(io.BytesIO(b"PK\x03\x04garbage"), filename="t.docx"), tmp_path, max_bytes=100_000)
    assert list(tmp_path.iterdir()) == []
