# Daily arecanut arrivals (KRAMA and AGMARKNET date-wise)

Connectors: [`data-platform/connectors/krama/`](../data-platform/connectors/krama/) and
[`agmarknet_v2/run_daily_arrivals.py`](../data-platform/connectors/agmarknet_v2/run_daily_arrivals.py).
API: [`api/src/daily-arrivals.ts`](../api/src/daily-arrivals.ts).
Schema: [`0027_daily_arrivals.sql`](../api/migrations/0027_daily_arrivals.sql).
Schedule: [`.github/workflows/krama-arrivals.yml`](../.github/workflows/krama-arrivals.yml).

This adds market, day, variety and grade arrival quantities. It is additive only:

- Nothing is written to `market_price_observations`, the reference index, `market_arrivals` or the AGMARKNET 2.0
  weekly/monthly tables.
- The price connectors are unchanged.
- The arrival reports' own prices are stored as provenance only. They never enter a price calculation.

## Sources

| | KRAMA (primary) | AGMARKNET 2.0 date-wise (secondary) |
|---|---|---|
| Publisher | Department of Agricultural Marketing, Government of Karnataka (Krishi Marata Vahini) | Directorate of Marketing & Inspection |
| Page / endpoint | `https://krama.karnataka.gov.in/Reports/Main_rep` → Commoditywise Daily Report → Arecanut | `GET https://api.agmarknet.gov.in/v1/prices-and-arrivals/date-wise/specific-commodity?year&month&stateId=16&commodityId=118` |
| Access | Public, no login or CAPTCHA | Needs an AGMARKNET login token (guest login lasts about 1 hour and cannot be renewed) or a solved CAPTCHA |
| Content | Market, variety, grade, arrivals, **unit (Quintal)**, min/max/modal price, for one date | Market, date, variety, arrivals (Metric Tonnes), min/max/modal price, for one month; no grade or district |
| History | At least 2014 | 2021 onward (saved for January 2021 to October 2026) |
| Automation | Scheduled (unattended) | Manual, during an operator's logged-in session |

KRAMA is the state system the APMCs report into, and AGMARKNET's Karnataka figures come from it. The two sources were
checked against each other and against AGMARKNET's monthly totals:

- **13 Nov 2026, Sirsi Bette:** 4 quintals and modal ₹40,171 in KRAMA, 0.4 t and ₹40,171 in AGMARKNET.
- **15 Jan 2021, state total:** KRAMA 1,118.9 t, AGMARKNET 1,117.0 t. AGMARKNET rounded to whole tonnes then.
- **AGMARKNET daily against AGMARKNET monthly:** the daily rows sum to the published monthly total for 1,996 of 1,997
  market-months (2021–2026). The exception, Madhugiri in October 2026, was revised at the source after publication.

### How KRAMA is read
1. `GET /Reports/Main_rep` returns an ASP.NET form.
2. Post `TxtDate=dd/mm/yyyy` and `RadBtnSel=C`. This lands on `/reports/Commadity`, the commodity list for that day; its
   date line must match the requested date.
3. If the list has no arecanut checkbox (`140`), the day is stored as `not_reported`.
4. Otherwise, post `140=on`. This lands on `/reports/CommadityRep`.
   - The heading must read `MARKETWISE REPORT FOR VARIOUS COMMODITIES AS ON dd/mm/yyyy`, followed by
     `COMMODITY: Arecanut`.
   - There must be one table, with exactly the columns `Market`, `Variety`, `Grade`, `Arrivals`, `Units`,
     `Min (Rs.)`, `Max (Rs.)` and `Modal (Rs.)`.

Any other layout fails the date, and nothing of it is stored. Requests are made one at a time, at least 2 s apart.

## Storage

