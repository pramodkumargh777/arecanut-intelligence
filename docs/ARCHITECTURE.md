# ANI — Architecture

This document describes the storage and query architecture as implemented in the repository
(migrations `0001`–`0019`). Source-specific behaviour is documented separately in
[AGMARKNET_DAILY_CONNECTOR.md](./AGMARKNET_DAILY_CONNECTOR.md),
[COOPERATIVE_SOURCES.md](./COOPERATIVE_SOURCES.md), [COMMODITY_MODEL.md](./COMMODITY_MODEL.md) and
[FORECASTING.md](./FORECASTING.md), [SUPPLY_AND_RISK.md](./SUPPLY_AND_RISK.md) and [AI_ASSISTANT.md](./AI_ASSISTANT.md).
Backup, restore and retention procedures are in [DATA_RETENTION_AND_BACKUP.md](./DATA_RETENTION_AND_BACKUP.md).

## Components

```text
Python connectors (data-platform/)            Cloudflare Worker cron (30 3 * * * UTC)
  idempotent batches + SHA-256 keys               source refreshes, then non-fatal maintenance
            │ POST /api/v1/admin/import                       │
            ▼                                                 ▼
   Hono Worker API (api/src) ───────────────► D1 (system of record, all evidence rows)
            │                                     │  market_daily_summaries (derived cache)
            │ optional ARCHIVE binding            │  archive_objects (evidence registry)
            ▼                                     │  operational_errors / ingestion_jobs
   R2 bucket (optional evidence archive)  ◄───────┘
            │
            ▼
   React + Vite dashboard (bounded, paginated requests only)
```

D1 remains the system of record. No PostgreSQL migration is needed: the published data set is
small (tens of thousands of observations at most per year), every hot query has a covering index,
and chart aggregation is done server-side over a compact per-day summary cache.

Forecasting experiments run offline in Python (`data-platform/forecasting`). The engine reads a local D1 SQLite file or an export, and only read access is needed. It posts one idempotent payload to `POST /admin/forecasting/experiments`. The Worker stores predictions before outcomes exist. The cron then reconciles them against new monthly data, so no model training runs inside the Worker.

The optional AI assistant (`api/src/assistant`, `POST /api/v1/assistant/query`) is a read-only consumer of the same
public API. It classifies a question, calls whitelisted ANI tools in-process and retrieves document excerpts through
SQLite FTS5 (`document_chunks_fts`) plus optional BGE-M3 vectors stored in D1. It then asks an optional LLM (Ollama or
Workers AI) to explain only the verified facts. Every number comes from a tool result, and answers that fail the grounding
check fall back to a rule-based answer. With `ASSISTANT_LLM_PROVIDER=none` (the default) no model is called, and every other
page is independent of the assistant. See [AI_ASSISTANT.md](./AI_ASSISTANT.md).

## Query design

| Endpoint | Bound | Index / source |
|---|---|---|
| `GET /prices` | `limit` 1–1000 (400 above), keyset `cursor` or `offset` (not both); `include_count=false` skips `COUNT(*)`; `q` ≤ 100 chars | `idx_observations_verified_commodity_date` |
| `GET /analytics/reference-index` | optional `from`/`to`; at most `MAX_REFERENCE_POINTS` (4000) dates, `truncated` flag | `market_daily_summaries` primary key |
| `GET /charts/reference` | `from`/`to` required, span ≤ 3660 days, `interval` = `daily`/`weekly`/`monthly`; weekly buckets start on Monday | `market_daily_summaries` primary key |
| `GET /overview` | latest summary dates only | `market_daily_summaries` |
| `GET /cooperative/prices` | 366-day default window ending at the variety's latest verified date; custom window ≤ 1096 days; ≤ 5000 rows with `window.truncated` | `idx_cooperative_variety_date` |
| `GET /admin/quality`, `GET /admin/cooperative/quality` | `limit` 1–200, `offset`, `total` | `idx_observations_review_queue`, `idx_cooperative_review_queue` |
| `GET /admin/ingestion/jobs`, `/admin/operations/errors`, `/admin/archive/objects` | `limit` 1–200, `offset`, `total` | `idx_ingestion_jobs_started`, `idx_operational_errors_recent`, `idx_archive_category` |

Chart buckets summarise only dates that meet the market-coverage threshold. Empty buckets are omitted,
never interpolated, and withheld (under-covered) dates are counted in `withheld_days`.

`api/src/performance-archive.test.ts` runs `EXPLAIN QUERY PLAN` on every statement issued by the public
read routes and fails on a full scan of `market_price_observations` or `market_daily_summaries`.

## Market summary cache

`market_daily_summaries` holds one row per (commodity, state, variety, reporting date):
the market count and the median of one verified modal price per verified market. The rules are the
same as `buildReferenceSeries`: the latest `ingested_at` per market and date wins, and a tie goes to the
smallest id. Coverage is applied when the cache is read, so changing `MIN_INDEX_MARKETS` does not
require a rebuild.

- Insert and update triggers on observations and on market mapping changes record affected keys in
  `market_summary_dirty`.
