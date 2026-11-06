import { z } from "zod";

export const DASD_SOURCES = {
  production_history: {
    url: "https://dasd.kerala.gov.in/storage/2025/03/Arecanut-2024-25-PDF.pdf",
    domain: "production",
    periods: ["2021-22", "2022-23", "2023-24", "2024-25"],
  },
  production_latest: {
    url: "https://dasd.kerala.gov.in/storage/2026/07/Arecanut-2025-26-Second-Advance.pdf",
    domain: "production",
    periods: ["2024-25", "2025-26"],
  },
  trade_imports: {
    url: "https://dasd.kerala.gov.in/wp-content/uploads/2025/03/Import-of-arecanut.pdf",
    domain: "trade",
    periods: ["2021-22", "2022-23", "2023-24", "2024-25"],
  },
} as const;
export const pdfItemSchema = z.object({ str: z.string().max(500), x: z.number().finite(), y: z.number().finite() }).strict();
export type PdfItem = z.infer<typeof pdfItemSchema>;
export type ProductionRecord = { geography: string; period: string; estimate_status: string; area: number | null; production: number | null; yield: number | null };
export type TradeRecord = { partner: string; period: string; quantity: number | null; value: number | null };
const states = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Goa", "Karnataka", "Kerala", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Tamil Nadu", "Tripura", "West Bengal", "Andaman & Nicobar Islands", "Pondicherry", "All India"];

function numeric(value: string) {
  if (!/^\d+(?:,\d{3})*(?:\.\d+)?$/.test(value)) throw new Error(`Unexpected PDF number: ${value}`);
  const parsed = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) throw new Error("Source number exceeds supported numerical magnitude.");
  return parsed;
}
function valuesAt(items: PdfItem[], y: number, centers: number[], tolerance = 2): (number | null)[] {
  const values: (number | null)[] = centers.map(() => null);
  for (const item of items.filter((item) => Math.abs(item.y - y) < tolerance && /^\d/.test(item.str))) {
    const column = centers.reduce((best, x, i) => Math.abs(item.x - x) < Math.abs(item.x - centers[best]) ? i : best, 0);
    if (Math.abs(item.x - centers[column]) > 25 || values[column] !== null) throw new Error("PDF numeric columns shifted or duplicated; review the new layout.");
    values[column] = numeric(item.str);
  }
  return values;
}
export function parseDasd(source: keyof typeof DASD_SOURCES, items: PdfItem[]) {
  const text = items.map((item) => item.str).join(" ").replace(/\s+/g, " ");
  const config = DASD_SOURCES[source];
  if (!/arecanut/i.test(text) || !config.periods.every((period) => text.includes(period))) throw new Error("DASD commodity or reporting years changed.");
  if (config.domain === "production") {
    if (!/000\s*ha/i.test(text) || !/000\s*tonnes/i.test(text) || !/kg\/ha/i.test(text)) throw new Error("DASD production units changed.");
    const latest = source === "production_latest";
    if (latest && (!/SECOND ADVANCE/i.test(text) || !/2024-25 FINAL/.test(text))) throw new Error("DASD estimate status changed.");
    const anchor = items.find((item) => item.str === "Andhra Pradesh");
    if (!anchor) throw new Error("Production table anchor is missing.");
    const centers = items.filter((item) => Math.abs(item.y - anchor.y) < 2 && /^\d/.test(item.str)).sort((a, b) => a.x - b.x).map((item) => item.x);
    if (centers.length !== config.periods.length * 3) throw new Error("Production column count changed.");
    const rows: ProductionRecord[] = [];
    for (const geography of states) {
      const wrapped = geography === "Andaman & Nicobar Islands"
        && items.find((item) => item.str === "Andaman & Nicobar");
      const label = items.find((item) => item.str === geography)
        ?? (wrapped ? items.find((item) => item.str === "Islands" && Math.abs(item.y - wrapped.y) < 15) : undefined);
      if (!label) throw new Error(`Missing production geography: ${geography}`);
      const values = valuesAt(items, label.y, centers);
      config.periods.forEach((period, index) => {
        rows.push({ geography, period, estimate_status: latest ? index === 0 ? "Final" : "Second advance" : "Status unspecified in source table",
          area: values[index * 3], production: values[index * 3 + 1], yield: values[index * 3 + 2] });
      });
    }
    if (rows.some((row) => row.geography === "All India" && (row.area === null || row.production === null))) throw new Error("National production totals missing.");
    return { domain: "production" as const, rows, publication_period: latest ? "2026-05" : null };
  }
  if (!/Quantity \(tonnes\)/.test(text) || !/Rs\.\s*Lakhs/.test(text) || !/Source: Dept of Commerce/.test(text)) throw new Error("Trade units or attribution changed.");
  const anchor = items.find((item) => item.str === "Indonesia");
  if (!anchor) throw new Error("Trade table anchor missing.");
  const centers = items.filter((item) => Math.abs(item.y - anchor.y) < 2 && /^\d/.test(item.str)).sort((a, b) => a.x - b.x).map((item) => item.x);
  if (centers.length !== 8) throw new Error("Trade column count changed.");
  const rows: TradeRecord[] = [];
  for (const partner of ["Bangladesh", "Indonesia", "Sri Lanka", "Myanmar", "Bhutan", "UAE", "Total"]) {
    const label = items.find((item) => item.str === partner);
    if (!label) throw new Error(`Missing trade partner: ${partner}`);
    const y = partner === "Total" ? items.find((item) => Math.abs(item.y - label.y) < 12 && /^\d/.test(item.str))?.y : label.y;
    if (y === undefined) throw new Error("Missing national import total.");
    const values = valuesAt(items, y, centers);
    config.periods.forEach((period, index) => rows.push({ partner: partner === "Total" ? "All partners (including others)" : partner,
      period, quantity: values[index * 2], value: values[index * 2 + 1] }));
  }
  for (const period of config.periods) {
    const total = rows.find((row) => row.period === period && row.partner.startsWith("All partners"));
    if (!total || total.quantity === null || total.value === null) throw new Error("Incomplete national trade totals.");
    const others = rows.filter((row) => row.period === period && row !== total);
    if (others.reduce((sum, row) => sum + (row.quantity ?? 0), 0) > total.quantity + others.length) throw new Error("Partner quantities exceed national total.");
  }
  return { domain: "trade" as const, rows, publication_period: null };
}

