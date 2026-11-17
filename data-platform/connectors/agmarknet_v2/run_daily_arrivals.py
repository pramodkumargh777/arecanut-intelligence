"""Import AGMARKNET 2.0 date-wise daily arrival reports (docs/DAILY_ARRIVALS.md).

``prices-and-arrivals/date-wise/specific-commodity`` returns a month of market x date x variety arrivals (Metric Tonnes)
and prices, but only with a logged-in AGMARKNET session or a solved CAPTCHA. It is therefore a secondary source: the
connector imports responses saved during an operator session (``--from-dir``), or fetches while
``AGMARKNET_V2_ACCESS_TOKEN`` holds a live session token (``--fetch``). The token is never stored or logged. KRAMA
(connectors/krama) is the unattended daily source.

Examples:
  .venv/bin/python data-platform/connectors/agmarknet_v2/run_daily_arrivals.py --from-dir data/raw/agmarknet-v2-daily
  .venv/bin/python data-platform/connectors/agmarknet_v2/run_daily_arrivals.py --fetch 2026-11 --fetch 2026-10
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "data-platform"))

from connectors.agmarknet.run_daily import load_env_file  # noqa: E402
from connectors.agmarknet_v2.arrivals import COMMODITY_ID, STATE_ID, USER_AGENT  # noqa: E402
from connectors.krama.arrivals import _api  # noqa: E402

SOURCE_KEY = "agmarknet_v2_daily"
ENDPOINT = "https://api.agmarknet.gov.in/v1/prices-and-arrivals/date-wise/specific-commodity"
PAYLOAD_FORMAT = "agmarknet_datewise_json/1"
PARSER_VERSION = "agmarknet-v2-daily/1"
DOCUMENTS_PER_IMPORT = 1  # a month is up to ~250 KB of source JSON


def month_bounds(month: str) -> tuple[str, str]:
    year, number = (int(part) for part in month.split("-"))
    nxt = datetime(year + (number == 12), number % 12 + 1, 1)
    last = (nxt - datetime(year, number, 1)).days
    return f"{year}-{number:02d}-01", f"{year}-{number:02d}-{last:02d}"


def document_for(month: str, body: bytes, fetched_at: str) -> dict:
    year, number = (int(part) for part in month.split("-"))
    params = {"year": str(year), "month": str(number), "includeExcel": "false", "stateId": str(STATE_ID), "commodityId": str(COMMODITY_ID)}
    start, end = month_bounds(month)
    return {"request_url": f"{ENDPOINT}?{urllib.parse.urlencode(params)}", "request_params": params, "period_start": start, "period_end": end,
            "fetched_at": fetched_at, "raw_sha256": hashlib.sha256(body).hexdigest(), "raw_bytes": len(body),
            "payload_format": PAYLOAD_FORMAT, "parser_version": PARSER_VERSION, "payload": body.decode("utf-8")}


def fetch_month(month: str, token: str) -> bytes:
    year, number = (int(part) for part in month.split("-"))
    params = {"year": year, "month": number, "includeExcel": "false", "stateId": STATE_ID, "commodityId": COMMODITY_ID}
    request = urllib.request.Request(f"{ENDPOINT}?{urllib.parse.urlencode(params)}",
                                     headers={"Accept": "application/json", "User-Agent": USER_AGENT, "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"AGMARKNET returned HTTP {error.code} for {month}: {error.read()[:200]!r}") from None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import AGMARKNET 2.0 date-wise daily arecanut arrivals for Karnataka.")
    parser.add_argument("--from-dir", type=Path, help="Directory of saved monthly responses (YYYY-MM.json) with manifest.json.")
    parser.add_argument("--fetch", action="append", default=[], help="Month (YYYY-MM) to fetch with AGMARKNET_V2_ACCESS_TOKEN; repeatable.")
    parser.add_argument("--save-dir", type=Path, default=ROOT / "data" / "raw" / "agmarknet-v2-daily", help="Where fetched responses are saved.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env")
    args = parser.parse_args(argv)
    env = load_env_file(args.env_file)
    api_url, token = env.get("ANI_API_URL"), env.get("INGESTION_TOKEN")
    if not args.dry_run and (not api_url or not token):
        parser.error("Set ANI_API_URL and INGESTION_TOKEN, or use --dry-run.")
    documents: list[tuple[str, dict]] = []
    if args.from_dir:
        manifest = json.loads((args.from_dir / "manifest.json").read_text(encoding="utf-8"))
        for item in manifest["responses"]:
            if item.get("file") and item.get("http_status") == 200:
                body = (args.from_dir / item["file"]).read_bytes()
                if hashlib.sha256(body).hexdigest() != item["sha256"]:
                    print(f"{item['month']}: file does not match its recorded SHA-256; skipped", file=sys.stderr)
                    continue
                documents.append((item["month"], document_for(item["month"], body, item["fetched_at"])))
    if args.fetch:
        session = (env.get("AGMARKNET_V2_ACCESS_TOKEN") or "").removeprefix("Bearer ").strip()
        try:
            expiry = json.loads(base64.urlsafe_b64decode(session.split(".")[1] + "==="))["exp"]
        except (IndexError, ValueError, KeyError):
            parser.error("AGMARKNET_V2_ACCESS_TOKEN is not a logged-in AGMARKNET session token.")
        if expiry - time.time() < 120:
            parser.error("AGMARKNET_V2_ACCESS_TOKEN has expired; log in at agmarknet.gov.in and copy a fresh one.")
        args.save_dir.mkdir(parents=True, exist_ok=True)
        for month in args.fetch:
            fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
            body = fetch_month(month, session)
            (args.save_dir / f"{month}.json").write_bytes(body)
            documents.append((month, document_for(month, body, fetched_at)))
            time.sleep(2)
    totals = {"documents": 0, "documents_new": 0, "inserted": 0, "revised": 0, "duplicates": 0, "rejected_rows": 0}
    for month, document in documents:
        totals["documents"] += 1
        if args.dry_run:
            continue
        result = _api("POST", f"{api_url.rstrip('/')}/admin/arrivals/daily/import", token, {"source_key": SOURCE_KEY, "documents": [document]})
        for name in ("documents_new", "inserted", "revised", "duplicates", "rejected_rows"):
            totals[name] += int(result.get(name, 0))
        for item in result.get("rejected", [])[:5]:
            print(f"{month} rejected: {json.dumps(item, ensure_ascii=False)}", file=sys.stderr)
    print(json.dumps(totals))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
