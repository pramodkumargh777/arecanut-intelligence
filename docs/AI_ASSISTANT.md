# ANI AI Intelligence Assistant

The assistant answers questions about arecanut markets, supply and crop health from **verified ANI data**. It does not use the language model's own knowledge.

The language model is optional. It can only write prose around values that ANI tools return. Any number, citation label or price-direction claim it adds is rejected.

## Architecture

```
User question (English or Kannada)
  → language detection, prompt-injection screening
  → query classification (keyword rules; optional LLM planner when no rule matches)
  → tool selection + argument validation (zod schemas, unknown keys/invented numbers stripped)
  → ANI API calls (in-process Hono requests; same endpoints the dashboard uses)
  → verified structured facts, sources, assumptions, uncertainty, missing data
  → optional hybrid document retrieval (SQLite FTS5 keyword + BGE-M3 semantic)
  → explanation: Qwen (grounding-checked) or deterministic rule text
  → answer with fact table, citations [S#]/[D#]/[N#], reporting periods, disclaimer
```

| Module | Purpose |
|---|---|
| `api/src/assistant/language.ts` | English/Kannada detection, Kannada glossary, UI strings |
| `api/src/assistant/classify.ts` | Rule-based intent and entity classification (variety, market, district, horizon) |
| `api/src/assistant/tools.ts` | 14 tools with zod argument schemas, calling ANI endpoints |
| `api/src/assistant/retrieval.ts` | FTS5 keyword search, BGE-M3 cosine search, hybrid ranking, relevance thresholds |
| `api/src/assistant/providers.ts` | Provider abstraction: `none`, `ollama`, `workers_ai` |
| `api/src/assistant/grounding.ts` | Injection detection, untrusted-text sanitising, grounding check |
| `api/src/assistant/compose.ts` | Evidence building, prompt, citation numbering, rule-based fallback |
| `api/src/assistant/routes.ts` | HTTP endpoints, rate limiting, audit log |
| `api/migrations/0019_assistant_documents.sql` | `documents`, `document_chunks`, `document_chunks_fts`, `assistant_interactions`, `assistant_rate_limits` |
| `data-platform/documents/` | Python document ingester and source manifest |
| `frontend/src/pages/AssistantPage.tsx` | `/assistant` page |

### Tools

| Tool | ANI source |
|---|---|
| `get_current_prices` | Monthly reference, AGMARKNET daily, MAMCOS, TSS, TUMCOS. Each keeps its own price basis and is never averaged across bases. |
| `get_historical_prices` | Monthly history (`/history/monthly`) |
| `compare_markets` | Verified daily/cooperative quotations by market |
| `get_market_index` | `/analytics/reference-index` |
| `get_market_arrivals` | `/supply/arrivals` |
| `get_price_forecast` | Stored experimental baseline snapshots (`/forecasts`) |
| `get_production_statistics` | `/supply/production` (DASD estimates, stage and revision aware) |
| `get_trade_statistics` | `/intelligence/trade` |
| `get_weather` | `/supply/weather` (observations, forecasts and warnings, labelled by data type) |
| `get_advisories` | `/supply/risk/advisories` (only expert-approved rules) |
| `calculate_net_realization` | Deterministic calculator using the user's own inputs |
| `calculate_sell_hold` | Deterministic hold scenario using the user's own assumptions; no probability is assigned |
| `search_industry_news` | `/intelligence/news` (captured official notices and bulletins) |
| `search_agricultural_documents` | CPCRI, DASD and government document passages |

When a calculator lacks inputs it returns `needs_input` and lists them. It never substitutes a price.

## Guarantees

- **No model-generated numbers.** Every fact value is copied from a tool result. The grounding check rejects model text that:
  - contains a number absent from the evidence (small integers up to 12 and date parts are allowed);
  - uses an unknown citation label, or any URL;
  - makes a directional price claim or a sell/hold/buy recommendation.

  Rejected text is replaced by the rule-based interpretation, and the UI says why.
