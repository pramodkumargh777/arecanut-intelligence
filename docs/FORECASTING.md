# ANI forecasting engine (experimental)

`data-platform/forecasting` is an independent and reproducible experimentation and evaluation engine. It **does not replace** the
Worker's `monthly-baselines-v1` reference (`/forecasts`). That baseline stays live and stays labelled as a reference estimate.

## What it does

1. **Datasets, one price basis each** (`datasets.py`). Nothing is pooled across bases.

   | Dataset | Basis | Source table | Notes |
   |---|---|---|---|
   | `monthly_reference` | `MONTHLY_STATE_WEIGHTED_AVERAGE` | `monthly_variety_prices` + `monthly_price_versions` (vintages) | Latest contiguous run per Karnataka variety; earlier gaps are dropped, never interpolated |
   | `daily_agmarknet` | `APMC_MODAL` | `market_price_observations` (validated) | Series = market × variety × grade |
   | `mamcos_branch_average` | `COOPERATIVE_AVERAGE` | `cooperative_quotes` (verified) | Branch × variety |
   | `tss_tender_average` | `COOPERATIVE_TENDER_AVERAGE` | `cooperative_quotes` | The unit is assumed, so this dataset is never publication-eligible |

   `build_unified_dataset` raises `IncomparableDatasets` unless basis, unit, unit status, frequency and provenance are all identical and series IDs do not overlap.

2. **Sufficiency rules** (`config.py`):
   - Monthly series need at least 48 observations and at least 24 walk-forward origins.
   - Daily series need at least 250 observations, at least 120 origins and a span of at least 365 days.

   A dataset with no eligible series is **suppressed**, and no forecast is produced for it.

3. **Models** (`models.py`):

   | Group | Models |
   |---|---|
   | Baselines | last value, seasonal naive (m = 12) |
   | Statistical (StatsForecast) | AutoARIMA, AutoETS, Theta |
   | Machine learning | LightGBM: global direct quantile regression on log returns, one model per horizon |
   | Experimental foundation model | Chronos-2, zero-shot on CPU, enabled with `--with-chronos` |

   LSTM and Transformer models are deliberately not included.

4. **Features** (`features.py`):
   - Lags 1–12, rolling mean and median (3/6/12), momentum, volatility, a seasonal ratio, target-month sin/cos, and peer-series median returns.
   - Every feature uses only values at or before the origin.
   - Exogenous values are joined only when `available_at <= cutoff`.
   - Weather, production and trade are currently **not used**. ANI has no historical as-of archive for them, so using them would leak information into the backtest.

5. **Walk-forward backtest** (`backtest.py`):
   - Expanding window with horizons 1–3 months.
   - **Revised** mode uses the current history.
   - **Strict** mode uses only `monthly_price_versions` captured before each origin's cutoff (month end + 15 days). Strict results stay sparse until enough vintages accumulate.

6. **Metrics and gate** (`metrics.py`, `evaluate.py`):
   - Metrics: MAE, RMSE, WAPE, MASE, directional accuracy, 80% interval coverage and width.
   - Each model is compared with the better of last value and seasonal naive for the same series and horizon, on identical points.
   - A model becomes a `candidate` only if all of these hold:
     - n ≥ 24;
     - its MAE is below the baseline's;
     - a one-sided Diebold–Mariano test with the HLN correction gives Holm-adjusted p < 0.05;
     - coverage is not significantly below nominal and is at least 0.6.
   - The engine never assigns `validated`.

7. **Legacy comparison** (`legacy.py`): a Python port of `evaluateForecast` reproduces all stored evaluated `forecast_snapshots` exactly (`python -m forecasting parity`).

8. **Tracking** (`tracking.py`):
   - Every run writes `forecasting/runs/<run id>/` (git-ignored), containing the config, environment, package versions, `backtest.csv`, `evaluation.json`, `payload.json` and `report.md`.
   - MLflow logging is optional and enabled with `ANI_MLFLOW_TRACKING_URI`.

## Storage, publication and prospective evaluation (API)

Migration `0017_forecasting_experiments.sql` creates the following append-only tables:

- `forecast_experiments`
- `forecast_model_evaluations`
- `forecast_predictions`, which records market, variety, grade, price basis, creation date, target, horizon, median, lower and upper bounds, model version, input-data version and coverage status
- `forecast_outcomes`
- `forecast_model_events`

Insert guards refuse a prediction in either of these cases:

- its origin value does not match a stored observation;
- its target period is already observed.

**Routes** (`api/src/forecasting.ts`):

- `POST /admin/forecasting/experiments`
  - Requires `INGESTION_TOKEN`.
  - Idempotent on the payload SHA-256.