export const SIRSI_WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=14.6195&longitude=74.8354&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean&timezone=Asia%2FKolkata&forecast_days=7&past_days=7";
const measurement = z.number().finite().nullable();
export const weatherSchema = z.object({
  latitude: z.number().finite(), longitude: z.number().finite(), elevation: z.number().finite(),
  timezone: z.literal("Asia/Kolkata"),
  daily_units: z.object({ time: z.literal("iso8601"), temperature_2m_max: z.literal("°C"), temperature_2m_min: z.literal("°C"), precipitation_sum: z.literal("mm"), relative_humidity_2m_mean: z.literal("%").optional() }),
  daily: z.object({ time: z.array(z.string()), temperature_2m_max: z.array(measurement), temperature_2m_min: z.array(measurement), precipitation_sum: z.array(measurement), relative_humidity_2m_mean: z.array(measurement).optional() }),
});
export function validDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function parseWeather(body: unknown, fetchedAt: string) {
  const value = weatherSchema.parse(body), daily = value.daily;
  const today = new Date(Date.parse(fetchedAt) + 330 * 60_000).toISOString().slice(0, 10);
  const firstDay = new Date(Date.parse(today) - 7 * 86_400_000).toISOString().slice(0, 10);
  if (Math.abs(value.latitude - 14.6195) > 0.15 || Math.abs(value.longitude - 74.8354) > 0.15) throw new Error("Weather grid no longer represents Sirsi.");
  if (daily.time.length !== 14 || new Set(daily.time).size !== 14 || daily.time[0] !== firstDay || !daily.time.includes(today)
    || [daily.temperature_2m_max, daily.temperature_2m_min, daily.precipitation_sum, ...(daily.relative_humidity_2m_mean ? [daily.relative_humidity_2m_mean] : [])].some((values) => values.length !== daily.time.length)
    || (daily.relative_humidity_2m_mean !== undefined) !== (value.daily_units.relative_humidity_2m_mean !== undefined)) throw new Error("Incomplete or stale Sirsi weather response.");
  return { latitude: value.latitude, longitude: value.longitude, elevation: value.elevation, rows: daily.time.map((date, index) => {
    if (!validDay(date) || (index > 0 && Date.parse(date) - Date.parse(daily.time[index - 1]) !== 86_400_000)) throw new Error("Nonconsecutive weather dates.");
    const maximum = daily.temperature_2m_max[index], minimum = daily.temperature_2m_min[index], rain = daily.precipitation_sum[index];
    const humidity = daily.relative_humidity_2m_mean?.[index] ?? null;
    if ((maximum !== null && minimum !== null && minimum > maximum) || (rain !== null && rain < 0) || (humidity !== null && (humidity < 0 || humidity > 100))) throw new Error("Invalid weather measurements.");
    return { date, maximum, minimum, rain, humidity, kind: date < today ? "recent_model" : "forecast_model" };
  }) };
}