- **Works without an LLM.** With `ASSISTANT_LLM_PROVIDER=none` (the default), or when the model is down, times out or fails grounding, the answer is still built from facts, sources, assumptions and missing-data notes.
- **Prompt-injection protection.**
  - Questions matching instruction-override patterns (English and Kannada) skip the model entirely.
  - Document text is sanitised and passed only inside delimited "reference only" blocks.
  - The LLM planner's tool arguments are re-validated, and planner numbers are discarded.
- **Separate price bases.** Different price bases are never merged. TSS and TUMCOS rows in the review queue are reported as missing, not as prices.
- **No diagnosis.** Crop-health answers quote documents and refer users to ICAR-CPCRI or the State Horticulture Department.
- **Request limits.**
  - Per-client hourly limit (`ASSISTANT_RATE_LIMIT_PER_HOUR`, default 30); exceeding it returns HTTP 429 with `Retry-After`.
  - Questions are capped at 1,000 characters, and model calls have a timeout.
- **Privacy.**
  - Client IPs are stored only as salted SHA-256 hashes.
  - Questions are stored as `[not retained]` unless `ASSISTANT_LOG_QUESTIONS=true`.

## Models and licences

| Role | Local (Ollama) | Cloudflare Workers AI | Licence |
|---|---|---|---|
| Chat | `qwen3.5:4b` (Q4_K_M, ~3.4 GB) | `@cf/qwen/qwen3-30b-a3b-fp8` | Apache-2.0 |
| Embedding | `bge-m3:567m` (BAAI/bge-m3, 1024-d) | `@cf/baai/bge-m3` | MIT |

Both runtimes serve the same BAAI/bge-m3 checkpoint, so stored embeddings are interchangeable. Embeddings are L2-normalised, int8-quantised and stored base64 in D1. The quantisation is identical in Python and TypeScript; a parity test vector checks this.

Other Qwen models served by Ollama (for example `qwen3:8b`) work through `ASSISTANT_LLM_MODEL`. CPU-only inference is supported; no GPU is required.

## Document retrieval

- **Keyword:** SQLite FTS5 (`document_chunks_fts`, `unicode61 remove_diacritics 2` tokenizer). Kannada questions are expanded with the glossary in `language.ts`, e.g. ಕೊಳೆ ರೋಗ → koleroga / mahali / fruit rot.
- **Semantic:** cosine similarity over BGE-M3 embeddings in D1, computed in the Worker. No vector database is needed at this corpus size (tens to low thousands of chunks).
- **Hybrid ranking.**
  - A chunk qualifies semantically at similarity ≥ 0.45, or ≥ 0.50 for Kannada-script queries.
  - A keyword hit whose semantic similarity is below 0.30 is vetoed.
  - If the embedder is unavailable, retrieval falls back to keyword only, and the answer says so.
- **Calibration** (local corpus, BGE-M3):

  | Query set | Similarity |
  |---|---|
  | English, relevant | 0.47–0.64 |
  | English, off-topic | ≤ 0.40 |
  | Kannada, relevant | 0.44–0.50 |
  | Kannada, off-topic | up to 0.44 |
  | Off-topic keyword hit | 0.237 |

- **Citations** carry title, publisher, URL, publication date (only when the document states it), page range and retrieval time.

### Ingesting documents

Documents are listed in `data-platform/documents/manifest.json` with publisher, URL and reuse note. Every URL was verified on 2026-11-05.

```bash
uv pip install --python .venv/bin/python -r data-platform/requirements-documents.txt
cd data-platform
# Inspect extraction and chunking without storing anything:
../.venv/bin/python -m documents.ingest --dry-run
# Store, with BGE-M3 embeddings from local Ollama:
ANI_API_URL=http://127.0.0.1:8787/api/v1 ANI_ADMIN_TOKEN=... ../.venv/bin/python -m documents.ingest --embed
# Use operator-saved copies (<key>.pdf / <key>.html), e.g. PIB pages that refuse automated access:
../.venv/bin/python -m documents.ingest --local-dir /path/to/saved --only pib-customs-tariff-value-areca-2025-08-14
```

Ingestion behaviour:

