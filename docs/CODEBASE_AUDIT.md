# Arecanut Intelligence (ANI) — Codebase Audit

**Audit date:** 2026-11-04
**Scope:** Repository source, tracked configuration, migrations, tests and
documentation. This is a static code audit plus local build/API-test
verification, not a production penetration test, source-access certification,
or Cloudflare deployment test.

## Executive summary

ANI has a clear source boundary for the three price feeds in question:

- **AGMARKNET daily observations** (CSV or configured data.gov.in API) are
  stored in `market_price_observations`, reviewed, and used by official modal
  price screens and the exact-variety market reference index.
- **AGMARKNET monthly reports** are stored separately in
  `monthly_variety_prices` and `monthly_price_versions`. They represent
  state/variety arrival-weighted aggregates, not daily market quotes, and are
  not used in the daily index.
- **MAMCOS and TSS** are stored separately in `cooperative_quotes`, keyed by
  `source_key`. They are reported averages, not modal prices. TSS rows are
  constrained to `unit_status='assumed'`; the cooperative benchmark excludes
  assumed-unit rows. Users can select either cooperative feed, but they are
  not blended together or into AGMARKNET analytics.

This separation is implemented in schema, API query filters, and UI
disclosures. A remaining ingestion-boundary exception is that the AGMARKNET
API and CSV connectors use distinct source keys, so a semantically identical
record arriving through both paths can coexist and the daily per-market
calculation then chooses the most recently ingested row.

The principal data correctness risk is the Python normalizer treating a
`Grade` column as a variety name. Other material gaps are incomplete daily
publication/source provenance in public price responses, no explicit
market/variety alias workflow, shared-token rather than user-scoped
authorization, unbounded historical reads and retained captures, and a
production configuration that intentionally cannot deploy yet.

## Repository structure

```text
.
├── .env.example
├── .github/
│   ├── dependabot.yml
│   └── workflows/
│       ├── agmarknet-ingestion.yml
│       ├── ci.yml
│       └── deploy-cloudflare.yml
├── .gitignore
├── .nvmrc
├── README.md
├── package.json
├── package-lock.json
├── api/
│   ├── .dev.vars.example
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── wrangler.toml
│   ├── migrations/
│   │   ├── 0001_market_data.sql
│   │   ├── 0002_source_correction_history.sql
│   │   ├── 0003_monthly_prices.sql
│   │   ├── 0004_daily_integrity.sql
│   │   ├── 0005_cooperative_quotes.sql
│   │   ├── 0006_cooperative_publication_guards.sql
│   │   ├── 0007_tss_unit_assumptions.sql
│   │   ├── 0008_history_and_calculations.sql
│   │   ├── 0009_independent_intelligence.sql
│   │   ├── 0010_evaluated_forecasts.sql
│   │   └── 0011_trade_direction.sql
│   └── src/
│       ├── index.ts
│       ├── cooperative-routes.ts
│       ├── cooperative.ts
│       ├── tss.ts
│       ├── monthly.ts
│       ├── history.ts
│       ├── decisions.ts
│       ├── forecast.ts
│       ├── intelligence-routes.ts
│       ├── intelligence-sources.ts
│       ├── cooperative.test.ts
│       ├── daily-integrity.test.ts
│       ├── decisions.test.ts
│       ├── forecast.test.ts
│       ├── history.test.ts
│       ├── intelligence-sources.test.ts
│       ├── monthly-routes.test.ts
│       ├── monthly.test.ts
│       ├── tss.test.ts
│       ├── domain/
│       │   ├── analytics.ts
│       │   └── analytics.test.ts
├── data-platform/
│   ├── requirements.txt
│   ├── connectors/
│   │   ├── __init__.py
│   │   └── agmarknet/
│   │       ├── __init__.py
│   │       ├── fetch_api.py
│   │       └── normalize.py
│   └── ingestion/
│       ├── __init__.py
│       └── import_csv.py
├── docs/
│   ├── CODEBASE_AUDIT.md
│   ├── IMPLEMENTATION_ROADMAP.md
│   └── IMPLEMENTATION_STATUS.md
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── app/App.tsx
│       ├── components/
│       │   ├── AppShell.tsx
│       │   ├── CooperativeReview.tsx
│       │   ├── PriceChart.tsx
│       │   └── State.tsx
│       ├── pages/
│       │   ├── AnalyticsPage.tsx
│       │   ├── ComparePage.tsx
│       │   ├── CooperativeMarketPage.tsx
│       │   ├── DataQualityPage.tsx
│       │   ├── DecisionToolsPage.tsx
│       │   ├── ForecastsPage.tsx
│       │   ├── HistoricalAnalyticsPage.tsx
│       │   ├── IntelligencePage.tsx
│       │   ├── MonthlyTrendsPage.tsx
│       │   ├── OverviewPage.tsx
│       │   ├── PricesPage.tsx
│       │   └── QualityInspectionsPage.tsx
│       ├── services/
│       │   ├── api.ts
│       │   ├── cooperative.ts
│       │   ├── csv.ts
│       │   ├── intelligence.ts
│       │   └── modules.ts
│       ├── types.ts
│       ├── responsive.css
│       └── styles.css
├── scripts/
│   ├── backfill-monthly.mjs
│   ├── evaluate-forecasts.mjs
│   └── refresh-intelligence.mjs
└── tests/
    └── data/
        ├── test_agmarknet_normalize.py
        └── test_daily_ingestion.py
```

