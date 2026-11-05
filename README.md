# Arecanut Intelligence (ANI)

Arecanut Intelligence is a market-data and decision-support application for Karnataka. The initial vertical slice provides a React dashboard, a versioned Cloudflare Worker API with D1 migrations, a CSV/API ingestion path, and a human review queue. It deliberately publishes no sample prices or unvalidated observations.

## Architecture

```text
AGMARKNET / authorized CSV
          │
          ▼
Python connector ── validation, normalization, provenance
          │
          ▼ authenticated POST /api/v1/admin/import
Cloudflare Worker (Hono) ── D1 job log and pending-review observations
          │
          ▼ reviewer approval
Versioned REST API ── verified prices and reference-index analytics
          │
          ▼
React + Vite dashboard
```

Storage, query bounds, the market summary cache and the optional R2 evidence archive are described in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Retention, backup and restore procedures are in
[docs/DATA_RETENTION_AND_BACKUP.md](docs/DATA_RETENTION_AND_BACKUP.md). Supply, production, arrivals, weather and
expert-reviewed crop-risk analytics (`/supply`) are described in [docs/SUPPLY_AND_RISK.md](docs/SUPPLY_AND_RISK.md).
The optional, data-grounded AI assistant (`/assistant`) is described in [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md).

The API and ingestion tools are separate from frontend components. SQL schema changes are migration-managed, and all runtime data access stays inside the Worker API (the initial MVP keeps repository queries in its API module). Prices are standardized to INR per quintal only when the original unit is explicit and convertible. The reference index is calculated separately for an exact reported variety using the median of one verified modal price per market/date; dates below the configured market-coverage threshold are withheld.

## Requirements

- Node.js 22.18+ on the Node 22 release line, or Node.js 24+,
  and npm (`nvm use` selects Node 22). Older Node 23 releases are not supported.
- Python 3.12 or newer for the supported ingestion workflow.
- Cloudflare Wrangler (installed with the API workspace) for local D1 and deployment.
- No AGMARKNET or Cloudflare credentials are needed to start the UI; credentials are needed only for those integrations.

## Local development

1. Install workspace packages:

   ```sh
   npm ci
   ```

2. Copy `.env.example` to `.env` if you need to change the frontend API URL. Vite reads only `VITE_`-prefixed values from that file.

3. Create/apply the local D1 database schema (Wrangler creates the local database on first use):

   ```sh
   npm run db:migrate:local
   ```

   The local D1 database is stored under the API workspace's Wrangler state. The migration seeds the Karnataka state, Arecanut commodity, and source identifiers only—not market prices.

4. Copy the Worker example and configure local API secrets (do not commit the
   filled-in file):

   ```sh
   cp -n api/.dev.vars.example api/.dev.vars
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Run the token-generation command twice and use different values for
   `INGESTION_TOKEN` and `ADMIN_TOKEN` in `api/.dev.vars`. Blank values
   intentionally disable authenticated operations until you configure them.
   Never put a secret in a `VITE_` variable: those values are public in the
   browser build. Existing local environment files must not be overwritten.

   Set `VITE_API_BASE_URL=http://127.0.0.1:8787/api/v1` in `.env` if the default is not suitable. Start both services from the repository root:

   ```sh
   npm run dev
   ```

   Vite runs on port 5173 and the Worker API on port 8787. Check `http://127.0.0.1:8787/api/v1/health`. If Wrangler changes its local DB setup or port for your version, use its emitted local command and update `VITE_API_BASE_URL`.

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
[docs/AGMARKNET_DAILY_CONNECTOR.md](docs/AGMARKNET_DAILY_CONNECTOR.md) for the
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

## Cooperative branch prices (MAMCOS, TSS and TUMCOS)

> **Current policy (2026-11-04):** see
> [docs/COOPERATIVE_SOURCES.md](docs/COOPERATIVE_SOURCES.md).
>
> - **Operator decision (2026-11-05, migration 0020):** TSS (no published unit) and TUMCOS (labels "kg" but shows per-quintal values) are treated as INR/quintal and published after review, in every module. They stay labelled as an operator assumption, not a source confirmation. TUMCOS values under 1,000 stay unconfirmed because they could genuinely be per kg.
> - Older text below about TSS benchmark exclusion and non-publication is history.
> - TUMCOS (`?feed=tumcos`) adds Channagiri arecanut and black pepper. Black pepper never enters arecanut benchmarks, calculators or aggregates.
> - Scheduled collection needs both `<SOURCE>_SCHEDULE_ENABLED=true` (`MAMCOS`, `TSS` or `TUMCOS`) **and** a permission grant recorded in Data quality → Cooperative source intelligence.

