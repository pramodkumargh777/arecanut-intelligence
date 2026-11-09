# Areca Pulse · Market Intelligence

*Know the market. See the opportunity.*

Areca Pulse is a market-data and decision-support application for Karnataka. The initial vertical slice provides a React dashboard, a versioned Cloudflare Worker API with D1 migrations, a CSV/API ingestion path, and a human review queue. It deliberately publishes no sample prices or unvalidated observations.

Areca Pulse was previously called Arecanut Intelligence (ANI). Internal identifiers keep the `ani` name: the repository,
package names, environment variables such as `ANI_API_URL`, database and migration names, storage keys and source keys.
Brand assets and usage rules are in [docs/BRAND.md](docs/BRAND.md).

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
   The API development command uses `api/src/dev-worker.ts`, a default-export
   wrapper around the production Worker, so Wrangler does not interpret test
   exports as Worker entrypoints. The production configuration is unchanged.
   The configured Workers AI binding uses a remote resource even during local
   development, can require Cloudflare access, and may incur usage charges.

Never commit `.env`, `api/.dev.vars`, database exports or captured source data; the ignore rules cover them, but
check `git status` before committing. If a credential is ever committed, rotate it. A fresh clone starts without
market records: restore or re-fetch authorised data explicitly.

## Frontend

Market pages (overview, prices, analytics, comparison) switch between the official AGMARKNET feed and cooperative
feeds without mixing price bases. Tables sort, paginate and export bounded CSV. Charts are lazy-loaded and show
observed values only. `/forecasts` and `/forecasts/evaluation` chart actual backtests, including poor performance.
`/workspace` stores organization or role dashboard profiles (filters and sections) in browser localStorage only.

`/` (latest rates) and `/sell-or-hold` are written for growers on phones, in Kannada by default with an English toggle that each browser remembers. Other pages have translated navigation but English content. Rates stay separate by cooperative and only rates from the same date are ranked. Sell-or-hold shows what the Karnataka monthly price did after a chosen month in past years, and how many years would have covered the reader's own costs. It gives no recommendation, and `shared/hold-history.ts` leaves out one-month spikes such as Rashi in January 2024, naming them on the page. Sections with no data (official daily feed, arrivals, advisories, quality inspections) stay hidden until they have some. The former home page is now at `/overview`.

## Tests and build

```sh
npm run build
npm test
python3 -m pip install -r data-platform/requirements.txt
python3 -m pytest -q tests/data
```

## Cloudflare deployment

Deployment is not configured until a real D1 database, Worker secrets, Pages project, account ID and API token are provided.

To start production with your local data, load it into the new empty database instead of applying migrations first. `npm run db:backup` files are not suitable for this: they omit indexes, triggers and views.

```bash
npm run db:prepare-import
npx wrangler d1 execute ani-market-data --remote --file backups/production-import.sql --config api/wrangler.toml
npx wrangler d1 migrations apply ani-market-data --remote --config api/wrangler.toml   # should report nothing to apply
# After the Worker is deployed, rebuild the search index:
curl -X POST https://YOUR-WORKER/api/v1/admin/documents/reindex -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

1. Create a D1 database: `npx wrangler d1 create ani-market-data --config api/wrangler.toml`. Set the returned `database_id` in `api/wrangler.toml`.
2. Apply migrations: `npx wrangler d1 migrations apply ani-market-data --remote --config api/wrangler.toml`.
3. Optionally take a backup first (`npm run db:backup -- --remote`) on later deployments; see [docs/DATA_RETENTION_AND_BACKUP.md](docs/DATA_RETENTION_AND_BACKUP.md). Configure API secrets with `npx wrangler secret put INGESTION_TOKEN --config api/wrangler.toml` and `npx wrangler secret put ADMIN_TOKEN --config api/wrangler.toml`. Configure `CORS_ORIGIN`, `MIN_INDEX_MARKETS`, and `REFERENCE_STATE` as Worker vars.
4. Create a GitHub environment named `production`, with approval rules where your GitHub plan supports them. Configure `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as Actions secrets available to that environment. Set `CLOUDFLARE_PAGES_PROJECT_NAME` and `VITE_API_BASE_URL` as **repository** variables; the API URL must be HTTPS and end in `/api/v1`. Optionally set `VITE_SITE_URL` to the site's public address (default `https://arecanut-intel.pages.dev`); the sitemap, `robots.txt` and link-preview tags are built from it. Set the production frontend's exact HTTPS origin in `CORS_ORIGIN` in `api/wrangler.toml`. Worker runtime secrets from step 3 are distinct from GitHub deployment credentials.
5. Only when ready to deploy, set the repository variable `CLOUDFLARE_DEPLOY_ENABLED=true` and dispatch `.github/workflows/deploy-cloudflare.yml` from the default branch. The workflow runs build/tests and local migration validation, rejects placeholder D1/production CORS configuration, applies remote migrations, then deploys the Worker. Pages waits for the Worker and is skipped unless its project and API URL variables are configured. Merely pushing code does **not** deploy. For command-line deployment instead, apply the migrations in step 2 before running `npx wrangler deploy --config api/wrangler.toml` and `npx wrangler pages deploy frontend/dist --project-name=YOUR_PAGES_PROJECT`.

The scheduled AGMARKNET workflow runs the daily connector only when the `ANI_API_URL` and `AGMARKNET_PRICE_UNIT` repository variables are configured, and skips with a warning unless the `DATA_GOV_IN_API_KEY` and `INGESTION_TOKEN` repository secrets are present. Apply migration 0012 before enabling it.

Migrations `0015`/`0016` must be applied before the Worker that uses them is deployed. R2 is not required: leave the `[[r2_buckets]]` block commented out unless an archive bucket has been created (`npx wrangler r2 bucket create ani-evidence`). `ARCHIVE_SCHEDULE_ENABLED`, `ARCHIVE_OFFLOAD_MIN_BYTES` and `TEMP_RETENTION_DAYS` are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Deployment success has not been claimed or tested in a Cloudflare account.

## Documentation

| Topic | Document |
|---|---|
| System design, storage and query bounds | [ARCHITECTURE.md](docs/ARCHITECTURE.md) ([visual map](docs/architecture/index.html)) |
| Importing CSV and AGMARKNET data | [DATA_IMPORT.md](docs/DATA_IMPORT.md), [AGMARKNET_DAILY_CONNECTOR.md](docs/AGMARKNET_DAILY_CONNECTOR.md) |
| MAMCOS, TSS and TUMCOS cooperative feeds | [COOPERATIVE_SOURCES.md](docs/COOPERATIVE_SOURCES.md) |
| Commodities, varieties and grades | [COMMODITY_MODEL.md](docs/COMMODITY_MODEL.md) |
| Monthly trends, history, calculators, source intelligence | [ANALYTICS_AND_TOOLS.md](docs/ANALYTICS_AND_TOOLS.md) |
| Supply, weather and crop risk | [SUPPLY_AND_RISK.md](docs/SUPPLY_AND_RISK.md) |
| Forecast baselines and evaluation | [FORECASTING.md](docs/FORECASTING.md) |
| AI assistant | [AI_ASSISTANT.md](docs/AI_ASSISTANT.md) |
| Retention, backup and restore | [DATA_RETENTION_AND_BACKUP.md](docs/DATA_RETENTION_AND_BACKUP.md) |
| Brand assets and usage | [BRAND.md](docs/BRAND.md) |
| Roadmap, limitations and open items | [ROADMAP.md](docs/ROADMAP.md) |

## Licence

Copyright (c) 2026 Pramod Kumar. All rights reserved. See [LICENSE](LICENSE).
