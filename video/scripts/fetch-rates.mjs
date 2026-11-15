// Step 1 of the daily pipeline. Fetches today's rates in Node (no browser CORS rules apply here), then writes, per
// language in LANGS (default "kn en"):
//   out/today-props-<lang>.json – Remotion input props
//   out/narration.json          – voice-over script per language and scene, built only from these rates
// Exits non-zero if the API can't be reached, so old rates are never posted by accident.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fetchRates } from "../src/data/rates.ts";
import { buildNarration, newestDate } from "../src/data/narration.ts";

const at = (p) => new URL(`../${p}`, import.meta.url);
const langs = (process.env.LANGS ?? "kn en").split(/\s+/).filter((l) => l === "kn" || l === "en");
// PROPS_NAME=story (scripts/story.sh) writes out/story-props-<lang>.json only, and leaves the daily video's files alone.
const name = process.env.PROPS_NAME ?? "today";
try {
  const data = await fetchRates(AbortSignal.timeout(30_000));
  const newest = newestDate(data);
  if (!newest) throw new Error("The API returned no rates.");
  mkdirSync(at("out/"), { recursive: true });
  const music = existsSync(at("public/music/bed.mp3")) ? { music: "music/bed.mp3" } : {};
  const narration = { newest, langs: {} };
  for (const lang of langs) {
    writeFileSync(at(`out/${name}-props-${lang}.json`), JSON.stringify({ data, source: "live", lang, ...(name === "today" ? music : {}) }));
    narration.langs[lang] = buildNarration(data, lang);
  }
  if (name === "today") writeFileSync(at("out/narration.json"), JSON.stringify(narration, null, 1));
  // `npm run snapshot:update`: make Studio and render:snapshot show today's rates.
  if (process.env.UPDATE_SNAPSHOT) writeFileSync(at("src/data/snapshot.json"), JSON.stringify({ ...data, live: false }, null, 1));
  console.log(`✓ Rates fetched · newest report ${newest} · languages: ${langs.join(", ")}`);
} catch (err) {
  console.error(`✗ Could not fetch today's rates: ${err instanceof Error ? err.message : err}`);
  console.error("  Nothing was rendered. Check the connection, or use `npm --workspace video run render:snapshot`.");
  process.exit(1);
}
