# ANI — Implementation Status

**Status snapshot:** 2026-11-04 P0 correctness implementation + AGMARKNET daily connector + cooperative sources (MAMCOS, TSS, TUMCOS) + multi-commodity domain model + D1 performance/R2 archive/data retention + experimental forecasting engine

**Audit details:** [`CODEBASE_AUDIT.md`](./CODEBASE_AUDIT.md)

**Next implementation sequence:** [`IMPLEMENTATION_ROADMAP.md`](./IMPLEMENTATION_ROADMAP.md)

This file describes code present in the repository. It does not claim that
every external source is authorized/available, that local ignored D1 data is
current, or that the application has been deployed.

## Implemented in the repository

| Area | Current status | Scope and boundary |
|---|---|---|
| Frontend | Implemented | React, Vite and TypeScript application with responsive source-aware routes, loading/error/empty states, charts, filters and exports. Date/chart-data helpers are regression-tested in the existing Vitest suite; no component/E2E runner is configured. |
| API | Implemented | Hono Worker under `/api/v1`, Zod validation, CORS allow-list, prepared D1 queries, shared-token admin/ingestion actions and separate route modules. Core daily API logic remains in `api/src/index.ts`. |
| Daily official market data | Live data.gov.in connector implemented and verified locally | The connector for resource `9ef84268-d588-465a-a308-a864a43d0070` has a verified schema, Karnataka/Arecanut filters, retries, validation, idempotent import, run records, reports and replay/CSV backfill (see [AGMARKNET_DAILY_CONNECTOR.md](./AGMARKNET_DAILY_CONNECTOR.md)). The resource is current-day only and has no unit, arrival-quantity or record-ID fields. The unit is operator-confirmed `Rs./Quintal`. Rows remain `validated` until a reviewer verifies them. The key is environment-only. Remote/production ingestion has not been run. |
| Monthly official data | Implemented | Separate AGMARKNET state/variety monthly feed, weighted-price methodology, raw CSV and refresh provenance, history/version records, backfill, and monthly routes. Not daily market data. |
| MAMCOS | Implemented as a separate feed | Source-declared INR/quintal min/max/reported average, branch/date/variety records, raw snapshots and review. A cooperative branch median is distinct from an APMC index. |
| TSS | Archived and reviewable; **not published** | `avgrate` and `norrate` remain separate. Lot, bag and weight aggregates are optional; no personal tender fields are stored. The unit is assumed, so approval gives `accepted_unit_unconfirmed`, and database triggers block publication. Publisher unit confirmation is outstanding. |
| TUMCOS | Archived and reviewable; **not published** | Channagiri arecanut and black pepper. The source says "kg" but values match per-quintal levels, so the unit is recorded as a conflict. No variety is published. Stale page metadata is detected and record dates are used. See [COOPERATIVE_SOURCES.md](./COOPERATIVE_SOURCES.md). |
| Cooperative compliance | Recorded; no permission granted | A source registry records robots, terms, unit evidence and permission. Scheduled collection needs an env flag **and** a recorded grant. Authorized CSV import, snapshot replay, TSS backfill and source status/freshness are available in Data quality. |
| Daily analytics/comparison | Implemented | Verified official modal prices, exact reported varieties, one market observation per date and minimum market-coverage gate. Latest-per-market comparisons can have different reporting dates; the UI discloses this. |
| Historical reporting | Implemented with P0 review signals | Monthly calendar coverage, source revisions, rolling statistics, YoY, seasonality and captured cooperative daily aggregates. Explicit gaps, observation markers/counts and adjacent-month anomaly flags; archived source/import comparisons are available on demand. Statistics remain descriptive; flagged values are not removed. |
| Decision tools | Implemented | Server-side, actual-input realization/profit/hold arithmetic with explicit source selection and snapshots. No price forecast or buy/sell recommendation is implied. Saved scenarios use shared reviewer-token access, not user isolation. |
| Intelligence | Implemented with narrow source coverage | Separate production, trade, weather, bulletin and lot-inspection schemas, with capture provenance. Production defaults and resets to Karnataka; All India and all-state comparisons remain available. Sources are curated and partial; quality records require real inspection evidence. |
| Forecasts | Experimental evaluated reference baselines | Exact-variety Karnataka monthly history, immutable evaluation snapshots, validation/calibration/holdout and publication gates. Last value repeats the latest price; seasonal naive repeats the same month last year. No proven prospective predictive edge. Uses revised current history rather than as-of vintage data. Evaluation remains operator-triggered. |
| Database | Implemented through 16 migrations | Daily observations/reviews, monthly snapshots, cooperative feeds, decisions, independent intelligence and forecasts are stored in separate tables. Production migrations have not been tested in a live account. |
| Multi-commodity model | Schema and UI generalized; **Arecanut is the only production commodity** | Migration 0014 adds commodity master/config/capability tables, commodity-scoped varieties, grades, grade mappings, aliases, units and market↔commodity links. It also adds an immutable `price_basis` on every observation (7-code taxonomy) and a read-only `price_observations` view. A global commodity selector (default Arecanut) gates pages by capability. Black pepper, coffee, cardamom, coconut/copra, cocoa and natural rubber are configuration only: no data is published or fabricated, and their varieties and grades are unverified reference configuration. See [COMMODITY_MODEL.md](./COMMODITY_MODEL.md). |
| Performance, archive and retention | Implemented; R2 optional and not provisioned | Migrations 0015/0016 add compound indexes, a trigger-maintained `market_daily_summaries` cache, idempotency columns, `operational_errors`, `archive_objects`, and evidence no-delete/offload guards. Read routes are bounded and paginated, and `/charts/reference` aggregates in SQL. R2 (`ARCHIVE_BUCKET`) is optional; without it, evidence stays inline in D1. See [ARCHITECTURE.md](./ARCHITECTURE.md) and [DATA_RETENTION_AND_BACKUP.md](./DATA_RETENTION_AND_BACKUP.md). |