- Re-posting identical content returns `unchanged` and back-fills missing embeddings.
- Changed content creates a new version and withdraws the old one; old versions are kept.
- Admin endpoints (`ADMIN_TOKEN`):
  - `POST /admin/documents`
  - `POST /admin/documents/reindex` rebuilds FTS (also required after a database restore, because `npm run db:backup` skips the FTS5 virtual table that D1 cannot export).
  - `POST /admin/documents/embed` embeds chunks through the Worker's provider.

## Endpoints

| Method | Path | Auth |
|---|---|---|
| POST | `/api/v1/assistant/query` — `{question, language?: auto\|en\|kn, calculation?, use_llm?}` | public, rate-limited |
| GET | `/api/v1/assistant/status` — provider, corpus, limits, guarantees | public |
| GET | `/api/v1/assistant/tools` | public |
| GET | `/api/v1/documents`, `/api/v1/documents/search?q=` | public |
| POST | `/api/v1/admin/documents`, `/admin/documents/reindex`, `/admin/documents/embed` | `ADMIN_TOKEN` |

## Configuration

See `api/.dev.vars.example` and `api/wrangler.toml`.

| Variable | Default | Meaning |
|---|---|---|
| `ASSISTANT_LLM_PROVIDER` | `none` | `none`, `ollama`, `workers_ai` (needs the `[ai]` binding) |
| `ASSISTANT_EMBEDDING_PROVIDER` | `none` | Same options; `none` means keyword retrieval only |
| `ASSISTANT_LLM_MODEL`, `ASSISTANT_EMBEDDING_MODEL` | see table above | Override model IDs |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Local Ollama |
| `ASSISTANT_LLM_TIMEOUT_MS` | 25000 (max 120000) | Per model call |
| `ASSISTANT_RATE_LIMIT_PER_HOUR` | 30 | Per hashed client |
| `ASSISTANT_SEMANTIC_THRESHOLD` | 0.45 | Semantic relevance floor |
| `ASSISTANT_LOG_QUESTIONS` | `false` | Retain question text in the audit log |
| `ASSISTANT_CLIENT_SALT` | built-in fallback | Set a random secret in production |

A deployed Worker cannot reach a laptop's Ollama. In production, use `workers_ai` (free daily allocation, paid beyond it) or keep `none`.

## Verified behaviour (local, 2026-11-05)

These ran against local D1 with `qwen3.5:4b` and `bge-m3:567m` on Ollama:

- **"How to manage Mahali (fruit rot) disease?"**
  - Hybrid retrieval returned 4 CPCRI passages.
  - Qwen's text passed grounding and cited [D1]–[D4].
- **"What is the latest Rashi arecanut price in Karnataka?"**
  - Returned the AGMARKNET monthly state weighted value with its basis and period [S1].
  - Missing daily, MAMCOS, TSS and TUMCOS values were each explained.
- **Forecast question:** the experimental baseline was shown with its interval and the caveat that it is not a proven predictive model.
- **`use_llm:false`:** a rule-based answer was returned and the LLM status was `disabled`.
- **Injection-style questions:** the model was never called.

## Known limitations

- **Small-model behaviour.**
  - Qwen 4B sometimes invents citation labels or numbers. Grounding rejects that text and the rule-based answer is shown.
  - It used to cite the prompt block names (`[DATA]`); these bare tags are now removed before grounding.
- **Kannada quality.**
  - Kannada prose from the 4B model is weaker, e.g. "ಕನ್ನಡದ" for Karnataka and loose citation placement.
  - The rule-based Kannada fallback is terse.
  - Use a larger model (e.g. `qwen3:8b` or Workers AI Qwen3-30B) for better Kannada output.
- **Kannada documents.**
  - No machine-readable Kannada CPCRI publication is in the corpus.
  - Kannada document retrieval depends on glossary expansion and BGE-M3's cross-lingual similarity.
  - Kannada off-topic similarity (0.44) is close to relevant scores, which is why a stricter threshold applies.
- **Source text quality.** CPCRI booklets contain OCR noise, which is quoted as-is.
- **PIB access.** PIB returns HTTP 403 to automated fetches, so PIB documents need operator-saved copies via `--local-dir`.
- **Commodity scope.** The assistant covers arecanut only. Other configured commodities are not yet supported.
- **Answer content.** Answers are reference information, not financial advice or crop diagnosis.
