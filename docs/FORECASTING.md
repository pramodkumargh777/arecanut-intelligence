# Areca Pulse forecasting engine (experimental)

`data-platform/forecasting` is an independent and reproducible experimentation and evaluation engine. It **does not replace** the
Worker's `monthly-baselines-v1` reference (`/forecasts`). That baseline stays live and stays labelled as a reference estimate.

## What it does

1. **Datasets, one price basis each** (`datasets.py`). Nothing is pooled across bases.

   | Dataset | Basis | Source table | Notes |
   |---|---|---|---|
   | `monthly_reference` | `MONTHLY_STATE_WEIGHTED_AVERAGE` | `monthly_variety_prices` + `monthly_price_versions` (vintages) | Latest contiguous run per Karnataka variety; earlier gaps are dropped, never interpolated |
   | `daily_agmarknet` | `APMC_MODAL` | `market_price_observations` (validated) | Series = market × variety × grade |
   | `mamcos_branch_average` | `COOPERATIVE_AVERAGE` | `cooperative_quotes` (verified) | Branch × variety |
   | `tss_tender_average` | `COOPERATIVE_TENDER_AVERAGE` | `cooperative_quotes` | INR/quintal is an operator assumption (migration 0020); publication depends on the history rules |

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

## Outlook ranges from the 2014+ history

The live 1–6 month outlook (`outlook.py`, applied by `api/src/outlook.ts`) takes its range widths from pooled
walk-forward errors, scaled by each series' volatility. With `--outlook-history daily` (used by
`forecasting-refresh.yml`), those errors come from the baselines (last value, seasonal naive) run on `monthly_from_daily`:

- **Source:** the median across Karnataka APMCs of each market's mean daily modal price, from the committed 2014+
  archive (`daily_archive/`, kept current by `long-history-topup.yml`). This gives 11 series and about 900 errors per
  horizon, against about 500 from the report's own 35 origins.
- **Complete months only:** errors whose target month is later than the report's latest month are dropped, because the
  archive's newest month can be partial.
- **Centred on zero:** each era leans its own way (the median 3-month error was +1.21 in 2020 and −0.67 in 2026), so
  no drift is assumed and the chance of a rise stays near 50% unless a validated model says otherwise.
- **Tested on the official report:** quantiles fitted on errors before the report's 12th-latest origin are scored on
  the report's last 12 origins, the series the ranges are applied to. That is the `test` published per horizon and
  shown as "how the range held".
- **What stays the same:** forecasts, evaluations, the candidate gate, prospective validation and `/forecasts` all stay
  on the official report (`MONTHLY_STATE_WEIGHTED_AVERAGE`). The API accepts no other monthly basis, and outcomes are
  scored only against the report.
- **Disclosure:** the outlook's `calibration` metadata records the dataset, basis and origins. `/forecasts` returns
  them as `calibration_history`, and the Forecasts page names that history.

**Evidence (2026-11-18).** The 80% range was scored on the official report:

| Test origins | Horizon | Report-only calibration: coverage / width | 2014+ calibration, centred: coverage / width |
|---|---|---|---|
| 2024-10 to 2025-09 | 1 | 0.77 / 18.5% | 0.75 / 16.8% |
| 2024-10 to 2025-09 | 6 | 0.50 / 36.9% | 0.74 / 41.1% |
| 2025-10 to 2026-09 | 1 | 0.90 / 26.8% | 0.89 / 23.8% |
| 2025-10 to 2026-09 | 6 | 0.91 / 67.9% | 0.87 / 54.3% |

- **Earlier window:** with only a few years of its own history, the report-only calibration was far too narrow (half
  of the 6-month ranges missed).
- **Latest window:** it was too wide.
- **2014+ calibration:** stayed nearer 80% in both windows.
- **Direction:** its Brier score was 0.24–0.25, at or below the no-skill level in both windows.

Without the option, the engine fits the evaluated series' own errors, as before.

### Volatility method

Range widths scale with each series' monthly volatility. The method used is recorded in the calibration and shared by
the engine (`recent_volatility` in `outlook.py`), the Worker and the Forecasts page (`shared/volatility.ts`):

| Method | How it is measured |
|---|---|
| `rms` | Root-mean-square of the last 12 monthly log returns, all weighted equally. |
| `ewma` | Exponentially weighted log returns: the newest has weight 1, the one before 0.94, then 0.94² and so on, over at most 60 months. |

Both need at least 6 returns and are floored at 1%.

- **Decay is fixed in advance.** 0.94 is the RiskMetrics convention, chosen before any comparison. A probe also tried
  0.90 and 0.97, and they were not used.
- **Memory.** The effective memory of `ewma` is about 17 months. A large move fades gradually instead of dropping out
  the month it leaves the 12-month window. It does not react faster than `rms`.
- **Selection.** `build_outlook_selected` fits both methods on identical errors, quantile fits and test origins.
  - It publishes `ewma` only when its mean held-out interval score (Gneiting & Raftery, on the log scale) is strictly
    lower over the horizons tested under both.
  - The comparison is recorded in `vol_selection`.
  - The chosen method's test is therefore slightly optimistic, which is acceptable with two candidates fixed in advance.
- **What the API applies.** `/forecasts` applies the published method and returns it as `outlook.volatility`.
  Calibrations published before the field existed are read as `rms`.