## P0 correctness changes

- [Shared date helpers](../shared/dates.ts) validate real calendar dates,
  preserve date-only reporting fields, format timestamps explicitly in IST,
  and interpret D1 `CURRENT_TIMESTAMP` as UTC rather than browser-local time.
  Monthly completion boundaries are consistently IST in the UI, monthly API
  and forecast evaluation. No publication time is invented from a date-only
  publication field.
- [Price charts](../frontend/src/components/PriceChart.tsx) use UTC calendar
  time axes and include years on every tick. Monthly observation tooltips and
  tables identify reporting months, not fabricated daily quotations. Null
  separators break lines across missing calendar observations; markers and
  actual/missing counts are shown without price interpolation. Counts cover
  the selected monthly range or the first-to-last daily observation span,
  not a claim about trading-day completeness.
- Overview APIs expose `benchmark_reporting_date` separately from
  `latest_reporting_date`. A chart can end at an older qualifying report
  when the newest market/branch reports lack coverage; the dashboard explains
  this and still withholds a latest-date benchmark with insufficient coverage.
- [Monthly review rules](../api/src/monthly-quality.ts) flag absolute changes
  of **20% or greater** between adjacent calendar months of the same series,
  including drops/rebounds, plus non-positive values and unexpected units.
  Gaps and differing units are not treated as comparable adjacent prices.
  These are deterministic review metadata, not reviewer adjudications or
  proof of source errors. Flags do not alter source records, descriptive
  calculations, forecast inputs or immutable snapshots.
- `GET /api/v1/history/monthly/snapshots/:id/evidence?variety=...` compares the
  exact state/variety primary token in an archived CSV with its retained
  normalized version and unit. Missing versions, mismatches and unparseable
  captures are explicit. Evidence is loaded on demand rather than loading
  every raw report into historical chart requests.
