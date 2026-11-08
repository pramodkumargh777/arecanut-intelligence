# AGMARKNET daily history (data.gov.in), an add-on

Code: [`data-platform/connectors/agmarknet/history.py`](../data-platform/connectors/agmarknet/history.py),
CLI: [`run_history.py`](../data-platform/connectors/agmarknet/run_history.py),
API: [`api/src/agmarknet-history.ts`](../api/src/agmarknet-history.ts),
schema: [`0021_agmarknet_history_source.sql`](../api/migrations/0021_agmarknet_history_source.sql),
schedule: [`.github/workflows/agmarknet-history.yml`](../.github/workflows/agmarknet-history.yml).

The [current-daily connector](AGMARKNET_DAILY_CONNECTOR.md) is unchanged. This add-on fills the past dates that
connector cannot reach, because its resource only ever returns today.

## Why this is possible without the AGMARKNET CAPTCHA

The CAPTCHA protects the report pages on agmarknet.gov.in. The same AGMARKNET data is published on data.gov.in,
whose API needs only the `DATA_GOV_IN_API_KEY` the daily connector already uses. Sites such as CommodityMarketLive,
ACROP and Krishimitra name AGMARKNET / data.gov.in as their source; their figures match this resource.

## Source

| Item | Value |
|---|---|
| Resource | `35985678-0d79-46b4-9ed6-6f13308a1d24`: "Variety-wise Daily Market Prices Data of Commodity" |
| Coverage (checked 8 Nov 2026) | 257,009 Karnataka arecanut rows, 2014 to the previous day; refreshed nightly (about 05:00 IST) |
| Fields | `Arrival_Date` (DD/MM/YYYY), `State`, `District`, `Market`, `Commodity`, `Commodity_Code`, `Variety`, `Grade`, `Min_Price`, `Max_Price`, `Modal_Price` |
| Filters | `filters[State]`, `filters[Commodity]` and `filters[Arrival_Date]` all work |
| Not published | unit, arrival quantity, record ID (same as the daily resource) |

Values for the same market and date match the current-daily resource (checked: Kumta APMC, Factory, 6 Nov 2026).

## How it stays out of the way of the current setup

- **Own source key and endpoint.** Records are stored under `agmarknet_history` and sent to
  `POST /api/v1/admin/agmarknet-history/import`. `POST /admin/import` and the daily connector are untouched.
- **No double counting.** The API never inserts a market, date, variety and grade that another source already holds
  (for example a daily row, whatever its review state). Readers never see the same mandi price twice.
- **Recent dates belong to the daily connector.** History only fetches dates at least 2 days old (IST; `--lag-days`).
- **Same checks as the daily connector.** Validation and normalization are imported from `daily.py`. Rejected:
  missing fields, wrong state or commodity, bad or future dates, non-positive prices, and conflicting duplicates
  (the source reporting one market/variety/grade/date with two prices). Flagged for review: min ≤ modal ≤ max
  violated, or an implausible magnitude.
- **Publishing.** With `AGMARKNET_HISTORY_AUTO_VERIFY = "true"` (wrangler.toml), a record that passed every check is
  verified at import, and its approval is written to `observation_reviews` under the reviewer
  `auto-validation-history-v1`. Flagged records wait in Data quality like any other. Set it to `"false"` to send every
  history record to the review queue instead. Records already imported keep their status if the setting changes.
- **D1 free tier.** One request carries at most 5 records (8 statements each, 46 queries per request at most).

## Market names

AGMARKNET renamed districts and markets in 2025–2026, in three steps:

| Period | Market | District |
|---|---|---|
| to late 2025 | `Sirsi` | `Karwar(Uttar Kannad)` |
| late 2025 – mid 2026 | `Sirsi APMC` | `Karwar(Uttar Kannad)` |
| current | `Sirsi APMC` | `Uttara Kannada` |

A market's ID is a hash of state, district and market, so each old name would otherwise be a separate market. Worse,
during the changeover data.gov.in published **the same price under both the old and the new name on the same day**.
Without mapping, one market would count twice on those days, which skews the reference-index median and its market
count. `LEGACY_DISTRICTS` and `LEGACY_MARKETS` in `history.py` map every old name to its current one.

