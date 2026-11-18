/**
 * Helpers that apply shared/lifecycles.ts at the HTTP boundary: explaining refused transitions, and releasing runs whose
 * Worker stopped before recording an outcome.
 */
import { RUN_STALE_AFTER_MINUTES, type Lifecycle } from "../../shared/lifecycles";

/**
 * Body for a review that cannot be applied. It names the record's current state, so a reviewer (or a script) whose
 * queue is out of date learns what happened instead of a bare "not found". Table and column come from the registry.
 */
export async function refusal(db: D1Database, lifecycle: Lifecycle, id: string, noun: string, changedDuringReview = false) {
  const row = await db.prepare(`SELECT ${lifecycle.column} AS status FROM ${lifecycle.table} WHERE id = ?`).bind(id).first<{ status: string }>();
  if (!row) return { error: `${noun} not found.`, current_status: null };
  const state = row.status.replace(/_/g, " ");
  return {
    error: changedDuringReview ? `${noun} changed during review and is now ${state}. Reload the queue.` : `${noun} is already ${state}; nothing was changed. Reload the queue.`,
    current_status: row.status,
  };
}

/** ISO time after which a still-running import job counts as abandoned. ingestion_jobs.started_at is SQLite UTC text. */
export function importAbandonedAfter(startedAt: string) {
  const started = Date.parse(startedAt.includes("T") ? startedAt : `${startedAt.replace(" ", "T")}Z`);
  return new Date(started + RUN_STALE_AFTER_MINUTES * 60_000).toISOString();
}

/**
 * Marks an import job failed when it has been running longer than the lifecycle allows, so a retry with the same
 * idempotency key can run instead of being refused forever. Guarded on the status and age, so a job that is genuinely
 * still running, or that finished meanwhile, is left alone. Returns whether the job was released.
 */
export async function releaseAbandonedImport(db: D1Database, jobId: string): Promise<boolean> {
  const message = `Abandoned: no outcome was recorded within ${RUN_STALE_AFTER_MINUTES} minutes; released for a retry.`;
  const [released] = await db.batch([
    db.prepare(`UPDATE ingestion_jobs SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'running' AND started_at <= datetime('now', ?)`).bind(message, jobId, `-${RUN_STALE_AFTER_MINUTES} minutes`),
    db.prepare("INSERT INTO ingestion_job_logs (id, job_id, level, message) SELECT ?, ?, 'warning', ? WHERE changes() = 1")
      .bind(crypto.randomUUID(), jobId, message),
  ]);
  return released.meta.changes > 0;
}

/** The 409 body for an import whose idempotency key belongs to a job that is still running. */
export function importStillRunning(job: { id: string; started_at: string }) {
  const retryAfter = importAbandonedAfter(job.started_at);
  return {
    error: `An import with this idempotency key is still running. If it has stopped, retry after ${retryAfter} and it will run again.`,
    job_id: job.id, retry_after: retryAfter,
  };
}