- `GET /forecasting/overview`, `/forecasting/evaluations`, `/forecasting/predictions` and `/forecasting/performance`.
  - Predictions from models that are `not_better_than_baseline` are returned with `publication = not_published`.
  - The dashboard does not show their values.
- `POST /admin/forecasting/reconcile`
  - Requires `ADMIN_TOKEN`.
  - Also runs after each monthly refresh and in the scheduled maintenance.
  - Matches saved predictions to newly observed outcomes.
- `POST /admin/forecasting/models/revoke`
  - Requires `ADMIN_TOKEN`.

**Promotion and revocation** (`FORECASTING_POLICY`):

- A model is `validated` only when all of these hold:
  - it has at least 6 prospective outcomes paired with the baseline;
  - its MAE ratio to the baseline is ≤ 1.0;
  - its coverage is ≥ 0.6.
- A model is revoked automatically when either of these holds:
  - its overall or recent MAE ratio is > 1.1;
  - its coverage is < 0.5.

The frontend page `/forecasts/evaluation` (`ForecastEvaluationPage.tsx`) shows:

- the datasets with their suppression reasons, pooled metrics, per-series evaluations with Holm p-values, and publishable predictions;
- prospective performance, the legacy comparison, and limitations and licences.

## Commands

From `data-platform/`, with the repository `.venv`:

```bash
../.venv/bin/python -m forecasting datasets                    # dataset summaries and suppression reasons
../.venv/bin/python -m forecasting run --dry-run               # baselines + statistical + LightGBM
../.venv/bin/python -m forecasting run --with-chronos --dry-run
../.venv/bin/python -m forecasting parity                      # legacy evaluator parity
ANI_API_URL=http://127.0.0.1:8787/api/v1 INGESTION_TOKEN=... ../.venv/bin/python -m forecasting publish --run-id <id>
```

The engine reads the local Miniflare D1 SQLite file, which it discovers automatically. To read a different database, set `ANI_D1_SQLITE`, or pass `--sql-export` with a `wrangler d1 export` dump. Access is read-only.

**Dependencies:**

- Core: `data-platform/requirements-forecasting.txt`, with pinned versions.
- Optional: `requirements-forecasting-optional.txt` for chronos-forecasting, torch and transformers. These run on CPU only and need no GPU.
- `OMP_NUM_THREADS=1` is set on import because LightGBM and torch load different OpenMP runtimes on macOS.

**Licences** (verified before use):

| Component | Licence |
|---|---|
| StatsForecast | Apache-2.0 |
| LightGBM | MIT |
| scikit-learn | BSD-3-Clause |
| statsmodels | BSD-3-Clause |
| chronos-forecasting | Apache-2.0 |
| `amazon/chronos-2` checkpoint | Apache-2.0, pinned to revision `29ec3766d36d6f73f0696f85560a422f50e8498c` |

## First real result (run `fx-20261104T192118Z-5839b847aa`, local D1)

**Scope:**
- 17 of 30 Karnataka monthly varieties were eligible.
- 35 walk-forward origins, horizons 1–3, 0 model errors, 105 s on CPU with Chronos.

**Outcome:**
- **No model passed the gate.** There were 255 `not_better_than_baseline` results and 102 `reference` results.
- Pooled h1 MAE in INR/quintal, from lowest to highest:

  | Model | MAE | MAE / best baseline |
  |---|---|---|
  | Theta | 2,366 | 0.990 |
  | last value | 2,391 | 1.000 |
  | AutoETS | 2,408 | — |
  | Chronos-2 | 2,440 | — |
  | LightGBM | 2,506 | — |
  | AutoARIMA | 2,577 | — |
  | seasonal naive | 6,143 | — |

  These differences are not statistically meaningful after Holm correction.

**Datasets not evaluated:**
- The daily AGMARKNET, MAMCOS and TSS datasets are suppressed for insufficient history. TSS is also suppressed because its unit is assumed.
- A unified dataset was refused for every pair.

**Vintages:** strict as-of evaluation covered 1 origin. Vintages start at 2026-11-03.

**Conclusion:** the existing last-value reference remains the appropriate published estimate.

## Limitations

- **Revised history:** backtests use revised history until strict vintages accumulate. Results may be optimistic.
- **Exogenous data:** weather, production and trade are excluded until as-of archives exist.
- **Prospective validation:** this needs at least 6 future monthly outcomes per model and horizon. Until then, nothing is `validated`.
- **No direction claims:** no output states that prices will rise or fall. Every interval is empirical and is not a guarantee.
- **Synthetic data:** `tests/data/test_forecasting.py` uses synthetic series only. Their `synthetic_test` provenance makes `build_payload` refuse them.
