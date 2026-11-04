# Implementation status

## Stage 1 — Foundation and market-data vertical slice

**Status:** Local market-data demo implemented with reviewed MAMCOS branch
averages, TSS rates with explicitly assumed INR/quintal units, and real
monthly AGMARKNET data, historical statistics, actual-input decision tools,
independent source intelligence and evaluated monthly baselines.
Official daily APMC ingestion, TSS unit confirmation, real lot reports,
comprehensive/live news and trade coverage, grounded AI, individual accounts
and Cloudflare deployment remain incomplete.

### Completed

- [x] Created React/Vite/TypeScript frontend workspace with responsive market-intelligence shell and working routes.
- [x] Added Hono/Cloudflare Worker API workspace, versioned endpoints, input validation, CORS configuration, health check, and local D1 binding.
- [x] Added D1 migration for geography, source management, ingestion job audit, market observations, indexes, and source/commodity seeds.
- [x] Added standard-library Python AGMARKNET CSV normalizer and configurable data.gov.in pagination connector.
- [x] Preserved original unit, raw source payload, source record identifier, report date, and ingestion job provenance.
- [x] Added idempotent imports, strict unit handling, validation flags, duplicate detection, and a reviewer approval/rejection queue.
- [x] Added corrected source-record version snapshots and superseded-record handling.
- [x] Added verified-only price, overview, comparison, and exact-variety median reference-index API endpoints.
- [x] Added frontend loading, error, empty, provenance, and insufficient-coverage states; no prices or forecasts are mocked.
- [x] Added Node/Python CI workflows and local setup/deployment documentation.
- [x] Added an opt-in, credential-gated scheduled AGMARKNET ingestion workflow.

### Verification

- [x] Frontend build and API typecheck.
- [x] API analytics unit tests.
- [x] Python ingestion unit tests (standard-library runner; CI uses pytest).
- [x] Local D1 migrations applied.
- [x] Local API and responsive browser smoke tests (health, empty states, navigation, CORS, parameter validation).

### Limitations and required configuration

- No Git repository was present in the workspace; GitHub configuration and deployment have not been tested.
- Real AGMARKNET ingestion requires an authorized data.gov.in API key/resource ID or an authorized CSV export. Schema and unit must match the selected source.
- Local review/import requires `INGESTION_TOKEN` and `ADMIN_TOKEN`; remote deployment additionally requires a D1 database and Cloudflare/GitHub credentials.
- Additional domains now use separate route modules; the original Worker still needs further repository-layer separation before production expansion. The lazily loaded ECharts bundle is approximately 539 KB minified (183 KB gzip), despite the smaller 260 KB (82 KB gzip) entry bundle.
- Future roadmap: market/variety mapping administration, extended source reconciliation, extended database domains, forecasts, agriculture/weather, trade/news, identity/roles, and E2E coverage.

## Monthly official report integration

- Added independent monthly-price storage and refresh-run provenance, including the original successful CSV, source URL, fetch time and failure status.
- Added a Worker-native connector for AGMARKNET's state/variety monthly export, commodity 118. It checks the requested period, comparison headings, explicit INR/quintal units, methodology, duplicate keys and primary-column price validity. Missing prices remain NULL.
- Refreshes atomically replace a state/month snapshot. These validated official aggregates publish directly to the monthly view, not the daily human-review queue. They never enter daily analytics.
- Added Monthly Trends navigation, reporting-month selection, variety filtering, up-to-24-month stored history, source links, separate fetch timestamps, and an authenticated manual-refresh form.
- Configured a production cron at 03:30 UTC daily to refresh the previous two completed months. Cron does not run automatically in local development; actual Cloudflare scheduling remains unverified until deployment.
- Verified direct source-to-local-D1 refreshes for September 2026 (25 Karnataka variety rows) and October 2026 (28 rows). Repeated October refresh retained 28 unique variety rows. Rashi values matched the official reports: 47,805.13 and 47,174.91 INR/quintal respectively.
- Checked the real populated Monthly Trends view at 1440, 834, 390 and 320 CSS pixels with no document overflow, and verified the variety-history values.
- Daily-price defects identified in the earlier production audit are not fixed by this separate integration. Endpoint stability, commercial usage terms and rate limits still need publisher confirmation.

