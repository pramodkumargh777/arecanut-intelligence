# Areca Pulse — Data import

How verified market data gets into Areca Pulse: historical CSV files and the AGMARKNET connectors.
The daily data.gov.in connector is described in detail in [AGMARKNET_DAILY_CONNECTOR.md](AGMARKNET_DAILY_CONNECTOR.md).

## Import a historical CSV

The CSV importer accepts common AGMARKNET field names (date, state, district, market, commodity, variety, minimum, maximum, modal, and optional arrival). A price unit must be explicitly present in a unit column or in a price-column heading (for example `Modal Price (Rs./Quintal)`). Unsupported/missing units, invalid required fields and non-arecanut rows are reported, never guessed into the database.

Validate and write JSONL without any API credentials:

```sh
python3 data-platform/ingestion/import_csv.py /path/to/authorized-agmarknet-export.csv \
  --output /tmp/arecanut-normalized.jsonl
```

To send validated rows to the local Worker API, provide the same `INGESTION_TOKEN` configured in `api/.dev.vars`:

```sh
INGESTION_TOKEN='your-local-token' \
python3 data-platform/ingestion/import_csv.py /path/to/authorized-agmarknet-export.csv \
  --api-url http://127.0.0.1:8787/api/v1
```

The importer prints row-level validation issues and exits non-zero if any rows need correction. New observations are kept in `pending_review`; they do not appear in public price responses or analytics until approved in the Data quality page using `ADMIN_TOKEN`.

The flat official CSV schema with `Min_x0020_Price`, `Max_x0020_Price`,
`Modal_x0020_Price` and commodity `Arecanut(Betelnut/Supari)` is supported.
If the file omits units, pass `--price-unit 'INR/quintal'` **only after
confirming its publisher's unit documentation**. It is not a default.
Foreign currencies, inconsistent price-column units, and conflicting
configuration are rejected. A CSV containing any normalization errors sends
no records to the API. Monthly analysis exports are explicitly rejected by
the daily importer.

The daily-report routes found in the official public frontend are
`POST https://api.agmarknet.gov.in/v1/daily-price-arrival/report` and
`GET https://api.agmarknet.gov.in/v1/prices-and-arrivals/market-report/specific`.
The latter returned `TOKEN_OR_CAPTCHA_REQUIRED` during access validation;
the daily flow requires human CAPTCHA completion or authorized credentials.
No CAPTCHA bypass or unverified daily-JSON parser is implemented. A real daily
export/authorized feed is still needed before claiming source-to-screen daily
validation or historical backfill.

Migration `0004` enforces one current version per source record, prevents
invalid verified prices, and adds durable review events. Import batches
snapshot/supersede/reactivate source versions atomically, including A → B → A
replay. Reviews recheck pending status inside their transaction; stale reviews
return HTTP 409. Invalid ranges and future dates cannot be approved.
Validation messages and raw source evidence remain available in the queue.
Review events identify `shared-reviewer-token`, **not an individual user**;
per-person accountability still requires account-based authentication.

Daily analytics no longer silently cap input at 10,000 observations. Queries
fail explicitly if database limits are exceeded rather than returning a
partial index. CSV export uses standard double-quote escaping.

## AGMARKNET daily connector (data.gov.in, Karnataka arecanut)

A dedicated connector for the verified current-daily mandi resource
`9ef84268-d588-465a-a308-a864a43d0070` lives in
`data-platform/connectors/agmarknet/daily.py`; see
[docs/AGMARKNET_DAILY_CONNECTOR.md](AGMARKNET_DAILY_CONNECTOR.md) for the
verified schema, limitations, backfill/replay/CSV fallback and run reports:

```sh
.venv/bin/python data-platform/connectors/agmarknet/run_daily.py daily --dry-run
.venv/bin/python data-platform/connectors/agmarknet/run_daily.py daily
```

The resource only exposes the current arrival date; history accumulates from
scheduled runs and archived replays. Run status appears in Data quality →
Data-source status. The scheduled workflow uses this connector.

## AGMARKNET API connector (generic)

The API connector follows the configurable data.gov.in resource endpoint format. It requires the caller to confirm authorized access and provide the resource identifier and API key; no resource ID or key is assumed:

```sh
DATA_GOV_IN_API_KEY='...' \
AGMARKNET_RESOURCE_ID='...' \
AGMARKNET_API_BASE_URL='https://api.data.gov.in/resource' \
AGMARKNET_PRICE_UNIT='INR/quintal' \
INGESTION_TOKEN='your-local-token' \
python3 data-platform/connectors/agmarknet/fetch_api.py \
  --api-url http://127.0.0.1:8787/api/v1
```

Pagination, bounded retries for rate-limit/transient errors, a configurable inter-page delay, duplicate detection within a run, and the same normalization/review path are implemented. Many API payloads do not include a price-unit field; set `AGMARKNET_PRICE_UNIT` only after verifying the selected resource schema. The connector does not guess. Verify the selected resource schema, API terms and access before running it. The connector remains disabled when credentials/resource configuration are absent.

The endpoint/pagination pattern follows the official data.gov.in resource API format. No particular arecanut resource, field schema, access permission, or price-unit declaration has been verified with credentials; configure and validate those before enabling scheduled ingestion.