The workspace also contained ignored Wrangler state and a local
`api/.dev.vars` file. Their contents and local database were not inspected.
Generated state is not part of the tracked application structure.

## Frontend routes and behavior

`frontend/src/app/App.tsx` maps:

| Route | Implementation |
|---|---|
| `/` | Cooperative market overview by default; `?feed=official` selects official AGMARKNET daily view |
| `/prices` | Source-specific quote/observation explorer |
| `/analytics` | Cooperative analytics by default; `?feed=official` selects daily official analytics |
| `/compare` | Source-specific market/branch comparison |
| `/monthly-trends` | Official monthly reports and manual refresh |
| `/history` | Monthly history/statistics plus captured cooperative daily aggregation |
| `/decision-tools` | User-input realization, profitability and hold calculations |
| `/intelligence/:domain` | Production, trade, weather, news and policy records |
| `/intelligence/quality` | Lot inspection reports |
| `/forecasts` | Evaluated monthly baseline snapshots |
| `/data-quality` | Official observation and cooperative review queues |

Pages are lazy-loaded, and loading/error/empty states are generally explicit.
There is no frontend unit/component or automated browser test runner in the
workspace. The chart chunk remains 539.35 kB minified (183.51 kB gzip) and
triggers Vite's 500 kB chunk warning; it is lazy-loaded rather than included
in the initial application chunk.

## API endpoint inventory

All Worker routes are under `/api/v1`.

- **Core daily data (`api/src/index.ts`):** `GET /health`, `/markets`,
  `/varieties`, `/prices`, `/overview`, `/analytics/reference-index`,
  `/analytics/market-comparison`; authenticated `GET /admin/quality`,
  `POST /admin/import`, `POST /admin/observations/:id/review`.
- **Monthly (`index.ts`, `monthly.ts`):** `GET /monthly-prices`,
  authenticated `POST /admin/monthly/refresh`.
- **Cooperative (`cooperative-routes.ts`):** `GET /cooperative/prices`,
  authenticated queue/review, MAMCOS refresh, and date-specific TSS refresh.
- **History (`history.ts`):** `GET /history/monthly`,
  `/history/monthly/snapshots/:id`, `/history/aggregates`.
- **Decisions (`decisions.ts`):** `GET /decisions/prices`,
  `POST /decisions/calculate`, authenticated save/list endpoints.
- **Intelligence (`intelligence-routes.ts`):** public domain/capture reads;
  reviewer-protected DASD import, weather/news refresh and quality report
  submission/review.
- **Forecast (`forecast.ts`):** `GET /forecasts` and reviewer-protected
  `POST /admin/forecasts/evaluate`.

The API uses Hono, Zod, D1 prepared statements/batches and route-specific
validation. Core daily data access still lives in the large `index.ts` module;
other domains are split into route modules but do not use a distinct
repository/data-access layer.

## Database and migration model

Migrations `0001`–`0004` define geography/source catalogs,
`market_price_observations`, ingestion jobs/logs, source record versions,
review events, publication invariants and indexes. Migrations `0005`–`0007`
add separate cooperative fetch/quote/review tables and preserve TSS's
assumed-unit status. Migration `0008` adds monthly report versions and saved
decision snapshots. Migration `0009` adds immutable intelligence captures,
production/trade/weather/bulletin and quality-inspection records.
Migrations `0010` and `0011` add immutable forecast snapshots and trade
direction.

Foreign keys, uniqueness constraints, status checks, and triggers protect
several important invariants. Daily source versions are unique per source
record; cooperative current rows are unique per source/branch/date/variety.
The migration set is comprehensive for current features but is entirely
forward-only; production migration execution and rollback/recovery have not
been exercised in a Cloudflare account.

## Price basis, unit, date and provenance audit

