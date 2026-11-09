import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Where the site is served. Link previews and the sitemap need absolute addresses. */
const DEFAULT_SITE_URL = "https://arecanut-intel.pages.dev";

/** Public pages listed in the sitemap. Workspace and data-quality pages are private to each visitor or reviewer. */
const SITEMAP_PATHS = [
  "/", "/prices", "/analytics", "/compare", "/sell-or-hold", "/assistant",
  "/intelligence/production", "/intelligence/trade", "/intelligence/weather", "/intelligence/news", "/intelligence/policy", "/intelligence/quality",
  "/overview", "/monthly-trends", "/supply", "/forecasts", "/forecasts/evaluation", "/decision-tools",
];

/** Writes robots.txt and sitemap.xml, and puts the site address into index.html's link-preview tags. */
function seo(siteUrl: string): Plugin {
  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${SITEMAP_PATHS.map((path) => `  <url><loc>${siteUrl}${path}</loc></url>`).join("\n")}\n</urlset>\n`;
  const files: Record<string, { body: string; type: string }> = {
    "/robots.txt": { body: robots, type: "text/plain" },
    "/sitemap.xml": { body: sitemap, type: "application/xml" },
  };
  return {
    name: "areca-pulse-seo",
    transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", siteUrl),
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = files[request.url?.split("?")[0] ?? ""];
        if (!file) return next();
        response.setHeader("Content-Type", `${file.type}; charset=utf-8`);
        response.end(file.body);
      });
    },
    generateBundle() {
      for (const [path, file] of Object.entries(files)) this.emitFile({ type: "asset", fileName: path.slice(1), source: file.body });
    },
  };
}

/**
 * Cloudflare Web Analytics: privacy-first page views, no cookies and no personal data. The beacon is added only when a
 * site token is configured, so local builds and tests send nothing. _headers allows its script and its report address.
 */
function analytics(token: string | undefined): Plugin {
  if (token && !/^[a-f0-9]{32}$/.test(token)) throw new Error("VITE_CF_ANALYTICS_TOKEN must be the 32-character site token from Cloudflare Web Analytics.");
  return {
    name: "areca-pulse-analytics",
    apply: "build",
    transformIndexHtml: (html) => token
      ? html.replace("</body>", `  <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${token}"}'></script>\n  </body>`)
      : html,
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../", "VITE_");
  const siteUrl = (env.VITE_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
  return {
    plugins: [react(), seo(siteUrl), analytics(env.VITE_CF_ANALYTICS_TOKEN || undefined)],
    envDir: "../",
  };
});
