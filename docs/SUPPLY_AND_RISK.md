# Areca Pulse — Supply, production and agricultural-risk analytics

Migration `0018_supply_production_risk.sql`, `api/src/supply.ts` (pure logic), `api/src/supply-routes.ts`
(routes) and the frontend page `/supply` (`frontend/src/pages/SupplyPage.tsx`).

The existing DASD production capture (`/intelligence/production`) and the Sirsi Open-Meteo weather capture
(`/intelligence/weather`) are unchanged and remain the evidence base. The new layer reads them through views
and adds append-only tables for authorized imports.

## Principles

- Every API response and every frontend table states its **source** and **reporting period**.
- Missing data is reported as missing. Nothing is interpolated, apportioned or synthesized.
- State totals are **never distributed** to districts. District analysis appears only when a publisher reports
  district figures and they are imported as `geography_level = "district"` rows.
- Observations, model estimates and forecasts are stored in separate tables and labelled separately.
- Crop-risk output is a **watch level, never a diagnosis**. Weather alone can at most produce a
  `weather_watch`. The elevated `field_reported` level needs reviewer-verified field evidence.
- Karnataka is the default geography everywhere.

## Source access findings (checked 2026-11-04/05)

| Source | Finding | ANI handling |
|---|---|---|
| DASD (dasd.kerala.gov.in) | Public PDFs; already captured by the intelligence pipeline | `production_estimates` view unions DASD captures with imported documents |
| AGMARKNET daily API (data.gov.in `9ef84268…`) | Exposes prices only, **no arrival quantities** | Arrivals need an authorized file import (`source_key = agmarknet`) |
| AGMARKNET 2.0 weekly/monthly arrivals (checked 2026-11-17) | Public market-wise reports in metric tonnes; daily arrivals need a CAPTCHA or login | `market_arrival_periods`, see [AGMARKNET_V2_ARRIVALS.md](AGMARKNET_V2_ARRIVALS.md) |
| KRAMA, Department of Agricultural Marketing, Karnataka (checked 2026-11-17) | Public daily market × variety × grade arrivals (quintals) and prices, 2014 onward | `market_arrival_days`, see [DAILY_ARRIVALS.md](DAILY_ARRIVALS.md) |
| eNAM | No public API | Authorized CSV/file import only (`source_key = enam`) |
| IMD APIs | Registration, an API key/JWT and a **whitelisted static IP**. Cloudflare Workers have no static egress IP | Authorized import (`provider = imd`) through an operator-run relay or file. No scraping |
| Open-Meteo | Free for non-commercial use, CC BY 4.0; model output, not station data | Optional development source. `OPEN_METEO_ENABLED=false` disables the scheduled capture |
| ICAR-CPCRI | Published extension PDFs (Vittal) describe fruit rot, bud rot, yellow leaf disease and root grub | Seeded as **draft** rules with citations. No thresholds or treatments are seeded |

The CPCRI material is old in places: for example, it recommends chemicals that are now banned, such as
endosulfan and phorate. ANI therefore stores no management guidance until a qualified reviewer supplies it.
No verified primary CPCRI source was found for **areolate mildew**. Its rule is seeded as `unknown` /
`unverified` and cannot be approved until a reviewer adds a verified citation.

## A. Production intelligence

**Tables:**
- `production_estimate_documents` and `production_estimate_records` are append-only.
- The `production_estimates` view combines DASD captures with imported documents.

**Fields:**
- Reporting year (`YYYY-YY`, consecutive years).
- Geography level (country, state or district).
- Area (thousand ha), production (thousand t) and yield (kg/ha).
- `estimate_type`: `first_advance`, `second_advance`, `third_advance`, `final` or `unspecified`.
- Publication date with its precision.
- Source URL and the document's SHA-256.

**Revision history.** Every capture or import is a vintage. `currentSeries` picks the most mature stage for
each year (final > third > second > first > unspecified), then the latest publication. `revisionHistory`
lists changes between vintages, with deltas and the previous stage.

**Growth.** Year-on-year growth is computed only between consecutive years, alongside a CAGR. Any growth figure
that spans different estimate stages is flagged `mixed_estimate_types`.