- Readers call `refreshDirtySummaries` before querying, so results are never stale.
- The cron drains the remaining dirty keys (`refreshAllDirtySummaries`).
- `POST /admin/summaries/rebuild` recomputes a bounded range (≤ 3660 days) on operator request.
- Equivalence with `buildReferenceSeries` is tested after inserts, reviewer rejections, corrections
  and market mapping changes.

The cache is derived data and is never a source of evidence.

## Evidence storage and the optional R2 archive

Evidence rows (observations, raw cooperative snapshots, monthly raw reports, intelligence captures,
review history and version tables) cannot be deleted. Triggers in `0015` raise an error on
`DELETE`. Snapshot and report rewrites are also refused.

`archive_objects` is the registry. For each object it records:
- the storage type (`r2` or `d1_inline`), object key and SHA-256;
- size, MIME type, category, source and original file name;
- the related table and id, retention class (`evidence` or `temporary`) and expiry;
- metadata and the last verification time.

Rows cannot be deleted, and their identity columns are immutable.

**Without an `ARCHIVE` binding (local development and the default):**
- `POST /admin/archive/sync` registers existing inline evidence as `d1_inline` rows (`d1://table/id`).
- Uploads return 503.
- Nothing else changes.

**With an `ARCHIVE` R2 binding:**
- Evidence is uploaded under a content-addressed key: `category/source/aa/<sha256>.<ext>`.
- Re-uploading identical bytes returns the existing row with 200 and is not re-sent.
- Reads re-hash the bytes. A missing object returns 404 and marks the row `missing`; a mismatch
  returns 409 and marks it `hash_mismatch`. Both are logged to `operational_errors`.
- **Inline offload is off by default.** When `ARCHIVE_OFFLOAD_MIN_BYTES` (≥ 1024) is set, large inline
  copies are cleared only after the R2 copy is read back and its hash re-verified.
  - D1 guard triggers refuse the clear unless a stored R2 row exists.
  - For cooperative snapshots, that R2 row must also match the recorded `snapshot_sha256`.
  - Legacy snapshots without a recorded hash are never offloaded.
- Readers (`/history/monthly/snapshots/:id`, cooperative snapshot replay) fall back to R2
  transparently. If the binding is later removed, they return 503 rather than substituting data.
- Manual uploads (`POST /admin/archive/objects?category=…`, ≤ 25 MB) accept quality images, PDFs,
  reports, CSVs and large payloads. They can only link to non-evidence tables; evidence tables are
  linked exclusively by the verified sync.

Categories: `source_csv`, `source_html`, `source_json`, `source_pdf`, `imported_report`,
`quality_image`, `source_payload`, `temporary_processing`.

## Ingestion reliability

- Every import creates an `ingestion_jobs` row (job identifier) with `idempotency_key`,
  `content_sha256`, `source_file_name` and optional `reprocess_of`.
- A completed key replays its original job (`200`, `replayed: true`), a running key returns 409,
  and a failed key may be retried. `reprocess: true` creates a new job linked by `reprocess_of`;
  observation-level duplicate detection still applies.
- Python CSV imports bind the file SHA-256, batch index and batch content into each key.
  `--reprocess` forces a linked re-run.
- AGMARKNET daily batches use per-run keys, so only same-run retries replay. Replayed batches
  are reported as `replayed_batches` and are not double-counted.
- Scheduled maintenance failures (summary refresh, archive sync, temporary purge) are logged to
  `operational_errors` and do not fail the source schedule.

## Configuration

| Setting | Where | Default | Purpose |
|---|---|---|---|
| `ARCHIVE` | `[[r2_buckets]]` binding (commented out) | absent | Enables R2 archive |
| `ARCHIVE_SCHEDULE_ENABLED` | `[vars]` | `"false"` | Run archive sync and temporary purge in the cron |
| `ARCHIVE_OFFLOAD_MIN_BYTES` | `[vars]` (commented out) | unset (no offload) | Minimum inline size to offload after verification; must be ≥ 1024 |
| `TEMP_RETENTION_DAYS` | `[vars]` | `"7"` | Expiry for `temporary_processing` R2 objects |
| `OPEN_METEO_ENABLED` | `[vars]` / `.dev.vars` | unset (enabled) | `"false"` stops the scheduled Open-Meteo Sirsi capture (development source) |
| `ANI_TEMP_DIR`, `ANI_TEMP_RETENTION_DAYS` | Python environment | `data/tmp`, `7` | Local temporary-file purge (`npm run retention:temp`) |

## Free-tier fit

Limits below were checked against Cloudflare documentation on 2026-11-04 (see
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/)).

| Limit | Free | Design response |
|---|---|---|
| D1 rows read | 5 M/day | Charts and overview read the summary cache, not observations |
| D1 rows written | 100 k/day | Summary refresh rewrites only dirty dates |
| D1 database size | 500 MB (10 GB paid) | Optional R2 offload of large raw evidence |
| D1 max row / string / BLOB | 2 MB | Large payloads belong in R2 |
| D1 queries per Worker invocation | 50 (1000 paid) | Batched statements; bounded archive sync (≤ 20 rows per table) |
| D1 Time Travel | 7 days (30 days paid) | Plus `wrangler d1 export` backups |
| R2 storage / Class A / Class B | 10 GB-month / 1 M / 10 M per month | Content-addressed, deduplicated uploads; egress is free |

No paid service is required. R2 is optional and has not been provisioned by this repository.
