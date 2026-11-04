from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from ingestion.import_csv import send_records
from connectors.agmarknet.normalize import RowError, normalize_record


def fetch_page(base_url: str, resource_id: str, api_key: str, limit: int, offset: int) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({"api-key": api_key, "format": "json", "limit": limit, "offset": offset})
    endpoint = f"{base_url.rstrip('/')}/{urllib.parse.quote(resource_id, safe='')}?{query}"
    for attempt in range(4):
        request = urllib.request.Request(endpoint, headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
            records = payload.get("records")
            if not isinstance(records, list) or not all(isinstance(item, dict) for item in records):
                raise ValueError("data.gov.in response did not contain a records array.")
            return records
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 3:
                detail = error.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"AGMARKNET API returned HTTP {error.code}: {detail}") from error
            time.sleep(min(2 ** attempt, 8))
        except urllib.error.URLError as error:
            if attempt == 3:
                raise RuntimeError(f"AGMARKNET API request failed: {error}") from error
            time.sleep(min(2 ** attempt, 8))
    return []


def fetch_records(
    base_url: str,
    resource_id: str,
    api_key: str,
    limit: int,
    pages: int,
    delay: float,
    price_unit: str | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    errors: list[str] = []
    seen: set[str] = set()
    for page in range(pages):
        raw_records = fetch_page(base_url, resource_id, api_key, limit, page * limit)
        if not raw_records:
            break
        for raw in raw_records:
            try:
                normalized = normalize_record(raw, "agmarknet", price_unit)
                if normalized["id"] not in seen:
                    records.append(normalized)
                    seen.add(normalized["id"])
            except RowError as error:
                errors.append(str(error))
        if len(raw_records) < limit:
            break
        if page == pages - 1:
            extra = fetch_page(base_url, resource_id, api_key, limit, (page + 1) * limit)
            if extra:
                raise ValueError("Pagination limit reached with additional source records remaining; increase --pages.")
        if delay:
            time.sleep(delay)
    return records, errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch and normalize AGMARKNET records from a configured data.gov.in resource.")
    parser.add_argument("--base-url", default=os.environ.get("AGMARKNET_API_BASE_URL") or "https://api.data.gov.in/resource")
    parser.add_argument("--resource-id", default=os.environ.get("AGMARKNET_RESOURCE_ID"))
    parser.add_argument("--api-key", default=os.environ.get("DATA_GOV_IN_API_KEY"))
    parser.add_argument("--price-unit", default=os.environ.get("AGMARKNET_PRICE_UNIT"), help="Unit documented by the selected resource (e.g. INR/quintal); API records often omit it.")
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--pages", type=int, default=10)
    parser.add_argument("--delay-seconds", type=float, default=1.0)
    parser.add_argument("--api-url", default=os.environ.get("ANI_API_URL"))
    parser.add_argument("--token", default=os.environ.get("INGESTION_TOKEN"))
    args = parser.parse_args()
    if not args.resource_id or not args.api_key:
        parser.error("Set AGMARKNET_RESOURCE_ID and DATA_GOV_IN_API_KEY; no default resource or credential is assumed.")
    if not 1 <= args.limit <= 1000 or not 1 <= args.pages <= 100 or args.delay_seconds < 0:
        parser.error("Use limit 1–1000, pages 1–100, and a non-negative request delay.")
    if bool(args.api_url) != bool(args.token):
        parser.error("Provide both ANI_API_URL and INGESTION_TOKEN, or neither.")
    try:
        records, errors = fetch_records(args.base_url, args.resource_id, args.api_key, args.limit, args.pages, args.delay_seconds, args.price_unit)
        if args.api_url and args.token and records and not errors:
            print(json.dumps(send_records(args.api_url, args.token, records, "agmarknet")))
        elif not args.api_url:
            for record in records:
                print(json.dumps(record, ensure_ascii=False))
        if args.api_url and errors:
            print("No rows were sent: correct source validation errors before importing.", file=sys.stderr)
        print(f"Fetched {len(records)} normalized record(s); {len(errors)} invalid record(s).", file=sys.stderr)
        for error in errors:
            print(error, file=sys.stderr)
        return 1 if errors else 0
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Fetch failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