The four daily market screens now default to **MAMCOS cooperative branch
averages**. Their source selector also offers **TSS reported averages with
assumed units** (`?feed=tss`) and the original AGMARKNET modal-price screens
(`?feed=official`). Cooperative quotations never enter
`market_price_observations`, and averages are never renamed modal prices.
The benchmark is the median of branch averages for one exact variety and
date, with at least three reviewed, source-confirmed-unit branches. Constituents are disclosed;
like-for-like movement claims are withheld when branch sets differ.

Apply migrations through `0007` locally before using these routes. In
**Data quality → Cooperative source review**, enter the local `ADMIN_TOKEN`,
fetch a MAMCOS snapshot, inspect the raw records, and verify valid rows.
Malformed ranges, missing varieties, non-positive prices and future dates
cannot be published. Every review is recorded under the shared-token
principal. Source snapshots, original branch names, reporting dates and
record revisions are retained in separate cooperative tables.

Public endpoint: `https://mamcos.info/areca-market-rates`. The connector
validates its unit declaration and structured Livewire payload and fails
explicitly if the page format changes. Each branch's own date is used.
Repeated identical snapshots do not duplicate or unverify records. Source
corrections require review again. Retained snapshots accumulate observed
history; no unavailable past dates are fabricated or interpolated.

Validated local publication: 39 quotations from the captured page were
reviewed against their raw records; two invalid rows were withheld.
`RASHI EDI` had qualifying benchmark dates on 31 October, 2 November and
3 November 2026 (4, 3 and 3 branches respectively). These are cooperative
branches, not claimed verified APMC market identifiers.

Automatic collection is **disabled by default**. After recording a
permission grant, set Worker variable `MAMCOS_SCHEDULE_ENABLED=true`.
It then fetches at the existing 09:00 IST cron; new/corrected records still
require review. Local refresh uses the authenticated button. The browser
polls stored observations every minute, not the source website.

### TSS: explicitly assumed units (superseded publication policy)

The user authorized publishing TSS rates with **INR/quintal assumed, not
source-confirmed**. This assumption is stored per quotation (`unit_status`),
displayed in the source selector, disclosures, table captions, charts, review
queue and CSV exports. Review approval means the source values were checked;
it does not certify their unit. TSS records are excluded at the benchmark
calculation boundary even when three locations report. They never enter
MAMCOS or official daily/modal-price calculations.

The connector calls the public frontend's
`https://webapi.tssindia.in/getrateshomepage` with `location`, `date_param`,
and `tabIndex=0` for Sirsi, Siddapur and Yellapur. It requires the returned
date to match the requested date exactly. Empty days stay empty. The raw
JSON is archived, including excluded categories. Only exact labels `RASHI`,
`BETTE`, `CHALI`, `MURI`, `KOLE` and `ARECANUT` are currently published.
Pepper, ambiguous abbreviations and other unsupported labels are excluded,
not silently mapped to arecanut. This is intentionally a partial taxonomy.

`avgrate` supplies the reported average. `norrate` is retained and displayed
as a separate **normal rate**, never substituted for the average or called
modal price. Source corrections/version replays require review again.
Failures are recorded per location; a partial refresh returns an error while
retaining successfully captured locations. Recent location fetch details
are available under Source and methodology.

For manual refresh, open **Data quality → Cooperative source review**, unlock
with `ADMIN_TOKEN`, select a UTC reporting day, acknowledge the unit
assumption and fetch. The authenticated endpoint is
`POST /api/v1/admin/cooperative/tss/refresh` with
`{"date":"2026-11-03"}`. Then inspect and approve
supported records with their assumed-unit label intact. TSS has **no automatic
schedule**; source collection permission remains a separate requirement.

Local validation captured 159 source rows across 2–3 November 2026:
26 supported quotations were reviewed and published; 133 unsupported items
were archived but excluded. A repeat 3 November fetch inserted zero rows
and preserved the 26 approvals. Sirsi RASHI on 3 November has minimum
44,099, average 46,055, maximum 47,299, and normal rate 45,699 in the
assumed unit. Per-location history charts plot reported averages, not an
inferred multi-market benchmark.

