"""Read-only access to ANI data: the local Miniflare D1 SQLite file or a `scripts/d1-backup.mjs` SQL export."""

from __future__ import annotations

import glob
import os
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
LOCAL_D1_GLOB = "api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite"


def discover_local_d1() -> Path:
    configured = os.environ.get("ANI_D1_SQLITE")
    if configured:
        path = Path(configured)
        if not path.is_file():
            raise FileNotFoundError(f"ANI_D1_SQLITE does not exist: {path}")
        return path
    candidates = [Path(p) for p in glob.glob(str(REPO_ROOT / LOCAL_D1_GLOB)) if not p.endswith("metadata.sqlite")]
    usable = [p for p in candidates if _has_table(p, "monthly_variety_prices")]
    if len(usable) != 1:
        raise FileNotFoundError(
            "Could not identify exactly one local D1 database with ANI tables; set ANI_D1_SQLITE "
            f"or pass --sql-export (found {len(usable)})."
        )
    return usable[0]


def _has_table(path: Path, table: str) -> bool:
    try:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
            return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None
    except sqlite3.Error:
        return False


def connect(sqlite_path: str | Path | None = None, sql_export: str | Path | None = None) -> sqlite3.Connection:
    """Open the data read-only. A SQL export is loaded into memory so the original file is never touched."""
    if sql_export:
        conn = sqlite3.connect(":memory:")
        conn.executescript(Path(sql_export).read_text(encoding="utf-8"))
    else:
        path = Path(sqlite_path) if sqlite_path else discover_local_d1()
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone() is not None
