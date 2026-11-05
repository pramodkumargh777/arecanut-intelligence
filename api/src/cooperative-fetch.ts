export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fetcher?: typeof fetch;
};

export type RetryResult = { response: Response; attempts: number };

export class SourceFetchError extends Error {
  constructor(message: string, readonly attempts: number, readonly httpStatus: number | null) {
    super(message);
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function configuredAttempts(value: string | undefined, fallback = 3): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : fallback;
}

function retryAfterMs(response: Response, cap: number): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, cap);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 0), cap) : null;
}

/** Retries network failures, timeouts and transient HTTP statuses. Never retries 4xx access refusals other than 408/425/429. */
export async function fetchWithRetry(url: string, init: RequestInit, options: RetryOptions = {}): Promise<RetryResult> {
  const attempts = Math.min(Math.max(options.attempts ?? 3, 1), 5);
  const base = options.baseDelayMs ?? 1_000, cap = options.maxDelayMs ?? 8_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const fetcher = options.fetcher ?? fetch;
  let lastError = "Source request failed.";
  let lastStatus: number | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let delay = Math.min(base * 2 ** (attempt - 1), cap);
    try {
      const response = await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(options.timeoutMs ?? 60_000) });
      if (response.ok) return { response, attempts: attempt };
      lastStatus = response.status;
      lastError = response.status >= 300 && response.status < 400
        ? `Source redirected (HTTP ${response.status}); redirects are not followed.`
        : `Source returned HTTP ${response.status}.`;
      if (!RETRYABLE_STATUS.has(response.status)) throw new SourceFetchError(lastError, attempt, lastStatus);
      delay = retryAfterMs(response, cap) ?? delay;
    } catch (error) {
      if (error instanceof SourceFetchError) throw error;
      lastStatus = null;
      lastError = error instanceof Error && error.name === "TimeoutError"
        ? "Source request timed out."
        : `Network error: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (attempt < attempts) await sleep(delay);
  }
  throw new SourceFetchError(`${lastError} Gave up after ${attempts} attempt${attempts === 1 ? "" : "s"}.`, attempts, lastStatus);
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
