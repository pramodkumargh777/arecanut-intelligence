import { describe, expect, it, vi } from "vitest";
import { handleRelay, KRAMA_ORIGIN, RELAY_HISTORY_RESOURCE_ID, RELAY_RESOURCE_ID, RELAY_TOKEN_HEADER } from "./agmarknet-relay";

const env = { INGESTION_TOKEN: "relay-test-token" };
const path = `https://relay.test/resource/${RELAY_RESOURCE_ID}`;
const request = (url = `${path}?api-key=secret-key&limit=1`, init: RequestInit = {}, token: string | null = env.INGESTION_TOKEN) =>
  new Request(url, { ...init, headers: token === null ? {} : { [RELAY_TOKEN_HEADER]: token } });
const upstream = () => vi.fn(async () => new Response('{"total":10}', { status: 200, headers: { "Content-Type": "application/json" } }));

describe("AGMARKNET relay", () => {
  it("forwards the query to the one dataset and returns the answer", async () => {
    const fetcher = upstream();
    const response = await handleRelay(request(), env, fetcher as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ total: 10 });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toBe(`https://api.data.gov.in/resource/${RELAY_RESOURCE_ID}?api-key=secret-key&limit=1`);
  });

  it("also forwards the daily-history dataset", async () => {
    const fetcher = upstream();
    const response = await handleRelay(request(`https://relay.test/resource/${RELAY_HISTORY_RESOURCE_ID}?limit=1`), env, fetcher as never);
    expect(response.status).toBe(200);
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toBe(`https://api.data.gov.in/resource/${RELAY_HISTORY_RESOURCE_ID}?limit=1`);
  });

  it("does not send the relay token to data.gov.in", async () => {
    const fetcher = upstream();
    await handleRelay(request(), env, fetcher as never);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.stringify(init.headers)).not.toContain(env.INGESTION_TOKEN);
  });

  it.each([
    ["no token", request(undefined, {}, null), 401],
    ["a wrong token", request(undefined, {}, "wrong"), 401],
    ["another dataset", request("https://relay.test/resource/other?api-key=x"), 404],
    ["another well-formed dataset id", request("https://relay.test/resource/00000000-0000-0000-0000-000000000000?api-key=x"), 404],
    ["a dataset id with a trailing path", request(`https://relay.test/resource/${RELAY_RESOURCE_ID}/extra`), 404],
    ["another site's path", request("https://relay.test/https://example.org/"), 404],
    ["a POST", request(undefined, { method: "POST" }), 405],
  ])("refuses %s without calling data.gov.in", async (_name, incoming, status) => {
    const fetcher = upstream();
    expect((await handleRelay(incoming, env, fetcher as never)).status).toBe(status);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stays closed when no token is configured", async () => {
    const fetcher = upstream();
    expect((await handleRelay(request(undefined, {}, ""), {}, fetcher as never)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("passes on an upstream error status, so the connector's own retries apply", async () => {
    const fetcher = vi.fn(async () => new Response("busy", { status: 503 }));
    expect((await handleRelay(request(), env, fetcher as never)).status).toBe(503);
  });

  it("does not reveal the API key when the upstream request fails", async () => {
    const fetcher = vi.fn(async () => { throw new Error("connect failed: https://api.data.gov.in/?api-key=secret-key"); });
    const response = await handleRelay(request(), env, fetcher as never);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("secret-key");
  });
});

describe("KRAMA relay", () => {
  const kramaRequest = (path: string, init: RequestInit = {}, token: string | null = env.INGESTION_TOKEN) =>
    new Request(`https://relay.test/krama${path}`, { ...init, headers: { ...(token === null ? {} : { [RELAY_TOKEN_HEADER]: token }), ...(init.headers ?? {}) } });

  it("forwards the form post with its cookie, and rewrites KRAMA's redirect and cookie to the relay", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: [["Location", "/reports/Commadity"],
      ["Set-Cookie", "ASP.NET_SessionId=abc; domain=krama.karnataka.gov.in; path=/; HttpOnly"]] }));
    const response = await handleRelay(kramaRequest("/Reports/Main_rep", { method: "POST", body: "a=1&b=2",
      headers: { Cookie: "ASP.NET_SessionId=abc", Referer: "https://relay.test/krama/Reports/Main_rep" } }), env, fetcher as never);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://relay.test/krama/reports/Commadity");
    expect(response.headers.get("Set-Cookie")).toBe("ASP.NET_SessionId=abc; path=/; HttpOnly");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit & { headers: Headers }];
    expect(url).toBe(`${KRAMA_ORIGIN}/Reports/Main_rep`);
    expect(init).toMatchObject({ method: "POST", body: "a=1&b=2", redirect: "manual" });
    expect(init.headers.get("Cookie")).toBe("ASP.NET_SessionId=abc");
    expect(init.headers.get("Referer")).toBe(`${KRAMA_ORIGIN}/Reports/Main_rep`);
    expect([...init.headers.values()].join(" ")).not.toContain(env.INGESTION_TOKEN);
  });

  it("follows KRAMA's own spellings of its pages", async () => {
    for (const path of ["/reports/Commadity.aspx", "/Reports/Main_rep.aspx", "/reports/Main_Rep", "/reports/CommadityRep"]) {
      const fetcher = upstream();
      expect((await handleRelay(kramaRequest(path), env, fetcher as never)).status).toBe(200);
      expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(`${KRAMA_ORIGIN}${path}`);
    }
  });

  it("returns a report page as it is", async () => {
    const fetcher = vi.fn(async () => new Response("<table/>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }));
    const response = await handleRelay(kramaRequest("/reports/CommadityRep"), env, fetcher as never);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<table/>");
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  });

  it.each([
    ["no token", kramaRequest("/Reports/Main_rep", {}, null), 401],
    ["another KRAMA page", kramaRequest("/Login.aspx"), 404],
    ["a path outside KRAMA's reports", kramaRequest("/../resource/x"), 404],
    ["a PUT", kramaRequest("/Reports/Main_rep", { method: "PUT", body: "x" }), 405],
  ])("refuses %s without calling KRAMA", async (_name, incoming, status) => {
    const fetcher = upstream();
    expect((await handleRelay(incoming, env, fetcher as never)).status).toBe(status);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a redirect away from KRAMA, and reports a failed upstream as 502", async () => {
    const away = vi.fn(async () => new Response(null, { status: 302, headers: { Location: "https://example.org/" } }));
    expect((await handleRelay(kramaRequest("/Reports/Main_rep"), env, away as never)).status).toBe(502);
    const down = vi.fn(async () => { throw new Error("timeout"); });
    expect((await handleRelay(kramaRequest("/Reports/Main_rep"), env, down as never)).status).toBe(502);
  });
});
