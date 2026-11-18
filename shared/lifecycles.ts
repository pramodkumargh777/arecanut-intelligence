/**
 * Record lifecycles: every status column whose value changes during a record's life, declared once.
 *
 * The database CHECK constraints say which values a column may hold. This file says how a record moves between them,
 * who moves it and why. `api/src/lifecycles.test.ts` keeps the three in step: it compares each `states` list with the
 * migrated schema, and every literal `UPDATE <table> SET <column> = '<state>'` / `INSERT` in api/src with `initial` and
 * `transitions`. docs/LIFECYCLES.md is generated from this file (`npm run docs:lifecycles`).
 *
 * To change a lifecycle: edit this file, then the SQL (and a migration if the CHECK list changes), then regenerate the
 * docs. The tests fail until all of them agree.
 *
 * Plain data and small helpers only (no runtime dependency), so the Worker, the frontend and scripts can all import it.
 */

/** Who moves a record: a person with the reviewer token, a scheduled/automatic check, an import, an operator, or run bookkeeping. */
export type Actor = "reviewer" | "automation" | "import" | "operator" | "system";

export type Transition<S extends string> = {
  readonly from: readonly S[];
  readonly to: S;
  /** Short event name, as shown in the diagram. */
  readonly on: string;
  readonly by: Actor;
  readonly note?: string;
};

export type Lifecycle<S extends string = string> = {
  readonly table: string;
  readonly column: string;
  readonly summary: string;
  /** Every value the CHECK constraint allows, in display order, with what it means. */
  readonly states: Readonly<Record<S, string>>;
  /** Values a new row may be inserted with. */
  readonly initial: readonly NoInfer<S>[];
  readonly transitions: readonly Transition<NoInfer<S>>[];
  /** Allowed by the schema but written by no code path; kept so the schema and this file agree. */
  readonly unreachable?: readonly NoInfer<S>[];
  /** Named conditions within a state that other columns encode (for example a pending quote that automation holds). */
  readonly substates?: Readonly<Record<string, string>>;
  /** A row left in `state` longer than this was abandoned (the Worker stopped before recording an outcome). */
  readonly stale?: { readonly state: NoInfer<S>; readonly afterMinutes: number; readonly handling: string };
};

const define = <const S extends string>(lifecycle: Lifecycle<S>) => lifecycle;

/**
 * A run still "running" after this long was abandoned: Cloudflare stops a scheduled Worker after 15 minutes of wall
 * time, and no request here legitimately takes longer. Twice that leaves room for clock skew and slow sources.
 */
export const RUN_STALE_AFTER_MINUTES = 30;

/** Held cooperative quotes are rejected automatically this many days after they were first held. */
export const HELD_QUOTE_AUTO_REJECT_DAYS = 14;
/** Flagged official observations are rejected automatically this many days after they were stored. */
export const FLAGGED_OBSERVATION_AUTO_REJECT_DAYS = 14;

