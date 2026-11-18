/**
 * Forwards the AGMARKNET connectors' requests to data.gov.in, and the KRAMA connector's to krama.karnataka.gov.in, from
 * Cloudflare's Mumbai location. data.gov.in times out from GitHub's runners and was unreachable from a Worker running in
 * Marseille, but answers from Mumbai; KRAMA does not answer GitHub's runners at all. Deployed separately through
 * wrangler.relay.toml (entry: relay-worker.ts), so the main API does not have to move.
 *
 * It serves only the two data.gov.in datasets below (GET) and KRAMA's four report pages (GET and form POST), and needs
 * the ingestion token, so it cannot be used as an open proxy. The data.gov.in key travels in the query string, so this
 * Worker logs nothing and keeps observability off.
 */
export const RELAY_RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070";
/** Variety-wise daily history, read by data-platform/connectors/agmarknet/history.py. */
export const RELAY_HISTORY_RESOURCE_ID = "35985678-0d79-46b4-9ed6-6f13308a1d24";
const RELAY_RESOURCES = new Set([RELAY_RESOURCE_ID, RELAY_HISTORY_RESOURCE_ID]);
export const RELAY_TOKEN_HEADER = "X-ANI-Relay-Token";
const UPSTREAM = "https://api.data.gov.in/resource/";
const UPSTREAM_TIMEOUT_MS = 50_000;
/** KRAMA's report pages, as the connector walks them (data-platform/connectors/krama/arrivals.py), under /krama/. */
export const KRAMA_ORIGIN = "https://krama.karnataka.gov.in";
const KRAMA_PREFIX = "/krama";
// Matched without case or ".aspx": KRAMA redirects to "/reports/Commadity.aspx", which then answers as "/reports/Commadity".
const KRAMA_PAGES = new Set(["/reports/main_rep", "/reports/commadity", "/reports/commadityrep"]);
const isKramaPage = (path: string) => KRAMA_PAGES.has(path.toLowerCase().replace(/\.aspx$/, ""));
const MAX_FORM_BYTES = 1_000_000;

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

/**
 * KRAMA is an ASP.NET form: it keeps a session cookie and answers each step with a redirect. Cookies pass through
 * without a Domain (so they belong to the relay's host), and redirects to KRAMA's own pages are rewritten to the relay,
 * so the connector's cookie jar and redirect handling work unchanged.
 */
async function relayKrama(request: Request, path: string, search: string, origin: string, fetcher: typeof fetch): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return failure(405, "Only GET and POST are supported.");
  const headers = new Headers({ Accept: "text/html", "User-Agent": request.headers.get("User-Agent") ?? "ANI-krama-relay/1.0" });
  const cookie = request.headers.get("Cookie");
  if (cookie) headers.set("Cookie", cookie);
  const referer = request.headers.get("Referer");
  if (referer?.startsWith(`${origin}${KRAMA_PREFIX}/`)) headers.set("Referer", `${KRAMA_ORIGIN}${referer.slice(origin.length + KRAMA_PREFIX.length)}`);
  let body: string | undefined;
  if (request.method === "POST") {
    body = await request.text();
    if (body.length > MAX_FORM_BYTES) return failure(413, "Form too large.");
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  }
  let upstream: Response;
  try {
    upstream = await fetcher(`${KRAMA_ORIGIN}${path}${search}`, { method: request.method, headers, body, redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch {
    return failure(502, "KRAMA did not respond through the relay.");
  }
  const out = new Headers({ "Content-Type": upstream.headers.get("Content-Type") ?? "text/html", "Cache-Control": "no-store" });
  const location = upstream.headers.get("Location");
  if (location) {
    const target = new URL(location, `${KRAMA_ORIGIN}${path}`);
    if (target.origin !== KRAMA_ORIGIN) return failure(502, "KRAMA redirected away from its own site.");
    out.set("Location", `${origin}${KRAMA_PREFIX}${target.pathname}${target.search}`);
  }
  const cookies = upstream.headers as Headers & { getSetCookie?: () => string[]; getAll?: (name: string) => string[] };
  const setCookies = cookies.getSetCookie?.() ?? cookies.getAll?.("Set-Cookie") ?? [upstream.headers.get("Set-Cookie")].filter((value): value is string => !!value);
  for (const value of setCookies) out.append("Set-Cookie", value.replace(/;\s*domain=[^;]*/gi, ""));
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export async function handleRelay(request: Request, env: RelayEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const krama = url.pathname.startsWith(`${KRAMA_PREFIX}/`) ? url.pathname.slice(KRAMA_PREFIX.length) : null;
  if (krama !== null && !isKramaPage(krama)) return failure(404, "Unknown KRAMA page.");
  if (krama === null) {
    if (request.method !== "GET") return failure(405, "Only GET is supported.");
    const resource = /^\/resource\/([0-9a-f-]{36})$/.exec(url.pathname)?.[1];
    if (!resource || !RELAY_RESOURCES.has(resource)) return failure(404, "Unknown resource.");
  }
  if (!env.INGESTION_TOKEN) return failure(503, "The relay token is not configured.");
  if (!await sameToken(request.headers.get(RELAY_TOKEN_HEADER) ?? "", env.INGESTION_TOKEN)) return failure(401, "A valid relay token is required.");
  if (krama !== null) return relayKrama(request, krama, url.search, url.origin, fetcher);
  try {
    const upstream = await fetcher(`${UPSTREAM}${url.pathname.slice("/resource/".length)}${url.search}`, {
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