## Daily integrity hardening and source-access investigation

- Located daily-report routes in the official public frontend. Access to the
  market-specific daily report returns `TOKEN_OR_CAPTCHA_REQUIRED`. The user
  chose to continue fixes/testing while daily export or authorized access is
  pending. No CAPTCHA bypass, invented market observations, or monthly-to-daily
  substitution was used.
- Fixed atomic source correction/replay, concurrent correction versioning and
  stale-review protection. Added a unique current-source-record index,
  database verification invariants and durable review events. Original
  validation messages are retained. The current reviewer is identified only
  as the shared-token principal, not an individual account.
- Fixed unsupported-currency acceptance, mixed-unit headings, normalization
  version identity, encoded official price headers and the official commodity
  label. Source-record identity preserves exact variety labels.
- Fixed case-only market reimports, incomplete pagination reporting, empty
  connector endpoint configuration, silently capped analytics and standard
  CSV quote escaping. Corrected overview's previous eligible reference value
  when the latest reporting date has insufficient coverage.
- Added review source evidence and validation messages to the UI/API.
- Extended the CSV connector with explicitly configured units and all-row
  validation before transmission. Monthly exports cannot enter daily storage.
- Added migrated in-memory SQLite tests using the actual Hono handlers for
  replay, concurrency, stale review, invalid approval, audit, capitalization
  and complete analytics beyond 10,000 inputs. Synthetic regression inputs are
  isolated to tests and are never loaded into the persistent demo database.
- The official daily APMC acceptance target remains **unmet** pending
  authorized source access. The cooperative branch equivalent is now met
  separately as described below, without substituting average for modal price.
- Verification: 39 TypeScript tests and 17 Python tests passed; the frontend
  production build and API typecheck passed. All six routes were checked after
  their actual empty/populated states loaded at 1440, 834, 390 and 320 CSS
  pixels (24 checks), with no document overflow. TSS's four market views were
  additionally checked at all four widths (16 checks), with source-value
  assertions for Sirsi and Siddapur history charts. Real monthly records remain
  intact; persistent daily observations and pending queue remain empty.

## Cooperative branch-data integration

- Implemented MAMCOS snapshot ingestion, explicit unit/date/range validation,
  separate revisioned storage, authenticated review and raw source evidence.
  The four market screens default to this feed; official modal-price views
  remain accessible. Market navigation preserves the selected source.
- Published 39 valid quotes against their raw source records; withheld two
  invalid records (BIRUR's empty placeholder and JAYAPURA BETTE's average
  above maximum). Re-fetch inserted zero rows and retained all 39 approvals.
- Exact `RASHI EDI` qualifies on 31 October 2026 (4 branches, median ₹48,585),
  2 November (3, ₹46,448) and 3 November (3, ₹46,232). Branch constituents are
  disclosed. Different branch sets are not described as like-for-like
  price movement. Branches are not assigned invented APMC identities.
- Overview, filtered prices, CSV export, same-date comparisons, benchmark
  charts, accessible data tables and descriptive analytics use only reviewed
  data. Retained source captures accumulate available history; no unavailable
  historical observations or forecasts are manufactured.
- Scheduled MAMCOS collection is opt-in with
  `MAMCOS_SCHEDULE_ENABLED=true` after collection permission is confirmed.
  Manual authenticated refresh works locally; new/corrected rows require review.
- Integrated TSS's public rates API for Sirsi, Siddapur and Yellapur after
  explicit user approval of an **assumed, not source-confirmed INR/quintal**
  unit. Stored per-record assumption status cannot silently become confirmed.
  Published 26 supported quotations from 2–3 November 2026; archived but
  excluded 133 unsupported rows. Supported exact labels are RASHI, BETTE,
  CHALI, MURI, KOLE and ARECANUT; the taxonomy is intentionally partial.
  Normal rates (`norrate`) remain separate from reported averages (`avgrate`).