| Feed | Stored price basis and unit | Market/reporting date | Publication/fetch date | Provenance and analytics boundary |
|---|---|---|---|---|
| AGMARKNET daily CSV/API | Min/max/modal standardized to `INR/quintal`; explicit `INR/kg` is multiplied by 100. Original unit and arrival unit are retained. | `reporting_date` is the source arrival/report date. | Optional `publication_date` is parsed and stored; `ingested_at` is set in D1. | Source key, record ID, raw payload and job are stored. Daily public responses expose source name/record ID/ingestion time but omit publication date, original unit, raw evidence and a source URL. |
| AGMARKNET monthly CSV | State/variety arrival-weighted modal price; `INR/quintal`. A source dash is NULL. | `reporting_month` is the requested report period. | Successful `fetched_at`, `finished_at`, source URL and original CSV are stored separately. | Independent monthly current/version tables and history/forecast routes; not daily market data. |
| MAMCOS | Minimum/maximum/reported average; explicit source declaration parsed as `INR/quintal`. Average is not renamed modal price. | Per-row `reporting_date` from the source. | `fetched_at` and source URL retained; source does not yield a separate publication date in this parser. | Separate cooperative table, source key and raw row/snapshot; approval queue and exports retain source semantics. |
| TSS | Minimum/maximum/`avgrate`; `norrate` is separate. `INR/quintal` is explicitly **assumed**, not publisher-confirmed. | Requested date must match source `date1`. | Fetch timestamp and source URL are stored; no separate publisher publication date. | Separate source key and raw row. Database triggers prevent relabeling as confirmed; assumed-unit data is excluded from the unit-confirmed cooperative benchmark. |
| Other intelligence | Production, trade, weather and quality use domain-specific units/fields, not price observations. | Annual/report/day/sample dates are distinct fields. | Captures store source URL, fetch time and publication period/date where parsed. | Separate capture/domain tables; no join into price indices or forecasts. |

### Source-separation conclusion

No query found that blends MAMCOS or TSS rows into `market_price_observations`
or the official daily reference index. `cooperative/prices` filters by a
single `source_key`; decision-tool prices are explicit source selections; the
history aggregation accepts one source per request. TSS's assumed-unit status
is carried through its endpoint, exports and decision snapshots.

The exact-variety daily index is the median of one verified modal price per
market per reporting date, with configurable minimum market coverage. The
monthly report's weighted average is not used as a daily index. Cooperative
branch medians are separate and use reported averages, with branch count and
constituents disclosed.

## Findings

Severity is based on demonstrated code behavior and likely business impact,
not on an assumed live dataset. Each entry names a location/module, problem,
impact and correction.

