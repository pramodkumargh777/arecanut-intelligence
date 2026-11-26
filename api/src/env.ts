import type { AssistantConfig } from "./assistant/providers";

export type Env = {
  Bindings: {
    DB: D1Database;
    // Anonymous product analytics event collection uses the existing D1 database.
    CORS_ORIGIN?: string;
    INGESTION_TOKEN?: string;
    ADMIN_TOKEN?: string;
    MIN_INDEX_MARKETS?: string;
    REFERENCE_STATE?: string;
    MAMCOS_SCHEDULE_ENABLED?: string;
    TSS_SCHEDULE_ENABLED?: string;
    TUMCOS_SCHEDULE_ENABLED?: string;
    TMS_SCHEDULE_ENABLED?: string;
    /** "true" publishes scheduled quotations that pass every check; the rest wait in the review queue. */
    COOPERATIVE_AUTO_PUBLISH?: string;
    COOPERATIVE_FETCH_ATTEMPTS?: string;
    /** "true" verifies AGMARKNET current-daily rows that pass every check (src/auto-verify.ts). */
    AGMARKNET_DAILY_AUTO_VERIFY?: string;
    /** "true" verifies AGMARKNET history records that pass every check at import (src/agmarknet-history.ts). */
    AGMARKNET_HISTORY_AUTO_VERIFY?: string;
    /** "false" refuses AGMARKNET 2.0 arrival imports (src/agmarknet-v2-arrivals.ts). */
    AGMARKNET_V2_ARRIVALS_IMPORT_ENABLED?: string;
    /** "true" adds AGMARKNET 2.0 monthly arrivals to GET /supply/arrivals (monthly and seasonal views only). */
    AGMARKNET_V2_ARRIVALS_IN_SUPPLY?: string;
    /** "false" refuses daily arrival imports (KRAMA and AGMARKNET date-wise; src/daily-arrivals.ts). */
    DAILY_ARRIVALS_IMPORT_ENABLED?: string;
    /** "true" adds daily arrivals (KRAMA first, then AGMARKNET date-wise) to GET /supply/arrivals at every granularity. */
    DAILY_ARRIVALS_IN_SUPPLY?: string;
    INTELLIGENCE_SCHEDULE_ENABLED?: string;
    /** Optional R2 evidence archive. Absent locally and on deployments without a bucket. */
    ARCHIVE?: R2Bucket;
    ARCHIVE_OFFLOAD_MIN_BYTES?: string;
    TEMP_RETENTION_DAYS?: string;
    ARCHIVE_SCHEDULE_ENABLED?: string;
    /** Set to "false" to disable Open-Meteo (development weather source; non-commercial licence). */
    OPEN_METEO_ENABLED?: string;
    /** AI assistant (optional). Provider "none"/unset = deterministic answers from verified data only. */
    ASSISTANT_LLM_PROVIDER?: string;
    ASSISTANT_LLM_MODEL?: string;
    ASSISTANT_EMBEDDING_PROVIDER?: string;
    ASSISTANT_EMBEDDING_MODEL?: string;
    OLLAMA_BASE_URL?: string;
    ASSISTANT_LLM_TIMEOUT_MS?: string;
    ASSISTANT_RATE_LIMIT_PER_HOUR?: string;
    ASSISTANT_CLIENT_SALT?: string;
    ASSISTANT_LOG_QUESTIONS?: string;
    ASSISTANT_SEMANTIC_THRESHOLD?: string;
    /** Optional Cloudflare Workers AI binding. */
    AI?: AssistantConfig["AI"];
  };
};

/** The state whose markets the platform reports on (REFERENCE_STATE), Karnataka unless configured. */
export function referenceState(env: { REFERENCE_STATE?: string }): string {
  return env.REFERENCE_STATE ?? "Karnataka";
}