- Read-only investigation of the captured Karnataka Rashi series found:
  December 2023 **47410.63**, January 2024 **36367.18**, February 2024
  **47117.44**, all INR/quintal. The captured primary source columns, raw
  imported tokens and stored numeric values agree. The January drop
  (**-23.29%**) and February rebound (**+29.56%**) are therefore retained and
  flagged; no causal explanation or publisher error is asserted.
- Publication calendar dates, source publication timestamps, platform fetch
  timestamps, ingestion times and forecast execution times are labelled
  independently. Daily AGMARKNET does not retain a publication/fetch
  timestamp; those fields are explicitly unavailable, not relabelled
  ingestion timestamps. Cooperative/monthly feeds do not supply a publisher
  timestamp. Existing daily ingestion/review future-date guards remain UTC;
  the captured-history query's today limit uses IST.

## AGMARKNET daily connector

- **Connector:** [`daily.py`](../data-platform/connectors/agmarknet/daily.py) implements `fetch_agmarknet_daily`, `normalize_agmarknet_record`, `validate_agmarknet_record`, `ingest_agmarknet_daily` and `backfill_agmarknet_history`. [`run_daily.py`](../data-platform/connectors/agmarknet/run_daily.py) provides the `daily`/`backfill` CLI with `--dry-run`.
- **Unchanged:** the existing `fetch_api.py`, `normalize.py` and CSV importer.
- **Migration 0012** adds `grade`, `source_resource_id` and `platform_fetched_at` to daily observations, plus the `source_ingestion_runs` table holding job statistics, request filters, reporting dates, import job IDs, a rejected-record sample and the error message.
- **API:** `POST /admin/source-runs` (INGESTION_TOKEN) and `GET /admin/source-status` (ADMIN_TOKEN). The daily read APIs now return `grade` and `platform_fetch_timestamp`.
- **UI:** Data quality now has a *Data-source status* panel, and review rows show grade and the platform fetch time in IST.
- **Workflow:** `agmarknet-ingestion.yml` now runs this connector twice daily. It skips without its variables or secrets and archives reports and raw pages as artifacts.
- **Live result (local D1, 4 Nov 2026):**
  - The authenticated request returned 46 of the 46 source-total records.
  - All 46 were stored: Karnataka observations with market date 2026-11-04, from 18 APMC markets, 10 districts and 21 source varieties.
  - The repeat run inserted 0 and counted 46 duplicates.
  - Both runs are recorded and visible in the UI.
- **Secret handling:** no report, log or repository file contains the API key. The key was shared in chat during setup and **should be rotated**.

## D1 performance, R2 archive and data retention

- **Migration 0015:**
  - Compound indexes for every filter and sort path that was audited.
  - The `market_daily_summaries` cache plus `summary_dirty_dates` triggers.
  - Import idempotency keys and SHA-256 hashes.
  - The `operational_errors` table.
  - The `archive_objects` registry.
  - Triggers that block deleting evidence, rewriting snapshots, or offloading without a verified copy.
- **Migration 0016** drops the 0013 blanket snapshot-immutability trigger, which blocked verified offloads. The 0015 guards still block content changes.
- **API:**
  - `/prices`: limit 1–1000, keyset cursor, optional count.
  - Paginated admin and cooperative quality queues.
  - Windowed `/cooperative/prices`: 366 days by default, 1096 maximum, 5,000-row limit.
  - The reference index is limited to 4,000 points.
  - New `/charts/reference` with daily, weekly or monthly SQL buckets over at most 3,660 days.
  - Overview and comparison read the summary cache.
- **Operations routes** (`operations-routes.ts`, ADMIN_TOKEN):
  - Storage status and summary rebuild.
  - Archive sync, upload, link and purge. Manual links are allowed only for non-evidence tables.
  - The operational error log.
  - Cron maintenance refreshes summaries and, when `ARCHIVE_SCHEDULE_ENABLED="true"`, syncs the archive and purges expired temporary objects. Failures are logged and never fail the schedule.