| ID | Severity | File / function or module | Problem | Business impact | Recommended correction |
|---|---|---|---|---|---|
| F-01 | **HIGH** | `data-platform/connectors/agmarknet/normalize.py` — `FIELD_ALIASES`, `_value`, `normalize_record` | The `variety` aliases include `grade`. If a daily CSV has a distinct market grade column and no variety column, that grade is accepted as the variety and published as the reported variety. | A grade can be treated as a market variety, splitting or mislabeling a price series and affecting variety comparison/index coverage. | Remove `grade` as an implicit variety alias. Model grade separately; reject rows with no explicit variety unless a documented source-specific mapping is configured. Add regression tests for CSVs containing both fields and grade-only rows. |
| F-02 | **MEDIUM** | `api/migrations/0001_market_data.sql` — `data_sources`; `data-platform/connectors/agmarknet/normalize.py` — `source_key`; `api/src/index.ts` — `verifiedObservations`, `buildReferenceSeries` call | `agmarknet` and `agmarknet_csv` have distinct source IDs and uniqueness scopes. The index deduplicates by market/date, selecting whichever record has the later ingestion timestamp; it does not reconcile conflicting rows across intake paths. | Re-importing the same official quote through API and CSV can change which source record represents that market/date and can change the price/provenance without an explicit conflict decision. | Establish a canonical cross-ingress observation identity and conflict policy. Preserve both raw sources but flag cross-source duplicate/conflict cases for review rather than silently selecting the newest import. |
| F-03 | **MEDIUM** | `api/src/index.ts` — `priceRecordSchema`, `/prices`, `verifiedObservations`, `/admin/quality`; `frontend/src/pages/PricesPage.tsx`, `OverviewPage.tsx` | Daily `publication_date` is optional and only checked for date syntax. It is not checked against the current date and is omitted from review/public price reads. The public view also omits daily source URL and original unit. | Reviewers and users can see the market reporting date and import timestamp, but cannot distinguish publisher publication timing or independently inspect the exact source record after approval. This weakens freshness and provenance checks. | Validate publication-date rules when the publisher's semantics are documented; include publication date, original unit, and stable source evidence/URL in review and public responses, with separate UI labels for reporting, publication, and ingestion times. |
| F-04 | **MEDIUM** | `api/migrations/0001_market_data.sql` — `varieties`, `variety_aliases`, `markets.mapping_status`; `api/src/index.ts` — `/admin/observations/:id/review`; `normalize.py` — deterministic market ID | Alias/reference tables exist, but no API/UI manages aliases or independently reconciles market/variety identities. A source row is keyed from normalized source labels, and approving an observation also marks its market mapping verified. | Spelling or taxonomy variants remain separate market/variety categories, lowering coverage and making comparisons incomplete. The current review workflow has no distinct canonical-mapping decision. | Add a reviewer-controlled mapping surface with immutable original labels, canonical targets, source-specific aliases, audit history and explicit mapping status. Do not auto-merge labels based only on approximate text. |
| F-05 | **MEDIUM** | `api/.dev.vars.example`; `api/src/index.ts` — `isAuthorized`; `api/src/cooperative-routes.ts`, `api/src/decisions.ts`, `api/src/intelligence-routes.ts`; `frontend/src/pages/DataQualityPage.tsx` | Admin/reviewer access is a shared static token. Saved decision scenarios and quality workflows are shared at the token boundary, and the data-quality page stores the token in browser `sessionStorage`. There is no per-user identity, role or record ownership. | Anyone holding the shared token can perform reviewer/admin operations and read all saved scenarios; activity cannot be attributed to an individual. Browser script compromise would expose the session token. | Before multi-user production, introduce identity-based authentication and role checks, scope private records by principal, audit actor IDs, define token rotation/revocation, and avoid using a shared reviewer secret as user privacy isolation. |
| F-06 | **HIGH** | `api/wrangler.toml`; `.github/workflows/deploy-cloudflare.yml` — production configuration validation | D1 `database_id` is the all-zero placeholder. `CORS_ORIGIN` contains only localhost origins. The deployment workflow explicitly rejects both placeholder D1 ID and absence of an HTTPS origin. | Production Worker deployment is intentionally blocked; a live frontend origin also cannot call the API under the checked-in CORS setting. | Keep deploy gated. Before enabling it, provision the real D1 database, configure production HTTPS origins and secrets/vars, apply migrations remotely, then run a staged health/read/write smoke test. |
| F-07 | **MEDIUM** | `api/migrations/0003_monthly_prices.sql`, `0005_cooperative_quotes.sql`, `0009_independent_intelligence.sql`; `api/src/monthly.ts`, `cooperative.ts`, `intelligence-routes.ts` | Successful monthly runs retain the full CSV; cooperative runs retain raw snapshots; intelligence captures retain raw payloads and extraction data. Captures/versions are append-only and no retention, archival, size accounting or pruning policy is implemented. | Storage grows with every source refresh. The free D1 database ceiling is 500 MB, so future ingestion could consume capacity and block writes; deleting data ad hoc would also undermine auditability. | Measure current and projected growth; define retention by data class. Keep immutable evidence in appropriate object storage where needed, retain compact D1 metadata/hashes, and add quota monitoring and threshold alerts before any retention action. |
| F-08 | **MEDIUM** | `api/src/index.ts` — `verifiedObservations`, `/analytics/reference-index`, `/overview`, `/analytics/market-comparison`; `api/src/decisions.ts` — `/decisions/prices` | Several read paths materialize the full matching verified history or all published price references before calculating/returning results. Some daily routes have pagination, but the index and latest-per-market comparison do not impose a date window or result bound. | Latency, memory and D1 result size grow with history; the Worker can fail rather than respond as volume increases. `market-comparison` must rank the entire source history to find each market's latest row. | Move aggregation/latest-row selection into indexed SQL where possible, define supported date windows, paginate high-cardinality lists, and measure result/CPU budgets. Preserve explicit failure rather than silently returning partial analytics. |
| F-09 | **MEDIUM** | `frontend/package.json`; `.github/workflows/ci.yml` | CI builds/types the frontend and tests API/Python, but there is no frontend unit/component or automated browser regression suite. Recorded UI viewport checks in implementation notes are manual smoke tests, not CI tests. | Route behavior, source labels, provenance displays, filters and responsive states can regress without an automated signal. | Add focused tests for source selector defaults, basis/unit/date labels, cooperative-versus-official separation and representative error/empty states; add a small browser smoke suite for the critical review and price-selection flows. |
| F-10 | **HIGH** | `data-platform/connectors/agmarknet/fetch_api.py`; `.github/workflows/agmarknet-ingestion.yml`; `.env.example`; `README.md` daily-source notes | The daily connector is generic and requires a configured authorized data.gov.in resource ID, API key and unit. No actual resource is supplied by the repository. The workflow is skipped without configuration; the documented official daily endpoint required CAPTCHA/token access during prior source investigation. | The code supports normalization/import but does not establish a working official daily source-to-screen pipeline. Daily APMC coverage cannot be considered operational from the presence of the connector alone. | Obtain authorized feed/export and terms, validate its exact schema/unit/date semantics with a real source fixture, configure the resource securely, and prove a complete observation through review and public UI before declaring the requirement met. Do not bypass CAPTCHA or infer a resource ID. |
| F-11 | **MEDIUM** | `api/src/index.ts` — scheduled handler; `api/src/monthly.ts`, `cooperative.ts`, `intelligence-routes.ts`; `api/wrangler.toml` | Free-tier fit has not been measured. Official limits include 10 ms Worker CPU per HTTP/Cron invocation, 100,000 requests/day, 50 D1 query API calls per Worker invocation, 500 MB per free D1 database, and a 50 MB D1 query-result ceiling effective 2026-11-04. The daily cron parses reports and may run monthly, MAMCOS and intelligence refreshes; no production CPU/storage traces are available. | A deployment may be functionally correct yet exceed free account limits as data or refresh work grows. The present code gives no evidence that production peak resource use remains within those ceilings. | Run representative source-size and worst-case migration/refresh tests, inspect Worker CPU and D1 usage, and document an operational budget. Split/offload large parsing or archive payloads if measurements exceed limits. Recheck vendor limits at deployment. |
| F-12 | **MEDIUM** | `api/src/cooperative.ts` — `parseMamcos`; `api/src/tss.ts` — `parseTss`; `api/src/monthly.ts` — `parseMonthlyReport`; `api/src/intelligence-sources.ts` — source parsers | Parsers intentionally depend on publisher-specific HTML/Livewire structure, JSON keys, exact report headings and PDF text positions. They fail closed on detected drift, but no live contract monitoring or upstream schema/version negotiation is present. | Publisher markup changes can stop ingestion; if a change remains superficially parseable, the connector may need new reviewed fixtures before safely resuming. | Keep fail-closed validation; record sanitized source fixtures with provenance, alert on failed scheduled refreshes, and require source-format review plus regression fixtures before parser updates. Prefer stable documented APIs/exports where authorized. |
| F-13 | **LOW** | `data-platform/connectors/agmarknet/normalize.py` — `normalize_record` | If both price range and future-date checks fail, the later future-date branch replaces the earlier validation message instead of retaining both findings. | The reviewer receives incomplete diagnostic context, although the row remains `review_required` and cannot bypass server-side future-date/range checks. | Accumulate validation messages and add a test with both errors present. Keep the existing status and publication guards. |
| F-14 | **MEDIUM** | `api/src/forecast.ts` — `/admin/forecasts/evaluate`; `api/src/index.ts` — `scheduled`; `scripts/evaluate-forecasts.mjs` | Forecast evaluations are explicit reviewer actions/local script runs; the daily scheduled handler refreshes source data but does not evaluate baselines. | After a new completed month arrives, a prior snapshot becomes stale until an operator evaluates it; the forecast page can remain unavailable despite adequate current data. | After confirming publication policy and operational cost, add a separately observable scheduled evaluation or a reviewed post-refresh workflow. Preserve immutable snapshots and do not auto-publish without existing gates. |
| F-15 | **LOW** | `frontend/src/components/PriceChart.tsx`; `frontend/package.json` | The charting chunk is 539.35 kB minified and Vite reports it over the configured default warning threshold. | Slower first use of chart views on constrained networks; it is not an initial-route bundle regression because the chart is lazy-loaded. | Profile real route usage and consider a smaller chart bundle or finer chart splitting if measured loading performance warrants it. |
| F-16 | **MEDIUM** | `api/src/index.ts` — `POST /admin/import`; `.github/workflows/agmarknet-ingestion.yml` | The handler materializes request JSON before Zod validation. It allows up to 500 records with raw payloads up to 20,000 characters each, but has no application-level request-body ceiling or rate limit. | A compromised ingestion credential or accidental oversized request can consume Worker memory/CPU and D1 writes before record validation rejects it. | Enforce a request-body ceiling before JSON parsing and configure edge rate limits. Retain record-level validation and batch writes after the boundary check; test oversized and burst requests. |
| F-17 | **LOW** | `.github/workflows/ci.yml`, `deploy-cloudflare.yml`, `agmarknet-ingestion.yml` — `uses:` actions | GitHub Actions dependencies are referenced by mutable major tags (`@v4`, `@v5`) rather than immutable commit SHAs. Dependabot is configured, but action references are not SHA-pinned. | A tag update can change the action implementation between otherwise identical workflow runs, increasing CI/deployment supply-chain drift. | Pin actions to verified commit SHAs and retain Dependabot updates for the pinned references. |

