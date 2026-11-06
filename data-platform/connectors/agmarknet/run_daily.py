"""Command-line entry point for the AGMARKNET current-daily connector.

Examples (from the repository root):
  .venv/bin/python data-platform/connectors/agmarknet/run_daily.py daily --dry-run
  .venv/bin/python data-platform/connectors/agmarknet/run_daily.py daily
  .venv/bin/python data-platform/connectors/agmarknet/run_daily.py backfill --start 2026-10-01 --end 2026-11-04 \
      --csv path/to/official_export.csv --replay data/processed/agmarknet/<run>/raw_source_pages.jsonl
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "data-platform"))

from connectors.agmarknet.daily import (  # noqa: E402
    ConnectorConfig, backfill_agmarknet_history, ingest_agmarknet_daily,
)


def load_env_file(path: Path) -> dict[str, str]:
    """Read KEY=VALUE lines without overriding variables already set in the environment."""
    values: dict[str, str] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    return {**values, **os.environ}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingest AGMARKNET current-daily arecanut prices from data.gov.in.")
    parser.add_argument("command", choices=("daily", "backfill"))
    parser.add_argument("--dry-run", action="store_true", help="Fetch and validate, write reports, persist nothing.")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env")
    parser.add_argument("--report-dir", type=Path, help="Defaults to data/processed/agmarknet/<UTC timestamp>-<command>.")
    parser.add_argument("--batch-size", type=int, default=10, help="Records per import request (10 keeps a Free-tier Worker under 50 D1 queries).")
    parser.add_argument("--page-size", type=int)
    parser.add_argument("--max-pages", type=int)
    parser.add_argument("--max-retries", type=int)
    parser.add_argument("--timeout-seconds", type=float)
    parser.add_argument("--start", type=date.fromisoformat)
    parser.add_argument("--end", type=date.fromisoformat)
    parser.add_argument("--csv", type=Path, action="append", default=[], help="Official data.gov.in daily CSV export (repeatable).")
    parser.add_argument("--replay", type=Path, action="append", default=[], help="Archived raw_source_pages.jsonl or JSON records (repeatable).")
    args = parser.parse_args(argv)

    env = load_env_file(args.env_file)
    config = ConnectorConfig.from_env(env, page_size=args.page_size, max_pages=args.max_pages,
                                      max_retries=args.max_retries, timeout_seconds=args.timeout_seconds)
    api_url, token = env.get("ANI_API_URL") or None, env.get("INGESTION_TOKEN") or None
    if not args.dry_run and not (api_url and token):
        parser.error("Set ANI_API_URL and INGESTION_TOKEN to persist, or use --dry-run.")
    if not config.price_unit:
        parser.error("AGMARKNET_PRICE_UNIT is not set. The resource publishes no unit field; set it only after confirming the unit.")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_dir = args.report_dir or ROOT / "data" / "processed" / "agmarknet" / f"{stamp}-{args.command}{'-dry-run' if args.dry_run else ''}"
    common = dict(dry_run=args.dry_run, api_url=api_url, token=token, batch_size=args.batch_size, report_dir=report_dir)

    if args.command == "daily":
        summary = ingest_agmarknet_daily(config, **common)
        rejected = summary.pop("rejected_records")
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        for item in rejected[:20]:
            print(f"REJECTED {item['source_record_id']}: {'; '.join(r['message'] for r in item['reasons'])}", file=sys.stderr)
        return 2 if summary["status"] == "failed" else 0

    if not args.start or not args.end:
        parser.error("backfill requires --start and --end (YYYY-MM-DD).")
    result = backfill_agmarknet_history(config, args.start, args.end, csv_paths=args.csv, replay_paths=args.replay, **common)
    print(json.dumps({k: v for k, v in result.items() if k != "uncovered_dates"} | {
        "uncovered_date_count": len(result["uncovered_dates"])}, indent=2, ensure_ascii=False))
    return 2 if any(part.get("status") == "failed" for part in result["parts"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
