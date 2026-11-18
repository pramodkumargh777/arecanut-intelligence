# AGMARKNET 2.0 arrivals (weekly and monthly)

Code: [`data-platform/connectors/agmarknet_v2/arrivals.py`](../data-platform/connectors/agmarknet_v2/arrivals.py),
CLI: [`run_arrivals.py`](../data-platform/connectors/agmarknet_v2/run_arrivals.py),
API: [`api/src/agmarknet-v2-arrivals.ts`](../api/src/agmarknet-v2-arrivals.ts),
schema: [`0026_agmarknet_v2_arrivals.sql`](../api/migrations/0026_agmarknet_v2_arrivals.sql),
schedule: [`.github/workflows/agmarknet-v2-arrivals.yml`](../.github/workflows/agmarknet-v2-arrivals.yml).

This adds arecanut **arrival quantities** from AGMARKNET 2.0. It is additive only:

- The data.gov.in price connectors ([daily](AGMARKNET_DAILY_CONNECTOR.md), [history](AGMARKNET_HISTORY.md)), the
  monthly report and every price calculation, including the reference index, are unchanged.
- No AGMARKNET 2.0 price is imported.
- Nothing is written to `market_price_observations`, `market_arrivals` or any other existing table. The one exception is
  one new `data_sources` row, plus run records in `source_ingestion_runs`.

## Source (checked 2026-11-17)

| Item | Value |
|---|---|
| Monthly | `GET https://api.agmarknet.gov.in/v1/price-trend/wholesale-arrivals-monthly?report_mode=Marketwise&commodity=118&year=YYYY&month=M&state=16&district=D` |
| Weekly | `GET …/wholesale-arrivals-weekly?…&week=1..4` |
| Districts | `GET …/price-trend/district-filter?commodity=118&state=16` (21 listed; 18 reported arecanut in October 2026) |
| Access | No login, key or CAPTCHA. These are the routes the public website calls, not a documented API: there is no published contract or rate limit. |
| Unit | Stated in every column title: `(Metric Tonnes)`. A different unit rejects the fetch. |
| Coverage | Monthly back to at least 2010. AGMARKNET 2.0 went live on **7 November 2025**. |

- **Only `Marketwise` works.** It is the only `report_mode` accepted for arrivals, so state and district totals are sums
  of market rows.
- **Weeks are month-relative:** days 1–8, 9–15, 16–23, then 24 to month end.
  - They are not Monday weeks, and they differ in length.
  - The four weeks add up exactly to the month (checked for every Uttara Kannada market, October 2026).
- **The open month and open week return partial totals with no marker.** Only periods whose last day is at least 2 days
  past (IST) are taken. The API also refuses any period that has not ended.
- **`null` (or `-` in CSV) means the market published no figure.** It is stored as `not_reported`, never as zero.
- **October 2025 is about 90% low in every market**, around the 2.0 cutover. Rows carry an `era`:
  - `agmarknet_1_legacy`: periods ending before 2025-10-01;
  - `cutover`;
  - `agmarknet_2`: from 2025-11-07.

  Values before about September 2025 are whole tonnes.
- **Daily arrivals are not used.** `daily-price-arrival/report` and `prices-and-arrivals/*` answer
  `TOKEN_OR_CAPTCHA_REQUIRED` to anonymous requests.
  - They do accept a logged-in AGMARKNET session; a guest login lasts about an hour and cannot be renewed.
  - Daily arrivals therefore come from KRAMA, unattended, with AGMARKNET's date-wise report imported from operator
    sessions. See [DAILY_ARRIVALS.md](DAILY_ARRIVALS.md).

## Storage

| Table | Holds |
|---|---|
| `agmarknet_v2_fetches` | Each distinct response, **verbatim**, with request URL and parameters, SHA-256, content type, parser version and fetch time. Immutable. |
| `market_arrival_periods` | One row per market and closed period. Holds the source's own names, period label and column key, the original quantity and unit, and tonnes. Append-only: a changed source value becomes the next `version_number`, and the earlier one stays. |
| `agmarknet_v2_market_aliases` | Renamed source markets mapped to the current AGMARKNET name, versioned. Seeded: `Hosanagar APMC` → `Hosanagara APMC`, and `Shimogga(Theertahalli) APMC` → `APMC THIRTHAHALLI`. |
| `market_arrival_periods_current` (view) | The latest version of each period, with current district and market names, the matching price market id, and `era`. |