## Official monthly trends

Monthly Trends (`/monthly-trends`) is independent of daily prices and the daily
reference index. The Worker fetches the public AGMARKNET state/variety monthly
CSV export for commodity 118. No API key was required in a successful local
request; production access terms, rate limits and long-term endpoint stability
still need confirmation with the publisher.

Apply migrations before opening the view:

```sh
npm run db:migrate:local
```

With both development servers running, open
`http://localhost:5173/monthly-trends`, expand **Refresh an official report**,
select a completed month (for example October 2026), enter the `ADMIN_TOKEN`
from your local API configuration, and choose **Fetch official report**.
The token remains in component memory only and is cleared after success.
Refresh September separately to populate another historical point. Imports
are persistent in local D1; re-fetching replaces the same state/month snapshot
atomically, without adding duplicate variety rows. Failed fetches preserve the
previous snapshot and record the error.

The connector checks the exact commodity/title, requested month, comparison
periods, explicit INR/quintal headings, unique state/variety keys, finite
nonnegative prices and weighted-average methodology. A source `-` remains
NULL, never zero. Only the primary reporting month is stored; previous-month
and year comparison columns are not reclassified as separate reports.
Original CSV text and source URL are retained with each successful refresh.
These are source-validated published aggregates, not human-reviewed daily
observations; they publish directly to the separate monthly view.

The deployed Worker's cron runs daily at 03:30 UTC (09:00 IST), refreshing the
previous two completed calendar months to capture revisions. Local Wrangler
does not run cron automatically; use the authenticated refresh form. The UI
polls its read API every minute; this checks for newly stored data, not live
auction updates. Reporting month and successful fetch time are shown
separately. This view displays 24 calendar months, including explicit gaps;
Historical analytics provides the longer range. Apply all migrations through
`0008` before deploying these features.

## Phase B: historical analytics

Open `http://localhost:5173/history`. Monthly state/variety history is
independent of cooperative daily quotations. Select the exact variety and
calendar range (up to 240 completed months). A row exists for every selected
month, with separate statuses for an absent report, absent variety, source
missing value and observed price. Reporting period, fetch time, source URL
and latest refresh failure are displayed separately.

Local verification captured all **70 reports from January 2021 through
October 2026**, containing **1,526 Karnataka variety rows**. All rows reconcile
with their archived source CSVs using the production parser. The source's
75 missing price values remain NULL. Exact `Rashi` has 70 observed months,
with five complete calendar years (2021–2025) available for seasonal analysis.
These are historical monthly observations, not live daily quotations.

With the API running, the approved local backfill can be started or resumed
from the project root:

```sh
npm run backfill:monthly -- 2021-01 2026-10
```

The script uses the local reviewer token without printing it, limits source
requests to two concurrent calls with a one-second pause per worker, skips
stored reports and exits unsuccessfully if any month fails. Re-running retries
missing reports. Existing months can be re-fetched through Monthly Trends
to capture revisions. Stop and restart backfill after changing Worker code:
development hot reload can interrupt active source requests. Interrupted
attempts must not be interpreted as unavailable source periods.

Successful refreshes retain immutable price-version rows and original CSV
snapshots as well as replacing the current report atomically. Captured
versions, including a variety's subsequent absence, are inspectable in the
history view; archived CSV downloads do not change when the publisher revises
a report. Pre-existing raw CSV archives remain preserved; historical
materialized version coverage starts with migration `0008`'s current snapshot
and subsequent refreshes.

Statistics are descriptive:

- **3- and 12-month rolling means:** equal-weight means of monthly weighted
  prices, available only with every month in the window. They are not a
  recomputed arrival-weighted price over the whole window.
- **Year-on-year:** exact same calendar month one year earlier, requiring a
  positive denominator. No nearest-month substitution.
- **Volatility:** sample standard deviation of 12 consecutive monthly log
  returns, annualized by `sqrt(12)` and expressed as a percentage. Requires
  13 positive consecutive prices.
- **Lookback:** rolling statistics and YoY use up to 12 stored months before
  the displayed range; the visible filter does not reset available history.
- **Seasonality:** average of each month's `price / full-year mean * 100`
  over at least three complete, positive-price calendar years inside the
  selected range. Incomplete years are excluded and named coverage is shown.
  An index is not a forecast or proof of a recurring causal pattern.