**Forecasting.** Production forecasts are suppressed below 15 annual points. 5 are available today.

**Endpoints:**
- `GET /api/v1/supply/production?geography=Karnataka&compare=All India`
- `GET /api/v1/supply/production/districts?state=Karnataka`: returns an explicit message when no original
  district records exist.
- `POST /api/v1/admin/supply/production/documents` (admin token): an all-or-nothing import that is idempotent
  on `source_key` + `content_sha256`. Districts must resolve through `geography_districts` /
  `geography_aliases`, and unknown districts are rejected.

## B. Market arrivals

**Table.** `market_arrivals` is append-only and holds two separate measures:
- `arrival`: the quantity arriving at the market.
- `traded`: the quantity transacted.

The two measures are **never summed together**. The Supply page shows the traded columns only when a period in view
has a traded quantity; the daily-report sources (KRAMA, AGMARKNET) publish arrivals only.

**Units.** Tonnes, quintals and kilograms are converted to tonnes. Rows with any other unit are kept with
`unit_status = unknown_unit` and excluded from totals; the count of such rows is shown.

**Import.** `POST /api/v1/ingest/arrivals` (ingestion token) accepts up to 2,000 rows. It requires a source
URL, an authorization note and the file SHA-256. Duplicates and conflicting quantities are detected both
within the file and against stored rows, and conflicts are rejected.

**Analytics:**
- `GET /api/v1/supply/arrivals?granularity=daily|weekly|monthly|seasonal&from&to&district&market&source`
  (maximum range 1,100 days). Weeks start on Monday, and seasons follow the IMD meteorological seasons.
  Market participation is reported as the number of markets and reporting days.
  - **Default window (no `from`/`to`):** whole periods only. Daily: the last 31 days. Weekly: 26 completed weeks.
    Monthly: 12 completed months. Seasonal: 4 completed seasons.
  - **Order:** buckets come back in calendar order.
- `GET /api/v1/supply/arrivals/price-comparison` pairs arrivals with **reviewer-verified AGMARKNET APMC prices on the
  same market, date and variety** only.

**Current state.** No file-import arrival rows exist, because no authorized file has been imported. Daily arrivals come
from KRAMA (scheduled) and AGMARKNET 2.0's date-wise report (operator session); they are stored in `market_arrival_days`
(migration 0027, [DAILY_ARRIVALS.md](DAILY_ARRIVALS.md)). AGMARKNET 2.0 weekly and monthly market totals are stored
separately in `market_arrival_periods` (migration 0026, [AGMARKNET_V2_ARRIVALS.md](AGMARKNET_V2_ARRIVALS.md)).

- **Supply page, daily data.** With `DAILY_ARRIVALS_IN_SUPPLY = "true"`, `GET /supply/arrivals` includes daily rows at
  every granularity. KRAMA is used for every date it reports.
- **Supply page, monthly totals.** With `AGMARKNET_V2_ARRIVALS_IN_SUPPLY = "true"`, closed-month totals are added only
  for months without daily rows.
- **No double counting.** A market-day or market-month that already has file-import rows uses those instead.
- **Raw data.** `GET /api/v1/supply/arrival-days` and `GET /api/v1/supply/arrival-periods` return the stored rows as
  published.
- **Forecasts.** Arrival forecasts are suppressed below 104 weekly points, counted from `market_arrivals` only.

## C. Weather

**Tables.** Each dataset is stored separately:
- `weather_history_records`: data types `station_measurement`, `model_grid` and `reanalysis`.
- `weather_forecast_records`: types `official_forecast` and `model_grid`.
- `weather_warnings`.

Every import batch records the provider, dataset, source URL, authorization note and content hash.

**Open-Meteo:**
- The existing Sirsi capture now also stores mean relative humidity (`weather_records.relative_humidity_mean_pct`).
- Its rows are exposed through the `weather_model_capture_days` view as `model_grid`.
- `POST /api/v1/admin/supply/weather/open-meteo-archive` (admin token, ≤366 days, ending ≥6 days ago)
  backfills ERA5 **reanalysis**. Reanalysis is labelled as model-derived and is not a station observation.
- The weather import endpoint refuses `station_measurement` from Open-Meteo.

