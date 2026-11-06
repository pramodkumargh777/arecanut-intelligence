"""Document ingester for the ANI assistant's retrieval corpus.

Downloads (or reads from a local directory) the documents listed in manifest.json, extracts text with page numbers,
chunks it, optionally embeds the chunks with BGE-M3 through Ollama, and stores them through
POST /api/v1/admin/documents. Ingestion is idempotent: the API recognises an unchanged file by URL + SHA-256 and a
changed file supersedes (withdraws) the previous version instead of overwriting it.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from typing import Any, Callable

MANIFEST_PATH = Path(__file__).with_name("manifest.json")
USER_AGENT = "ANI-document-ingester/1.0 (+https://github.com/arecanut-intelligence)"
MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
CHUNK_TARGET = 1200
CHUNK_OVERLAP = 200
CHUNK_HARD_LIMIT = 6000
MAX_CHUNKS = 400
CANONICAL_EMBEDDING_MODEL = "BAAI/bge-m3"
DEFAULT_OLLAMA_EMBEDDING_MODEL = "bge-m3:567m"
DOCUMENT_TYPES = {"cpcri_publication", "dasd_report", "government_notification", "agricultural_research"}
LANGUAGES = {"en", "kn", "hi", "ml", "mixed"}
MONTHS = {m: i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}
OCR_MODES = {"auto", "force", "never"}
OCR_TIMEOUT_SECONDS = 1800
OCR_WARNING = "Text read by OCR"
OCR_NOTE = "Text read from a scanned copy by OCR; check any dose or quantity against the original page."
MIN_TEXT_CHARS_PER_PAGE = 40
MIN_KANNADA_SHARE = 0.9
MIN_READABLE_WORD_SHARE = 0.45
OCR_READABLE_TOKEN = re.compile(r"[A-Za-z]{3,}|\d{2,}|^\d[.,%]?$")
KANNADA_LETTER = re.compile(r"[ಀ-೿]")
LATIN_LETTER = re.compile(r"[A-Za-z]")
READABLE_TOKEN = re.compile(r"[(\[\"']?(?:[A-Za-z][a-z]+|[A-Z]{2,}|[A-Za-z]|[\d.,:/%-]*\d[\d.,:/%-]*)[)\]\"',.;:?!]*")


class IngestError(Exception):
    pass


@dataclass
class Page:
    number: int | None
    text: str


@dataclass
class Chunk:
    chunk_index: int
    page_from: int | None
    page_to: int | None
    heading: str | None
    text: str
    embedding: dict[str, Any] | None = None

    def payload(self) -> dict[str, Any]:
        body: dict[str, Any] = {"chunk_index": self.chunk_index, "page_from": self.page_from, "page_to": self.page_to,
                                "heading": self.heading, "text": self.text}
        if self.embedding:
            body["embedding"] = self.embedding
        return body


@dataclass
class DocumentResult:
    key: str
    status: str
    document_id: str | None = None
    chunks: int = 0
    embedded: int = 0
    warnings: list[str] = field(default_factory=list)
    error: str | None = None


# ---------------------------------------------------------------- manifest

def load_manifest(path: Path = MANIFEST_PATH) -> list[dict[str, Any]]:
    entries = json.loads(path.read_text(encoding="utf-8"))["documents"]
    keys: set[str] = set()
    for entry in entries:
        validate_entry(entry)
        if entry["key"] in keys:
            raise IngestError(f"Duplicate manifest key: {entry['key']}")
        keys.add(entry["key"])
    return entries


def validate_entry(entry: dict[str, Any]) -> None:
    for name in ("key", "title", "publisher", "document_type", "source_url", "mime_type"):
        if not entry.get(name):
            raise IngestError(f"Manifest entry is missing {name}: {entry.get('key', '?')}")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{3,60}", entry["key"]):
        raise IngestError(f"Manifest key must be a lowercase slug: {entry['key']}")
    if entry["document_type"] not in DOCUMENT_TYPES:
        raise IngestError(f"Unknown document_type for {entry['key']}: {entry['document_type']}")
    if entry.get("language", "en") not in LANGUAGES:
        raise IngestError(f"Unknown language for {entry['key']}")
    if entry.get("ocr", "auto") not in OCR_MODES:
        raise IngestError(f"ocr must be one of {sorted(OCR_MODES)}: {entry['key']}")
    if not entry["source_url"].startswith("https://"):
        raise IngestError(f"Source URL must be https: {entry['key']}")
    date = entry.get("publication_date")
    basis = entry.get("publication_date_basis")
    if date is not None and not re.fullmatch(r"\d{4}(-\d{2}(-\d{2})?)?", date):
        raise IngestError(f"publication_date must be YYYY, YYYY-MM or YYYY-MM-DD: {entry['key']}")
    if (date is None) != (basis is None) or basis not in (None, "stated", "page_metadata"):
        raise IngestError(f"publication_date and publication_date_basis must be set together: {entry['key']}")


# ---------------------------------------------------------------- download

def download(url: str, *, retries: int = 3, timeout: float = 60.0, opener: Callable[..., Any] = urllib.request.urlopen,
             sleep: Callable[[float], None] = time.sleep) -> bytes:
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with opener(request, timeout=timeout) as response:
                data = response.read(MAX_DOWNLOAD_BYTES + 1)
            if len(data) > MAX_DOWNLOAD_BYTES:
                raise IngestError(f"Document exceeds {MAX_DOWNLOAD_BYTES} bytes: {url}")
            if not data:
                raise IngestError(f"Empty response: {url}")
            return data
        except urllib.error.HTTPError as error:
            last = error
            if error.code in (401, 403):
                # Access restrictions are respected, not worked around (no browser impersonation).
                raise IngestError(f"HTTP {error.code} from {url}: the publisher refuses automated access. Save an authorised copy "
                                  "manually and ingest it with --local-dir.") from error
            if error.code < 500 and error.code != 429:
                raise IngestError(f"HTTP {error.code} from {url}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            last = error
        if attempt < retries:
            sleep(min(2 ** attempt, 10))
    raise IngestError(f"Download failed after {retries} attempts: {url} ({last})")


# ---------------------------------------------------------------- extraction

def clean_text(text: str) -> str:
    text = text.replace("\u00ad", "").replace("\r", "\n")
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_pdf(data: bytes) -> list[Page]:
    try:
        from pypdf import PdfReader
    except ImportError as error:  # pragma: no cover - dependency guard
        raise IngestError("pypdf is required: pip install -r data-platform/requirements-documents.txt") from error
    reader = PdfReader(BytesIO(data))
    return [Page(number, clean_text(page.extract_text() or "")) for number, page in enumerate(reader.pages, start=1)]


# ---------------------------------------------------------------- OCR

def kannada_share(pages: list[Page]) -> float:
    """Kannada letters as a share of all letters. Old Kannada PDFs use non-Unicode fonts whose text layer is Latin garbage."""
    text = "".join(page.text for page in pages)
    kannada = len(KANNADA_LETTER.findall(text))
    latin = len(LATIN_LETTER.findall(text))
    return kannada / (kannada + latin) if kannada + latin else 0.0


def readable_word_share(pages: list[Page]) -> float:
    """Tokens that look like a word or a number, as a share of all tokens. Table figures count as readable."""
    tokens = "\n".join(page.text for page in pages).split()
    return sum(1 for token in tokens if READABLE_TOKEN.fullmatch(token)) / len(tokens) if tokens else 0.0


def ocr_reason(pages: list[Page], language: str) -> str | None:
    """Why the embedded text layer cannot be trusted, or None when it can."""
    filled = sum(1 for page in pages if len(page.text) >= MIN_TEXT_CHARS_PER_PAGE)
    if filled * 2 < len(pages):
        return "no usable text layer"
    if language == "kn":
        if kannada_share(pages) < MIN_KANNADA_SHARE:
            return "text layer is not Unicode Kannada"
    elif readable_word_share(pages) < MIN_READABLE_WORD_SHARE:
        return "text layer is unreadable"
    return None


def drop_ocr_noise(text: str) -> str:
    """Remove lines OCR made from pictures and page furniture. A line of real words or table figures is always kept."""
    kept = []
    for line in text.split("\n"):
        tokens = line.split()
        readable = sum(1 for token in tokens if len(KANNADA_LETTER.findall(token)) >= 3 or OCR_READABLE_TOKEN.search(token))
        if len(tokens) < 3 or readable * 2 >= len(tokens):
            kept.append(line)
    return clean_text("\n".join(kept))


def ocr_languages(entry: dict[str, Any]) -> str:
    return entry.get("ocr_languages") or ("kan+eng" if entry.get("language", "en") == "kn" else "eng")


def run_ocr(data: bytes, languages: str, *, cache_dir: Path | None = None, runner: Callable[..., Any] = subprocess.run) -> list[Page]:
    """Read every page image with OCRmyPDF and Tesseract. The file itself is never changed or stored."""
    cached = cache_dir / f"{hashlib.sha256(data).hexdigest()}-{languages}.txt" if cache_dir else None
    if cached and cached.exists():
        sidecar_text = cached.read_text(encoding="utf-8")
    else:
        executable = shutil.which("ocrmypdf")
        if not executable:
            raise IngestError("PDF has no extractable text and ocrmypdf is not installed: brew install ocrmypdf tesseract-lang "
                              "(or apt-get install ocrmypdf tesseract-ocr-kan).")
        with tempfile.TemporaryDirectory(prefix="ani-ocr-") as folder:
            source, output, sidecar = Path(folder, "in.pdf"), Path(folder, "out.pdf"), Path(folder, "out.txt")
            source.write_bytes(data)
            command = [executable, "--force-ocr", "--language", languages, "--rotate-pages", "--deskew", "--optimize", "0",
                       "--output-type", "pdf", "--sidecar", str(sidecar), str(source), str(output)]
            try:
                finished = runner(command, capture_output=True, text=True, timeout=OCR_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired as error:
                raise IngestError(f"OCR did not finish within {OCR_TIMEOUT_SECONDS} seconds.") from error
            if finished.returncode != 0:
                raise IngestError(f"OCR failed (exit {finished.returncode}): {(finished.stderr or '').strip()[-300:]}")
            sidecar_text = sidecar.read_text(encoding="utf-8")
        if cached:
            cached.parent.mkdir(parents=True, exist_ok=True)
            cached.write_text(sidecar_text, encoding="utf-8")
    parts = sidecar_text.split("\f")
    if parts and not parts[-1].strip():
        parts.pop()
    return [Page(number, drop_ocr_noise(clean_text(part))) for number, part in enumerate(parts, start=1)]


def pdf_pages(entry: dict[str, Any], data: bytes, *, ocr_cache: Path | None = None) -> tuple[list[Page], list[str]]:
    """Use the embedded text when it is trustworthy, otherwise OCR. Text that still fails the quality test is refused."""
    language = entry.get("language", "en")
    mode = entry.get("ocr", "auto")
    pages = extract_pdf(data)
    reason = "manifest requires OCR" if mode == "force" else ocr_reason(pages, language) if mode == "auto" else None
    if reason is None:
        if not any(page.text for page in pages):
            raise IngestError("PDF has no extractable text layer and OCR is switched off for this document.")
        return pages, []
    languages = ocr_languages(entry)
    pages = run_ocr(data, languages, cache_dir=ocr_cache)
    if language == "kn" and kannada_share(pages) < MIN_KANNADA_SHARE:
        raise IngestError(f"OCR output is not Kannada ({kannada_share(pages):.0%} Kannada letters); not ingesting it.")
    if language != "kn" and readable_word_share(pages) < MIN_READABLE_WORD_SHARE:
        raise IngestError(f"OCR output is unreadable ({readable_word_share(pages):.0%} readable words); not ingesting it.")
    return pages, [f"{OCR_WARNING} ({reason}; {languages})."]


class _TextCollector(HTMLParser):
    BLOCK = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "table", "section"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style", "noscript"):
            self._skip += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.parts.append(data)


def html_to_text(markup: str) -> str:
    collector = _TextCollector()
    collector.feed(markup)
    return clean_text(html.unescape("".join(collector.parts)))


PIB_CONTENT_MARKER = "innner-page-main-about-us-content-right-part"


def extract_pib(markup: str) -> list[Page]:
    """PIB release body: from the content container to the '(Release ID: N)' line; navigation and counters dropped."""
    start = markup.find(PIB_CONTENT_MARKER)
    if start < 0:
        raise IngestError("PIB page layout not recognised (content container missing); not ingesting page chrome.")
    start = markup.rfind("<", 0, start)
    text = html_to_text(markup[start:start + 400_000])
    end = re.search(r"\(Release ID:\s*\d+\)", text)
    if not end:
        raise IngestError("PIB release text has no 'Release ID' terminator; layout changed.")
    return [Page(None, text[:end.end()].strip())]


def extract_html(markup: str) -> list[Page]:
    text = html_to_text(markup)
    if not text:
        raise IngestError("HTML page contains no text.")
    return [Page(None, text)]


def stated_pib_date(text: str) -> str | None:
    match = re.search(r"Posted On:\s*(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})", text)
    if not match or match.group(2).upper() not in MONTHS:
        return None
    return f"{match.group(3)}-{MONTHS[match.group(2).upper()]:02d}-{int(match.group(1)):02d}"


def extract(entry: dict[str, Any], data: bytes, *, ocr_cache: Path | None = None) -> tuple[list[Page], list[str]]:
    warnings: list[str] = []
    if entry["mime_type"] == "application/pdf":
        if not data.startswith(b"%PDF"):
            raise IngestError("Expected a PDF but the response is not a PDF (possibly an error or login page).")
        return pdf_pages(entry, data, ocr_cache=ocr_cache)
    markup = data.decode("utf-8", errors="replace")
    if "pib.gov.in" in entry["source_url"]:
        pages = extract_pib(markup)
        stated = stated_pib_date(pages[0].text)
        if stated is None:
            warnings.append("PIB 'Posted On' date not found in the release text.")
        elif entry.get("publication_date") and stated != entry["publication_date"]:
            raise IngestError(f"Manifest publication_date {entry['publication_date']} differs from the release's stated date {stated}.")
        return pages, warnings
    return extract_html(markup), warnings


# ---------------------------------------------------------------- chunking

def _is_heading(line: str) -> bool:
    stripped = line.strip()
    if not 4 <= len(stripped) <= 90 or stripped.endswith((".", ",", ";")):
        return False
    letters = [char for char in stripped if char.isalpha()]
    if len(letters) < 4:
        return False
    upper_ratio = sum(char.isupper() for char in letters) / len(letters)
    return upper_ratio > 0.8 and len(stripped.split()) <= 10


def _split_long(text: str, limit: int) -> list[str]:
    """Split text at sentence/space boundaries so no piece exceeds limit."""
    pieces: list[str] = []
    while len(text) > limit:
        cut = max(text.rfind(". ", 0, limit), text.rfind("\n", 0, limit))
        if cut < limit // 2:
            cut = text.rfind(" ", 0, limit)
        if cut <= 0:
            cut = limit
        pieces.append(text[:cut + 1].strip())
        text = text[cut + 1:].strip()
    if text:
        pieces.append(text)
    return pieces


def chunk_pages(pages: list[Page], *, target: int = CHUNK_TARGET, overlap: int = CHUNK_OVERLAP) -> list[Chunk]:
    """Paragraph-aware chunks of about `target` characters, overlapping by up to `overlap` characters, with page spans."""
    units: list[tuple[int | None, str | None, str]] = []
    heading: str | None = None
    for page in pages:
        for paragraph in re.split(r"\n\s*\n|\n(?=[A-Z0-9][^\n]{0,89}\n)", page.text):
            paragraph = paragraph.strip()
            if not paragraph:
                continue
            first_line = paragraph.split("\n", 1)[0]
            if _is_heading(first_line):
                heading = first_line.strip()[:300]
            for piece in _split_long(re.sub(r"\s*\n\s*", " ", paragraph), target):
                units.append((page.number, heading, piece))

    chunks: list[Chunk] = []
    buffer: list[tuple[int | None, str | None, str]] = []

    def flush() -> None:
        text = " ".join(piece for _, _, piece in buffer).strip()
        if not text:
            return
        numbers = [number for number, _, _ in buffer if number is not None]
        chunks.append(Chunk(len(chunks), min(numbers) if numbers else None, max(numbers) if numbers else None,
                            buffer[0][1], text[:CHUNK_HARD_LIMIT]))

    for unit in units:
        size = sum(len(piece) + 1 for _, _, piece in buffer)
        if buffer and size + len(unit[2]) > target:
            flush()
            tail: list[tuple[int | None, str | None, str]] = []
            carried = 0
            for previous in reversed(buffer):
                if carried + len(previous[2]) > overlap:
                    break
                tail.insert(0, previous)
                carried += len(previous[2])
            buffer = tail
        buffer.append(unit)
    flush()
    if len(chunks) > MAX_CHUNKS:
        raise IngestError(f"Document produces {len(chunks)} chunks; the API accepts at most {MAX_CHUNKS}.")
    return chunks


# ---------------------------------------------------------------- embeddings

def quantize_embedding(vector: list[float]) -> str:
    """Byte-identical to api/src/assistant/retrieval.ts quantizeEmbedding (JS Math.round = floor(x + 0.5))."""
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    out = bytearray()
    for value in vector:
        q = max(-127, min(127, math.floor((value / norm) * 127 + 0.5)))
        out.append(q & 0xFF)
    return base64.b64encode(bytes(out)).decode("ascii")


def embed_ollama(texts: list[str], *, base_url: str, model: str = DEFAULT_OLLAMA_EMBEDDING_MODEL, timeout: float = 120.0,
                 opener: Callable[..., Any] = urllib.request.urlopen) -> list[list[float]]:
    request = urllib.request.Request(base_url.rstrip("/") + "/api/embed", method="POST",
                                     data=json.dumps({"model": model, "input": texts}).encode("utf-8"),
                                     headers={"Content-Type": "application/json"})
    try:
        with opener(request, timeout=timeout) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise IngestError(f"Ollama embedding failed with HTTP {error.code}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise IngestError(f"Ollama is unreachable at {base_url}: {error}") from error
    vectors = body.get("embeddings")
    if not isinstance(vectors, list) or len(vectors) != len(texts):
        raise IngestError("Ollama returned an unexpected embedding response.")
    return vectors


def attach_embeddings(chunks: list[Chunk], embedder: Callable[[list[str]], list[list[float]]], batch: int = 16) -> int:
    for start in range(0, len(chunks), batch):
        group = chunks[start:start + batch]
        for chunk, vector in zip(group, embedder([chunk.text for chunk in group])):
            chunk.embedding = {"model": CANONICAL_EMBEDDING_MODEL, "dim": len(vector), "q8": quantize_embedding(vector)}
    return sum(1 for chunk in chunks if chunk.embedding)


# ---------------------------------------------------------------- payload and upload

def build_payload(entry: dict[str, Any], data: bytes, chunks: list[Chunk], *, page_count: int | None, fetched_at: str,
                  job_id: str, used_ocr: bool = False) -> dict[str, Any]:
    sha = hashlib.sha256(data).hexdigest()
    reuse_note = entry.get("reuse_note")
    if used_ocr:  # The API reads this note to warn readers that a scanned dose can be misread.
        reuse_note = f"{reuse_note + ' ' if reuse_note else ''}{OCR_NOTE}"
    return {
        "ingestion_job_id": job_id,
        "document": {
            "id": f"{entry['key']}-{sha[:12]}",
            "title": entry["title"],
            "publisher": entry["publisher"],
            "document_type": entry["document_type"],
            "language": entry.get("language", "en"),
            "source_url": entry["source_url"],
            "publication_date": entry.get("publication_date"),
            "publication_date_basis": entry.get("publication_date_basis"),
            "mime_type": entry["mime_type"],
            "content_sha256": sha,
            "page_count": page_count,
            "reuse_note": reuse_note,
            "fetched_at": fetched_at,
        },
        "chunks": [chunk.payload() for chunk in chunks],
    }


def _redact(text: str, token: str) -> str:
    return text.replace(token, "[redacted]") if token else text


def post_document(payload: dict[str, Any], *, api_url: str, token: str, timeout: float = 120.0,
                  opener: Callable[..., Any] = urllib.request.urlopen) -> dict[str, Any]:
    if not api_url or not token:
        raise IngestError("ANI_API_URL and ANI_ADMIN_TOKEN are required to store documents (use --dry-run otherwise).")
    request = urllib.request.Request(api_url.rstrip("/") + "/admin/documents", method="POST",
                                     data=json.dumps(payload).encode("utf-8"),
                                     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": USER_AGENT})
    try:
        with opener(request, timeout=timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:500]
        raise IngestError(f"API rejected document (HTTP {error.code}): {_redact(detail, token)}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise IngestError(f"API unreachable: {_redact(str(error), token)}") from error


# ---------------------------------------------------------------- orchestration

def ingest_document(entry: dict[str, Any], *, job_id: str, dry_run: bool, local_dir: Path | None, api_url: str, token: str,
                    embedder: Callable[[list[str]], list[list[float]]] | None,
                    fetcher: Callable[[str], bytes] = download, poster: Callable[..., dict[str, Any]] = post_document,
                    ocr_cache: Path | None = None) -> DocumentResult:
    result = DocumentResult(entry["key"], "failed")
    try:
        if local_dir is not None:
            candidates = [path for path in local_dir.glob(f"{entry['key']}.*") if path.is_file()]
            if not candidates:
                raise IngestError(f"No local file named {entry['key']}.* in {local_dir}")
            data = candidates[0].read_bytes()
        else:
            data = fetcher(entry["source_url"])
        fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        pages, warnings = extract(entry, data, ocr_cache=ocr_cache)
        result.warnings.extend(warnings)
        used_ocr = any(warning.startswith(OCR_WARNING) for warning in warnings)
        chunks = chunk_pages(pages)
        if not chunks:
            raise IngestError("No text chunks were produced.")
        if embedder is not None:
            result.embedded = attach_embeddings(chunks, embedder)
        page_count = len(pages) if entry["mime_type"] == "application/pdf" else None
        payload = build_payload(entry, data, chunks, page_count=page_count, fetched_at=fetched_at, job_id=job_id, used_ocr=used_ocr)
        result.document_id = payload["document"]["id"]
        result.chunks = len(chunks)
        if dry_run:
            result.status = "dry_run"
            return result
        response = poster(payload, api_url=api_url, token=token)
        result.status = str(response.get("status", "stored"))
        result.document_id = response.get("document_id", result.document_id)
        if response.get("withdrawn_versions"):
            result.warnings.append(f"Superseded versions withdrawn: {', '.join(response['withdrawn_versions'])}")
    except IngestError as error:
        result.error = str(error)
    except Exception as error:  # pragma: no cover - report unexpected parser failures per document
        result.error = f"{type(error).__name__}: {error}"
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingest ANI assistant documents (CPCRI, DASD, PIB) into the retrieval index.")
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    parser.add_argument("--only", action="append", default=[], help="Manifest key to ingest (repeatable).")
    parser.add_argument("--dry-run", action="store_true", help="Download, extract and chunk, but do not store anything.")
    parser.add_argument("--local-dir", type=Path, help="Read authorised local copies named <key>.<ext> instead of downloading.")
    parser.add_argument("--embed", action="store_true", help="Embed chunks with BGE-M3 through Ollama before upload.")
    parser.add_argument("--ollama-url", default=os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434"))
    parser.add_argument("--ollama-model", default=os.environ.get("ANI_OLLAMA_EMBEDDING_MODEL", DEFAULT_OLLAMA_EMBEDDING_MODEL))
    parser.add_argument("--ocr-cache", type=Path, help="Reuse OCR text from this folder, so a repeat run is fast and stores identical text.")
    parser.add_argument("--summary", type=Path, help="Write a JSON ingestion summary to this path.")
    args = parser.parse_args(argv)

    entries = load_manifest(args.manifest)
    if args.only:
        unknown = set(args.only) - {entry["key"] for entry in entries}
        if unknown:
            parser.error(f"Unknown manifest keys: {', '.join(sorted(unknown))}")
        entries = [entry for entry in entries if entry["key"] in args.only]
    api_url = os.environ.get("ANI_API_URL", "")
    token = os.environ.get("ANI_ADMIN_TOKEN", "")
    if not args.dry_run and (not api_url or not token):
        print("ANI_API_URL and ANI_ADMIN_TOKEN must be set (or use --dry-run).", file=sys.stderr)
        return 2
    embedder = (lambda texts: embed_ollama(texts, base_url=args.ollama_url, model=args.ollama_model)) if args.embed else None
    job_id = f"documents-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"

    results = [ingest_document(entry, job_id=job_id, dry_run=args.dry_run, local_dir=args.local_dir, api_url=api_url,
                               token=token, embedder=embedder, ocr_cache=args.ocr_cache) for entry in entries]
    for result in results:
        line = f"{result.key}: {result.status}"
        if result.document_id:
            line += f" id={result.document_id} chunks={result.chunks} embedded={result.embedded}"
        if result.error:
            line += f" ERROR {result.error}"
        print(line)
        for warning in result.warnings:
            print(f"  warning: {warning}")
    summary = {"ingestion_job_id": job_id, "dry_run": args.dry_run,
               "documents": [result.__dict__ for result in results],
               "failed": sum(1 for result in results if result.error)}
    if args.summary:
        args.summary.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