- **Deploy the Worker first.** A Worker older than this field ignores `vol_method` and would apply EWMA-fitted ranges
  to an RMS volatility. Deploy the Worker (and the Pages build, whose "How the range held" table uses the same
  formula) before the first engine run that can publish `ewma`, whether that is `forecasting-refresh.yml` on the 20th
  or a manual dispatch.

**Probe (2026-11-18, 2014+ series, last-value errors, 80% band):**

| Fit / test split | Horizon | Coverage, `rms` / `ewma` | Interval score, `rms` / `ewma` |
|---|---|---|---|
| < 2019 / ≥ 2019 | 1 | 0.76 / 0.74 | 26.5 / 26.6 |
| < 2019 / ≥ 2019 | 6 | 0.68 / 0.72 | 55.6 / 53.6 |
| < 2022 / ≥ 2022 | 1 | 0.79 / 0.77 | 26.0 / 25.9 |
| < 2022 / ≥ 2022 | 6 | 0.75 / 0.78 | 51.7 / 48.3 |

The gain is small and comes at 3–6 months, not at 1 month.

## Commands

From `data-platform/`, with the repository `.venv`:

```bash
../.venv/bin/python -m forecasting datasets                    # dataset summaries and suppression reasons
../.venv/bin/python -m forecasting run --dry-run               # baselines + statistical + LightGBM
../.venv/bin/python -m forecasting run --outlook-history daily --dry-run   # outlook ranges from the 2014+ archive
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
- The daily AGMARKNET, MAMCOS and TSS datasets are suppressed for insufficient history. That run predates the 2026-11-05 unit decision, which removed the TSS unit suppression.
- A unified dataset was refused for every pair.

**Vintages:** strict as-of evaluation covered 1 origin. Vintages start at 2026-11-03.

**Conclusion:** the existing last-value reference remains the appropriate published estimate.

## Limitations

- **Revised history:** backtests use revised history until strict vintages accumulate. Results may be optimistic.
- **Exogenous data:** weather, production and trade are excluded until as-of archives exist.
- **Prospective validation:** this needs at least 6 future monthly outcomes per model and horizon. Until then, nothing is `validated`.
- **No direction claims:** no output states that prices will rise or fall. Every interval is empirical and is not a guarantee.
- **Synthetic data:** `tests/data/test_forecasting.py` uses synthetic series only. Their `synthetic_test` provenance makes `build_payload` refuse them.

## Evaluated monthly forecast baselines (operations)

### Evaluated monthly forecast baselines

An independent experimental engine (`data-platform/forecasting`, dashboard `/forecasts/evaluation`) benchmarks statistical, LightGBM and Chronos-2 models against these baselines with walk-forward evaluation. See [docs/FORECASTING.md](FORECASTING.md). It does not replace the baselines below.

Open `http://localhost:5173/forecasts`. To evaluate and persist snapshots:

```sh
npm run evaluate:forecasts                # Rashi
npm run evaluate:forecasts -- --all        # all varieties in latest monthly report
```

The same reviewer-protected operation is available in the UI. Evaluations use
only exact-variety Karnataka monthly weighted prices with archived capture
provenance. No monthly/daily blending or TSS prices enter these monthly baselines.
Production, weather and news are not predictive features in this baseline.

- Require at least 60 consecutive positive calendar-month prices and data
  through the latest completed month. Missing, zero, stale or absent history
  keeps forecasts unavailable.
- Walk forward chronologically. Initial history is followed by 12 validation
  targets, 12 interval-calibration targets and 12 holdout targets.
- Compare last-value and seasonal-naive models; choose by validation MAE,
  never calibration or holdout performance. Predict only one reporting month.
- Calibrate an 80%-nominal empirical absolute-error interval on the 12
  pre-holdout errors. Show actual holdout coverage, MAE, RMSE and sMAPE.
  Small samples, serial dependence and selection prevent guaranteed coverage.
- Publish only if the selected model does not deteriorate against the
  last-value holdout benchmark on all three error measures. A published
  last-value baseline means **no demonstrated predictive edge**, not an AI
  prediction with proven profitability.
- Save immutable inputs, source references/fingerprint, formula version,
  scores, gates and results. A changed month, price or unit, or a calendar
  rollover, suppresses the displayed forecast until re-evaluation. Re-fetching
  an unchanged report adds a capture record but does not suppress the forecast,
  so the daily refresh leaves valid forecasts published.

Initial real-data evaluation: **28 varieties evaluated, 11 published
last-value baselines, 17 withheld**. Rashi uses 70 months and its November
2026 baseline is 47,174.91 INR/quintal, empirical interval
43,048.37–51,301.45. Its twelve-target holdout MAE is 919.28 INR/quintal,
RMSE 1,238.89, sMAPE 1.75%, and interval coverage 12/12. Skill versus the
last-value benchmark is exactly zero. These are retrospective measurements,
not promised future accuracy.

Backtests use **currently revised history**, not period-by-period as-of
vintages; vintage leakage is not ruled out. Holdout results gate publication
and can be reused by subsequent evaluations. There is no prospective trading
validation, multi-step model, predictive sell/hold recommendation or grounded
AI chat. CSV holdout exports and full evaluation JSON support inspection.
