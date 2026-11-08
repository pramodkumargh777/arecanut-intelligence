# Areca Pulse — Data Retention, Backup and Restore

ANI keeps source evidence permanently. Storage is reduced only by moving verified copies to an
optional R2 archive, never by deleting historical records. See [ARCHITECTURE.md](./ARCHITECTURE.md)
for the storage design.

## Retention policy

| Data | Retention | Enforcement |
|---|---|---|
| Market observations, review history, source record versions, monthly price versions | Permanent | `BEFORE DELETE` / immutability triggers (`0015`) |
| Raw cooperative snapshots, monthly raw reports, intelligence captures | Permanent; may move to R2 only after a verified read-back | Delete triggers plus offload guards (`0015`, `0016`) |
| Cooperative quotes and fetch logs, ingestion jobs and job logs | Permanent | Delete triggers (`0015`) |
| `operational_errors` | Permanent | Delete trigger (`0015`) |
| `archive_objects` registry rows | Permanent; identity columns immutable | Triggers (`0015`) |
| R2 objects in category `temporary_processing` | `TEMP_RETENTION_DAYS` (default 7) | `purgeExpiredTemporary` (cron when `ARCHIVE_SCHEDULE_ENABLED="true"`, or `POST /admin/retention/purge`). The registry row is kept and marked `expired`; bytes shared with evidence are never deleted |
| Local temporary files under `data/tmp/` | `ANI_TEMP_RETENTION_DAYS` (default 7, range 1–365) | `npm run retention:temp` (dry-run) / `npm run retention:temp -- --apply` |
| `market_daily_summaries`, `market_summary_dirty` | Derived; rebuildable | `POST /admin/summaries/rebuild` |

The local purge refuses to operate on the filesystem root, the home directory, or the repository
itself. It also refuses `data/raw`, `data/processed`, `api/.wrangler` and `backups`, including their
parents and children. A custom `ANI_TEMP_DIR` must contain a `.ani-temp` marker file. Symbolic
links are skipped.

## Backups

### Logical export (local or remote)

```sh
npm run db:backup                    # local wrangler D1 (default)
npm run db:backup -- --remote        # remote D1; needs wrangler login / CLOUDFLARE_API_TOKEN
npm run db:backup -- --output-dir /secure/location --skip-counts
```

Each run writes two files:
- `<database>-<local|remote>-<timestamp>.sql`, produced by `wrangler d1 export`;
- `<…>.manifest.json`, in format `ani-d1-backup/1`, recording the dump's SHA-256 and every table's
  row count.

`backups/` is git-ignored. Store copies outside the repository; dumps contain all operational data.

D1 cannot export a database that contains virtual tables. The assistant's FTS5 index
(`document_chunks_fts` and its shadow tables, migration `0019`) is derived from `document_chunks`, so
`db:backup` exports every other table explicitly and lists the skipped ones in the manifest's `excluded_tables`.
After any restore, rebuild the index with `POST /api/v1/admin/documents/reindex` (reviewer token). The endpoint
recreates the virtual table if it is missing. Do not drop the FTS table to make a plain `wrangler d1 export` work.

Remote export constraints:
- It reads every row, which counts against the D1 rows-read allowance.
- It blocks writes to the database while it runs, so schedule it off-peak.
- R2 objects are **not** included in the dump. `archive_objects` rows reference them by key and
  SHA-256, so back up the bucket separately (for example with `rclone` or `wrangler r2 object get`)
  if R2 is enabled.

### Verify a backup before relying on it

```sh
npm run db:restore-check -- backups/<name>.manifest.json
npm run db:restore-check -- backups/<name>.manifest.json --write /tmp/restored.sqlite   # optional local copy
```

The check:
1. Verifies the dump SHA-256 against the manifest.
2. Replays the dump into an in-memory SQLite database with foreign-key enforcement off.
   Wrangler exports can emit a rebuilt parent table after its children.