- **R2:**
  - Optional `ARCHIVE_BUCKET` binding. Without it the system runs in `d1_inline` mode; local development needs no R2.
  - Readers fall back to R2 for offloaded payloads.
  - Only `temporary_processing` objects expire, after `ARCHIVE_TEMP_RETENTION_DAYS` (default 7). Evidence is never deleted.
- **Python:**
  - `idempotency.py` hashes payloads.
  - The CSV importer has `--reprocess`.
  - The daily connector sends batch keys.
  - `retention.py` purges local temporary files only.
- **Backups:** `scripts/d1-backup.mjs` exports the database with a manifest and SHA-256 hashes. `scripts/d1-restore-check.mjs` replays an export into a scratch database and checks row counts and foreign keys.
- **Frontend:**
  - A `QueuePager` adds paging to the review queues.
  - The cooperative page requests a date window and shows the window and a truncation note.
  - The branch list comes from the API.

## Forecasting experimentation engine

See [`FORECASTING.md`](./FORECASTING.md).

- **Engine:** `data-platform/forecasting` is an independent Python engine.
  - Separate datasets per price basis.
  - Baselines, AutoARIMA, AutoETS, Theta, LightGBM and Chronos-2 (experimental, CPU).
  - Walk-forward evaluation in revised and strict-vintage modes.
  - Metrics: MAE, RMSE, WAPE, MASE, directional accuracy, coverage and width.
  - Diebold–Mariano tests with Holm correction.
  - File-based tracking, with MLflow optional.
- **Existing baseline:** `monthly-baselines-v1` is unchanged. The Python port reproduces all 11 stored evaluated snapshots exactly.
- **Migration 0017:** append-only experiment, evaluation, prediction, outcome and model-event tables, with origin and unobserved-target guards.
- **API:** `api/src/forecasting.ts` covers publication, reconciliation, validation and revocation. Reconciliation runs after the monthly refresh and in cron.
- **Frontend:** a new `/forecasts/evaluation` dashboard.
- **Real run** `fx-20261104T192118Z-5839b847aa`:
  - 17 eligible monthly series, 35 origins.
  - 0 candidates: no model beat the baseline significantly.
  - The daily, MAMCOS and TSS datasets are suppressed.
  - Published to local D1 only.
- **Tests:** 8 API tests and 20 synthetic Python tests.

## Supply, production and agricultural risk

See [`SUPPLY_AND_RISK.md`](./SUPPLY_AND_RISK.md).

- **Migration 0018:** append-only tables and views.
  - Production estimate documents and records, with estimate stages and revision history. The view unions DASD captures with imports.
  - Verified Karnataka district list and aliases.
  - Market arrivals, with arrival and traded quantities as separate measures.
  - Weather history, forecast and warning datasets, kept separate and labelled by data type.
  - Versioned crop-risk rules, expert reviews and field reports.
- **API:** `api/src/supply.ts` and `api/src/supply-routes.ts`, under `/supply/*`, `/admin/supply/*` and `/ingest/arrivals`.
- **Open-Meteo:** the existing Sirsi capture now records mean humidity, and `OPEN_METEO_ENABLED=false` disables it.
- **Frontend:** a new `/supply` page.
  - Karnataka is the default, with an All India comparison.
  - Shows estimate stages, revisions, growth with mixed-stage flags, arrivals, weather, crop-risk rules and advisories.
  - Every table states its source and reporting period.
- **Local data:**
  - Migration applied.
  - DASD production for 2021-22 to 2025-26 is served.
  - 364 genuine ERA5 reanalysis days were imported for the Sirsi grid; a re-run was idempotent.
- **Honest gaps:**
  - No arrival rows: AGMARKNET's API has no quantities and eNAM has no public API.
  - No district production records exist; state totals are never apportioned.
  - No IMD data: access needs a registered key and a whitelisted static IP.
  - No approved crop-risk rule, so no advisories are issued.
  - Production and arrival forecasts are suppressed by data-sufficiency gates.
