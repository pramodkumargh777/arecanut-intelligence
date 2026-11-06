# Multi-commodity domain model

ANI's production commodity is still **Arecanut**. Migration
[`0014_commodity_master.sql`](../api/migrations/0014_commodity_master.sql)
generalizes the schema so other commodities can be added without changing
arecanut behaviour. Black pepper, coffee, cardamom, coconut/copra, cocoa and
natural rubber are **configuration only**:

- No price data is published for them.
- No observation was created for them.
- Their varieties and grades are reference configuration marked `unverified`.
- None of them is mapped to a source label.

## Tables

| Table | Purpose |
|---|---|
| `units`, `unit_aliases` | Unit dimension (mass/count) and conversion factor to a base unit. Source unit labels map to units. Only verified aliases are used for normalization. |
| `price_bases` | The 7-code taxonomy below. |
| `commodities` | Existing table extended with `code`, `display_name`, `category`, `status` (`production`/`configured`) and `sort_order`. The existing arecanut row keeps its ID. |
| `commodity_configs` | Per-commodity settings, kept separate from the master row: default unit, currency, grading-system description and configuration status. |
| `commodity_capabilities` | Which ANI capabilities exist for a commodity, with status `available` or `unpublished`. Missing means not integrated. |
| `varieties` | Existing table extended with `code`, `classification_type`, `unit_code`, `evidence` and `sort_order`. Varieties are always scoped to one commodity. |
| `grades` | Commodity-scoped grades, optionally tied to one variety. Grades are never shared across commodities. |
| `grade_mappings` | Maps a source's grade label to a grade, per commodity and source. |
| `commodity_aliases` | Maps source commodity labels to a commodity, per source. |
| `variety_aliases` | Rebuilt with `source_key` and `mapping_status`, so the same label can mean different things in different sources or commodities. Existing alias rows are copied. |
| `markets` (+`market_type`), `market_commodities` | Markets can be APMCs or cooperative branches. `market_commodities` records which commodities a market actually reports; it is derived from existing observations, not assumed. |

## Price-basis taxonomy

| Code | Meaning | Current producer |
|---|---|---|
| `APMC_MODAL` | Official APMC modal price | AGMARKNET daily rows (`market_price_observations`) |
| `APMC_MIN_MAX` | Official APMC min/max-only quotation | Allowed on `market_price_observations`; not currently produced |
| `COOPERATIVE_AVERAGE` | Cooperative branch reported average | MAMCOS and TUMCOS (`cooperative_quotes`) |
| `COOPERATIVE_TENDER_AVERAGE` | Cooperative tender/auction average | TSS (`cooperative_quotes`) |
| `AUCTION_LOT_PRICE` | Single auction lot price | Not ingested |
| `BUYER_QUOTATION` | Trader or buyer quotation | Not ingested |
| `FARMER_TRANSACTION` | Recorded farmer sale | Not ingested |

The shared helper `priceBasisForSource()` in
[`shared/commodities.ts`](../shared/commodities.ts) mirrors this mapping.
Database protections:

- `CHECK` constraints limit each table to its own bases.
- `cooperative_price_basis_source_insert` rejects a cooperative row whose basis does not match its source.
- `observation_price_basis_immutable` and `cooperative_price_basis_immutable` reject any change to `price_basis`. A correction must be ingested as a new record.

The monthly AGMARKNET state/variety series (`monthly_variety_prices`) remains
a separate aggregate. It is not a market observation and is not in the view.

## Unified view: `price_observations`

The view is read-only. It combines `market_price_observations` and
`cooperative_quotes`, and each row keeps the following.

| Concern | Fields |
|---|---|
| Origin | Source table, source key, source record ID and source URL |
| Labels | Original commodity, variety and grade labels |
| Mapping | Mapped variety and grade IDs, plus their mapping status |
| Basis and units | Price basis, original unit and normalized unit |
| Observation | Observation date |
| Prices | `minimum_price`, `maximum_price`, `modal_price` and `average_price` |
| Volume and status | Quantity with its unit, and validation status |
| Publication | `published` flag |

Modal and average prices stay in separate columns and are never combined.

A cooperative row only gets the normalized unit `INR/quintal` when its unit is
`source_confirmed`. TSS and TUMCOS rows therefore keep a null normalized unit
and stay unpublished.

## API