Cloudflare plan limits in F-07 and F-11 were checked against the official
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
(last updated 2026-10-29) and
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
(last updated 2026-10-30), accessed 2026-11-04. The documented 50 MB D1
query-result ceiling takes effect 2026-11-04. Recheck limits before deployment.

## Hardcoded assumptions and external dependencies

**Configuration/domain assumptions visible in code:** Karnataka is the reference
state in Wrangler configuration and forecast scope; the official monthly
connector uses AGMARKNET commodity code `118`; monthly history starts no earlier
than 2010 while the forecast input starts in 2021; the default minimum daily
market coverage is three; weather is a Sirsi grid point; TSS supports only
three locations and six exact item labels. These choices are explicit in code
and/or UI disclosures, but broader geography/taxonomy requires configuration
and new validation rather than simply adding data.

**External runtime/source dependencies:** Cloudflare Workers, D1 and Wrangler;
GitHub Actions; AGMARKNET monthly CSV and optional data.gov.in API; MAMCOS
published HTML; TSS JSON API; DASD PDF/announcement pages; PIB HTML releases;
Open-Meteo weather endpoint. Publisher terms, endpoint stability, quotas and
commercial redistribution rights are not established by code. `pdfjs-dist`
is used by the local PDF extraction script; frontend ECharts is the largest
browser dependency. npm dependency scanning during `npm ci` reported zero
known vulnerabilities for the lockfile at audit time; this does not certify
runtime configuration or third-party source terms.

