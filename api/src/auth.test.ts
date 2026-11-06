import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bearerMatches } from "./auth";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("bearer token check", () => {
  it("accepts only the exact header", () => {
    expect(bearerMatches("Bearer secret-token", "secret-token")).toBe(true);
    for (const header of ["Bearer secret-toke", "Bearer secret-token2", "Bearer secret-tokeN", "bearer secret-token", "secret-token", "", null, undefined]) {
      expect(bearerMatches(header, "secret-token"), String(header)).toBe(false);
    }
  });

  it("stays closed when no token is configured, even for an empty bearer header", () => {
    for (const token of ["", null, undefined]) {
      expect(bearerMatches("Bearer ", token)).toBe(false);
      expect(bearerMatches("Bearer undefined", token)).toBe(false);
    }
  });

  it("handles non-ASCII input without matching", () => {
    expect(bearerMatches("Bearer ಸೀಕ್ರೆಟ್", "secret")).toBe(false);
    expect(bearerMatches("Bearer ಸೀಕ್ರೆಟ್", "ಸೀಕ್ರೆಟ್")).toBe(true);
  });

  it("is the only way routes compare tokens", () => {
    for (const file of ["./index.ts", "./forecasting.ts", "./cooperative-routes.ts", "./operations-routes.ts", "./supply-routes.ts", "./commodity-routes.ts", "./decisions.ts", "./forecast.ts", "./intelligence-routes.ts", "./source-status.ts", "./assistant/routes.ts"]) {
      expect(source(file), file).not.toMatch(/[!=]== `Bearer/);
    }
  });
});

describe("browser security", () => {
  const headers = source("../../frontend/public/_headers");

  it("sends a restrictive policy with the site", () => {
    expect(headers).toMatch(/^\/\*$/m);
    expect(headers).toMatch(/script-src 'self';/);
    expect(headers).toMatch(/frame-ancestors 'none'/);
    expect(headers).toMatch(/object-src 'none'/);
    expect(headers).toMatch(/connect-src 'self' https:\/\/ani-market-api\.arecanut\.workers\.dev/);
    expect(headers).toMatch(/Strict-Transport-Security: max-age=31536000/);
    expect(headers).toMatch(/X-Frame-Options: DENY/);
    expect(headers).not.toMatch(/script-src[^;]*unsafe/);
  });

  it("does not keep the admin token in browser storage", () => {
    expect(source("../../frontend/src/pages/DataQualityPage.tsx")).not.toMatch(/sessionStorage\.setItem|localStorage/);
  });
});
