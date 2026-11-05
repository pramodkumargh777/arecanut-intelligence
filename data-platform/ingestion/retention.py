"""Configurable retention for temporary processing files only.

Source evidence is never eligible: raw source captures and connector reports under ``data/raw`` and
``data/processed`` are refused, as is any directory outside the repository's ``data/tmp`` unless an
operator explicitly configures ``ANI_TEMP_DIR``. Dry-run is the default; pass ``--apply`` to delete.

Usage (from the repository root):
  .venv/bin/python data-platform/ingestion/retention.py                 # dry-run, 7-day default
  .venv/bin/python data-platform/ingestion/retention.py --days 14 --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TEMP_DIR = ROOT / "data" / "tmp"
PROTECTED_DIRS = (ROOT / "data" / "raw", ROOT / "data" / "processed", ROOT / "api" / ".wrangler", ROOT / "backups")
DEFAULT_DAYS = 7
MIN_DAYS, MAX_DAYS = 1, 365
MARKER_FILE = ".ani-temp"


class RetentionRefused(ValueError):
    pass


@dataclass
class PurgeReport:
    temp_dir: str
    retention_days: int
    applied: bool
    candidates: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    bytes_eligible: int = 0


def retention_days(value: str | int | None) -> int:
    if value is None or value == "":
        return DEFAULT_DAYS
    days = int(value)
    if not MIN_DAYS <= days <= MAX_DAYS:
        raise RetentionRefused(f"Retention must be {MIN_DAYS}-{MAX_DAYS} days.")
    return days


def resolve_temp_dir(configured: str | os.PathLike[str] | None) -> Path:
    """Return a safe temporary directory or raise; never a protected evidence location."""
    temp_dir = Path(configured).expanduser().resolve() if configured else DEFAULT_TEMP_DIR.resolve()
    if temp_dir == Path(temp_dir.anchor) or temp_dir == Path.home().resolve() or temp_dir == ROOT.resolve():
        raise RetentionRefused(f"Refusing to purge a root, home or repository directory: {temp_dir}")
    for protected in PROTECTED_DIRS:
        protected = protected.resolve()
        if temp_dir == protected or protected in temp_dir.parents or temp_dir in protected.parents:
            raise RetentionRefused(f"Refusing to purge evidence location: {temp_dir}")
    if temp_dir != DEFAULT_TEMP_DIR.resolve() and not (temp_dir / MARKER_FILE).is_file():
        raise RetentionRefused(f"Custom temp directories must contain a {MARKER_FILE} marker file: {temp_dir}")
    return temp_dir


def purge_temporary_files(temp_dir: Path, days: int, *, apply: bool = False, now: float | None = None) -> PurgeReport:
    report = PurgeReport(str(temp_dir), days, apply)
    if not temp_dir.is_dir():
        return report
    cutoff = (now if now is not None else time.time()) - days * 86400
    for path in sorted(temp_dir.rglob("*")):
        # Symlinks are skipped so a link cannot redirect deletion outside the temp directory.
        if path.is_symlink() or not path.is_file() or path.name == MARKER_FILE:
            continue
        stat = path.stat()
        if stat.st_mtime >= cutoff:
            continue
        relative = str(path.relative_to(temp_dir))
        report.candidates.append(relative)
        report.bytes_eligible += stat.st_size
        if apply:
            try:
                path.unlink()
                report.deleted.append(relative)
            except OSError as error:
                report.errors.append(f"{relative}: {error.strerror or error}")
    if apply:
        for directory in sorted((p for p in temp_dir.rglob("*") if p.is_dir() and not p.is_symlink()), reverse=True):
            try:
                directory.rmdir()
            except OSError:
                pass
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Purge expired temporary processing files (never source evidence).")
    parser.add_argument("--temp-dir", default=os.environ.get("ANI_TEMP_DIR"))
    parser.add_argument("--days", default=os.environ.get("ANI_TEMP_RETENTION_DAYS"))
    parser.add_argument("--apply", action="store_true", help="Delete files; omitted means dry-run.")
    args = parser.parse_args(argv)
    try:
        report = purge_temporary_files(resolve_temp_dir(args.temp_dir), retention_days(args.days), apply=args.apply)
    except (RetentionRefused, ValueError) as error:
        print(f"Retention refused: {error}", file=sys.stderr)
        return 2
    print(json.dumps(report.__dict__, indent=2))
    return 1 if report.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