| Table | Holds |
|---|---|
| `arrival_daily_documents` | One row per distinct source document. For KRAMA: the heading, commodity line and report table **verbatim** (about 11 KB), plus the full page's SHA-256 and size. For AGMARKNET: the JSON response verbatim. Also the request URL and parameters, fetch time and parser version. Immutable. |
| `market_arrival_days` | The rows the API parsed from each document, as published: original quantity and unit, tonnes, and blank prices kept blank. Append-only. |
| `arrival_market_aliases` | Source market name → AGMARKNET market name and district. 234 seeded mappings. Versioned and insert-only; add more with `POST /admin/arrivals/market-aliases` (reviewer token). |
| `market_arrival_days_current` (view) | For each source and date, the rows of the **latest reported document**. |

How documents become rows:
- **The API parses each document itself.** Connectors only send evidence, so stored rows always follow from stored
  documents.
- **A document is a complete snapshot of its date(s).** A re-read that changes a value or drops a row becomes the new
  current snapshot; the earlier one stays. Imports report `inserted`, `revised`, `removed` and `duplicates`.
- **A `not_reported` day never hides an earlier reported page** for that date.
- **Repeats within a document:** identical repeats collapse to one row. Rows that repeat a market/date/variety/grade
  with *different* values are all rejected and counted (`rejected_rows`).
- **Market mapping:**
  - **KRAMA names** (e.g. `SIRSI`, `YELLAPURA`, `SHIVAMOGGA`) were matched to the AGMARKNET market master by spelling.
    113 mappings are `verified`: identical same-day arrivals and modal prices across 14 sampled dates, or an
    unambiguous identity. The rest are `inferred`.
  - **AGMARKNET names** take their district from AGMARKNET's public market master. Renamed markets map as in migration
    0026.
  - **Unmapped names** still count in state totals. They are listed by `GET /admin/arrivals/daily/coverage`.

## Running

```sh
# KRAMA: last 7 days (default), specific dates, or a backfill within a request budget.
.venv/bin/python data-platform/connectors/krama/run_arrivals.py --dry-run --recent-days 2
.venv/bin/python data-platform/connectors/krama/run_arrivals.py
.venv/bin/python data-platform/connectors/krama/run_arrivals.py --backfill-from 2014-01-01 --backfill-requests 900

# AGMARKNET date-wise: import saved months, or fetch while logged in (AGMARKNET_V2_ACCESS_TOKEN in .env; never stored).
.venv/bin/python data-platform/connectors/agmarknet_v2/run_daily_arrivals.py --from-dir data/raw/agmarknet-v2-daily
.venv/bin/python data-platform/connectors/agmarknet_v2/run_daily_arrivals.py --fetch 2026-11
```

Both need `ANI_API_URL` and `INGESTION_TOKEN`; apply migration 0027 first.

- **Reports.** KRAMA runs write every page fetched and `ingestion_summary.json` to
  `data/processed/krama-arrivals/<stamp>/`, and record a run in `source_ingestion_runs`.
- **Saved AGMARKNET months.** They are in `data/raw/agmarknet-v2-daily/` (git-ignored), with a `manifest.json` holding
  each file's SHA-256. The importer refuses a file whose hash differs.

**Schedule.** `krama-arrivals.yml` runs at 21:30 and 09:30 IST. Each run re-reads the last 7 days, then backfills older
dates, up to `KRAMA_BACKFILL_REQUESTS` (default 900, about 300 dates).

- **Backfill length:** going back to 2014 takes about two weeks of runs.
- **Requirements:** `ANI_API_URL` and `INGESTION_TOKEN`.
- **Stopping it:** set `KRAMA_ARRIVALS_ENABLED=false`.
- **Relay:** if GitHub's runners cannot reach KRAMA, point `KRAMA_BASE_URL` at a relay that forwards cookies and form
  posts. The existing data.gov.in relay does not.

## Reading

**`GET /api/v1/supply/arrivals`** (the Supply page) includes daily arrivals at every granularity when
`DAILY_ARRIVALS_IN_SUPPLY = "true"` (wrangler.toml; off for the first deploy, see "Production rollout").

- **Same response shape**, and the same page section and wording.
- **KRAMA wins a whole date.** AGMARKNET date-wise rows count only for dates KRAMA has no reported rows for.
- **File imports win a market-day.** A market-day that already has daily file imports (`market_arrivals`) uses those.
- **Daily data replaces AGMARKNET 2.0 monthly totals.** A closed month holding any daily rows is not also counted from
  the monthly report.