- TSS source selection, filters, comparisons, CSVs and per-location observed
  history charts preserve the assumption label. Assumed-unit records are
  excluded at the verified-unit benchmark boundary, including when three
  locations qualify. Same-date comparisons never blend MAMCOS or AGMARKNET.
- Authenticated TSS refresh requires a date and explicit unit acknowledgement.
  Snapshot dates must match the request; empty days remain empty; partial
  failures are recorded by location and reported as failures. No automated
  TSS schedule is enabled. Re-fetching 3 November inserted zero new rows and
  preserved 26 approvals. Source unit confirmation remains outstanding.
- Verification: 60 TypeScript tests passed, including migrated actual-handler
  cooperative deduplication/correction/replay, review, archive and failure tests.
  Frontend build and API typecheck passed. All six populated/empty route
  states were checked at 1440, 834, 390 and 320 CSS pixels without document overflow.
- These changes complete the existing market-data demo, not the original
  twelve-module platform. Forecasting/backtests, predictive sell/hold advice,
  quality, weather/production, trade/news, grounded AI, individual auth/roles
  and production deployment still require their own implementation and inputs.

## Frontend design refinement

- Replaced the miniature dashboard styling with a restrained commodity-workstation hierarchy: readable system typography, tabular numerals, consistent panel spacing, subdued surfaces and source-first supporting copy. No remote font request is required.
- Refined all five routes, including responsive summaries, reviewer forms, filters and navigation. Search remains usable on mobile; filter reset also clears the URL search.
- Tables retain every data column inside keyboard-focusable horizontal scroll regions, with sticky leading identifiers and right-aligned prices. Missing values remain explicitly missing.
- Charts use calendar-time spacing, straight observed-price segments and explicit breaks for unpublished dates, rather than smoothed curves or implied values. Exact dates, prices and market coverage are also available in an expandable accessible table.
- Corrected the analytics summary label from "period median" to "period average" to match its existing arithmetic calculation; the daily reference-index median calculation is unchanged.
- Added mobile navigation focus containment, Escape dismissal, focus restoration, skip navigation and reduced-motion support. Reviewer failures have explicit error styling, duplicate review submissions are disabled during saving, and locking clears review feedback and cached review records.

### Design verification

- Production frontend build and API typecheck pass; the existing four API analytics tests pass. No editor diagnostics were reported.
- Browser layout checks passed for all five routes at 1440, 1024, 834, 390 and 320 CSS-pixel viewport widths (25 route/viewport checks), including horizontal-overflow and search visibility checks.
- Browser-only test responses exercised populated overview, table, comparison, chart and review-queue layouts at 1440, 834, 390 and 320 pixels. Checked long market/source identifiers, table scrolling, chart observation values, reviewer error feedback and queue locking.
- Exercised mobile menu focus containment/Escape restoration and market search/filter reset. These are browser smoke checks, not a persisted automated E2E suite or physical-device certification.
- All browser test intercepts and test reviewer session state were removed afterward. No test observations were imported, no database records were changed, and live-source access or authorized publication was not claimed.

## Phase B — Historical analytics

- Added a resumable monthly backfill command for the requested January 2021
  through October 2026 range. It skips stored periods, reports failures and
  imports only each report's primary observation column.
- Completed all 70 reports: 1,526 Karnataka variety rows, including 75
  source-missing prices retained as NULL. Exact `Rashi` has 70 observations
  and five complete seasonal years (2021–2025). Reconciled every stored
  variety row against the archived original CSV using the production parser.
  Retried development hot-reload interruptions successfully; no refresh
  attempts remain running. A repeated October refresh retained the current
  price and added an immutable capture without duplicating current rows.
- Added immutable monthly variety snapshots alongside archived successful
  source CSVs. Corrections and removed varieties remain traceable; identical
  re-fetches are captures, not price revisions. Pre-migration captures retain
  their raw CSVs; only previously current rows seed materialized versions.