Weekly (Monday-start) and monthly aggregation of captured daily cooperative
quotes is also available on this page. Select one source, exact variety and
branch, over up to 366 days. These are arithmetic means of observed daily
averages, not official monthly arrival-weighted reports. Empty periods remain
empty; observed-day/calendar-day coverage does not claim complete trading-day
coverage. TSS's unit assumption remains visible in results and CSV exports.

## Phase C: actual-input decision tools

Open `http://localhost:5173/decision-tools`. No farm costs, yields or future
prices are prefilled. Select a published cooperative quotation, the latest
stored official monthly variety price, or an explicitly user-entered price.
Check the grade, reporting period and unit before using a quotation.

Enter saleable quantity in **quintals (100 kg)**, commission in percent, total
transport/other selling costs in INR, area in hectares, production cost
excluding selling costs and by-product income for that same harvest. Enter
0 explicitly only when a cost genuinely does not apply.

The tools calculate net realization, net per quintal, farm profit,
profit/hectare, return on production cost and farm break-even price.
ROI is unavailable when production cost is zero. Costs are not inferred from
external data or a language model.

Holding scenarios compare an unchanged source price, the user's entered
future price and the calculated break-even future price. Inputs include
holding days, annual opportunity/finance rate, additional total storage cost
and expected saleable weight loss. Finance is
`max(net now, 0) * annual rate * days / 365`. Selling commissions, transport
and other selling costs are assumed unchanged. Taxes, quality changes,
inflation, unentered expenses and financing of negative proceeds are not
inferred. No scenario probabilities or buy/sell recommendations are given.

Calculation requests are validated and recomputed server-side. Sourced price
references are pinned to their current version; a corrected/superseded
selection returns 409 and must be selected again. All TSS-derived results
retain **INR/quintal assumed, not source-confirmed**.

Use the reviewer token to save and reopen private scenarios in local D1.
Saved input, source-price and result snapshots are immutable and include a
formula version, so later source corrections do not rewrite previous results.
Monthly scenarios link to their archived input report. Lists and saves require
the reviewer token; ordinary calculation requests are not persisted.
The token remains in component memory. Locking clears private inputs/results
and cached saved scenarios. This shared-token mechanism is not individual
account isolation. The latest 100 saved scenarios are listed.

No example farm records are seeded. Tests use synthetic inputs only in
isolated test databases or non-persisted browser calculations. For an actual
farm demo, enter and save the user's real figures. Scenario CSV exports
include inputs, source/unit provenance, formula version and results.

These calculators do not predict prices. The separate evaluated-baseline
module below supplies measured one-month forecasting, not an AI recommendation.
No OpenRouter key or paid AI model is required.

## Independent source intelligence

Open `http://localhost:5173/intelligence/production` and use the module tabs.
All records are stored in D1 with source URLs, capture timestamps and original
archives. Reporting periods are never replaced with fetch dates.

| Module | Verified initial local coverage | Important boundary |
|---|---|---|
| Production | 90 state/national rows, 2021-22 through 2025-26, from DASD PDFs | Original thousand-hectare, thousand-tonne and kg/ha units; 2025-26 is a second advance estimate, not final production |
| Weather | Sirsi reference 14.6195, 74.8354; 7 recent model days and 7 forecast days | Open-Meteo grid output, not measured farm/station observations; returned grid/elevation retained |
| Trade | 28 country/total import rows, 2021-22 through 2024-25; one 2023-24 export aggregate | Imports from DASD/Department of Commerce; export aggregate from PIB. Not a complete or live trade feed |
| Policy | One dated PIB tariff notification, 14 August 2025 | Historical notice, not a declaration of currently applicable law |
| News | Three dated official PIB/DASD publications, latest 18 July 2026 | Curated announcements, not comprehensive breaking news, inferred sentiment or price-impact analysis |
| Quality | Real-report submission, review and publication workflow | Empty until an actual inspection/lab report is supplied; no sample lot measurements are seeded |

With the local API running:

```sh
npm run refresh:intelligence
```

This command fetches the three verified DASD PDF tables, extracts positioned
columns with PDF.js, submits their original PDF archives and validated
extractions using the reviewer token, then refreshes Sirsi weather and official
bulletins. Requires Node 22.18+ (or a newer supported release) for native
TypeScript imports. Layout, units, periods, source failures and partial
refreshes fail explicitly; the command exits nonzero rather than claiming
complete success. Existing valid captures remain visible.