- **Tests:** 22 new API tests. The full suite passes with 252 tests.

## AI Intelligence Assistant

See [`AI_ASSISTANT.md`](./AI_ASSISTANT.md).

- **Migration 0019:** adds `documents`, `document_chunks` (with optional BGE-M3 vectors), the derived FTS5 index `document_chunks_fts`, `assistant_interactions` (question text stored only when `ASSISTANT_LOG_QUESTIONS=true`) and `assistant_rate_limits` (salted client hash, hourly buckets).
- **API (`api/src/assistant/`):**
  - Modules: language detection, query classification, provider abstraction (Ollama, Workers AI, none), 14 validated tools, hybrid retrieval, a composer and grounding checks.
  - `POST /api/v1/assistant/query` and `GET /assistant/status` are public and rate limited. The `/admin/documents*` endpoints need the reviewer token.
  - Tools call existing ANI endpoints in-process and never query new data paths.
- **Guarantees:**
  - Every number comes from a tool result.
  - LLM text is rejected and replaced by a rule-based answer if it contains a number absent from the facts, cites an unknown label or lacks citations.
  - Prompt-injection patterns are flagged and neutralised in questions and retrieved text.
  - Forecasts appear only with their stored validation status and interval.
- **Frontend:** a new `/assistant` page.
  - Separates verified facts, interpretation, assumptions, uncertainty and missing data.
  - Lists sources with reporting dates and IST retrieval times.
  - Offers English, Kannada and auto language, plus a rules-only mode.
- **Documents:**
  - The Python ingester is `data-platform/documents`.
  - Locally ingested: 6 genuine documents (3 CPCRI, 3 DASD), 42 chunks, embedded with `bge-m3`.
  - PIB pages returned HTTP 403 and were not ingested.
- **Backups:** `npm run db:backup` now skips the FTS5 tables, because D1 cannot export virtual tables. They are listed in `excluded_tables`, and the index is rebuilt after restore through `/admin/documents/reindex`. A local backup and restore-check passed (65 tables).
- **Defaults:** `ASSISTANT_LLM_PROVIDER=none` and `ASSISTANT_EMBEDDING_PROVIDER=none`. The page then gives rule-based answers with keyword retrieval, and the rest of ANI never depends on the assistant.
- **Tests:** 40 API assistant tests (292 API tests in total) and 21 Python document tests (87 in total).

## Enterprise frontend refinement

The ANI identity is preserved: forest-green sidebar, neutral palette, typography and navigation order. Only one navigation item was added. Every panel reads existing ANI endpoints. Missing data is shown as an explicit empty state; nothing is interpolated or filled with placeholder values.

- **Shared building blocks:**
  - `frontend/src/services/insights.ts`: pure helpers for sorting with missing values last, IST date presets, reporting-date freshness, completeness, distribution statistics, histograms, year-by-month matrices, spreads, same-date ranking, observation quality checks and forecast validation status.
  - `components/InsightCharts.tsx`, loaded lazily through `LazyCharts.tsx`, so echarts stays out of the main bundle. Line, bar and ranked-range charts share one palette (`chartPalette.ts`).
  - `components/Scorecard.tsx`: `IntelligenceScorecard`, `StatusBadge` and `SourceLabel`.
  - `services/csv.ts` guards against spreadsheet formula injection. The browser download lives in `csvDownload.ts`.
- **Overview:** an intelligence scorecard with four items:
  - Data freshness, measured from the market reporting date (not the fetch time).
  - Reporting coverage.
  - Historical monthly completeness.
  - Forecast validation status.

  The cooperative overview also adds a branch coverage table and a benchmark methodology panel.
- **Market prices:**
  - Sortable columns. The official sort is server-side through a whitelisted `/prices?sort=&order=`; a custom sort combined with a cursor returns 400.
  - Server pagination, date presets, a searchable variety list, per-row quality indicators and price-basis labels.
  - CSV export of the current page. "Export all" is bounded to 5,000 rows, fetched in 1,000-row pages.
  - The cooperative view adds search, presets, sorting and CSV download.
