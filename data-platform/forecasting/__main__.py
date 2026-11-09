"""Command line: `python -m forecasting <command>` from `data-platform/`.

Commands
  datasets   Build and summarise every dataset (no models).
  run        Walk-forward backtest, evaluation, legacy comparison, report and (optionally) publication.
  parity     Check the Python port of monthly-baselines-v1 against stored forecast snapshots.
  publish    POST a stored run's payload.json (`--run-id`) to the API.
  covariates Download arrivals, imports and rainfall through `--through YYYY-MM` into forecasting/covariates/.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from itertools import combinations

from .backtest import walk_forward
from .config import CANDIDATE_MODELS, ExperimentConfig
from .datasets import IncomparableDatasets, build_all, build_unified_dataset, exogenous_availability
from .evaluate import evaluate
from .legacy import compare_with_engine, parity_check
from .outlook import build_outlook
from .publish import build_payload, build_track, post_payload
from .report import render
from .sources import connect, table_exists
from .tracking import RUNS_DIR, RunRecorder, canonical_hash, environment, mirror_to_mlflow, new_run_id


def _unified_note(datasets) -> str:
    refusals = []
    for a, b in combinations(datasets.values(), 2):
        try:
            build_unified_dataset([a, b])
            return f"{a.key} and {b.key} are comparable."
        except IncomparableDatasets:
            refusals.append(f"{a.key}/{b.key}")
    return "refused for every pair (" + ", ".join(refusals) + ") — price basis, unit status or frequency differ."


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m forecasting", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["datasets", "run", "parity", "publish", "covariates"])
    parser.add_argument("--through", help="Last month (YYYY-MM) for the covariates command.")
    parser.add_argument("--sqlite", help="Path to a D1 SQLite file (default: discover local Miniflare D1).")
    parser.add_argument("--sql-export", help="Path to a scripts/d1-backup.mjs SQL export (loaded in memory).")
    parser.add_argument("--models", default="", help=f"Comma list; default baselines + statistical + lightgbm. Extra: {','.join(CANDIDATE_MODELS)}")
    parser.add_argument("--with-chronos", action="store_true", help="Add the experimental Chronos-2 benchmark (CPU).")
    parser.add_argument("--with-covariates", action="store_true",
                        help="Add lightgbm_x and chronos2_x, fed with arrivals, imports, rainfall and policy events from forecasting/covariates/.")
    parser.add_argument("--with-pretrained", action="store_true",
                        help="Add Chronos-2, TimesFM 2.5 and the median ensemble of theta, auto_ets and chronos2 (CPU).")
    parser.add_argument("--last-origins", type=int, default=0, help="Evaluate only the latest N origins (smoke runs).")
    parser.add_argument("--publish", action="store_true", help="POST the experiment to ANI_API_URL with INGESTION_TOKEN.")
    parser.add_argument("--dry-run", action="store_true", help="Build the payload and report but never POST.")
    parser.add_argument("--run-id", help="Run identifier for the publish command.")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    if args.command == "covariates":
        if not args.through or not re.fullmatch(r"\d{4}-\d{2}", args.through):
            parser.error("covariates needs --through YYYY-MM")
        from .covariates import fetch_all
        print(json.dumps({"files": fetch_all(args.through, log=lambda m: print(m, file=sys.stderr))}, indent=2))
        return 0

    if args.command == "publish":
        if not args.run_id or not re.fullmatch(r"fx-[0-9TZ]+-[0-9a-f]{10}", args.run_id):
            parser.error("publish needs a valid --run-id")
        payload = json.loads((RUNS_DIR / args.run_id / "payload.json").read_text(encoding="utf-8"))
        if args.dry_run:
            print(json.dumps({"run_id": args.run_id, "predictions": len(payload["predictions"]), "published": False}))
            return 0
        print(json.dumps(post_payload(payload), indent=2))
        return 0

    conn = connect(args.sqlite, args.sql_export)
    config = ExperimentConfig()
    if args.models or args.with_chronos or args.with_pretrained or args.with_covariates:
        models = tuple(m for m in args.models.split(",") if m) or config.models
        extra = ("chronos2", "timesfm25", "ensemble") if args.with_pretrained else ("chronos2",) if args.with_chronos else ()
        extra += ("lightgbm_x", "chronos2_x") if args.with_covariates else ()
        models = models + tuple(m for m in extra if m not in models)
        config = ExperimentConfig(models=models)
    log = (lambda _message: None) if args.quiet else (lambda message: print(message, file=sys.stderr))

    if args.command == "parity":
        if not table_exists(conn, "forecast_snapshots"):
            print(json.dumps({"error": "forecast_snapshots table not found"}))
            return 1
        report = parity_check(conn)
        print(json.dumps(report, indent=2, default=str))
        return 0 if all(r["match"] is not False for r in report) else 1

    datasets = build_all(conn, config)
    if args.command == "datasets":
        print(json.dumps({"datasets": {k: d.summary() for k, d in datasets.items()},
                          "unified": _unified_note(datasets), "exogenous": exogenous_availability(conn)},
                         indent=2, default=str))
        return 0

    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    config_hash = canonical_hash(config.to_dict())
    run_id = new_run_id(config_hash)
    recorder = RunRecorder(run_id)
    env = environment()
    monthly = datasets["monthly_reference"]
    recorder.json("config.json", config.to_dict() | {"config_hash": config_hash})
    recorder.json("environment.json", env)
    recorder.json("datasets.json", {k: d.summary() for k, d in datasets.items()})

    periods = sorted({p for s in monthly.eligible_series for p in s.values.index})
    origins = periods[config.initial_training_periods - 1:]
    if args.last_origins:
        origins = origins[-args.last_origins:]
    strict = walk_forward(monthly, config, models=("last_value",), mode="strict", origins=origins)
    strict_meta = {"origins_evaluated": strict.origins_evaluated, "origins_skipped": strict.origins_skipped}
    log(f"strict as-of evaluation: {strict_meta}")
    covariates = None
    covariate_meta: dict | None = None
    if args.with_covariates:
        from .covariates import LAG_MONTHS, MIN_MARKET_SHARE, covariate_version, monthly_covariates
        covariates = monthly_covariates(through=str(periods[-1]))
        covariate_meta = {"version": covariate_version(), "columns": list(covariates.columns),
                          "from": str(covariates.index.min()), "to": str(covariates.index.max()),
                          "publication_lag_months": LAG_MONTHS, "steady_market_share": MIN_MARKET_SHARE,
                          "sources": {"arrivals": "AGMARKNET market-wise monthly arrivals (Karnataka areca districts)",
                                      "imports": "Commerce Ministry TradeStat, HS 080280, all countries",
                                      "rainfall": "Open-Meteo ERA5 archive (Shivamogga, Sirsi, Puttur)",
                                      "events": "Verified policy dates (market-events.ts)"}}
        recorder.json("covariates.json", covariate_meta)
        log(f"covariates: {covariate_meta['columns']} {covariate_meta['from']}..{covariate_meta['to']}")
    result = walk_forward(monthly, config, mode="revised", origins=origins, progress=log, covariates=covariates)
    recorder.frame("backtest.csv", result.rows)
    evaluation = evaluate(result, config)
    recorder.json("evaluation.json", evaluation)
    legacy = compare_with_engine(parity_check(conn), result.rows) if table_exists(conn, "forecast_snapshots") else []
    recorder.json("legacy_comparison.json", legacy)
    exogenous = exogenous_availability(conn)
    payload = build_payload(run_id=run_id, created_at=created_at, config=config, config_hash=config_hash, env=env,
                            datasets=datasets, evaluated=monthly, result=result, evaluation=evaluation)
    payload["experiment"].update(strict_vintage=strict_meta, pooled=evaluation["pooled"],
                                 status_counts=evaluation["status_counts"], legacy_comparison=legacy,
                                 exogenous=exogenous, track=build_track(result.rows, monthly, evaluation["pooled"]),
                                 outlook=build_outlook(result.rows, monthly, evaluation, config.horizons, config.interval_level),
                                 covariates=covariate_meta)
    recorder.json("payload.json", payload)
    backtest_meta = {"origins_evaluated": result.origins_evaluated, "horizons": list(config.horizons),
                     "model_errors": len(result.model_errors), "seconds": round(result.seconds, 1)}
    report = render(run_id=run_id, created_at=created_at, env=env, datasets=payload["datasets"], evaluation=evaluation,
                    backtest_meta=backtest_meta, legacy=legacy, exogenous=exogenous, strict=strict_meta,
                    unified_note=_unified_note(datasets))
    recorder.text("report.md", report)
    pooled = {f"h{r['horizon']}_{r['model']}_mae": r["mae"] for r in evaluation["pooled"]}
    mlflow_note = mirror_to_mlflow(run_id, config.to_dict(), pooled, recorder.path)
    summary = {"run_id": run_id, "run_dir": str(recorder.path), "status_counts": evaluation["status_counts"],
               "predictions": len(payload["predictions"]), "evaluations": len(payload["evaluations"]),
               "backtest": backtest_meta, "strict_vintage": strict_meta, "mlflow": mlflow_note, "published": False}
    if args.publish and not args.dry_run:
        summary["api_response"] = post_payload(payload)
        summary["published"] = True
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