export const LIFECYCLES = {
  observation: define({
    table: "market_price_observations",
    column: "validation_status",
    summary: "An official (AGMARKNET or CSV) price row, from import to publication. Only `verified` rows reach readers.",
    states: {
      validated: "Passed every connector check; waiting for review or automatic verification.",
      review_required: "The connector flagged it (for example an implausible range); waiting for a person.",
      verified: "Published in prices and analytics.",
      rejected: "Kept for audit, never published.",
      superseded: "Replaced by a corrected version of the same source record.",
    },
    initial: ["validated", "review_required", "verified"],
    transitions: [
      { from: ["validated", "review_required"], to: "verified", on: "approve", by: "reviewer" },
      { from: ["validated"], to: "verified", on: "auto-verify", by: "automation", note: "AGMARKNET_DAILY_AUTO_VERIFY; api/src/auto-verify.ts" },
      { from: ["validated", "review_required"], to: "rejected", on: "reject", by: "reviewer" },
      { from: ["review_required"], to: "rejected", on: `flagged ${FLAGGED_OBSERVATION_AUTO_REJECT_DAYS} days`, by: "automation" },
      { from: ["validated", "review_required", "verified", "rejected"], to: "superseded", on: "corrected", by: "import" },
      { from: ["superseded"], to: "validated", on: "re-imported", by: "import" },
      { from: ["superseded"], to: "review_required", on: "re-imported", by: "import" },
      { from: ["superseded"], to: "verified", on: "re-imported", by: "import", note: "History import with AGMARKNET_HISTORY_AUTO_VERIFY" },
    ],
  }),

  cooperativeQuote: define({
    table: "cooperative_quotes",
    column: "status",
    summary: "A cooperative (MAMCOS, TSS, TMS, TUMCOS) branch average. Only `verified` rows reach readers.",
    states: {
      pending: "Stored and waiting for automatic publication or a person.",
      invalid: "Failed source validation; can only be rejected.",
      verified: "Published.",
      accepted_unit_unconfirmed: "Accepted as a source record, but not published because its unit is unconfirmed.",
      rejected: "Kept for audit, never published.",
      superseded: "Replaced by a newer snapshot of the same source record.",
    },
    initial: ["pending", "invalid"],
    substates: {
      held: `pending with hold_reason set: automatic checks found a problem (held_at is when). A person can still approve or `
        + `reject it; otherwise it is rejected automatically ${HELD_QUOTE_AUTO_REJECT_DAYS} days after held_at.`,
    },
    transitions: [
      { from: ["pending"], to: "verified", on: "approve", by: "reviewer" },
      { from: ["pending"], to: "verified", on: "auto-publish", by: "automation", note: "api/src/cooperative-auto-publish.ts" },
      { from: ["pending"], to: "accepted_unit_unconfirmed", on: "approve (unit unconfirmed)", by: "reviewer" },
      { from: ["pending", "invalid"], to: "rejected", on: "reject", by: "reviewer" },
      { from: ["pending"], to: "rejected", on: `held ${HELD_QUOTE_AUTO_REJECT_DAYS} days`, by: "automation" },
      { from: ["pending", "invalid", "verified", "accepted_unit_unconfirmed", "rejected"], to: "superseded", on: "new snapshot", by: "import" },
      { from: ["superseded"], to: "pending", on: "re-fetched", by: "import" },
      { from: ["superseded"], to: "invalid", on: "re-fetched", by: "import" },
    ],
  }),

  cropFieldReport: define({
    table: "crop_field_reports",
    column: "verification_status",
    summary: "A field observation of crop disease or pests, reviewed before it informs risk advisories.",
    states: { pending: "Submitted; waiting for a reviewer.", verified: "Accepted as evidence.", rejected: "Kept, not used." },
    initial: ["pending"],
    transitions: [
      { from: ["pending"], to: "verified", on: "verify", by: "reviewer" },
      { from: ["pending"], to: "rejected", on: "reject", by: "reviewer" },
    ],
  }),

  qualityInspection: define({
    table: "quality_inspections",
    column: "status",
    summary: "A laboratory quality report for a lot, reviewed before use.",
    states: {
      pending: "Submitted; waiting for a reviewer.",
      verified: "Accepted.",
      rejected: "Kept, not used.",
      superseded: "Reserved for a corrected report. A correction is currently submitted as a separate report instead.",
    },
    initial: ["pending"],
    unreachable: ["superseded"],
    transitions: [
      { from: ["pending"], to: "verified", on: "verify", by: "reviewer" },
      { from: ["pending"], to: "rejected", on: "reject", by: "reviewer" },
    ],
  }),

  ingestionJob: define({
    table: "ingestion_jobs",
    column: "status",
    summary: "One official import request (POST /admin/import, /admin/agmarknet/history/import).",
    states: { running: "Writing rows.", completed: "Finished; counts recorded.", failed: "Stopped; error_message says why." },
    initial: ["running"],
    stale: {
      state: "running", afterMinutes: RUN_STALE_AFTER_MINUTES,
      handling: "A retry with the same idempotency key marks the abandoned job failed and runs the import again.",
    },
    transitions: [
      { from: ["running"], to: "completed", on: "finished", by: "system" },
      { from: ["running"], to: "failed", on: "error", by: "system" },
      { from: ["running"], to: "failed", on: `abandoned ${RUN_STALE_AFTER_MINUTES} min`, by: "system", note: "Released by a retry with the same idempotency key" },
    ],
  }),

  cooperativeFetch: define({
    table: "cooperative_fetches",
    column: "status",
    summary: "One collection from a cooperative website, with its raw snapshot.",
    states: {
      running: "Fetching and storing.",
      succeeded: "Snapshot stored.",
      failed: "Fetch or parse failed; earlier records were kept.",
      blocked: "Not attempted: collection permission is not recorded as granted.",
    },
    initial: ["running", "blocked"],
    stale: {
      state: "running", afterMinutes: RUN_STALE_AFTER_MINUTES,
      handling: "Source status reports availability \"stalled\" instead of \"running\"; the row is left as recorded.",
    },
    transitions: [
      { from: ["running"], to: "succeeded", on: "stored", by: "system" },
      { from: ["running"], to: "failed", on: "error", by: "system" },
    ],
  }),

  monthlyRefreshRun: define({
    table: "monthly_refresh_runs",
    column: "status",
    summary: "One download of the Karnataka monthly price report.",
    states: { running: "Downloading.", succeeded: "Report stored.", failed: "Download or parse failed." },
    initial: ["running"],
    transitions: [
      { from: ["running"], to: "succeeded", on: "stored", by: "system" },
      { from: ["running"], to: "failed", on: "error", by: "system" },
    ],
  }),

  intelligenceRefreshRun: define({
    table: "intelligence_refresh_runs",
    column: "status",
    summary: "One refresh of an intelligence source (weather, official bulletins).",
    states: { running: "Fetching.", succeeded: "Capture stored.", failed: "Fetch failed." },
    initial: ["running"],
    transitions: [
      { from: ["running"], to: "succeeded", on: "stored", by: "system" },
      { from: ["running"], to: "failed", on: "error", by: "system" },
    ],
  }),

  archiveObject: define({
    table: "archive_objects",
    column: "status",
    summary: "An evidence or temporary object in the R2 archive, re-checked by SHA-256 whenever it is read.",
    states: {
      stored: "Present, and its hash matched when last checked.",
      missing: "Not found in R2 when last read.",
      hash_mismatch: "Found, but its SHA-256 did not match.",
      expired: "Temporary object past its retention; bytes deleted.",
    },
    initial: ["stored"],
    transitions: [
      { from: ["stored", "hash_mismatch"], to: "missing", on: "read: absent", by: "system" },
      { from: ["stored", "missing"], to: "hash_mismatch", on: "read: bad hash", by: "system" },
      { from: ["missing", "hash_mismatch", "expired"], to: "stored", on: "re-uploaded or read OK", by: "system" },
      { from: ["stored"], to: "expired", on: "retention purge", by: "automation" },
    ],
  }),

  assistantDocument: define({
    table: "documents",
    column: "status",
    summary: "A document in the assistant's search index. Only `active` documents are searched.",
    states: {
      active: "Searchable.",
      withdrawn: "Not searchable: either still being written (a new upload) or replaced by a newer version.",
    },
    initial: ["withdrawn"],
    transitions: [
      { from: ["withdrawn"], to: "active", on: "published", by: "import", note: "Chunks are written first, then one batch publishes" },
      { from: ["active"], to: "withdrawn", on: "replaced", by: "import" },
    ],
  }),

  cooperativePermission: define({
    table: "cooperative_sources",
    column: "permission_status",
    summary: "Whether a cooperative has permitted collection. Scheduled collection needs `granted` and its own flag.",
    states: {
      not_requested: "No request made.",
      requested: "Requested; no answer recorded.",
      granted: "Granted; a permission reference is required.",
      denied: "Refused; collection and redistribution are off.",
    },
    initial: ["not_requested", "requested", "granted", "denied"],
    transitions: [
      { from: ["requested", "granted", "denied"], to: "not_requested", on: "recorded", by: "operator" },
      { from: ["not_requested", "granted", "denied"], to: "requested", on: "recorded", by: "operator" },
      { from: ["not_requested", "requested", "denied"], to: "granted", on: "recorded", by: "operator", note: "Needs permission_reference" },
      { from: ["not_requested", "requested", "granted"], to: "denied", on: "recorded", by: "operator" },
    ],
  }),

  marketMapping: define({
    table: "markets",
    column: "mapping_status",
    summary: "Whether a market's name and district have been confirmed by an approved observation.",
    states: { unverified: "Seen in an import only.", verified: "Confirmed by an approved observation." },
    initial: ["unverified"],
    transitions: [
      { from: ["unverified"], to: "verified", on: "observation approved", by: "reviewer" },
      { from: ["unverified"], to: "verified", on: "observation auto-verified", by: "automation" },
    ],
  }),
} as const;

