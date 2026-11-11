"""AGMARKNET daily APMC prices from 2014, kept as files for the forecasting engine instead of rows in D1.

The app's own history backfill stores every daily row in D1 (about 17 rows written per record), which suits recent
years but would take weeks of the free write budget for 2014–2020. The engine only needs one value per variety and
month, so this module keeps the daily rows as versioned files and the engine builds its monthly series from them.

- Source, validation and market-name mapping are exactly the history connector's (``connectors/agmarknet/history.py``):
  each date is fetched on its own and checked against the source's total, rejected rows are counted, renamed markets
  are mapped to one current name, and a market reported twice under old and new names is kept once.
- Work is a month at a time and all or nothing: a month with any date that could not be fetched is not written, so a
  re-run fills it. Months already written are skipped, so an interrupted run simply continues.
- Each month is ``daily_archive/YYYY-MM.csv.gz`` (one row per market, variety, grade and date) and
  ``daily_archive/manifest.json`` records, per month, the source totals, what was rejected and why, and when it was
  fetched. Nothing is interpolated: a date with no rows stays absent.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

DIR = Path(__file__).resolve().parent / "daily_archive"
MANIFEST = DIR / "manifest.json"
START = "2014-01"
COLUMNS = ("reporting_date", "district", "market", "variety", "grade", "minimum_price", "modal_price", "maximum_price", "status")
# Recent dates belong to the daily connector (same lag as the history connector), so the archive stops before them.
LAG_DAYS = 2


def _months(start: str, end: str) -> list[str]:
    year, month = map(int, start.split("-"))
    out: list[str] = []
    while f"{year:04d}-{month:02d}" <= end:
        out.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return out


def _days(month: str, last: date) -> list[date]:
    first = date.fromisoformat(f"{month}-01")
    following = (first + timedelta(days=32)).replace(day=1)
    return [first + timedelta(days=offset) for offset in range((min(following - timedelta(days=1), last) - first).days + 1)]


def load_manifest() -> dict[str, Any]:
    return json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {"months": {}}


def _save_manifest(manifest: dict[str, Any]) -> None:
    manifest["months"] = dict(sorted(manifest["months"].items()))
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _write_month(month: str, records: list[dict[str, Any]]) -> None:
    rows = sorted(records, key=lambda r: (r["reporting_date"], r["district"], r["market_name"], r["variety_name"], r["grade"] or ""))
    text = io.StringIO()
    writer = csv.writer(text, lineterminator="\n")
    writer.writerow(COLUMNS)
    for r in rows:
        writer.writerow([r["reporting_date"], r["district"], r["market_name"], r["variety_name"], r["grade"] or "",
                         r["minimum_price"], r["modal_price"], r["maximum_price"], r["validation_status"]])
    # mtime=0 keeps the file byte-identical across re-runs with the same data.
    with gzip.GzipFile(DIR / f"{month}.csv.gz", "wb", mtime=0) as handle:
        handle.write(text.getvalue().encode("utf-8"))


def fetch_archive(start: str = START, end: str | None = None, *, refresh: bool = False, workers: int = 4,
                  env_file: Path | None = None, log: Callable[[str], None] = print) -> dict[str, Any]:
    """Fetch every month from ``start`` to ``end`` (default: the last month old enough to be complete)."""
    from connectors.agmarknet.daily import ConnectorConfig, SourceAccessError, today_ist
    from connectors.agmarknet.history import HISTORY_RESOURCE_ID, fetch_history_day, prepare_history
    from connectors.agmarknet.run_daily import load_env_file

    env = load_env_file(env_file or Path(__file__).resolve().parents[2] / ".env")
    config = ConnectorConfig.from_env(env, resource_id=env.get("AGMARKNET_HISTORY_RESOURCE_ID") or HISTORY_RESOURCE_ID,
                                      page_size=1000, page_delay_seconds=0.2)
    config.validate()
    today = today_ist()
    last_day = today - timedelta(days=LAG_DAYS)
    end = end or last_day.strftime("%Y-%m")
    DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    done = written = 0
    failed: dict[str, int] = {}
    for month in _months(start, end):
        entry = manifest["months"].get(month)
        days = _days(month, last_day)
        if not days:
            continue
        # A month written before it was over is fetched again once more of it can be read.
        complete = entry and entry.get("last_date") == days[-1].isoformat()
        if complete and not refresh and (DIR / f"{month}.csv.gz").exists():
            done += 1
            continue
        fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        errors: dict[str, str] = {}

        def one(day: date):
            try:
                return fetch_history_day(config, day)
            except SourceAccessError as error:
                errors[day.isoformat()] = str(error)
                return None

        with ThreadPoolExecutor(max_workers=workers) as pool:
            fetched = [item for item in pool.map(one, days) if item is not None]
        if errors:
            failed[month] = len(errors)
            log(f"{month}: {len(errors)} date(s) could not be fetched; month left for the next run "
                f"(first error: {next(iter(errors.values()))})")
            continue
        raw = [record for item in fetched for record in item.records]
        prepared = prepare_history(raw, config, fetched_at, today=today)
        _write_month(month, prepared.accepted)
        status = Counter(record["validation_status"] for record in prepared.accepted)
        manifest["months"][month] = {
            "first_date": days[0].isoformat(), "last_date": days[-1].isoformat(), "fetched_at": fetched_at,
            "source_rows": len(raw), "kept": len(prepared.accepted), "needs_review": sum(v for k, v in status.items() if k != "validated"),
            "rejected": len(prepared.rejected), "duplicates": prepared.duplicates, "out_of_scope": prepared.excluded,
            "rejection_reasons": dict(Counter(reason["code"] for item in prepared.rejected for reason in item["reasons"])),
            "dates_with_no_records": [item.day.isoformat() for item in fetched if item.total == 0],
            "renamed_markets": sum(prepared.renamed.values()),
        }
        manifest.update({"source": f"data.gov.in resource {config.resource_id} (AGMARKNET variety-wise daily prices)",
                         "state": config.state, "commodity": config.commodity, "unit": "INR/quintal"})
        _save_manifest(manifest)
        written += 1
        log(f"{month}: {len(prepared.accepted)} rows kept, {len(prepared.rejected)} rejected, {prepared.duplicates} duplicate(s)")
    return {"months_written": written, "months_already_stored": done, "months_failed": failed}


def load_archive(directory: Path = DIR):
    """Every archived row as one DataFrame (only rows that passed validation without a flag)."""
    import pandas as pd

    files = sorted(directory.glob("*.csv.gz"))
    if not files:
        return pd.DataFrame(columns=COLUMNS)
    frame = pd.concat([pd.read_csv(path, dtype={"grade": str}, keep_default_na=False) for path in files], ignore_index=True)
    frame["reporting_date"] = pd.to_datetime(frame.reporting_date)
    for column in ("minimum_price", "modal_price", "maximum_price"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame
