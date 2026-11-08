# Areca Pulse — Roadmap

This sequence is ordered to fix data correctness before broadening data
coverage, preserve the current Hono/Worker/D1 and React/Vite architecture, and
keep each behavior change reviewable. It is a proposal, not authorization to
change application code; wait for the next implementation instruction before
starting.

## Principles and release gates

- Preserve separate storage, price basis and API contracts for AGMARKNET daily
  modal observations, AGMARKNET monthly weighted aggregates, MAMCOS averages,
  TSS assumed-unit averages, and non-price intelligence.
- For any source parser change, retain original source evidence and validate
  against known fixtures before publishing.
- Add additive migrations where possible. Back up/verify D1 before any
  production migration or data rewrite.
- Do not turn historical/monthly/cooperative values into daily APMC
  observations; do not silently merge variety or market labels.
- Keep invalid, missing, assumed and stale states explicit. Never fill gaps
  with zeros or inferred source values.
- Keep forecast publication behind the existing evaluation gates.

## Phase 0 — Establish a reproducible baseline

**Scope:** tests, source fixtures, release checklist.

1. Retain the current baseline: frontend build/API typecheck and all 122 API
   tests pass; Vite's chart-chunk warning remains. Run Python tests on the CI
   Python version (3.12) before touching Python normalization.
2. Add isolated, synthetic fixtures for a daily CSV containing both `Variety`
   and `Grade`, grade-only rows, and equivalent AGMARKNET API/CSV observations.
3. Capture sanitized parser fixtures for each source and record their expected
   reporting date, unit, basis, source identity and publication/fetch semantics.
4. Add a CI check that flags the present production placeholders without
   blocking normal CI; keep the deployment workflow's existing hard gate.
5. Pin GitHub Actions to verified commit SHAs while retaining Dependabot
   updates for those references.

**Exit gate:** baseline runs are reproducible; new fixtures demonstrate current
failure modes without using persistent market data.

## Phase 1 — Correct daily normalization and duplicate reconciliation

**Scope:** Python normalizer, ingestion identity, daily index inputs.

1. Remove `grade` as an implicit variety alias. Preserve grade as a distinct
   source attribute where supported, or reject rows without a documented
   variety value.
2. Define stable cross-ingress identity for the same AGMARKNET source
   observation, independent of whether it came from CSV or the data.gov.in
   connector. Keep both raw payloads and intake provenance.
3. If two ingresses disagree on fields that affect the canonical observation,
   keep the observation in review/conflict state rather than selecting the
   latest ingestion timestamp.
4. Add migration-backed tests covering duplicate imports, conflict decisions,
   replays and unchanged source corrections. Keep the existing source-scoped
   correction history intact.

**Exit gate:** one market/date/exact-variety observation cannot change basis or
value solely because another import channel ran later; grade is never used as
a variety without an explicit configured rule.

## Phase 2 — Complete date and provenance semantics

**Scope:** API daily schemas/responses, review interface, price pages and CSVs.

1. Define and document the distinct meanings of reporting date, publisher
   publication date, ingestion timestamp and fetch timestamp by source.
2. Validate optional AGMARKNET publication dates according to the confirmed
   source contract; do not impose an undocumented order or timezone rule.
3. Add source evidence links/identifiers and original unit to the daily review
   and public read contracts. Clearly label each date field in UI and exports.
4. Preserve current `INR/quintal` conversion and source-specific price basis.
   Do not relabel monthly weighted or cooperative average prices as daily
   modal prices.
5. Add API/UI contract tests for reporting date versus publication/fetch
   timestamps, source identity, original/canonical units and CSV output.

**Exit gate:** reviewers and end users can identify what date each field means,
what price basis/unit is shown, and where the record originated.

## Phase 3 — Explicit canonical mapping workflow

**Scope:** D1 mapping tables, reviewer endpoints, data-quality UI and
analytics filters.

1. Add reviewer-managed, source-specific aliases for market and variety labels
   with canonical targets and durable audit events.
2. Separate record approval from market/variety mapping verification. Keep
   original text permanently available and make mapping changes reversible or
   versioned.
3. Apply canonical identities only where an authorized reviewer approved the
   mapping. Do not combine source values merely because normalized strings
   look similar.
4. Test coverage/index behavior before and after mapping, including ambiguous
   and conflicting labels and source-specific varieties.

**Exit gate:** mapped and unmapped rows are distinguishable; no approval
implicitly asserts an unreviewed alias; historical source labels remain
traceable.

## Phase 4 — Identity, access control and request boundaries

**Scope:** admin authentication, private decisions, reviewer audit and API
ingestion edge.

1. Decide the supported user/identity provider and role model before
   implementation; this is a design gate, not a token-format tweak.
2. Add per-user ownership for saved scenarios and any private submission,
   audit entries with actor identity, role-based review permissions and
   revocation. Migrate existing shared-token operations deliberately.
3. Set request-body limits before JSON parsing and configure edge rate limits
   for ingestion/review actions. Keep the ingestion credential distinct from
   user authentication.
4. Add tests for missing, expired, wrong-role, cross-user and revoked access;
   verify secrets never appear in frontend build variables, URLs or logs.

**Exit gate:** private records are isolated by principal; administrative
actions are attributable; oversized and abusive requests are bounded.

## Phase 5 — Query and storage budgets

**Scope:** D1 access patterns, immutable source captures and observability.

1. Measure route query counts, rows read, result sizes, Worker CPU, database
   size and capture growth on representative history sizes.
2. Move latest-per-market/index aggregation into indexed SQL where semantics
   are unchanged. Add explicit date windows or pagination to unbounded
   high-cardinality reads.
3. Decide archival/retention by evidence class. If raw payloads move to object
   storage, keep immutable identifiers, hashes, source URLs and fetch metadata
   in D1; do not silently delete evidence.
4. Add source freshness/failure, Worker CPU, D1 quota and storage alerts. Recheck
   Cloudflare limits at deployment; free-plan ceilings are not a capacity
   guarantee.
5. Benchmark the daily cron and worst-case ingestion on the selected plan.
   Move CPU-heavy source parsing out of the Worker only if the measurements
   justify it.

**Exit gate:** every high-volume route and scheduled job has measured upper
bounds and operational alerts; source evidence has an approved retention plan.

## Phase 6 — Automated UI and source-contract regression protection

**Scope:** frontend tests and continuous integration.

1. Add focused frontend tests for source selection, price-basis labels,
   unit assumptions, date provenance, missing values, error states and
   exports.
2. Add a small browser suite for the official daily review path, cooperative
   source switching, monthly reports and decision price selection. Use
   synthetic isolated test databases only.
3. Add source parser fixtures and scheduled failure alerts; do not make CI
   depend on live publisher availability.
4. Keep chart performance measurement separate from source/data correctness
   tests; revisit ECharts splitting only against a measured route budget.

**Exit gate:** source and UI distinctions are enforced by CI rather than only
manual viewport checks.

## Phase 7 — Complete source availability and forecasting operations

**Scope:** authorized official daily data, connector lifecycle and forecasts.

1. Resolve official daily AGMARKNET access/terms, schema, stable record IDs,
   price units and publication-date meaning with the publisher or an
   authorized export provider.
2. Exercise the configured connector end-to-end using a small approved
   sample; verify a record from source through review to UI/CSV and
   reconciliation. Enable scheduled ingestion only after that gate.
3. Add forecast re-evaluation after source refresh or on a schedule only after
   an operator/publication policy is approved. Preserve immutable snapshots,
   current-revision caveats and all existing publication gates.
4. Keep MAMCOS, TSS and independent production/trade/weather sources on their
   current separate paths. Obtain collection/redistribution terms before
   enabling automatic collection or commercial use.

**Exit gate:** no source is described as operational until it has authorized
access, validated data semantics, successful source-to-screen evidence and
observable failure handling.

## Phase 8 — Staged Cloudflare deployment

**Scope:** production configuration, D1 migrations, Worker and Pages rollout.

1. Provision production D1 and set its real ID; configure HTTPS CORS origins,
   Worker vars, distinct secrets, GitHub environment protection and Pages
   project/API URL if Pages is used.
2. Review migration SQL against a disposable database, run local migration
   validation, and back up any existing remote database before migration.
3. Deploy the Worker first. Smoke-test health, public empty states,
   authentication denial, allowed CORS origin and read-only routes.
4. Apply/verify migrations and one controlled, authorized ingestion/review
   path. Confirm source-separated queries and forecast staleness behavior.
5. Deploy Pages only after the Worker/API URL is healthy. Enable cron and
   source-specific scheduled ingestion incrementally, observing CPU, D1 and
   failure logs after each activation.
6. Document rollback/disable procedures and verify that no deploy or cron
   automation runs from non-default branches or without explicit enablement.

**Exit gate:** production origin, secrets, migrations, source access, health,
alerts and rollback are verified in the target Cloudflare account. The
repository's current all-zero D1 ID and localhost-only CORS settings must
remain deployment blockers until then.

## Current scope and limitations

- Implemented now: market overview, market-price explorer, exact-variety reference-index analytics, same-date cooperative comparison, data-quality review, monthly historical analytics with revisions/coverage, actual-input realization/profit/hold tools, independently sourced production/weather/trade/policy/news records, real-report quality workflow, evaluated one-month price baselines, AGMARKNET CSV and configurable data.gov.in ingestion.
- Not yet implemented: advanced taxonomy/mapping tools, advanced/prospectively validated forecasting, financial recommendations, complete/live trade or news coverage, measured lot data without real reports, individual authentication/roles, production alerts, cloud deployment validation, and automated browser/E2E tests.
- Imported markets keep source names and remain unverified until a reviewer approves an observation. Variety labels are retained as reported and never merged automatically.
- Monthly and cooperative source access/imports were verified locally. Official daily APMC access/backfill remains blocked on human CAPTCHA or authorized access; cooperative quotations are published separately, not as official modal prices.
- Split the initial Worker module into route and explicit repository interfaces as additional backend domains are added.
- The JavaScript entry bundle is approximately 260 KB minified (82 KB gzip); the accessible ECharts line-chart bundle is lazy-loaded at 539 KB minified (183 KB gzip) and should be revisited before production.
- Python unit tests use the standard library. Pandas, DuckDB and forecasting dependencies are not needed for this first ingestion slice.

## Open product and UI items

Carried over from the November 2026 UI review (the review documents themselves were retired once their fixes landed).

- **Source freshness (P0):** show, per feed, how far Areca Pulse lags the publisher (report date, fetch, review and
  publication state). Investigate authorised fetch, monitoring and review workflow; never auto-approve.
- **Release parity:** confirm the deployed build and API configuration match the intended release before judging
  deployed behaviour.
- **Kannada:** every page, chart, table, message and date is available in Kannada and English. Each page keeps
  both languages side by side (`defineCopy`), and TypeScript fails the build if a Kannada line is missing. Still in
  English by design or pending: the assistant's detailed fact/tool/assumption lists (server, `api/src/assistant/tools.ts`),
  expert-approved crop-risk advisory wording, forecasting-engine metadata, and source data itself (market and variety
  names). All Kannada text needs a native-speaker review before release.
- **Price-direction colours:** rises are green and falls red; the brand guide asks that direction not read as
  good or bad. Decide whether to make them neutral (see [BRAND.md](BRAND.md)).
- **Kannada font:** consider bundling Noto Sans Kannada for consistent rendering.
- **Charts:** validate gaps, single points, changing coverage and the data-table fallback on touch and keyboard.
- **Decision tools and weather/forecasts:** keep assumptions, captured time and experimental status next to results.
- **Type scale:** proposed but not adopted: body 16/24, compact 14/20, captions at least 12/18, h1 26/34, h2 19/27.
- **Navigation:** user-test the primary links (Home, Prices, Analytics, Intelligence) with growers in both languages.
- **Interaction tests:** frontend tests render static HTML; add jsdom and Testing Library for clicks, the drawer and
  URL-driven filters.

### Verification checklist for UI changes

- Every feed in each state: success, independent failure, empty, pending review, old and unavailable dates.
- Comparisons rank only same-date, same-scope observations; mixed dates stay unranked.
- Trends show true gaps and never interpolate.
- Routes, deep links, Back, source and variety context, and unknown URLs behave correctly.
- Viewports 360×800, 390×844, 430×932, 768×1024, 1366×768, 1440×900 and 1920×1080 without page-level overflow.
- Keyboard and screen reader: skip link, focus, drawer trap and Escape, labelled controls, announcements, contrast.
- Native-language review of English and Kannada text, dates, prices, units and errors.