export type LifecycleName = keyof typeof LIFECYCLES;
export type StateOf<L> = L extends Lifecycle<infer S> ? S : never;
export type ObservationStatus = StateOf<typeof LIFECYCLES.observation>;
export type CooperativeQuoteStatus = StateOf<typeof LIFECYCLES.cooperativeQuote>;
export type PermissionStatus = StateOf<typeof LIFECYCLES.cooperativePermission>;

export const statesOf = <S extends string>(lifecycle: Lifecycle<S>) => Object.keys(lifecycle.states) as S[];

/** Whether `by` (any actor when omitted) may move a record from `from` to `to`. */
export function canTransition<S extends string>(lifecycle: Lifecycle<S>, from: string, to: S, by?: Actor): boolean {
  return lifecycle.transitions.some((t) => t.to === to && (t.from as readonly string[]).includes(from) && (!by || t.by === by));
}

/** States a record must be in for `by` to move it to `to`, in declaration order. */
export function statesBefore<S extends string>(lifecycle: Lifecycle<S>, to: S, by?: Actor): S[] {
  const sources = new Set(lifecycle.transitions.filter((t) => t.to === to && (!by || t.by === by)).flatMap((t) => t.from));
  return statesOf(lifecycle).filter((state) => sources.has(state));
}

/** States a reviewer can act on: what a review queue lists. */
export function reviewQueueStates<S extends string>(lifecycle: Lifecycle<S>): S[] {
  const sources = new Set(lifecycle.transitions.filter((t) => t.by === "reviewer").flatMap((t) => t.from));
  return statesOf(lifecycle).filter((state) => sources.has(state));
}