- **Whole periods only.** Without `from`/`to`, the window holds complete periods, so no partial period reads as a fall in
  arrivals:
  - daily: the last 31 days, including today as reported so far;
  - weekly: the last 26 completed Monday weeks;
  - monthly: the last 12 completed months;
  - seasonal: the last 4 completed IMD seasons.
- **Order.** Buckets are returned in calendar order; seasonal labels do not sort by name.
- **Fails soft.** If either addition fails (for example, code deployed before its migration), the error is logged and the
  response is what it would have been without it.
- **Turning it off:** setting the flag to `"false"` restores the previous response exactly. The stored data is kept.

**Backfill granularity.** The backfill takes whole months within its request budget, so a month is never shown from a
partial set of days.

**Scale.** With 12 years stored (synthetic test: 370,000 rows, 4,700 KRAMA documents), the default views answer in
5–60 ms and a 3-year weekly view in about 0.2 s. The current-snapshot lookup is two index probes per row; a CHECK keeps
every document to one date or one calendar month, so that lookup stays correct.

**`GET /api/v1/supply/arrival-days?from&to&district&market&source`** (public, at most 31 days per request) returns:

- the rows as published: original and mapped market names, quantity and unit, tonnes, and prices;
- the source and the request URL of the source document;
- the same precedence as the Supply page.

**Unchanged:** the arrival forecast gate (it still counts `market_arrivals` weeks) and
`/supply/arrivals/price-comparison`.

## Production rollout

The page should never show a mix of sources while history is still loading. Do it in this order:

1. **Deploy.** The deploy workflow applies migrations 0026 and 0027 before it deploys the Worker.
   - `AGMARKNET_V2_ARRIVALS_IN_SUPPLY` and `DAILY_ARRIVALS_IN_SUPPLY` ship as `"false"`, so the Supply page looks exactly
     as it does today.
   - Imports and the read endpoints work regardless of those flags.
2. **Load KRAMA for the default windows.** From a machine in India, with `ANI_API_URL` pointing at production (about
   45 minutes):
   ```sh
   .venv/bin/python data-platform/connectors/krama/run_arrivals.py --backfill-from 2025-10-01 --backfill-requests 1500
   ```
   This covers every default window: 31 days, 26 weeks, 12 months and 4 seasons.
3. **Load the AGMARKNET 2.0 weekly and monthly totals.** Run `agmarknet-v2-arrivals.yml` (Run workflow), or the same
   connector locally.
4. **Check the stored data before readers see it.** Use `GET /api/v1/supply/arrival-days?from=…&to=…` and
   `GET /api/v1/supply/arrival-periods`.
5. **Switch the page on.** Set both `*_IN_SUPPLY` flags to `"true"` in `api/wrangler.toml` and deploy again.
6. **Leave the rest to the schedules.** `krama-arrivals.yml` keeps the recent days current and fills older history back
   to 2014 over the following days, a month at a time.
7. **Optional:** import the saved AGMARKNET date-wise months (`run_daily_arrivals.py --from-dir …`) once the KRAMA
   backfill has passed 2021. They only fill dates KRAMA does not cover.

For local development, `api/.dev.vars` (git-ignored) sets both flags to `true`.

## Rollback

1. Set `DAILY_ARRIVALS_IN_SUPPLY = "false"`.
2. Stop imports with `DAILY_ARRIVALS_IMPORT_ENABLED = "false"` or `KRAMA_ARRIVALS_ENABLED=false`.
3. To remove everything, use the statements at the top of migration 0027.

## Limitations

- **Fragile page format.** KRAMA is an old ASP.NET form. A redesign stops the connector, failing closed, until the
  parser is updated.
- **No time-of-publication marker.** The 7-day re-read and the snapshot rule handle late uploads and corrections.
- **Variety names differ between sources** (e.g. KRAMA `Coca`, AGMARKNET `Cqca`). Each is stored as published.