**The import checks every record against the stored response itself.** It confirms:

- the URL and parameters;
- that the title names the requested period;
- that the current column (the first arrivals column; later ones are comparison periods) and its unit are right;
- each market's value, or its absence;
- that no market is dropped or duplicated.

Any mismatch rejects the whole request, and nothing is stored.

## Running

```sh
# Needs ANI_API_URL and INGESTION_TOKEN (same .env as the other connectors). Apply migration 0026 first.
.venv/bin/python data-platform/connectors/agmarknet_v2/run_arrivals.py --dry-run
.venv/bin/python data-platform/connectors/agmarknet_v2/run_arrivals.py                       # last 2 closed months + 4 weeks
.venv/bin/python data-platform/connectors/agmarknet_v2/run_arrivals.py --backfill-from 2010-01 --backfill-requests 600
.venv/bin/python data-platform/connectors/agmarknet_v2/run_arrivals.py --backfill-from 2025-11 --backfill-weekly
```

- **Request rate.** Requests are at least 2 s apart (`--min-interval`). The client backs off on 429/5xx and does not
  retry other errors.
- **Reports.** Each run writes `raw_source_responses.jsonl` and `ingestion_summary.json` under
  `data/processed/agmarknet-v2-arrivals/<UTC stamp>/`. It also records a run in `source_ingestion_runs`
  (`POST /admin/agmarknet-v2/arrivals/runs`).
- **Re-running is safe.** Identical values are duplicates. Backfill skips district-periods already fetched
  (`GET /admin/agmarknet-v2/arrivals/coverage`).
- **Exit code 2** means the run failed.
- **TLS.** If Python reports `CERTIFICATE_VERIFY_FAILED`, use an interpreter with a working CA bundle (the repository's
  `.venv` works).

**Schedule.** `agmarknet-v2-arrivals.yml` runs daily at 07:45 IST. It refreshes the recent periods and then backfills
months, up to `AGMARKNET_V2_BACKFILL_REQUESTS` source requests per run (default 400).

- **Requirements:** the `ANI_API_URL` variable and the `INGESTION_TOKEN` secret.
- **Stopping it:** set `AGMARKNET_V2_ARRIVALS_ENABLED=false`.
- **Relay:** if GitHub's runners cannot reach the source, point `AGMARKNET_V2_BASE_URL` at a relay. The existing
  data.gov.in relay does not forward these routes.

## Reading

**`GET /api/v1/supply/arrival-periods?period_type=month|agm_week&from&to&district&market`** (public) returns the
stored periods as published, together with:

- `era`, version and mapping status;
- the source request URL and the fetch time.

**`GET /api/v1/supply/arrivals`** (the Supply page) adds AGMARKNET 2.0 **monthly** totals to the **monthly and seasonal**
views when `AGMARKNET_V2_ARRIVALS_IN_SUPPLY = "true"` (wrangler.toml; on since 2026-11-18, after the
rollout in [DAILY_ARRIVALS.md](DAILY_ARRIVALS.md)).

- **Same response shape**, and the same page section, wording and layout.
- **Closed months only.** A month counts only if it lies wholly inside the requested range.
- **No double counting.** A market-month that already has daily file-import arrivals (`market_arrivals`) uses those
  instead.
- **Weekly and daily views** get no AGMARKNET 2.0 rows, because the weeks do not line up with Monday weeks. They still
  list the source, so the section and its period selector stay on the page.
- **Unchanged:** the arrival forecast gate and the arrival/price comparison.
- **Turning it off:** setting the flag to `"false"` restores the previous response exactly. The stored data is kept.

## Rollback

1. Set `AGMARKNET_V2_ARRIVALS_IN_SUPPLY = "false"` to hide the data from the Supply page.
2. Set `AGMARKNET_V2_ARRIVALS_IMPORT_ENABLED = "false"` or `AGMARKNET_V2_ARRIVALS_ENABLED=false` to stop imports.
3. To remove everything, use the `DROP`/`DELETE` statements at the top of migration 0026. No existing table depends on
   these objects.

## Limitations

- **The routes are undocumented** and may change without notice. The connector then fails closed: unknown titles,
  columns or units reject the fetch.
- **Revision behaviour is unknown.** Revisions are kept as versions, and the recent periods are re-read every day to
  catch them.
- **The Hosanagar → Hosanagara gap** (no data from 2025-06 to 2026-03) is a source gap. The operator confirmed it is the
  same market.
- **District totals** count only markets that reported.