/** States with no way out. */
export function terminalStates<S extends string>(lifecycle: Lifecycle<S>): S[] {
  const exits = new Set(lifecycle.transitions.flatMap((t) => t.from));
  return statesOf(lifecycle).filter((state) => !exits.has(state));
}

/**
 * A SQL list for `IN (...)`. Only declared state names are accepted (lower-case identifiers), so the result is safe to
 * interpolate; values from requests must still be bound as parameters.
 */
export function sqlStates(states: readonly string[]): string {
  if (!states.length) throw new Error("sqlStates needs at least one state.");
  return states.map((state) => {
    if (!/^[a-z_]+$/.test(state)) throw new Error(`Not a lifecycle state: ${state}`);
    return `'${state}'`;
  }).join(", ");
}

/** D1 stores some timestamps as SQLite "YYYY-MM-DD HH:MM:SS" (UTC, no zone) and others as ISO-8601. */
const toTime = (timestamp: string) => Date.parse(timestamp.includes("T") ? timestamp : `${timestamp.replace(" ", "T")}Z`);

/** Whether a row in the lifecycle's stale-prone state has been there longer than allowed. */
export function isStale<S extends string>(lifecycle: Lifecycle<S>, status: string, startedAt: string | null, now = new Date()): boolean {
  if (!lifecycle.stale || status !== lifecycle.stale.state || !startedAt) return false;
  const started = toTime(startedAt);
  return Number.isFinite(started) && now.getTime() - started >= lifecycle.stale.afterMinutes * 60_000;
}