- Historical analytics retains one row per calendar month and distinguishes
  missing reports, absent varieties and missing prices. Reporting month,
  fetch time, latest refresh failures and coverage are shown separately.
- Added complete-window 3/12-month means, exact-month year-on-year changes and
  annualized sample volatility of twelve consecutive monthly log returns.
  Seasonal indices require at least three complete positive-price years;
  incomplete years and missing periods are never filled.
- Added source/branch/exact-variety weekly and monthly aggregation of reviewed
  daily cooperative averages, with evidence, CSV export and observed/calendar
  day coverage. This is not a transaction-weighted series or a trading-day
  completeness claim. TSS's unit assumption remains visible.

## Phase C — Actual-input decision tools

- Added net realization, farm profitability and hold-scenario calculations,
  using reviewed cooperative prices, stored official monthly prices, or
  explicitly user-entered prices. Source types are not silently blended.
- Costs, quantity, area, finance, storage, loss and future scenario prices
  require user inputs. Hold outputs compare unchanged-price and user-price
  scenarios against selling now and calculate the break-even price; they do
  not predict future prices or assign probabilities.
- Server-side validation and arithmetic reject stale source selections and
  unsupported numerical magnitudes explicitly. A saved calculation pins its
  formula version, inputs, resolved source price/provenance and outputs;
  subsequent source corrections do not rewrite it.
- Public calculations are not persisted. Saving/listing private scenarios
  requires the shared reviewer token. Locking clears private form state,
  results, token and cached saved scenarios. Individual-account isolation is
  not implemented. No synthetic farm-cost records were saved to the demo.
- No AI model, paid service or OpenRouter key is needed for these phases.

### Phase B/C verification

- 87 TypeScript tests pass, including actual Hono/migrated SQLite regressions
  for immutable monthly captures, absent varieties, archive downloads, private
  scenario persistence, stale prices and numerical overflow rejection.
- Frontend production build and API typecheck pass; editor diagnostics are
  clear. The existing lazy-loaded chart bundle still produces a size warning.
- All eight routes passed loaded-state checks at 1440, 834, 390 and 320 CSS
  pixels (32 checks), without document overflow or displayed API errors.
  Populated calculator outputs were also checked at all four widths; short
  desktop/mobile navigation remains scrollable.
- Calculator arithmetic and CSV output were checked using a real MAMCOS
  reference price with temporary, non-persisted test inputs. Real user farm
  inputs are still required for a saved practical demonstration.
- Browser-tested TSS's assumed-unit price, official monthly state price and
  manual price paths; temporary inputs were cleared afterward. Confirmed
  39 reviewed MAMCOS and 26 reviewed, assumed-unit TSS records remain intact,
  with two invalid MAMCOS rows withheld and no official daily substitutions.
- Verified the 70-row calendar table, 71-line history CSV, invalid date-range
  feedback and populated seasonal indices. Latest Rashi remains 47,174.91
  INR/quintal for October 2026; its 3/12-month means are 48,538.88/52,508.64,
  YoY change -18.93% and annualized monthly-return volatility 5.85%.
- At this milestone, independent intelligence and evaluated forecasting were
  still separate work. The next sections record their subsequent implementation.

## Phase D — Independent intelligence integrations

- Implemented separate production, trade, weather, bulletin and lot-inspection
  tables, immutable original source archives and per-source refresh attempts.
  These records never enter the price-observation/index tables.
- Captured official DASD PDFs: 90 current annual state/national production
  records across 2021-22–2025-26, with source estimate status and units; 28
  country/total import rows across 2021-22–2024-25. Original sparse PDF column
  positions retain missing cells instead of shifting later years left.
- Captured a PIB annual export aggregate: 10,637 tonnes / INR 400 crore for
  2023-24; stored value is explicitly converted to INR 40,000 lakh. Trade
  coverage is 29 current records, not a live/complete import-export feed.
