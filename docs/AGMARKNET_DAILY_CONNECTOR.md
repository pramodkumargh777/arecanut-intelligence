# AGMARKNET daily connector (data.gov.in)

Code: [`data-platform/connectors/agmarknet/daily.py`](../data-platform/connectors/agmarknet/daily.py),
CLI: [`run_daily.py`](../data-platform/connectors/agmarknet/run_daily.py),
schema: [`0012_agmarknet_daily_connector.sql`](../api/migrations/0012_agmarknet_daily_connector.sql),
API: [`source-status.ts`](../api/src/source-status.ts).

The earlier generic connector (`fetch_api.py`) and CSV importer
(`ingestion/import_csv.py`) are unchanged.

## Source

| Item | Value |
|---|---|
| Provider | Open Government Data Platform India (data.gov.in) |
| Resource | `9ef84268-d588-465a-a308-a864a43d0070`: "Current Daily Price of Various Commodities from Various Markets (Mandi)" |
| Endpoint | `https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070` |
| Credential | `DATA_GOV_IN_API_KEY` (environment only; never logged, redacted from errors) |

### Verified schema (live authenticated request, 4 Nov 2026)

- **Fields:** `state`, `district`, `market`, `commodity`, `variety`, `grade`, `arrival_date` (`DD/MM/YYYY`), `min_price`, `max_price` and `modal_price`.
- **Metadata:** response metadata includes `total` and `updated_date`. `updated_date` is stored as the source update timestamp.
- **Filter fields:**
  - `filters[state.keyword]=Karnataka` works.
  - `filters[commodity]=Arecanut(Betelnut/Supari)` works. This is the exact commodity value; nationally it returned Karnataka, Keralam, Meghalaya and Maharashtra.
  - `filters[arrival_date]` is **silently ignored**.
- **What the source does not publish:**
  - **No historical archive.** The resource returned only the current arrival date.
  - **No unit field.** The unit is operator-confirmed configuration (`AGMARKNET_PRICE_UNIT=Rs./Quintal`), based on a magnitude cross-check against same-day MAMCOS INR/quintal quotations. The connector refuses to run without it and accepts only quintal units.
  - **No arrival quantity.** `arrival_quantity` is stored as `NULL` and never estimated.
  - **No record ID.** `source_record_id` is derived as `datagovin:<resource>:<sha256(state|district|market|commodity|variety|grade|date)>`.
  - **No publication date.** `publication_date` is `NULL`. The platform fetch time is stored separately in `platform_fetched_at`.

## Behaviour

| Function | Responsibility |
|---|---|
| `fetch_agmarknet_daily()` | Authenticated paginated fetch (`limit` ≤ 1000, `offset`). Retries 408/429/5xx, network and invalid-JSON errors with exponential backoff. Fails on schema drift or when the fetched count differs from `total`. Error messages give the exact HTTP status and source message, with the key removed. |
| `validate_agmarknet_record()` | **Reject:** missing fields, wrong commodity or state, invalid or future (IST) dates, and non-numeric or non-positive prices. **Review flag:** min ≤ modal ≤ max violated, or implausible magnitude. |
| `normalize_agmarknet_record()` | Keeps variety and grade separate and exactly as published. Keeps min, max and modal prices separate. Converts `Rs./Quintal` to `INR/quintal` and retains the original unit. Records provenance: resource ID, derived record ID, raw source payload and fetch time. |
| `ingest_agmarknet_daily()` | Fetch → validate → deduplicate → import in batches of 10 through `/admin/import` → record run via `/admin/source-runs` → write reports. |
| `backfill_agmarknet_history()` | Pulls a date range from the live resource (current day only), archived replays (`raw_source_pages.jsonl`, `--replay`) and official CSV exports (`--csv`, source `agmarknet_csv`). Reports covered and uncovered dates; nothing is interpolated. |

**Idempotency.** The observation ID is a hash of the record ID, raw payload and unit, and it excludes the fetch time.
- Re-fetches count as duplicates.
- Changed source values supersede the old row, with history kept in `source_record_versions`.
- Within a run, identical rows are counted as duplicates. Rows with the same natural key but different prices are all rejected as `conflicting_duplicate`.

**Publication.** With `AGMARKNET_DAILY_AUTO_VERIFY = "true"` (wrangler.toml, the default since 8 Nov 2026), rows that passed every check are verified at import ([`src/auto-verify.ts`](../api/src/auto-verify.ts)).
- Each approval is written to `observation_reviews` under the reviewer `auto-validation-daily-v1`, and the market is verified as a manual approval would.
- Rows flagged `review_required`, rows a reviewer rejected, future dates, and slots that already hold a verified price are never auto-verified. Flagged rows wait in Data quality.
- It is one set-based pass per import request (three D1 statements, whatever the record count), and it never fails an import.
- The 09:00 IST cron runs the same pass over rows still waiting, for example rows imported before the switch was on. `POST /api/v1/admin/agmarknet/auto-verify` (ADMIN_TOKEN) runs it immediately. Repeating it is safe.
- Set the switch to `"false"` to return to reviewing every row. Manual CSV imports (`agmarknet_csv`) are always reviewed by a person.

