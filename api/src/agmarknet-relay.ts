/**
 * Forwards the AGMARKNET daily connector's requests to data.gov.in from Cloudflare's Mumbai location. data.gov.in times
 * out from GitHub's runners and was unreachable from a Worker running in Marseille, but answers from Mumbai. Deployed
 * separately through wrangler.relay.toml, so the main API does not have to move.
 *
 * It only serves GET requests for one dataset and needs the ingestion token, so it cannot be used as an open proxy.
 * The data.gov.in key travels in the query string, so this Worker logs nothing and keeps observability off.
 */
export const RELAY_RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070";
export const RELAY_TOKEN_HEADER = "X-ANI-Relay-Token";
const UPSTREAM = "https://api.data.gov.in/resource/";
const UPSTREAM_TIMEOUT_MS = 50_000;

export type RelayEnv = { INGESTION_TOKEN?: string };

const failure = (status: number, error: string) => new Response(JSON.stringify({ error }), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

/** Compares digests, so the time taken says nothing about how much of a guessed token was right. */
async function sameToken(a: string, b: string): Promise<boolean> {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  return left.reduce((difference, byte, index) => difference | (byte ^ right[index]), 0) === 0;
}

export async function handleRelay(request: Request, env: RelayEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "GET") return failure(405, "Only GET is supported.");
  const url = new URL(request.url);
  if (url.pathname !== `/resource/${RELAY_RESOURCE_ID}`) return failure(404, "Unknown resource.");
  if (!env.INGESTION_TOKEN) return failure(503, "The relay token is not configured.");
  if (!await sameToken(request.headers.get(RELAY_TOKEN_HEADER) ?? "", env.INGESTION_TOKEN)) return failure(401, "A valid relay token is required.");
  try {
    const upstream = await fetcher(`${UPSTREAM}${RELAY_RESOURCE_ID}${url.search}`, {
      headers: { Accept: "application/json", "User-Agent": "ANI-agmarknet-relay/1.0" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    // The original error can include the upstream URL, and with it the API key.
    return failure(502, "data.gov.in did not respond through the relay.");
  }
}

export default { fetch: (request: Request, env: RelayEnv) => handleRelay(request, env) };
