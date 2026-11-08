# Areca Pulse — Analytics and tools

How the monthly trends, historical analytics, decision calculators and source-intelligence pages work, and the commands that refresh their data.

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

## Historical analytics

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

## Decision tools (actual inputs)

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
module ([FORECASTING.md](FORECASTING.md)) supplies measured one-month forecasting, not an AI recommendation.
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

Customer intelligence pages show reporting periods, sources and platform fetch times. Operators can inspect
capture attempts and refresh weather or official bulletins under **Data quality → Intelligence source health**;
those refresh actions require the reviewer token. Production and trade PDF refreshes remain a local operator
procedure. With the local API running:

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