## Security review observations

No arbitrary caller-controlled URL is passed to the source fetchers: source
URLs are fixed/configured, and relevant request fields are schema-validated.
Prepared SQL statements are used for dynamic values. Admin/ingestion endpoints
require separate configured secrets, and secret files are ignored by Git.
These are positive controls, not a substitute for a production security test.

Actionable security concerns are tracked in findings F-05, F-06, F-16 and
F-17. These findings do not establish that the shared credentials have been
compromised or that workflows have been tampered with.

## Testing and verification performed

- `npm ci`: completed; the lockfile installed and npm reported zero known
  vulnerabilities at that time.
- `npm run build`: passed frontend TypeScript/Vite build and API typecheck.
  Vite emitted the existing >500 kB chart-chunk warning.
- `npm test`: passed all 122 tests across 10 API test files.
- The Python CI job is configured for Python 3.12 and runs `pytest` on
  `tests/data`. It was not rerun in this audit: the editor reported no selected
  project Python environment, and the only installed framework interpreter
  located was Python 3.16. No Python implementation changes were made.
- No local D1 migration was applied during this audit; no production account,
  credentials, external source feed, or deployment was exercised.

Coverage is strongest for API/domain parsing, migration-backed daily handlers,
source corrections/reviews, monthly history, forecasts and calculations.
Gaps include frontend automated tests, live connector contract tests, production
Cloudflare resource/limit verification, and end-to-end checks for the
configured official daily feed.

## Deployment readiness

**Not deployable as checked in.** The deployment workflow is manually
dispatched and gated, which is appropriate for the current state, but it will
reject the all-zero D1 identifier and the lack of a production HTTPS CORS
origin. It also requires Cloudflare account/token secrets, a production D1
database, Worker secrets and Pages variables if Pages is desired. Scheduled
AGMARKNET ingestion is separately opt-in and requires an authorized resource,
API key, ingestion token and verified unit. No production migration/deploy
smoke test has been performed.

## Duplicate, incomplete and intentionally separate functionality

- No implementation was found that combines MAMCOS/TSS averages with official
  AGMARKNET modal prices or AGMARKNET monthly weighted prices.
- Daily official index, cooperative branch benchmark, monthly trends/history,
  and decision calculations have adjacent UI concepts but distinct input
  bases and disclosed methodologies; they are not duplicate calculations.
- Repeated date-validation helpers exist in source modules; the more material
  correctness issue is their separate reporting/publication/fetch semantics,
  not the presence of helper duplication itself.
- Missing/unfinished scope: authorized official daily source access;
  market/variety canonical mapping management; individual user identities and
  data isolation; automated frontend/E2E tests; forecast scheduling; and
  production Cloudflare configuration/validation.

## Recommended implementation sequence

The regression-minimizing sequence is detailed in
[`IMPLEMENTATION_ROADMAP.md`](./IMPLEMENTATION_ROADMAP.md). In brief: first fix
normalization identity and cross-ingress conflict behavior with fixtures;
then complete date/provenance and mapping boundaries; introduce user-scoped
authorization as a deliberate migration; establish API/storage/resource
budgets; add UI regression coverage; only then configure and canary deployment.
Keep monthly, daily official, MAMCOS, TSS and independent intelligence
pipelines separate throughout.