export function htmlText(value: string) {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt|ndash|mdash|rsquo|lsquo|rdquo|ldquo);/g, (entity) => ({
      "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&ndash;": "-", "&mdash;": "-", "&rsquo;": "'", "&lsquo;": "'", "&rdquo;": '"', "&ldquo;": '"',
    }[entity] ?? entity)).replace(/\s+/g, " ").trim();
}
export const PIB_RELEASES = ["2159561", "2156521"] as const;
export const DASD_NEWS_URL = "https://dasd.kerala.gov.in/second-advance-estimates-for-2025-26/";
export function parseDasdNews(html: string) {
  const title = htmlText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const publishedText = htmlText(html.match(/itemprop="datePublished"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const match = publishedText.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  const month = match ? ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].indexOf(match[1]) + 1 : 0;
  if (!title.includes("Second Advance Estimates for 2025-26") || !match || !month
    || !html.includes("Spices-Areca-Betel-2025-26-Second-Advance-consolidated.pdf")) throw new Error("DASD announcement title, publication date or linked report changed.");
  const published = `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  if (!validDay(published) || published > new Date().toISOString().slice(0, 10)) throw new Error("Invalid DASD announcement publication date.");
  return { title, published };
}
export function parsePibExport(html: string) {
  const text = htmlText(html);
  const match = text.match(/In\s+(\d{4}-\d{2}),\s*India exported\s+([\d,]+)\s+tonnes of areca nuts worth\s+(?:₹|&#8377;|Rs\.?)\s*([\d,.]+)\s+crore/i);
  if (!match) return null;
  const quantity = numeric(match[2]), value_lakh = numeric(match[3]) * 100;
  if (!Number.isFinite(value_lakh)) throw new Error("Export value exceeds supported numerical magnitude.");
  return { period: match[1], quantity, value_lakh };
}
export function parsePib(html: string, id: string) {
  const text = htmlText(html);
  const headings = [...html.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi)].map((match) => htmlText(match[1])).filter(Boolean);
  const title = headings.find((value) => /areca/i.test(value));
  const date = text.match(/(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})\s+\d{1,2}:\d{2}\s*(?:AM|PM)/i);
  if (!title || !date || !text.includes(id)) throw new Error(`PIB ${id} title, release identity or publication date missing.`);
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(date[2].toUpperCase()) + 1;
  const published = `${date[3]}-${String(month).padStart(2, "0")}-${date[1].padStart(2, "0")}`;
  if (!validDay(published) || published > new Date().toISOString().slice(0, 10)) throw new Error("Invalid PIB publication date.");
  return { title, published, is_policy: /tariff|import|policy|notification/i.test(title) };
}
