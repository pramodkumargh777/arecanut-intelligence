# Cooperative market-rate sources: MAMCOS, TSS and TUMCOS

Status snapshot: 2026-11-04 (IST). This document records what the connectors
actually do and what has been verified against the live sources. Statements
about permissions describe the **recorded** state in the database. They are not
legal advice.

## 1. Separation rules

These rules apply to all three sources:

- Every quotation is stored in `cooperative_quotes`. Its `source_key` is `mamcos`, `tss` or `tumcos`, and its `commodity` is `arecanut` or `black_pepper`.
- Values are the source's **reported averages**. They are never relabelled as APMC modal prices.
- Values are never merged with each other, with the AGMARKNET daily feed or with the monthly feed.
- Every benchmark covers exactly one source, commodity and variety. `cooperativeSeries` throws on mixed commodities.
- The arecanut decision tools and `/history/aggregates` read only rows where `commodity='arecanut'`.
- A quotation can become `verified` (published) only if `price_unit='INR/quintal'` and `unit_status` is `source_confirmed` or `assumed`. Database triggers enforce this.
- **Operator decision (2026-11-05, migration 0020):** TSS and TUMCOS prices are treated as INR/quintal and published after review. They stay labelled `assumed`, because neither source confirms that unit, and the source's own label and raw record are retained.
- A TUMCOS value under 1,000 could genuinely be per kg, so it stays `price_unit='unconfirmed'`. If a reviewer approves such a record it becomes `accepted_unit_unconfirmed` and remains unpublished.
- Missing dates are never filled. Invalid rows are retained with reasons and cannot be approved.

## 2. Source facts and recorded compliance state

Robots and terms were checked on 2026-11-04. Every source is seeded as follows:

- `permission_status = not_requested`
- `scheduled_collection_allowed = 0`
- `redistribution_allowed = 0`

| Source | Access used | Robots / terms observed | Unit evidence | Variety | Publication |
|---|---|---|---|---|---|
| MAMCOS (`https://mamcos.info/areca-market-rates`) | Public HTML page | robots.txt disallows only `/admin` and `/api/`. No terms or data-reuse licence found; footer says "All rights reserved". | The page declares "All market rates are in ₹ per Quintal". The parser fails closed if this declaration is missing. | Exact source names | Reviewed rows can be verified. UI label: **Permission not confirmed**. |
| TSS (`https://web.tssindia.in/`, via the public `webapi.tssindia.in` endpoints used by that page) | Public JSON used by the public site | robots.txt files contain only Cloudflare content-signal definitions, with no rules. No terms found. | **No unit anywhere**. INR/quintal is an assumption (`unit_status='assumed'`, enforced by trigger). | Exact labels `RASHI`, `BETTE`, `CHALI`, `MURI`, `KOLE`, `ARECANUT`. Other items are archived but excluded. | Kept in the review queue. Approval gives `accepted_unit_unconfirmed`, so nothing is published. |
| TUMCOS (`https://www.tumcos.com/market-rates.php?lang=en`) | Public HTML page with embedded JSON | robots.txt returns HTTP 404. Footer says "All rights reserved". Disclaimer: "Rates are indicative and may vary." | Every record declares `unit: "kg"`, but values are about 22,000–70,000, which is only plausible per quintal. Stored as `unit_status='source_conflict'`, `price_unit='unconfirmed'`, with the source label preserved. | **Not reported.** The source's commodity name is stored with `variety_reported=0` and the flag `variety_not_reported`. | Kept in the review queue. Approval gives `accepted_unit_unconfirmed`, so nothing is published. |

TUMCOS covers **Channagiri** only, for arecanut and black pepper. Its page
header "Last Updated" read **03 Apr 2026**, while embedded records run to
**2026-11-04**. The connector uses the record dates and reports the header as
`stale_page_metadata`.

### Recording a permission decision

To record a decision, use `POST /api/v1/admin/cooperative/sources/:key/permission`, or the **Record permission decision** form in Data quality → Cooperative source intelligence.

- A `granted` status requires a written `permission_reference`.
- `scheduled_collection_allowed` and `redistribution_allowed` can be true only when the status is granted.

No grant has been recorded for any source.

## 3. Scheduled collection gate

The Worker cron (`30 3 * * *`, 09:00 IST) runs a source only when all three of these hold:

1. Its flag is `"true"`: `MAMCOS_SCHEDULE_ENABLED`, `TSS_SCHEDULE_ENABLED` or `TUMCOS_SCHEDULE_ENABLED`.
2. The registry records `permission_status='granted'`.
3. The registry records `scheduled_collection_allowed=1`.

If the flag is on but permission is missing, the run is recorded as a `blocked` fetch with the reason and nothing is requested from the source. Manual, reviewer-initiated refreshes remain available; their results still need review.

## 4. Captured fields

| Source | Fields |
|---|---|
| MAMCOS | Branch, reporting date, exact variety, min, max, reported (cooperative) average, source URL, fetch timestamp, raw row. |
| TSS | Location/session, tender date (must equal the requested date), exact variety, min, max, `avgrate` (reported average) and `norrate` (normal rate, kept separate). Optionally (`include_lots`): lot count, bag count, reported weight (unit unconfirmed) and session codes, aggregated from the public tender endpoint. |
| TUMCOS | Commodity, market (location), reported name, reporting date, low, average, high, source record ID, source `created_at` (as publication timestamp), source unit label. |

**TSS privacy:**
- The tender endpoint returns lot-level rows containing seller and buyer identities. These rows are **never stored**.
- Only per-variety lot, bag and weight aggregates are kept, together with the tender URL, a SHA-256 hash of the response and row counts.

## 5. Shared mechanisms

- **Raw snapshots:** every fetch stores the source response in `cooperative_fetches.raw_snapshot`. A trigger makes it immutable once written. Raw and price fields on quotations are immutable as well.
- **Duplicates:** there is a unique index over non-superseded rows on (source, commodity, branch, date, variety, source record ID). Re-fetching unchanged rows inserts nothing. A changed source row supersedes the earlier one and needs review again. Same-date duplicates within TUMCOS are flagged `multiple_source_records_same_date`.
- **Retry:** `fetchWithRetry` uses exponential backoff on network errors, timeouts and HTTP 408, 425, 429, 500, 502, 503 and 504. Other 4xx refusals are not retried. The attempt count comes from `COOPERATIVE_FETCH_ATTEMPTS` (an integer from 1 to 5; default 3). The attempt count and HTTP status are recorded per fetch.
- **Data-quality rules:** each record is checked for the following.
  - Real dates that are not in the future.
  - Positive prices.
  - min ≤ average ≤ max.
  - Commodity consistency (TUMCOS name or category versus the array).
  - Unit plausibility.
  - Exact-label scope for TSS.

  Failing rows are stored as `invalid` with reasons.
- **Manual review:** the queue in Data quality → Cooperative source review shows source, commodity, unit status, source unit label, review flags, lots and raw evidence. The approve button reads "Accept (unit unconfirmed)" whenever the unit is not source-confirmed.
- **Historical backfill:**
  - TSS: `POST /admin/cooperative/tss/backfill` takes a date range of up to 5 reporting dates per request. Attempts per date use `COOPERATIVE_FETCH_ATTEMPTS`, defaulting to 2.
  - TUMCOS: `scope=full_history` archives every record embedded in the page (1,313 rows on 2026-11-04).
  - MAMCOS publishes only its current table, so it has no historical backfill.
  - No source is treated as a complete archive.
- **Snapshot replay:** `POST /admin/cooperative/replay/:fetchId` re-parses a stored snapshot without re-fetching the source.
- **Authorized manual CSV import:** `POST /admin/cooperative/import` takes the following fields.
  - `source`, `csv`, `authorized_by`, `permission_reference`, `attestation: true`, optional `dry_run`.
  - The CSV is limited to 500 rows and 512 KB. Columns are `branch, reporting_date, commodity, variety, minimum_price, maximum_price, average_price, declared_unit, unit_evidence, source_reference`, plus optional `source_record_id, lot_count, bag_count, reported_weight`.
  - A unit is source-confirmed only when `declared_unit` is INR/quintal with evidence; TSS rows always stay assumed.
  - Unknown columns, ragged rows and duplicate rows reject the whole file. Invalid rows are imported as `invalid` and listed in the rejected-records report.

## 6. Endpoints

Public:
- `GET /api/v1/cooperative/prices?source=mamcos|tss|tumcos&commodity=arecanut|black_pepper&variety=`
  - `black_pepper` is accepted only for `tumcos`.
  - The response includes `publication` (published flag, blocked reason, latest archived reporting date) and `permission`.