3. Runs `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.
4. Compares every table's row count with the manifest.

`--write` uses `VACUUM INTO` and refuses to overwrite an existing file.

Verified on this repository's local database on 2026-11-04: 43 tables and 4,197 rows; the integrity,
foreign-key and count checks all passed.

## Restore procedures

### Point-in-time restore (remote, preferred for recent mistakes)

D1 Time Travel keeps 7 days of history on the free plan and 30 days on paid plans.

```sh
npx wrangler d1 time-travel info ani-market-data --config api/wrangler.toml
npx wrangler d1 time-travel restore ani-market-data --timestamp=2026-11-01T03:00:00Z --config api/wrangler.toml
# or: --bookmark=<bookmark from `info`>
```

A Time Travel restore overwrites the database in place. Take a fresh `npm run db:backup -- --remote`
first.

### Restore from a logical export

1. Verify the backup: `npm run db:restore-check -- <manifest>`.
2. Create a new, empty database rather than overwriting production:
   `npx wrangler d1 create ani-market-data-restore`.
3. Load the dump:
   `npx wrangler d1 execute ani-market-data-restore --remote --file backups/<name>.sql`.
   D1 limits each SQL statement to 100 KB. Wrangler exports use one INSERT per row, so normal rows
   fit; rows near the 2 MB limit belong in R2.
4. Point the Worker's `database_id` in `api/wrangler.toml` at the restored database.
5. Run `npx wrangler d1 migrations apply ani-market-data --remote` to confirm no migration is pending.
6. Deploy.
7. Call `POST /api/v1/admin/summaries/rebuild` for the active ranges, or let reads refresh dirty dates.
8. Run `POST /api/v1/admin/archive/objects/:id/verify` on a sample of R2 rows.

For local development, restore by replacing `api/.wrangler/state` from a copy, or by running
`npx wrangler d1 execute ani-market-data --local --file <dump>` against an empty local database.

## Reprocessing

- **Official imports:** re-sending the same CSV is a no-op replay. To re-run a file deliberately,
  use `python3 data-platform/ingestion/import_csv.py <file> --reprocess`. This creates new jobs
  linked by `reprocess_of`; duplicate observations are still detected and not inserted twice.
- **Cooperative sources:** `POST /api/v1/admin/cooperative/replay/:fetchId` re-parses the archived
  snapshot. It reads from D1, or from R2 if the snapshot was offloaded.
- **Summary cache:** `POST /api/v1/admin/summaries/rebuild` with `from`/`to` (≤ 3660 days).
- **Failed jobs** release their idempotency key and may be retried with the same key.

## Operations endpoints (reviewer token required)

| Endpoint | Purpose |
|---|---|
| `GET /admin/ingestion/jobs`, `GET /admin/ingestion/jobs/:id` | Job history, logs, observations by status |
| `GET /admin/operations/errors?component=` | Persisted maintenance, archive and ingestion errors |
| `GET /admin/storage/status` | Row counts, summary-cache state, archive totals by storage/class/status |
| `POST /admin/archive/sync` | Bounded archive pass (`limit` 1–20 per evidence table) |
| `GET/POST /admin/archive/objects`, `GET …/:id`, `GET …/:id/content`, `POST …/:id/verify` | Registry, upload, hash-verified download and verification |
| `POST /admin/retention/purge` | Expire temporary R2 objects past retention |
| `POST /admin/summaries/rebuild` | Rebuild the summary cache for a bounded range |

## Enabling R2 (optional)

1. Create a bucket: `npx wrangler r2 bucket create ani-evidence`.
2. Uncomment the `[[r2_buckets]]` block (`binding = "ARCHIVE"`) in `api/wrangler.toml` and deploy.
3. Run `POST /admin/archive/sync` repeatedly (or set `ARCHIVE_SCHEDULE_ENABLED = "true"`) until
   `GET /admin/storage/status` shows evidence stored in R2.
4. Only then, if D1 size requires it, set `ARCHIVE_OFFLOAD_MIN_BYTES` (for example `"262144"`) to
   clear large inline copies after verified read-back.

Removing the binding later makes offloaded evidence unavailable (503), but never lost: the R2 object
and its registry row remain.

## Performance, archive and backups (overview)

### Performance, archive and backups

Migration `0015` adds compound indexes, a trigger-maintained daily summary cache, idempotent import
keys, `operational_errors`, an `archive_objects` registry and no-delete guards on evidence tables.
Migration `0016` lets verified R2 offload clear a cooperative snapshot without allowing any rewrite.
Public list and chart endpoints are bounded and paginated; the browser never loads the full history.

```sh
npm run db:backup                                   # wrangler d1 export + SHA-256 manifest
npm run db:restore-check -- backups/<name>.manifest.json
npm run retention:temp                              # dry-run purge of data/tmp (add -- --apply)
```

R2 is optional and off by default; local development needs no R2 configuration.
