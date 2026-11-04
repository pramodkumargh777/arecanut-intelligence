from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from connectors.agmarknet.normalize import RowError, normalize_record


def import_csv(
    path: Path,
    source_key: str = "agmarknet_csv",
    configured_price_unit: str | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    errors: list[str] = []
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise ValueError("CSV has no header row.")
        if any("Prices Monthly Analysis" in header for header in reader.fieldnames if header):
            raise ValueError("Monthly aggregates cannot be imported as daily market observations. Use Monthly Trends.")
        rows = list(reader)
        if not rows:
            raise ValueError("CSV contains a header but no data rows.")
        for line_number, row in enumerate(rows, start=2):
            try:
                if None in row:
                    raise RowError("CSV row has more columns than its header.")
                records.append(normalize_record(row, source_key, configured_price_unit))
            except RowError as error:
                errors.append(f"line {line_number}: {error}")
    return records, errors


def send_records(api_url: str, token: str, records: list[dict[str, Any]], source_key: str) -> dict[str, Any]:
    endpoint = api_url.rstrip("/") + "/admin/import"
    results: list[dict[str, Any]] = []
    for offset in range(0, len(records), 200):
        body = json.dumps({"source_key": source_key, "records": records[offset : offset + 200]}).encode()
        request = urllib.request.Request(
            endpoint,
            data=body,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                results.append(json.loads(response.read().decode("utf-8")))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            detail = error.read().decode("utf-8", errors="replace") if isinstance(error, urllib.error.HTTPError) else str(error)
            raise RuntimeError(f"Import API request failed: {detail}") from error
    return {"batches": results}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate and import an AGMARKNET arecanut CSV.")
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--source", choices=("agmarknet_csv", "agmarknet"), default="agmarknet_csv")
    parser.add_argument("--price-unit", help="Only set after verifying the source's documented units; conflicting row/heading units are rejected.")
    parser.add_argument("--output", type=Path, help="Write normalized JSONL to this path; omit to print to stdout.")
    parser.add_argument("--api-url", default=os.environ.get("ANI_API_URL"), help="Versioned ANI API base URL, e.g. http://127.0.0.1:8787/api/v1")
    parser.add_argument("--token", default=os.environ.get("INGESTION_TOKEN"), help="Bearer token; may be set through INGESTION_TOKEN.")
    args = parser.parse_args()
    if not args.csv_file.is_file():
        parser.error(f"CSV file not found: {args.csv_file}")
    if bool(args.api_url) != bool(args.token):
        parser.error("Provide both --api-url and --token, or neither.")
    try:
        records, errors = import_csv(args.csv_file, args.source, args.price_unit)
        serialized = "\n".join(json.dumps(record, ensure_ascii=False) for record in records)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(serialized + ("\n" if serialized else ""), encoding="utf-8")
        elif not args.api_url:
            print(serialized)
        if args.api_url and args.token and records and not errors:
            result = send_records(args.api_url, args.token, records, args.source)
            print(json.dumps(result), file=sys.stderr)
        if args.api_url and errors:
            print("No rows were sent: correct all CSV validation errors before importing.", file=sys.stderr)
        print(f"Normalized {len(records)} row(s); {len(errors)} row(s) require correction.", file=sys.stderr)
        for error in errors:
            print(error, file=sys.stderr)
        return 1 if errors else 0
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Import failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