**Free-tier compatibility.**
- Each imported record costs about 4 D1 statements. The default batch of 10 keeps an import request below the 50-query Workers Free limit.
- The live Karnataka snapshot is about 46 rows, which is 5 import requests plus 1 run record.

## Running

```sh
# .env at repository root (gitignored): DATA_GOV_IN_API_KEY, AGMARKNET_PRICE_UNIT=Rs./Quintal,
# ANI_API_URL, INGESTION_TOKEN. Existing environment variables take precedence.
.venv/bin/python data-platform/connectors/agmarknet/run_daily.py daily --dry-run
.venv/bin/python data-platform/connectors/agmarknet/run_daily.py daily
.venv/bin/python data-platform/connectors/agmarknet/run_daily.py backfill \
  --start 2026-10-01 --end 2026-11-04 \
  --replay data/processed/agmarknet/<run>/raw_source_pages.jsonl \
  --csv path/to/official-export.csv
```

Tuning: `--page-size`, `--max-pages`, `--max-retries`, `--timeout-seconds`,
`--batch-size`, or `AGMARKNET_PAGE_SIZE`, `AGMARKNET_MAX_PAGES`,
`AGMARKNET_MAX_RETRIES`, `AGMARKNET_TIMEOUT_SECONDS`,
`AGMARKNET_BACKOFF_SECONDS`, `AGMARKNET_PAGE_DELAY_SECONDS`.
`AGMARKNET_DAILY_RESOURCE_ID` overrides the resource. Otherwise
`AGMARKNET_RESOURCE_ID` is used, falling back to the verified ID above.

Each run writes these files to `data/processed/agmarknet/<UTC stamp>-<command>/` (gitignored):

- `ingestion_summary.json`
- `source_coverage.json`
- `rejected_records.json`
- `raw_source_pages.jsonl`, the archive used for replay

Backfills also write `backfill_summary.json`. Exit code 2 means the run failed.

**Scheduling.** `.github/workflows/agmarknet-ingestion.yml` runs at 17:45 and 03:17 UTC and can be dispatched manually, with optional dry run.
- It needs the repository variables `ANI_API_URL` and `AGMARKNET_PRICE_UNIT`, and the secrets `DATA_GOV_IN_API_KEY` and `INGESTION_TOKEN`. If any are missing it skips.
- Reports and raw pages are uploaded as 90-day artifacts. Copy them to durable storage if they are needed as long-term replay evidence.
- The resource's refresh cadence is not documented. Days on which no run happens while that day is current cannot be recovered from this resource.

**Relay.** data.gov.in timed out from GitHub's runners on 6 Nov 2026 and returned HTTP 523 to a Worker running in Marseille, but answered from Mumbai. So the scheduled job reaches it through a small Worker pinned to Mumbai (`api/src/agmarknet-relay.ts`, `api/wrangler.relay.toml`).
- Set the repository variable `AGMARKNET_API_BASE_URL` to `https://ani-agmarknet-relay.arecanut.workers.dev/resource`. Without it, the connector calls data.gov.in directly, which works from a machine in India.
- The relay serves GET requests for this one resource only and needs `INGESTION_TOKEN` in the `X-ANI-Relay-Token` header, so that secret must match on the relay, the main API and GitHub. The token is never sent to data.gov.in.
- Deploy it with `npx wrangler deploy --config api/wrangler.relay.toml`. Keep its logging off, because the data.gov.in key is in the request URL.

**Status.** `GET /api/v1/admin/source-status` (ADMIN_TOKEN) and the
*Data-source status* panel in Data quality show the latest Karnataka market
date, observation counts by review status, platform fetch time (IST), recent
runs, rejected records and source limitations.

## Live verification (local D1, 4 Nov 2026)

| Run | Fetched | Accepted | Rejected | Inserted | Duplicates |
|---|---|---|---|---|---|
| First | 46 | 46 | 0 | 46 | 0 |
| Repeat | 46 | 46 | 0 | 0 | 46 |

- The first run fetched 46 of the 46 records reported by the source total, from 1 page.
- **Stored data:** 46 Karnataka observations with market date 2026-11-04, across 18 APMC markets in 10 districts and 21 source varieties. Grades: Local 36, Large 6, Medium 3, FAQ 1.
- **Retrieval:** the stored rows were read back through `/admin/quality` and `/admin/source-status`.
- **Review state:** the rows remain `validated`, awaiting reviewer verification.
- **Scope of this check:** it used local D1 only; no remote or production ingestion was performed.

## Limitations

- **History.** Only the current day is available from this resource. Past dates come from a separate data.gov.in resource through the [AGMARKNET history add-on](AGMARKNET_HISTORY.md), or from archived replays and official CSV exports. CAPTCHA-protected AGMARKNET pages and private endpoints are not used.
- **Unit.** The unit is an evidence-based operator confirmation, not a publisher declaration. Confirm it with the publisher.
- **Grade and the reference index.** The reference index (`buildReferenceSeries`) groups by exact variety, not grade, and keeps one observation per market and date, choosing the latest ingestion time.
  - If a market reported two grades of one variety on one date, the choice between them would depend on order.
  - The 4 Nov 2026 snapshot contains no such pair; across those 46 rows each market, variety and date has exactly one grade.
  - The methodology is unchanged. Grade-aware selection should be a reviewed methodology decision.