- User selected Sirsi weather. Stored 14 Open-Meteo gridded model days:
  seven recent and seven forecast days, with actual returned coordinates,
  elevation, source units and original JSON. Recent model estimates are not
  described as measured station observations. Captures over 24 hours old
  display a freshness warning. Non-commercial API terms/attribution are shown.
- Stored three curated official PIB/DASD news publications with source dates;
  one is a dated tariff notification in the policy view. Latest announcement
  is 18 July 2026. Historical policy notices are not asserted as current law.
  No continuous breaking-news feed, sentiment or price-impact model is claimed.
- Added authenticated refreshes, record filters, source archive downloads and
  provenance-preserving CSVs. The local PDF command is
  `npm run refresh:intelligence`; optional Worker weather/bulletin refreshes
  use `INTELLIGENCE_SCHEDULE_ENABLED=true` in the existing daily cron.
  Local ordinary development does not automatically invoke cron.
- User confirmed no lab report is available. Implemented real-report
  submission, immutable evidence, reviewer notes/verification/rejection and
  public quality exports; the persistent measured-quality dataset remains
  empty intentionally. No moisture, safety, grade or premium is invented.
  Public report links must not expose confidential/personal information.
- No OpenRouter/AI key is required. Commercial source collection/redistribution
  rights, individual identities and deployment remain unverified.

## Phase E — Evaluated monthly baselines

- Added immutable forecast evaluation snapshots over exact Karnataka monthly
  prices and their archived capture provenance. Minimum 60 contiguous positive
  months, including the latest completed month; missing/stale/unsupported
  histories remain withheld. Assumed TSS units and unrelated domains are not
  blended into the input series.
- Implemented chronological one-step walk-forward comparison of last-value
  and seasonal-naive baselines: 12 validation, 12 calibration and 12 holdout
  targets after initial training. Selection uses validation MAE, not holdout.
- Empirical 80%-nominal intervals use pre-holdout absolute errors; actual
  coverage, MAE/RMSE/sMAPE and last-value skill are published. Small-sample/
  serial-dependence caveats are explicit. A candidate must not deteriorate
  against the last-value holdout benchmark on all three error measures.
- Evaluated all 28 varieties from the latest monthly report. Eleven publish
  last-value baselines; 17 remain withheld. All published baselines have no
  demonstrated predictive edge over last value.
- Rashi: 70 months; November 2026 baseline 47,174.91 INR/quintal, interval
  43,048.37–51,301.45; holdout MAE 919.28, RMSE 1,238.89, sMAPE 1.75%,
  coverage 12/12 and skill 0%. This is not a promised forward accuracy.
- Source revisions/new captures, formula changes or month rollover suppress
  stale forecasts until re-evaluated. Snapshot ties use append order, not
  random UUID order. Public reads do not compute or save evaluations.
- Backtests use current revised history, not as-of vintage data. Holdout
  publication gating and repeated evaluations are disclosed. Advanced models,
  multi-step forecasts, prospective trading validation, grounded AI and
  predictive recommendations are not implemented.

### Phase D/E verification

- 122 TypeScript tests pass, including source layout/unit/date validation,
  sparse PDF columns, source-failure preservation, immutable archives, quality
  authorization/review, chronological evaluation, stale-history suppression
  and actual Hono/migrated SQLite routes. No synthetic observations or lot
  reports were inserted in the persistent database.
- Reconciled all 118 currently displayed PDF-derived production/import rows,
  all 14 weather rows, all three bulletins and the PIB export aggregate
  against their archived original source evidence.
- Production build/API typecheck and editor diagnostics pass. Runtime
  dependency audit reports zero known vulnerabilities; chart size warning
  remains. Added only the PDF extraction dependency required by ingestion.
- All 15 routes passed loaded-state checks at 1440, 834, 390 and 320 CSS
  pixels (60 checks), with no document overflow or displayed API errors.
- Verified production/trade exact filters, CSV exports across all five source
  views, withheld-variety UI, quality access denial/token clearing and
  desktop-short/mobile navigation. Original monthly and cooperative feeds
  retain their previous data. These are browser smoke checks, not a
  persistent automated E2E suite or production certification.