- Each non-obvious mapping was checked on the source (8 Nov 2026): on days where both names appear, variety, grade and
  prices are identical. Checked: Sirsi, Tumkur → Tumakuru, Mangalore → Mangaluru, Shimoga(Theertahalli) →
  APMC THIRTHAHALLI, Sagar(Hosanagara) → Hosanagara, Mysore (Bandipalya) → Mysuru, Chamaraj Nagar → Chamarajanagar,
  Chikkamagalore → Chikkamagaluru, Piriya Pattana → Periyapatna. Moodigere → Mudigere and Doddaballa Pur →
  Doddaballapur are spelling variants of the same towns.
- Markets with no current counterpart (Bangalore, Malur, Pavagada, Sringeri, Gundlupet, Ramanagara, Sakaleshpura) keep their own
  names. The Bangalore and Kolar districts were split, so they are mapped per market, not as districts.
- When rows land on one market, variety, grade and date after mapping:
  - **Same price:** one copy is kept, preferring the row that already uses current names; the rest count as duplicates.
  - **Different prices:** both are rejected as `canonical_market_collision`, since that would mean a wrong mapping.
- The source's own names are kept in `raw_payload`.
- Every run reports the renames it applied (`renamed_markets`) and the markets it stored (`markets`).
- If AGMARKNET renames a market again, add it to the maps. A re-run stores the record under the new market and
  supersedes the old one, with its version kept.

## Running

```sh
# Uses the same .env as the daily connector: DATA_GOV_IN_API_KEY, AGMARKNET_PRICE_UNIT=Rs./Quintal,
# ANI_API_URL, INGESTION_TOKEN. Apply migration 0021 first.
.venv/bin/python data-platform/connectors/agmarknet/run_history.py --start 2021-01-01 --end 2021-12-31 --dry-run
.venv/bin/python data-platform/connectors/agmarknet/run_history.py --start 2021-01-01 --end 2021-12-31
.venv/bin/python data-platform/connectors/agmarknet/run_history.py --recent-days 14
```

- Work is done one month at a time. Each month writes `ingestion_summary.json`, `rejected_records.json` and
  `raw_source_pages.jsonl` under the report directory, posts a run record to `/admin/source-runs`, and prints a
  progress line.
- Re-running any range is safe. Completed batches are replayed, not re-imported, so an interrupted run can simply be
  started again.
- Exit code 2 means a date could not be fetched or an import failed; re-run that range.
- Cloudflare D1 Free allows about 100,000 rows written per day for the whole database, and each record costs several
  writes. For a manual run, stay at about 3 months per day (see Schedule).

**Schedule.** Nothing needs starting by hand. `agmarknet-history.yml` runs daily at 07:00 IST, after data.gov.in's
nightly refresh:

1. `--recent-days 14` fills any recent date the daily runs missed.
2. `--backfill-from 2021-01-01 --backfill-max-records 4000` reads the oldest stored history date
   (`GET /admin/agmarknet-history/coverage`, INGESTION_TOKEN) and fills older months, newest first, until the day's
   record budget is used. Once it is within a week of 2021-01-01 it does nothing more.
   - **Budget.** Measured with Cloudflare's local D1 engine (June 2023, 1,004 records): 17.4 D1 rows written per
     record, including the summary-cache rebuild. 4,000 records is about 70,000 of D1 Free's 100,000 writes per day,
     leaving the rest for the daily import and cooperative collection. About 63,500 records date from 2021, so the
     backfill takes about 16 days. Change the budget with the repository variable `AGMARKNET_HISTORY_DAILY_RECORDS`;
     on Workers Paid (50 million writes a month included), 100000 finishes it in one run.
   - **No gaps.** A month is all or nothing: one with a failed date stores nothing and is retried whole the next day,
     and a month that does not fit the day's budget waits whole. Within a month, the newest dates are stored first, and
     each run restarts at the oldest stored date, so an interrupted import is completed the next day.
   - **Write cost.** Clean records are stored as verified in one write rather than inserted and then updated
     (22.1 → 16.6 rows written per record).

It uses the same repository variables and secrets as `agmarknet-ingestion.yml`, and the same Mumbai relay
(`AGMARKNET_API_BASE_URL`). The deploy workflow deploys the relay.

**Status.** `GET /api/v1/admin/source-status` and the Data-source status panel list `agmarknet_history` with its
observation counts, coverage and recent runs.

## Limitations

- The dataset has gaps of its own. Some dates carry far fewer markets than usual (15 Jan 2024 had 3 rows). Dates
  with no rows are listed in each run's `dates_with_no_records`; nothing is interpolated.
- The unit is the same operator-confirmed `Rs./Quintal` as the daily connector, not a publisher declaration.
- The reference index still groups by exact variety, not grade (see the daily connector's limitations).
