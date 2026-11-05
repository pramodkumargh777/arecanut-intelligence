"""Content hashes and idempotency keys shared by ANI import clients.

The API (`POST /admin/import`) replays a completed job when the same `(source, idempotency_key)`
is sent again, so a retried request after a network timeout cannot create a second import job.
Keys bind to the exact batch content: re-sending different records under the same file still
creates a new job, and operators can force reprocessing with `reprocess: true`.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

BUFFER_SIZE = 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(BUFFER_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_json(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def batch_idempotency_key(prefix: str, batch_index: int, records: list[dict[str, Any]], content_sha256: str | None = None) -> str:
    """Return a key accepted by the API pattern `^[A-Za-z0-9:._-]{8,200}$`."""
    if not prefix.replace("_", "").replace("-", "").isalnum():
        raise ValueError("Idempotency key prefix must be alphanumeric (with - or _).")
    parts = [prefix]
    if content_sha256:
        parts.append(content_sha256)
    parts.extend([f"b{batch_index}", sha256_json(records)[:24]])
    return ":".join(parts)