Production uses the newer explicitly final 2024-25 values in preference to
that year in the historical table. Missing older state cells remain null.
The source does not label the historical table's estimate status; ANI does
not invent one. Blank import partner cells are not zero, and published totals
include partners not individually listed. The PIB export figure of 10,637
tonnes / INR 400 crore is stored as 40,000 INR lakh; no exchange rate or
unsupported HS-code split is inferred.

Filters and CSV exports preserve the displayed source scope and units.
Original capture downloads are immutable. Capture hashes are SHA-256 of
the stored payload representation (base64 text for PDFs); PDF bytes are
decoded only for the archive download. Earlier captures and refresh errors
are retained even when the current snapshot changes. PDF ingestion is a
trusted reviewer workflow, not an unauthenticated arbitrary-URL fetch.

Weather/news also have authenticated in-app refresh controls. The existing
03:30 UTC Worker cron can refresh them daily when
`INTELLIGENCE_SCHEDULE_ENABLED=true` is explicitly configured. It is disabled
by default and does not run automatically under ordinary local `wrangler dev`.
PDF source refresh remains the explicit command above. Open-Meteo attribution
and terms are linked in the weather view; its free endpoint is for
non-commercial evaluation, not an assumed free commercial redistribution
licence. Obtain appropriate publisher/service terms before commercial use.
The Sirsi town reference is not the user's exact farm location.

Quality reports require a lot, exact variety, sampling/report dates, inspector
or laboratory, report reference, HTTPS evidence and at least one actual
moisture/defect measurement. Reports start pending; reviewer verification or
rejection requires an evidence note. Original measurements are immutable,
duplicate report identities are rejected, and corrected laboratory reports
need distinct references. Public records and evidence URLs must not contain
personal/confidential information. No grade, safety certificate, aflatoxin
result or price premium is inferred. Shared-token access is not individual
reviewer identity or laboratory accreditation verification.

## Evaluated monthly forecast baselines

An independent experimental engine (`data-platform/forecasting`, dashboard `/forecasts/evaluation`) benchmarks statistical, LightGBM and Chronos-2 models against these baselines with walk-forward evaluation. See [docs/FORECASTING.md](docs/FORECASTING.md). It does not replace the baselines below.

Open `http://localhost:5173/forecasts`. To evaluate and persist snapshots:

```sh
npm run evaluate:forecasts                # Rashi
npm run evaluate:forecasts -- --all        # all varieties in latest monthly report
```

The same reviewer-protected operation is available in the UI. Evaluations use
only exact-variety Karnataka monthly weighted prices with archived capture
provenance. No monthly/daily blending or TSS prices enter these monthly baselines.
Production, weather and news are not predictive features in this baseline.

- Require at least 60 consecutive positive calendar-month prices and data
  through the latest completed month. Missing, zero, stale or absent history
  keeps forecasts unavailable.
- Walk forward chronologically. Initial history is followed by 12 validation
  targets, 12 interval-calibration targets and 12 holdout targets.
- Compare last-value and seasonal-naive models; choose by validation MAE,
  never calibration or holdout performance. Predict only one reporting month.
- Calibrate an 80%-nominal empirical absolute-error interval on the 12
  pre-holdout errors. Show actual holdout coverage, MAE, RMSE and sMAPE.
  Small samples, serial dependence and selection prevent guaranteed coverage.
- Publish only if the selected model does not deteriorate against the
  last-value holdout benchmark on all three error measures. A published
  last-value baseline means **no demonstrated predictive edge**, not an AI
  prediction with proven profitability.
- Save immutable inputs, source references/fingerprint, formula version,
  scores, gates and results. A changed month, price or unit, or a calendar
  rollover, suppresses the displayed forecast until re-evaluation. Re-fetching
  an unchanged report adds a capture record but does not suppress the forecast,
  so the daily refresh leaves valid forecasts published.

Initial real-data evaluation: **28 varieties evaluated, 11 published
last-value baselines, 17 withheld**. Rashi uses 70 months and its November
2026 baseline is 47,174.91 INR/quintal, empirical interval
43,048.37–51,301.45. Its twelve-target holdout MAE is 919.28 INR/quintal,
RMSE 1,238.89, sMAPE 1.75%, and interval coverage 12/12. Skill versus the
last-value benchmark is exactly zero. These are retrospective measurements,
not promised future accuracy.