Admin (`Authorization: Bearer <ADMIN_TOKEN>`):
- `GET /admin/cooperative/quality?source=`
- `POST /admin/cooperative/refresh` (MAMCOS)
- `POST /admin/cooperative/tss/refresh` with `{date, include_lots?}`
- `POST /admin/cooperative/tss/backfill` with `{start, end}`
- `POST /admin/cooperative/tumcos/refresh` with `{scope: "recent" | "full_history"}`
- `POST /admin/cooperative/import`
- `POST /admin/cooperative/replay/:fetchId`
- `POST /admin/cooperative/:id/review` with `{action}`
- `GET /admin/cooperative/sources`: availability, freshness per commodity (stale after 7 days, by market reporting date), permission, robots/terms, unit evidence and recent failure reasons.
- `POST /admin/cooperative/sources/:key/permission`

## 7. Live verification (local D1, 2026-11-04 IST)

| Source | Result |
|---|---|
| MAMCOS | 41 rows received; 6 new; 35 unchanged; 2 invalid. |
| TUMCOS (recent) | 1,313 source records. 21 in scope: 18 arecanut and 3 black pepper. All 21 flagged unit conflict; 0 invalid. Latest record 2026-11-04; stale page header detected; table cross-check matched 12 of 12. A repeat fetch inserted 0 (21 duplicates). |
| TSS (2026-11-04, `include_lots`) | 77 rows; 9 arecanut quotations; 68 excluded; 240 tender lot rows aggregated. No personal fields were stored. |

**Review and publication**
- One TUMCOS row and one TSS row were approved as a test. Both became `accepted_unit_unconfirmed` with `published: false`.
- Public TSS and TUMCOS feeds return no published rows and state the reason.
- Migration 0013 converted 26 earlier TSS approvals (published under the previous assumed-unit policy) to `accepted_unit_unconfirmed`.

**Source status**
- All three sources show as available, with "Permission not confirmed".
- Freshness: MAMCOS, TSS and TUMCOS arecanut are fresh (2026-11-04). TUMCOS black pepper is stale (latest record 2026-10-26, 9 days old).

## 8. Outstanding

- Request and record written permission from each operator before enabling scheduled collection or redistribution.
- Obtain unit confirmation from TSS and TUMCOS. Until then their values remain unpublished.
- Confirm whether TUMCOS values correspond to a variety or grade.
- Confirm the unit of TSS tender weights.

## Operating the cooperative feeds

### Cooperative branch prices (MAMCOS, TSS and TUMCOS)

> **Current policy (2026-11-04):** see
> [docs/COOPERATIVE_SOURCES.md](COOPERATIVE_SOURCES.md).
>
> - **Operator decision (2026-11-05, migration 0020):** TSS (no published unit) and TUMCOS (labels "kg" but shows per-quintal values) are treated as INR/quintal and published after review, in every module. They stay labelled as an operator assumption, not a source confirmation. TUMCOS values under 1,000 stay unconfirmed because they could genuinely be per kg.
> - Older text below about TSS benchmark exclusion and non-publication is history.
> - TUMCOS (`?feed=tumcos`) adds Channagiri arecanut and black pepper. Black pepper never enters arecanut benchmarks, calculators or aggregates.
> - Scheduled collection needs both `<SOURCE>_SCHEDULE_ENABLED=true` (`MAMCOS`, `TSS` or `TUMCOS`) **and** a permission grant recorded in Data quality → Cooperative source intelligence.
> - **Collection runs twice a day (2026-11-06):** 09:00 IST closes out the previous day's TSS date and does all other refreshes; 20:00 IST collects that day's cooperative rates only.
> - **Auto-publishing (2026-11-06):** with `COOPERATIVE_AUTO_PUBLISH=true`, scheduled quotations from the last 30 days publish without a person if they pass validation, have a publishable unit, carry no unaccepted review flag, do not conflict with a verified price, and sit within 20% of that variety's recent median. A variety with fewer than 3 quotes in the last 30 days (a newly seen grade) has no median yet, so it publishes on the other checks alone (since 2026-11-11). Everything else stays in the review queue. Each approval is recorded in `cooperative_reviews` under the reviewer `auto-validation-v1`. Manual refreshes still go through review. Rules: `api/src/cooperative-auto-publish.ts`.

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

#### TSS: explicitly assumed units (superseded publication policy)

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