## Addendum: AGMARKNET daily connector implementation (2026-11-04)

These findings were identified while implementing
[`AGMARKNET_DAILY_CONNECTOR.md`](./AGMARKNET_DAILY_CONNECTOR.md). The
original audit findings above are unchanged.

| ID | Severity | Location | Problem | Business impact | Recommended correction |
|---|---|---|---|---|---|
| F-18 | **MEDIUM** | `data-platform/ingestion/import_csv.py` — `send_records`; used by `connectors/agmarknet/fetch_api.py` and the CSV importer | Posts 200 records per `/admin/import` request. The import handler prepares several D1 statements per record. | On Workers Free, a large request can exceed the per-invocation D1 query limit and fail the whole batch. The daily connector avoids this with a default batch of 10, and the scheduled workflow now uses it. Measure the actual limit, including how `batch()` statements are counted, against current Cloudflare documentation. | Make the batch size configurable in `send_records` and default it to a measured safe value. |
| F-19 | **LOW** | `api/src/domain/analytics.ts` — `buildReferenceSeries` | Keeps one observation per market and date by latest ingestion time, regardless of `grade`. If a market reports two grades of one variety on one date, the choice depends on order. | Not observed in the 4 Nov 2026 Karnataka snapshot, where no market had two grades for one variety on one date. If it occurs, the index input could vary by grade. | Decide on a reviewed methodology, such as a grade filter, a grade-specific index or a reviewer-selected grade. Do not change it silently. |
| F-20 | **INFO** | data.gov.in resource `9ef84268-…` | Current-day only: `filters[arrival_date]` is ignored. There are no unit, arrival-quantity, record-ID or publication fields. | Missed days cannot be recovered from this resource, and the unit rests on operator confirmation. | Schedule capture, durably archive raw pages, use official CSV exports for gaps, and seek publisher confirmation of the unit. |

## Addendum: cooperative sources (2026-11-04)

These findings came up while implementing MAMCOS, TSS and TUMCOS. Each is fixed in this change unless the correction column says otherwise. See [COOPERATIVE_SOURCES.md](./COOPERATIVE_SOURCES.md).

| ID | Severity | Location | Problem | Business impact | Recommended correction |
|---|---|---|---|---|---|
| F-21 | **HIGH** | `api/src/decisions.ts` — cooperative quote selection; `api/src/history.ts` — cooperative aggregates | Once `cooperative_quotes` gained a `commodity` column, neither query filtered on it. A verified TUMCOS black-pepper row (possible via an attested CSV with INR/quintal evidence) could enter arecanut calculators and aggregates. | A pepper price could be presented as an arecanut realization, profit or hold input. | **Fixed:** both queries filter `commodity='arecanut'`. A regression integration test fails when the filter is removed. |
| F-22 | **HIGH** | Prior TSS publication policy (`cooperative_quotes` rows with an assumed unit and `status='verified'`) | 26 TSS rows had been published as INR/quintal although the source publishes no unit. | Users could read an assumed unit as a verified quotation. | **Fixed:** migration 0013 converts these rows to `accepted_unit_unconfirmed`, keeping their review history. Triggers forbid `verified` unless the unit is source-confirmed INR/quintal. |
| F-23 | **MEDIUM** | TUMCOS source (`api/src/tumcos.ts`) | Records declare "kg" while values are per-quintal magnitudes. No variety is published. The "Last Updated" header is stale. | Naive ingestion would mislabel the unit by 100×, invent varieties, or mark data stale or fresh incorrectly. | **Handled:** stored as `source_conflict` and unpublished; `variety_not_reported` flag; record dates used and stale metadata reported. **Outstanding:** confirm the unit with TUMCOS. |
| F-24 | **MEDIUM** | TSS tender endpoint (`api/src/tss.ts` — lot aggregation) | Lot-level rows contain seller and buyer identities. | Storing them would retain personal data without a basis. | **Handled:** only per-variety aggregates and a response hash are stored. |
| F-25 | **MEDIUM** | `cooperative_sources` registry | No source has recorded permission for automated collection or redistribution. | Scheduled collection or redistribution could breach the operators' terms. | **Handled:** the scheduler requires a recorded grant; the UI labels feeds "Permission not confirmed". **Outstanding:** obtain written permissions. |

## Addendum: multi-commodity domain model (2026-11-04)

Details are in [COMMODITY_MODEL.md](./COMMODITY_MODEL.md).