Backtests use **currently revised history**, not period-by-period as-of
vintages; vintage leakage is not ruled out. Holdout results gate publication
and can be reused by subsequent evaluations. There is no prospective trading
validation, multi-step model, predictive sell/hold recommendation or grounded
AI chat. CSV holdout exports and full evaluation JSON support inspection.

## Multiple commodities

Arecanut is the production commodity. Migration `0014` adds a commodity master
covering black pepper, coffee, cardamom, coconut/copra, cocoa and natural
rubber, with commodity-specific varieties, grades and units. It also adds an
immutable price-basis taxonomy on every observation. Use the topbar
**Commodity** selector (or `?commodity=`) to switch.

Commodities without an integrated source show their configured profile only.
No prices are estimated. See [docs/COMMODITY_MODEL.md](docs/COMMODITY_MODEL.md).

## AI assistant (optional)

`/assistant` answers English or Kannada questions using only ANI tool results (prices, index, forecasts, arrivals,
production, trade, weather, advisories and calculators) and cited document excerpts (CPCRI, DASD). The LLM explains
facts but never supplies numbers, and ungrounded answers fall back to a rule-based answer. It is off by default
(`ASSISTANT_LLM_PROVIDER=none`), and the rest of ANI does not depend on it. Local setup with Ollama
(`qwen3.5:4b`, `bge-m3`), document ingestion and limitations: [docs/AI_ASSISTANT.md](docs/AI_ASSISTANT.md).

## Frontend overview

Market pages (overview, prices, analytics, comparison) switch between the official AGMARKNET feed and cooperative
feeds without mixing price bases. Tables sort, paginate and export bounded CSV. Charts are lazy-loaded and show
observed values only. `/forecasts` and `/forecasts/evaluation` chart actual backtests, including poor performance.
`/workspace` stores organization or role dashboard profiles (filters and sections) in browser localStorage only.

## Performance, archive and backups

Migration `0015` adds compound indexes, a trigger-maintained daily summary cache, idempotent import
keys, `operational_errors`, an `archive_objects` registry and no-delete guards on evidence tables.
Migration `0016` lets verified R2 offload clear a cooperative snapshot without allowing any rewrite.
Public list and chart endpoints are bounded and paginated; the browser never loads the full history.

```sh
npm run db:backup                                   # wrangler d1 export + SHA-256 manifest
npm run db:restore-check -- backups/<name>.manifest.json
npm run retention:temp                              # dry-run purge of data/tmp (add -- --apply)
```

R2 is optional and off by default; local development needs no R2 configuration.

## Tests and build

```sh
npm run build
npm test
python3 -m pip install -r data-platform/requirements.txt
python3 -m pytest -q tests/data
```

## Cloudflare deployment

Deployment is not configured until a real D1 database, Worker secrets, Pages project, account ID and API token are provided.

