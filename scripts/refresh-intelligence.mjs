import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DASD_SOURCES, parseDasd } from "../api/src/intelligence-sources.ts";

const vars = readFileSync(new URL("../api/.dev.vars", import.meta.url), "utf8");
const token = vars.match(/^ADMIN_TOKEN=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!token) throw new Error("Local ADMIN_TOKEN missing.");
const base = "http://127.0.0.1:8787/api/v1/admin/intelligence";
let failed = false;
async function post(path, body) {
  const r = await fetch(base + path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  if (!r.headers.get("content-type")?.includes("application/json")) throw new Error(`API returned HTTP ${r.status} without JSON. Check the local Worker.`);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data;
}
for (const [source, config] of Object.entries(DASD_SOURCES)) {
  try {
    const response = await fetch(config.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 700_000 || Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") throw new Error("Expected a PDF under 700 KB.");
    const original = Buffer.from(bytes).toString("base64");
    const task = getDocument({ data: bytes, useSystemFonts: true });
    try {
      const document = await task.promise;
      if (document.numPages !== 1) throw new Error("Expected the verified single-page DASD table.");
      const text = await (await document.getPage(1)).getTextContent();
      const items = text.items.filter((item) => "str" in item && item.str.trim()).map((item) => ({ str: item.str.trim(), x: item.transform[4], y: item.transform[5] }));
      parseDasd(source, items);
      const result = await post("/dasd", { source, pdf_base64: original, items });
      console.log(source, JSON.stringify(result));
    } finally { await task.destroy(); }
  } catch (error) {
    failed = true; console.error(`${source}: ${error.message}`);
  }
}
for (const source of ["weather", "news"]) {
  try { console.log(source, JSON.stringify(await post(`/${source}/refresh`, {}))); }
  catch (error) { failed = true; console.error(`${source}: ${error.message}`); }
}
if (failed) process.exitCode = 1;
