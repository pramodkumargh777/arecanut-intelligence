"""Command line for the KRAMA daily arrivals connector (docs/DAILY_ARRIVALS.md).

Examples (from the repository root):
  .venv/bin/python data-platform/connectors/krama/run_arrivals.py --dry-run --recent-days 2
  .venv/bin/python data-platform/connectors/krama/run_arrivals.py                                   # last 7 days
  .venv/bin/python data-platform/connectors/krama/run_arrivals.py --backfill-from 2014-01-01 --backfill-requests 900
  .venv/bin/python data-platform/connectors/krama/run_arrivals.py --dates 2026-11-13,2026-11-14
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "data-platform"))

from connectors.agmarknet.run_daily import load_env_file  # noqa: E402
from connectors.krama.arrivals import (  # noqa: E402
    BASE_URL, EARLIEST_DATE, Session, SourceError, backfill_days, ingest, recent_days, stored_dates, today_ist, whole_months,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import KRAMA (Karnataka) daily arecanut arrivals.")
    parser.add_argument("--recent-days", type=int, default=7, help="Re-read the last N days up to today, IST (default 7; 0 skips).")
    parser.add_argument("--dates", help="Comma-separated YYYY-MM-DD dates to fetch instead of the recent days.")
    parser.add_argument("--backfill-from", type=date.fromisoformat, help=f"Also fetch dates not stored yet, back to this date (from {EARLIEST_DATE}).")
    parser.add_argument("--backfill-requests", type=int, default=900, help="Most KRAMA requests for the backfill part (3 per date; default 900).")
    parser.add_argument("--min-interval", type=float, default=2.0, help="Seconds between KRAMA requests (default 2).")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and check, write reports, store nothing.")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env")
    parser.add_argument("--report-dir", type=Path, help="Defaults to data/processed/krama-arrivals/<UTC timestamp>.")
    args = parser.parse_args(argv)
    if args.recent_days < 0 or args.backfill_requests < 3 or args.min_interval < 1:
        parser.error("Use a non-negative --recent-days, --backfill-requests of at least 3 and at least 1 s between requests.")
    env = load_env_file(args.env_file)
    api_url, token = env.get("ANI_API_URL"), env.get("INGESTION_TOKEN")
    if not args.dry_run and (not api_url or not token):
        parser.error("Set ANI_API_URL and INGESTION_TOKEN, or use --dry-run.")
    report_root = args.report_dir or ROOT / "data" / "processed" / "krama-arrivals" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    session = Session(env.get("KRAMA_BASE_URL") or BASE_URL, min_interval=args.min_interval, relay_token=token)
    try:
        session.check()
    except SourceError as error:
        print(f"error: {error}", file=sys.stderr)
        print("On GitHub's runners, set KRAMA_BASE_URL to the relay (https://<relay>/krama/); see docs/DAILY_ARRIVALS.md.", file=sys.stderr)
        return 2
    today = today_ist()
    results = []
    recent = [date.fromisoformat(item) for item in args.dates.split(",")] if args.dates else recent_days(today, args.recent_days)
    if recent:
        results.append(ingest(recent, session, dry_run=args.dry_run, api_url=api_url, token=token, report_dir=report_root / "recent", mode="daily"))
    if args.backfill_from:
        start = max(args.backfill_from, EARLIEST_DATE)
        done = set() if args.dry_run else stored_dates(api_url, token)
        done.update(day.isoformat() for day in recent)
        remaining = backfill_days(done, start, today)
        work = whole_months(remaining, args.backfill_requests // 3)
        budget = session.requests + 3 * len(work) + 60  # room for one retry of up to 20 dates
        results.append(ingest(work, session, dry_run=args.dry_run, api_url=api_url, token=token, report_dir=report_root / "backfill",
                              mode="backfill", max_requests=budget))
        results[-1]["pending_after_run"] = max(0, len(remaining) - results[-1]["dates"])
    for result in results:
        brief = {k: result[k] for k in ("mode", "status", "source_requests", "dates", "reported_dates", "not_reported_dates", "table_rows",
                                         "documents_new", "inserted", "revised", "duplicates", "rejected_rows", "source_errors")}
        if "pending_after_run" in result:
            brief["pending_after_run"] = result["pending_after_run"]
        print(json.dumps(brief))
        for item in result["rejected"][:20]:
            print(f"rejected: {json.dumps(item, ensure_ascii=False)}", file=sys.stderr)
        for error in result["errors"][:20]:
            print(f"error: {error}", file=sys.stderr)
    print(f"Reports: {report_root}", file=sys.stderr)
    return 2 if any(result["status"] == "failed" for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