- **Analytics:**
  - Market spreads (within-quote and cross-market or cross-branch).
  - Monthly insights: multi-year seasonal overlay, seasonal index, year-on-year change, rolling volatility and price distribution.
  - An arrival-versus-price panel that shows an explicit empty state when no paired records exist.
- **Market comparison:** a horizontal ranked chart showing minimum, average or modal, and maximum, restricted to one selected reporting date, with branch or market coverage counts.
- **Forecasting:**
  - `/forecasts` charts the actual backtest: actual versus last-value and seasonal-naive across validation and holdout months, the next-month interval, and per-month holdout absolute error. A status badge states when there is no skill over the benchmark.
  - `/forecasts/evaluation` adds pooled relative-MAE bars against the baseline (grey is the baseline, red is worse) and interval coverage versus the nominal 80%. Poor performance is labelled, not hidden.
- **Organization dashboard (`/workspace`):**
  - Profiles are created from role templates: grower, trader, cooperative or analyst.
  - Each profile has custom filters (source or price type, variety, reporting period) and selectable sections (scorecard, latest quotes, monthly insights, forecast status, filtered shortcuts).
  - Profiles are zod-validated and stored only in browser localStorage, with a maximum of 20. They hold no market data and are not shared between users or devices. Server-side organization accounts are not implemented.
- **Tests:** `api/src/frontend-insights.test.ts` adds 21 tests covering helpers, the CSV guard and workspace storage. The `/prices` sort is covered in `performance-archive.test.ts`.
- **Responsive check:** 11 routes were tested at 1440×900, 820×1180 and 390×844, across the official and cooperative feeds and the workspace. Every route had no horizontal overflow (`scrollWidth == innerWidth`), no error states and no console or page errors.
- **Local data limits:**
  - Official daily views are empty locally because no observations are reviewer-verified.
  - No arrival records exist, so arrival-price panels show their empty state.
  - Cooperative history is too short for seasonal analysis, which links to the official monthly series instead.

## Verification

- **Frontend refinement (latest):** frontend and API `tsc --noEmit` are clean; 314 API tests pass in 22 files; 87 Python tests pass; `npm run build` passes. The responsive browser sweep is described above.

- **AI assistant:**
  - API `tsc --noEmit` is clean; 292 API tests pass in 21 files; 87 Python tests pass; `npm run build` passes.
  - Browser check against local Ollama `qwen3.5:4b`: the Mahali question returned an LLM explanation that passed grounding, with citations [D1]–[D4]. The Rashi price question returned the rule-based facts table with the source and reporting date.
- `npm ci`: passed; npm reported zero known vulnerabilities for the installed
  lockfile at the time of this audit.
- `npm run build`: passed frontend build and API typecheck. Vite reports the
  lazy chart chunk is over 500 kB minified.
- `npm test`: passed **139 tests** across 11 files, including API handlers,
  date parsing, timezone-independent formatting, IST year/month boundaries,
  sparse chart preparation, benchmark coverage/source/variety guards and
  read-only historical evidence/mismatch handling.
- Python 3.12.15: **17 existing ingestion tests passed** with
  `.venv/bin/python -m pytest -q tests/data`. An ignored isolated environment
  was created after the selected interpreter lacked pytest.
- Browser checks against current code confirmed distinct multi-year ticks
  (`1 Jan 2021` through `1 Jan 2026`), 70 actual monthly markers,
  `connectNulls: false`, the January anomaly evidence/IST fetch display,
  a sparse MAMCOS benchmark with 3 observations and 1 missing calendar date,
  Karnataka's default/reset and retained All India records, and experimental
  forecast disclosures with an explicitly labelled IST execution time.
