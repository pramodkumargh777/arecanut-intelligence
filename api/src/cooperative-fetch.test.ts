import { describe, expect, it, vi } from "vitest";
import { configuredAttempts, fetchWithRetry, SourceFetchError } from "./cooperative-fetch";

const sleep = vi.fn(async () => {});
const ok = () => new Response("ok", { status: 200 });

describe("cooperative source retry policy", () => {
  it("retries transient statuses and network errors with backoff, then succeeds", async () => {
    sleep.mockClear();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("connection reset")).mockResolvedValueOnce(ok());
    const result = await fetchWithRetry("https://example.test", {}, { attempts: 3, fetcher, sleep, baseDelayMs: 10 });
    expect(result.attempts).toBe(3);
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });
  it("honours Retry-After within the configured cap", async () => {
    sleep.mockClear();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "120" } })).mockResolvedValueOnce(ok());
    await fetchWithRetry("https://example.test", {}, { fetcher, sleep, maxDelayMs: 5_000 });
    expect(sleep).toHaveBeenCalledWith(5_000);
  });
  it.each([401, 403, 404])("does not retry access refusal HTTP %i and reports the exact status", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));
    const error = await fetchWithRetry("https://example.test", {}, { attempts: 5, fetcher, sleep }).catch((caught) => caught);
    expect(error).toBeInstanceOf(SourceFetchError);
    expect(error).toMatchObject({ attempts: 1, httpStatus: status, message: `Source returned HTTP ${status}.` });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not follow redirects (e.g. to login or challenge pages)", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "/login" } }));
    await expect(fetchWithRetry("https://example.test", {}, { fetcher, sleep })).rejects.toThrow("redirects are not followed");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });
  it("gives up after the configured attempts with the last reason", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 502 }));
    await expect(fetchWithRetry("https://example.test", {}, { attempts: 2, fetcher, sleep })).rejects.toThrow("HTTP 502. Gave up after 2 attempts.");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("bounds configured attempts to 1-5", () => {
    expect([undefined, "0", "6", "2.5", "x", "1", "5"].map((value) => configuredAttempts(value))).toEqual([3, 3, 3, 3, 3, 1, 5]);
  });
});
