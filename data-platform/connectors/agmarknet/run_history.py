"""Command-line entry point for the AGMARKNET daily-history add-on (docs/AGMARKNET_HISTORY.md).

Examples (from the repository root):
  .venv/bin/python data-platform/connectors/agmarknet/run_history.py --start 2021-01-01 --end 2021-12-31 --dry-run
  .venv/bin/python data-platform/connectors/agmarknet/run_history.py --start 2021-01-01 --end 2021-12-31
  .venv/bin/python data-platform/connectors/agmarknet/run_history.py --recent-days 10   # scheduled gap fill
  # Scheduled: gap fill, then the next 12 months back from the oldest stored date until 2021-01-01 is reached.
  .venv/bin/python data-platform/connectors/agmarknet/run_history.py --recent-days 14 --backfill-from 2021-01-01
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "data-platform"))

from connectors.agmarknet.daily import ConnectorConfig, today_ist  # noqa: E402
from connectors.agmarknet.history import (  # noqa: E402
    DEFAULT_BATCH_SIZE, DEFAULT_LAG_DAYS, HISTORY_RESOURCE_ID, backfill_history, fetch_history_coverage,
    next_backfill_window,
)
from connectors.agmarknet.run_daily import load_env_file  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill AGMARKNET daily arecanut history from data.gov.in.")
    parser.add_argument("--start", type=date.fromisoformat, help="First arrival date (YYYY-MM-DD).")
    parser.add_argument("--end", type=date.fromisoformat, help="Last arrival date; capped at today minus --lag-days (IST).")
    parser.add_argument("--recent-days", type=int, help="Instead of --start/--end: the last N allowed dates.")
    parser.add_argument("--backfill-from", type=date.fromisoformat,
                        help="Also fill the next window older than the stored history, back to this date; stops once reached.")
    parser.add_argument("--backfill-months", type=int, default=12, help="Months per --backfill-from window (default 12).")
    parser.add_argument("--lag-days", type=int, default=DEFAULT_LAG_DAYS,
                        help="Leave the most recent N days to the current-daily connector (default 2).")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and validate, write reports, persist nothing.")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env")
    parser.add_argument("--report-dir", type=Path, help="Defaults to data/processed/agmarknet-history/<UTC timestamp>.")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="Records per import request (max 5).")
    parser.add_argument("--max-retries", type=int)
    parser.add_argument("--timeout-seconds", type=float)
    parser.add_argument("--page-delay-seconds", type=float, help="Pause between requests to data.gov.in (default 0.5).")
    args = parser.parse_args(argv)

    latest = today_ist() - timedelta(days=args.lag_days)
    ranges: list[tuple[str, date, date]] = []
    if args.recent_days is not None:
        if args.start or args.end:
            parser.error("Use either --recent-days or --start/--end.")
        if args.recent_days < 1:
            parser.error("--recent-days must be at least 1.")
        ranges.append(("recent", latest - timedelta(days=args.recent_days - 1), latest))
    elif args.start:
        ranges.append(("range", args.start, args.end or today_ist()))
    elif not args.backfill_from:
        parser.error("Give --start (and optionally --end), --recent-days or --backfill-from.")

    env = load_env_file(args.env_file)
    config = ConnectorConfig.from_env(
        env, resource_id=env.get("AGMARKNET_HISTORY_RESOURCE_ID") or HISTORY_RESOURCE_ID, page_size=1000,
        max_retries=args.max_retries, timeout_seconds=args.timeout_seconds, page_delay_seconds=args.page_delay_seconds)
    api_url, token = env.get("ANI_API_URL") or None, env.get("INGESTION_TOKEN") or None
    if not args.dry_run and not (api_url and token):
        parser.error("Set ANI_API_URL and INGESTION_TOKEN to persist, or use --dry-run.")
    if not config.price_unit:
        parser.error("AGMARKNET_PRICE_UNIT is not set. The resource publishes no unit field; set it only after confirming the unit.")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_dir = args.report_dir or ROOT / "data" / "processed" / "agmarknet-history" / f"{stamp}{'-dry-run' if args.dry_run else ''}"

    def progress(month: dict) -> None:
        print(f"{month['start'][:7]}: {month['status']}, fetched {month['fetched_count']}, accepted {month['accepted_count']}, "
              f"inserted {month['inserted_count']}, auto-verified {month['auto_verified_count']}, "
              f"flagged for review {month['review_required_count']}, "
              f"held by another source {month['held_by_other_source_count']}, rejected {month['rejected_count']}, "
              f"failed dates {len(month['failed_dates'])}", file=sys.stderr, flush=True)

    def run(label: str, start: date, end: date) -> dict:
        try:
            result = backfill_history(config, start, end, dry_run=args.dry_run, api_url=api_url, token=token,
                                      batch_size=args.batch_size, lag_days=args.lag_days, report_dir=report_dir / label,
                                      on_month=progress)
        except ValueError as error:
            parser.error(str(error))
        return {"part": label, **result}

    parts = [run(label, start, end) for label, start, end in ranges]
    if args.backfill_from:
        # Read after the recent fill, so a first run on an empty database starts just before that window.
        try:
            coverage = fetch_history_coverage(api_url, token) if api_url and token else {}
        except RuntimeError as error:
            coverage = None
            parts.append({"part": "backfill", "status": "failed", "failed_dates": {}, "error_message": str(error)})
        earliest = date.fromisoformat(coverage["earliest_reporting_date"]) if coverage and coverage.get("earliest_reporting_date") else None
        window = next_backfill_window(earliest, args.backfill_from, latest, args.backfill_months) if coverage is not None else None
        if coverage is None:
            pass  # reported above; the next scheduled run tries again
        elif window:
            parts.append(run("backfill", *window))
        else:
            parts.append({"part": "backfill", "status": "complete", "failed_dates": {},
                          "note": f"History is stored back to {args.backfill_from.isoformat()}; nothing older to fill."})
    print(json.dumps({"parts": parts, "report_dir": str(report_dir)}, indent=2, ensure_ascii=False))
    return 2 if any(part["status"] == "failed" or part["failed_dates"] for part in parts) else 0


if __name__ == "__main__":
    raise SystemExit(main())