- No historical records were modified, deleted or added. No local migration,
  source refresh/import, forecast evaluation or Cloudflare deployment was
  executed. Synthetic test fixtures use isolated in-memory databases only.

- AGMARKNET daily connector:
  - `npm test` passed **141 tests**.
  - pytest passed **34 tests**, including 17 new connector unit tests. These use a fake HTTP opener and are not evidence of live integration.
  - `npm run build` and `git diff --check` passed.
  - Migration 0012 was applied to local D1 only.
  - The live run is described above. A browser check confirmed the Data-source status panel and the IST fetch times.

- Cooperative sources (MAMCOS, TSS, TUMCOS):
  - `npm test` passed **181 tests** in 16 files.
  - API and frontend `tsc` and `npm run build` passed.
  - pytest passed **34**.
  - Migration 0013 was applied to local D1 only.
  - Live local runs:
    - MAMCOS: 41 rows.
    - TUMCOS: 21 in-scope records, all unit-conflict; a repeat fetch inserted 0.
    - TSS 2026-11-04 with lots: 9 quotations and 240 lot rows aggregated.
  - Public TSS and TUMCOS feeds correctly return no published rows, with the blocked reason shown.
  - Migration 0013 converted 26 earlier TSS approvals to `accepted_unit_unconfirmed`, so they are no longer published.
  - Black-pepper rows are excluded from the arecanut decision tools and history aggregates; a regression test covers this.
  - Details: [COOPERATIVE_SOURCES.md](./COOPERATIVE_SOURCES.md).

- Multi-commodity domain model:
  - `npm test` passed **202 tests** in 17 files, including 21 new commodity tests. They cover mappings, filters, grade isolation, units, a 0013→0014 upgrade that preserves rows, basis immutability and HTTP scoping.
  - API and frontend `tsc`, `npm run build` and pytest (34) passed.
  - Migration 0014 was applied to local D1 only. Existing rows are identical apart from the added `price_basis`:
    - 46 daily `APMC_MODAL`;
    - 47 MAMCOS and 21 TUMCOS `COOPERATIVE_AVERAGE`;
    - 35 TSS `COOPERATIVE_TENDER_AVERAGE`;
    - 1,526 monthly rows with an unchanged price sum.
  - The admin validation endpoint returned `ok: true`.
  - Browser check:
    - Arecanut pages are unchanged.
    - Black pepper shows only the unpublished TUMCOS feed.
    - Coffee shows its configured profile.
    - Nav links keep the selected commodity, and the Prices grade filter lists the source grades.

- D1 performance, R2 archive and data retention:
  - `npm test` passed **222 tests** in 18 files, including 20 new performance and archive tests. They cover:
    - summary-cache equivalence after reject, correction and mapping changes;
    - cursor pagination;
    - a ten-year range in under 5 s cold and 1 s warm, with 120 monthly points;
    - `EXPLAIN QUERY PLAN` with no full scans;
    - retention guards;
    - R2 behaviour without a binding, idempotent upload, hash mismatch, missing object, offload and fallback, and temporary-object purge;
    - import idempotency and reprocessing;
    - logging of maintenance errors;
    - restore-check failure modes.
  - API and frontend `tsc`, `npm run build` and pytest (46) passed.
  - Migrations 0015 and 0016 were applied to local D1 only. The local backup and restore-check passed: 43 tables, 4,197 rows.
  - Live local check:
    - `/prices` returns a cursor page.
    - `/charts/reference` rejects spans over 3,660 days.
    - `/cooperative/prices` returns a 366-day window with 12 branches.
    - `/admin/storage/status` returns 401 without a token. With a token it reports `r2_configured: false` and about 3.9 MB of inline evidence.
    - The cooperative page shows the reporting window.
  - `market_daily_summaries` is empty locally because no local daily rows are reviewer-verified.

## Not ready / outstanding

