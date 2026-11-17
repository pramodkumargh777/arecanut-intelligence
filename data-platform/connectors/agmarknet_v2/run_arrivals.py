"""Command line for the AGMARKNET 2.0 arrivals connector (docs/AGMARKNET_V2_ARRIVALS.md).

Examples (from the repository root):
  .venv/bin/python data-platform/connectors/agmarknet_v2/run_arrivals.py --dry-run
  .venv/bin/python data-platform/connectors/agmarknet_v2/run_arrivals.py                       # last 2 closed months, 4 closed weeks
  .venv/bin/python data-platform/connectors/agmarknet_v2/run_arrivals.py --backfill-from 2011-01 --backfill-requests 600
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "data-platform"))

from connectors.agmarknet.run_daily import load_env_file  # noqa: E402
from connectors.agmarknet_v2.arrivals import (  # noqa: E402
    DEFAULT_BASE_URL, DEFAULT_LAG_DAYS, Client, Period, SourceError, backfill_periods, fetch_districts, fetched_keys, ingest,
    latest_closed_month, recent_periods, today_ist,
)


def month_arg(value: str) -> Period:
    year, month = value.split("-")
    return Period(int(year), int(month))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import AGMARKNET 2.0 weekly/monthly arecanut arrivals for Karnataka.")
    parser.add_argument("--recent-months", type=int, default=2, help="Closed months to (re)fetch, newest first (default 2; 0 skips).")
    parser.add_argument("--recent-weeks", type=int, default=4, help="Closed AGMARKNET weeks to (re)fetch (default 4; 0 skips).")
    parser.add_argument("--backfill-from", type=month_arg, help="Also fetch months not stored yet, back to this month (YYYY-MM).")
    parser.add_argument("--backfill-weekly", action="store_true", help="Backfill weeks as well as months.")
    parser.add_argument("--backfill-requests", type=int, default=300, help="Most source requests for the backfill part (default 300).")
    parser.add_argument("--districts", help="Comma-separated AGMARKNET district ids (default: every district listed for arecanut).")
    parser.add_argument("--lag-days", type=int, default=DEFAULT_LAG_DAYS, help="Days a period must have been closed (default 2).")
    parser.add_argument("--min-interval", type=float, default=2.0, help="Seconds between source requests (default 2).")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and check, write reports, store nothing.")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env")
    parser.add_argument("--report-dir", type=Path, help="Defaults to data/processed/agmarknet-v2-arrivals/<UTC timestamp>.")
    args = parser.parse_args(argv)
    if args.recent_months < 0 or args.recent_weeks < 0 or args.backfill_requests < 1 or args.min_interval < 0.5:
        parser.error("Use non-negative recent counts, a positive request budget and at least 0.5 s between requests.")
    env = load_env_file(args.env_file)
    api_url, token = env.get("ANI_API_URL"), env.get("INGESTION_TOKEN")
    if not args.dry_run and (not api_url or not token):
        parser.error("Set ANI_API_URL and INGESTION_TOKEN, or use --dry-run.")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_root = args.report_dir or ROOT / "data" / "processed" / "agmarknet-v2-arrivals" / stamp
    client = Client(env.get("AGMARKNET_V2_BASE_URL") or DEFAULT_BASE_URL, min_interval=args.min_interval)
    try:
        districts = fetch_districts(client)
    except (SourceError, ValueError, KeyError) as error:
        print(f"Could not read the district list: {error}", file=sys.stderr)
        return 2
    if args.districts:
        wanted = {int(item) for item in args.districts.split(",")}
        districts = [item for item in districts if item[0] in wanted]
    today = today_ist()
    results = []
    recent = recent_periods(today, args.recent_months, args.recent_weeks, args.lag_days)
    if recent:
        work = [(period, district_id, name) for period in recent for district_id, name in districts]
        results.append(ingest(work, client, dry_run=args.dry_run, api_url=api_url, token=token, report_dir=report_root / "recent", mode="daily"))
    if args.backfill_from:
        done = set() if args.dry_run else fetched_keys(api_url, token)
        recent_set = set(recent)
        work = [(period, district_id, name)
                for period in backfill_periods(args.backfill_from, latest_closed_month(today, args.lag_days), args.backfill_weekly)
                if period not in recent_set
                for district_id, name in districts if (period.kind, district_id, period.year, period.month, period.week) not in done]
        start = client.requests
        results.append(ingest(work, client, dry_run=args.dry_run, api_url=api_url, token=token, report_dir=report_root / "backfill",
                              mode="backfill", max_requests=start + args.backfill_requests))
        results[-1]["pending_after_run"] = max(0, len(work) - results[-1]["fetched"] - results[-1]["source_errors"])
    for result in results:
        brief = {k: result[k] for k in ("mode", "status", "source_requests", "fetched", "accepted_fetches", "rejected_fetches", "records",
                                         "reported", "not_reported", "inserted", "revised", "duplicates", "source_errors", "market_count")}
        if "pending_after_run" in result:
            brief["pending_after_run"] = result["pending_after_run"]
        print(json.dumps(brief))
        for item in result["rejected"][:20]:
            print(f"rejected {item['period']} {item['district']}: {'; '.join(item['problems'])}", file=sys.stderr)
        for error in result["errors"][:20]:
            print(f"error: {error}", file=sys.stderr)
    print(f"Reports: {report_root}", file=sys.stderr)
    return 2 if any(result["status"] == "failed" for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