**IMD and other official sources.** `POST /api/v1/admin/supply/weather/imports` (admin token) accepts
`history`, `forecast` or `warning` datasets. Records are inserted idempotently and the response reports
stored and skipped counts.

**Display rules.** When several data types exist for a day, analysis prefers station measurements, then
reanalysis, then model output. Freshness is reported for the model capture (36-hour threshold) and for the
latest imports. Seasonal summaries report coverage and are marked partial when days are missing.

**Endpoint.** `GET /api/v1/supply/weather?state=Karnataka&district=Uttara Kannada&from&to` (default 120 days).

**Local verification.** 364 days of ERA5 reanalysis (2025-11-01 to 2026-10-30) were imported for the Sirsi
grid. A repeated import stored 0 rows and skipped 364.

## D. Arecanut crop risk

**Tables:**
- `crop_risk_rules`: immutable versions, with id `rule_key-vN`.
- `crop_risk_rule_reviews`.
- `crop_field_reports`.

**Seeded rules.** Five draft rules are seeded:
- Mahali/fruit rot and bud rot: `weather_linked`.
- Yellow leaf disease: `not_weather_driven`.
- Root grub: `weather_linked`.
- Areolate mildew: `unknown`, unverified.

None has thresholds or guidance.

### Expert-review workflow

1. **Draft a version.** An admin posts a new version to `POST /api/v1/admin/supply/risk/rules`. It may carry
   weather conditions, guidance and citations, and it is always a draft.
2. **Approve or reject.** A qualified reviewer posts `POST /api/v1/admin/supply/risk/rules/:id/review` with
   `approve | reject | retire`, a name, a qualification and a note. Approval is refused unless all of these hold:
   - It is the latest version of the rule.
   - It has a verified citation.
   - Weather relevance is established.
   - Weather-linked rules have valid conditions: a window, optional months, and rainfall, rainy-day, humidity
     or temperature criteria with a minimum coverage.
3. **Generate advisories.** Only the highest approved version of each rule key produces advisories. A later
   draft does not unpublish it.
4. **Verify field reports.** Field reports go to `POST /api/v1/ingest/risk/field-reports`. A reviewer then
   verifies or rejects each one at `POST /api/v1/admin/supply/risk/field-reports/:id/review`.

**Advisory levels.** `GET /api/v1/supply/risk/advisories?district&as_of` returns one of four levels:
- `field_reported`: verified reports exist.
- `weather_watch`: the approved weather criteria are met.
- `insufficient_data`: weather coverage is below the minimum.
- `no_advisory`.

Each advisory carries the disclaimer, its citations and the period and data types of the weather basis.
Currently **no rule is approved, so no advisory is issued**.

## E. Analytics summary

| Analysis | Status |
|---|---|
| District production comparison | Ready; empty until original district records are imported |
| Historical production growth | Live (DASD 2021-22 to 2025-26, Karnataka and All India) |
| Weather and seasonal analysis | Live for Uttara Kannada (Sirsi grid); other districts are empty until imported |
| Arrival trends | Live: daily from KRAMA (2014 onward as the backfill completes) and AGMARKNET date-wise (2021–2026), monthly totals from AGMARKNET 2.0 for months without daily data |
| Production and arrival forecasts | Suppressed by data-sufficiency gates (15 annual / 104 weekly points) |

## F. Tests

`api/src/supply.test.ts` (22 tests) covers:
- Reporting-year parsing and IST date alignment, including Monday week buckets and IMD seasons.
- Revised statistics and estimate-stage precedence.
- Mixed-stage growth flags.
- Missing datasets and empty states.
- District alias mapping and rejection of unknown districts.
- Arrival measure separation, unit handling and duplicate/conflict rejection.
- Price pairing restricted to validated APMC prices.
- Weather freshness, humidity parsing and data-type labelling.
- Rejection of Open-Meteo "station" imports.
- The rule approval gates and the guarantee that weather alone never yields more than a watch.

## Configuration

| Setting | Default | Purpose |
|---|---|---|
| `OPEN_METEO_ENABLED` | unset (enabled) | Set `"false"` to stop the scheduled Sirsi Open-Meteo capture in production |