**Resolved**

- Price-basis confusion between APMC modal prices and cooperative averages is now enforced in the schema:
  - Each observation row carries an immutable `price_basis`.
  - CHECK constraints and an insert trigger tie the basis to the source table and source.
  - The `price_observations` view keeps modal and average prices in separate columns.
- Variety aliases are now source- and commodity-scoped (partly addresses F-04).

**Remaining**

| File | Module | Problem | Impact | Severity | Recommendation |
|---|---|---|---|---|---|
| `api/migrations/0014_commodity_master.sql` | `variety_aliases` seed | Compound MAMCOS labels (`HASA`, `NEWRASHIEDI`, etc.) have no canonical mapping | These rows cannot be filtered by canonical variety ID | Low | Add reviewer-approved mappings. Do not infer them. |
| `frontend/src/pages/*` | Decision tools, history, forecast and intelligence pages | Arecanut wording and assumptions remain | None today, because the capability gate blocks other commodities | Low | Make the pages configuration-driven before enabling a capability for another commodity |
| `data-platform/` | Python normalizer | No commodity configuration; arecanut is assumed | A new commodity source would need code changes | Medium (future) | Read commodity, alias and unit configuration from the catalogue when a second commodity is integrated |


## Addendum: D1 performance, R2 archive and data retention (2026-11-04)

Details are in [ARCHITECTURE.md](./ARCHITECTURE.md) and [DATA_RETENTION_AND_BACKUP.md](./DATA_RETENTION_AND_BACKUP.md).

**Resolved or reduced**

- **F-08 (unbounded reads)** is resolved for the routes that were reviewed:
  - `/prices` has a limit (1–1000; values outside return 400), keyset cursor pagination, and an optional count.
  - Admin and cooperative quality queues use server-side `limit`/`offset` and return `total`.
  - `/cooperative/prices` has a default window of 366 days, a maximum of 1096 days, a 5,000-row limit, and a `truncated` flag.
  - The reference index is limited to 4,000 points.
  - The new `/charts/reference` returns SQL-aggregated daily, weekly or monthly buckets over at most 3,660 days.
  - Market comparison and overview read the `market_daily_summaries` cache. Migration 0015 triggers mark dates dirty, and the cron or the admin rebuild refreshes them.
  - Compound indexes were added for every filter and sort path that was audited. `EXPLAIN QUERY PLAN` tests assert that these paths use no full-table scans.
- **F-07 (unmanaged retained captures)** is reduced:
  - `archive_objects` records the SHA-256, MIME type, size, source, link and storage for each object.
  - The optional R2 binding `ARCHIVE_BUCKET` may offload inline evidence. Offload happens only after a verified hash match.
  - Database triggers block deleting evidence and rewriting snapshots.
  - Only `temporary_processing` objects expire, after `ARCHIVE_TEMP_RETENTION_DAYS` (default 7).
  - Local development needs no R2.
- **F-11 (free-tier fit)** is reduced but not resolved:
  - Routes are bounded and summaries are cached.
  - Scheduled maintenance is non-fatal and logs failures to `operational_errors`.
  - Production CPU and D1 usage have still not been measured.
- **Reliability added:**
  - Import idempotency keys and SHA-256 payload hashes, with explicit reprocessing.
  - Daily connector batch keys.
  - Ingestion job IDs.
  - A backup/export script and a restore-check script, with documented restore steps using D1 Time Travel or export replay.

**Defect found and fixed during this work**

| File | Module | Problem | Impact | Severity | Correction |
|---|---|---|---|---|---|
| `api/migrations/0013_cooperative_sources.sql` | `cooperative_snapshot_immutable` trigger | Blocked every update to a snapshot, including a hash-verified R2 offload | Verified evidence could never be moved out of D1 | Medium | `0016_snapshot_offload_trigger.sql` drops this trigger. 0015's `no_rewrite` and `offload_guard` triggers still block content changes. |

**Remaining**

| File | Module | Problem | Impact | Severity | Recommendation |
|---|---|---|---|---|---|
| `api/wrangler.toml` | R2 binding | No bucket is provisioned, so the archive runs in `d1_inline` mode | Inline evidence (about 3.9 MB locally) keeps growing in D1 | Low | Provision a free-tier R2 bucket when D1 size requires it. |
| `cooperative_fetches` | Legacy snapshots | Rows from before 0015 have no `snapshot_sha256`, so the guard refuses offload | These rows stay inline | Low | Backfill hashes with a reviewed one-off migration before offloading them. |
| `scripts/` | Backup | Remote export and Time Travel restore have not been exercised | Restore time and steps against production are unproven | Medium | Run a restore drill against a staging D1 database before production launch. |