| Endpoint | Behaviour |
|---|---|
| `GET /api/v1/commodities` | Catalogue: commodities, configs, capabilities, varieties, grades, units and unit aliases. |
| `GET /api/v1/price-observations?commodity=&price_basis=&source=&variety=&variety_id=&grade=&grade_id=&from=&to=&limit=&offset=` | Published rows only. Returns 400 for an unknown commodity, an unknown basis, or an invalid date (e.g. `2026-13-01`). |
| `GET /api/v1/admin/commodities/validation` (Bearer `ADMIN_TOKEN`) | Post-migration report: arecanut row counts, basis distribution, unmapped labels, and rows without a basis or commodity. |
| Daily routes (`/overview`, `/markets`, `/varieties`, `/prices`, `/analytics/reference-index`, `/analytics/market-comparison`) | Accept `commodity` (default `arecanut`). Unknown codes return 400. `/prices` also accepts an exact `grade`. |

## Frontend

The commodity is global and lives in the URL (`?commodity=`); it is omitted
for the default.

- **Selector:** [`AppShell`](../frontend/src/components/AppShell.tsx) renders
  the selector, and every nav link keeps the commodity in its URL.
  Non-production commodities are labelled "configured".
- **Catalogue:** [`useCommodity`](../frontend/src/services/commodity.ts) loads
  `/commodities`. If that fails it uses the fallback catalogue and says so.
- **Gating:** [`CommodityGate`](../frontend/src/components/CommodityGate.tsx)
  calls `routeAvailable()`.
  - When a route's capability is not integrated for the commodity, the gate
    shows a **commodity profile** instead: varieties, grades, unit, grading
    system and integrated sources.
  - Nothing is estimated or substituted.
  - Market-data pages offer only that commodity's feeds (`marketFeeds()`), and
    unpublished feeds are marked.
- **Commodity-driven pages:** Prices, Overview, Analytics and Compare pass the
  commodity to the API. The unit text comes from configuration, and Prices
  adds an exact-label Grade filter.

Current behaviour:

| Commodity | Behaviour |
|---|---|
| Arecanut | All existing pages, unchanged. |
| Black pepper | Market-data pages show the TUMCOS feed, marked unpublished, with the existing unit-conflict empty state. All other pages show the profile. |
| Others | Every commodity-dependent page shows the profile. Data quality is commodity-independent. |

## Adding a commodity or source

1. Add a migration that seeds `commodities`, `commodity_configs`, `varieties`
   and `grades`, keeping `mapping_status = 'unverified'` until a source is
   verified.
2. When a source is integrated, add its aliases with `mapping_status =
   'verified'`, plus a `commodity_capabilities` row (`unpublished` first) and
   the correct price basis.
3. Add a new price-basis code only through the taxonomy, together with a
   `CHECK`/trigger update and a `priceBasisForSource` test.

**D1 note:** D1 rejects long `UNION ALL` chains with "too many terms in
compound SELECT". `node:sqlite` in the tests accepts them, so tests will not
catch this. Use multi-row `VALUES` (columns `column1…`) for seeds, and always
validate with `npx wrangler d1 migrations apply DB --local --config api/wrangler.toml`.

## Migration validation (local D1, 2026-11-04)

The migration was applied to local D1 only, after a backup. Comparing
before/after snapshots:

| Table | Result |
|---|---|
| `market_price_observations` | 46 rows, identical except the new `price_basis` (all `APMC_MODAL`) |
| `cooperative_quotes` | 103 rows, identical except `price_basis` |
| `monthly_variety_prices` | 1,526 rows, price sum unchanged |
| `market_commodities` | 18 derived rows |

The cooperative rows split as follows:

| Source | Rows | Price basis |
|---|---|---|
| MAMCOS | 47 | `COOPERATIVE_AVERAGE` |
| TUMCOS | 21 | `COOPERATIVE_AVERAGE` |
| TSS | 35 | `COOPERATIVE_TENDER_AVERAGE` |

The validation endpoint returned `ok: true`. The unmapped labels it lists are:

- compound MAMCOS labels such as `HASA` and `NEWRASHIEDI`, intentionally left unmapped pending review;
- one pre-existing invalid blank-variety MAMCOS row, which is preserved and unpublished.

Coverage is in [`api/src/commodities.test.ts`](../api/src/commodities.test.ts):

- Mappings and filters.
- Grade isolation between commodities.
- Unit normalization.
- An upgrade test that applies migrations 0001–0013, inserts rows, applies 0014 and checks the rows are identical apart from the basis.
- Basis immutability.
- HTTP scoping.