0. **AI assistant:**
   - Apply migration 0019 to production and ingest the document corpus there.
   - Configure the Workers AI `[ai]` binding, or an Ollama endpoint, for a deployed LLM. Workers AI has not been tested end to end.
   - Kannada output from the 4B model is weaker than English. Kannada retrieval relies mainly on keyword matching.
   - PIB notifications need manually saved, authorized copies (HTTP 403).
   - The tools cover arecanut only.
   - The rate limit is per salted client hash, not per user identity.

0. **Supply and risk:** these items need external action:
   - Import authorized arrival files (AGMARKNET or eNAM).
   - Obtain IMD API access through a static-IP relay, or file imports.
   - Have a qualified agronomist review the crop-risk rules and supply thresholds and guidance.
   - Apply migration 0018 to production.

1. **Production deployment:** `api/wrangler.toml` still has a placeholder D1
   ID and localhost-only CORS. The workflow correctly blocks deployment until
   production configuration and secrets are provided.
2. **Official daily feed:** the live daily connector is verified locally.
   Outstanding items:
   - Run it against production D1 after migration 0012.
   - Configure the workflow's variables and secrets.
   - Obtain publisher confirmation of the price unit.
   - Durably archive the raw pages, because GitHub artifacts expire after 90 days.
   - Decide whether reference-index selection should be grade-aware.
3. **Data normalization:** `Grade` is currently accepted as a `variety` alias
   in the Python normalizer; see finding F-01 in the audit.
4. **Canonical taxonomy:** market/variety alias tables exist without a
   reviewer-managed mapping workflow; see F-04.
5. **Daily provenance:** publication date and original unit are now surfaced.
   Connector-imported rows also retain the source resource ID, the platform
   fetch timestamp and the source update timestamp (on the run record).
   CSV-imported rows still lack fetch timestamps. Confirm publisher semantics before extending ingestion; F-03
   is partially addressed, not closed.
6. **Access isolation:** shared admin tokens do not provide individual
   identity or saved-scenario ownership; see F-05.
7. **Capacity/operations:** read routes are now bounded and cached, and the
   evidence archive and backups exist (F-07 and F-08 reduced). Outstanding:
   - Provision R2 when D1 size requires it.
   - Hash legacy pre-0015 snapshots before they can be offloaded.
   - Apply migrations 0015 and 0016 to production.
   - Run a remote export and Time Travel restore drill.
   - Measure production Worker CPU and D1 usage (F-11).
8. **Automated frontend regression tests:** date/chart-data helpers run in CI
   through the API Vitest suite; component/browser checks are not automated
   in CI. F-09 remains partially outstanding.
9. **Forecast operations:** stale snapshots require explicit re-evaluation;
   see F-14.
   - The forecasting engine has not been published to production D1.
   - Prospective validation needs future monthly outcomes.
   - Strict-vintage backtests need accumulated `monthly_price_versions` captures.
   - Exogenous features need as-of archives.
10. **Publisher permissions and plan limits:** confirm collection,
    redistribution and current Cloudflare limits before production use.
    No MAMCOS, TSS or TUMCOS permission is recorded, so scheduled
    cooperative collection stays blocked. TSS and TUMCOS stay unpublished
    until their units are confirmed.
11. **Ingestion and CI hardening:** add request-size/rate boundaries and pin
     GitHub Actions to immutable commits; see F-16 and F-17 in the audit.
12. **Multi-commodity follow-ups:**
    - Compound MAMCOS labels (e.g. `HASA`, `NEWRASHIEDI`) are not mapped to canonical varieties and need reviewer decisions.
    - Non-arecanut varieties and grades are unverified until a source is integrated.
    - Some arecanut-only pages (decision tools, history, forecasts, intelligence) still contain arecanut wording. They are only reachable for arecanut because of the capability gate.
    - The Python ingestion path has no commodity configuration yet.
    - Migration 0014 has not been applied to production D1.

P0 correctness improvements are implemented without changing the React/Vite,
Hono/Worker/D1 architecture or the visual theme. Remaining audit findings are
not implicitly authorized by this implementation task.
