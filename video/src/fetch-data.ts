/**
 * Fetches today's figures from the public API in Node (no browser, so no cross-origin limits) and saves them to
 * public/promo-data.json, which the video reads. Run before every render: `npm run render` and `npm run gif` do.
 */
import { writeFileSync } from "node:fs";
import { loadPromoData } from "./data.ts";

const data = await loadPromoData();
writeFileSync(new URL("../public/promo-data.json", import.meta.url), `${JSON.stringify(data, null, 2)}\n`);
console.log(`Promo data saved: ${data.rates.map((rate) => `${rate.source} ${rate.variety} ${rate.low}-${rate.high} (${rate.date})`).join("; ")}`);