1. Create a D1 database: `npx wrangler d1 create ani-market-data --config api/wrangler.toml`. Set the returned `database_id` in `api/wrangler.toml`.
2. Apply migrations: `npx wrangler d1 migrations apply ani-market-data --remote --config api/wrangler.toml`.
3. Optionally take a backup first (`npm run db:backup -- --remote`) on later deployments; see [docs/DATA_RETENTION_AND_BACKUP.md](docs/DATA_RETENTION_AND_BACKUP.md). Configure API secrets with `npx wrangler secret put INGESTION_TOKEN --config api/wrangler.toml` and `npx wrangler secret put ADMIN_TOKEN --config api/wrangler.toml`. Configure `CORS_ORIGIN`, `MIN_INDEX_MARKETS`, and `REFERENCE_STATE` as Worker vars.
4. Create a GitHub environment named `production`, with approval rules where your GitHub plan supports them. Configure `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as Actions secrets available to that environment. Set `CLOUDFLARE_PAGES_PROJECT_NAME` and `VITE_API_BASE_URL` as **repository** variables; the API URL must be HTTPS and end in `/api/v1`. Set the production frontend's exact HTTPS origin in `CORS_ORIGIN` in `api/wrangler.toml`. Worker runtime secrets from step 3 are distinct from GitHub deployment credentials.
5. Only when ready to deploy, set the repository variable `CLOUDFLARE_DEPLOY_ENABLED=true` and dispatch `.github/workflows/deploy-cloudflare.yml` from the default branch. The workflow runs build/tests and local migration validation, rejects placeholder D1/production CORS configuration, applies remote migrations, then deploys the Worker. Pages waits for the Worker and is skipped unless its project and API URL variables are configured. Merely pushing code does **not** deploy. For command-line deployment instead, apply the migrations in step 2 before running `npx wrangler deploy --config api/wrangler.toml` and `npx wrangler pages deploy frontend/dist --project-name=YOUR_PAGES_PROJECT`.

The scheduled AGMARKNET workflow runs the daily connector only when the `ANI_API_URL` and `AGMARKNET_PRICE_UNIT` repository variables are configured, and skips with a warning unless the `DATA_GOV_IN_API_KEY` and `INGESTION_TOKEN` repository secrets are present. Apply migration 0012 before enabling it.

Migrations `0015`/`0016` must be applied before the Worker that uses them is deployed. R2 is not required: leave the `[[r2_buckets]]` block commented out unless an archive bucket has been created (`npx wrangler r2 bucket create ani-evidence`). `ARCHIVE_SCHEDULE_ENABLED`, `ARCHIVE_OFFLOAD_MIN_BYTES` and `TEMP_RETENTION_DAYS` are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Deployment success has not been claimed or tested in a Cloudflare account.

## Preparing your first GitHub push

The project can be pushed without Cloudflare credentials or data-provider
keys. CI builds and tests code using isolated test databases; it does not
fetch live publisher data. Deployment is manual and disabled until explicitly
configured. Scheduled AGMARKNET ingestion is skipped without its repository
variables and secrets.

The ignore rules exclude local environment files (including local/production
variants), Worker state, SQLite databases, dependencies, build output,
raw/processed data, logs and private keys. Commit the lockfile, migrations,
source files and blank environment examples. Local database contents and
captured reports do **not** travel with the source repository; a fresh clone
starts without your populated market records.

Before staging, inspect what Git will include:

```sh
# Run git init only if this folder is not already a Git repository.
git init -b main
git add .
git status --short
git diff --cached --stat
git diff --cached -- .env api/.dev.vars
```

The last command must produce no output. Confirm that no environment files,
credentials, database exports or local source captures are staged. Ignore
rules do not remove files already tracked in an existing repository; untrack
any such files before committing, without deleting the local originals.
If credentials were ever exposed or committed, rotate them; adding an ignore
rule does not erase Git history.

After you inspect the staged files, create your own commit and push to your
chosen GitHub repository. No GitHub remote, commit, push or deployment is
created automatically by the project. Choose public/private visibility and
licensing deliberately; this project does not grant redistribution rights
to third-party market data or source publications.

For a fresh clone, follow local setup above, then restore/re-fetch authorized
records explicitly. Monthly backfill, independent-source capture and forecast
evaluation commands are documented above. Cooperative captures still require
review and retain all source/unit qualifications. Do not commit populated
databases to make a demonstration portable.

## Scope and limitations

- Implemented now: market overview, market-price explorer, exact-variety reference-index analytics, same-date cooperative comparison, data-quality review, monthly historical analytics with revisions/coverage, actual-input realization/profit/hold tools, independently sourced production/weather/trade/policy/news records, real-report quality workflow, evaluated one-month price baselines, AGMARKNET CSV and configurable data.gov.in ingestion.
- Not yet implemented: advanced taxonomy/mapping tools, advanced/prospectively validated forecasting, financial recommendations, complete/live trade or news coverage, measured lot data without real reports, grounded AI, individual authentication/roles, production alerts, cloud deployment validation, and automated browser/E2E tests.
- Imported markets keep source names and remain unverified until a reviewer approves an observation. Variety labels are retained as reported and never merged automatically.
- Monthly and cooperative source access/imports were verified locally. Official daily APMC access/backfill remains blocked on human CAPTCHA or authorized access; cooperative quotations are published separately, not as official modal prices.
- Split the initial Worker module into route and explicit repository interfaces as additional backend domains are added.
- The JavaScript entry bundle is approximately 260 KB minified (82 KB gzip); the accessible ECharts line-chart bundle is lazy-loaded at 539 KB minified (183 KB gzip) and should be revisited before production.
- Python unit tests use the standard library. Pandas, DuckDB and forecasting dependencies are not needed for this first ingestion slice.
