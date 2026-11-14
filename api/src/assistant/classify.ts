/** Deterministic query classification: keyword intents (English + Kannada) and entity extraction. */
import { PLACES } from "./places";
import { normalizeDigits } from "./language";
import type { ToolName } from "./types";

type IntentRule = { tool: ToolName; patterns: RegExp[] };

// Order matters only for tie-breaking display; every matching rule contributes a tool.
const RULES: IntentRule[] = [
  { tool: "calculate_sell_hold", patterns: [/\b(hold|holding|store|storing|wait|keep)\b.*\b(sell|price|stock)\b/, /\bsell\b.*\b(now|later)\b/, /\bsell or hold\b/, /\bhold or sell\b/, /\bbreak[- ]?even\b/, /ಹಿಡಿದಿಟ್ಟ/, /ಕಾಯ(ಬೇಕ|ಲ)/, /ಈಗ ಮಾರ/] },
  { tool: "calculate_net_realization", patterns: [/\bnet (realization|realisation|income|return|proceeds)\b/, /\bhow much (will|would|can) i (get|earn|receive)\b/, /\bcommission\b/, /ನಿವ್ವಳ/, /ಎಷ್ಟು (ಹಣ|ಸಿಗ)/] },
  { tool: "get_price_forecast", patterns: [/\bforecast/, /\bpredict/, /\bnext month\b/, /\boutlook\b/, /\bwill (the )?price/, /\bexpected price\b/, /ಮುನ್ಸೂಚನೆ/, /ಮುಂದಿನ ತಿಂಗಳ/, /ಮುನ್ನೋಟ/] },
  { tool: "get_market_index", patterns: [/\bindex\b/, /\bbenchmark\b/, /\breference (price|index)\b/, /ಸೂಚ್ಯಂಕ/] },
  { tool: "compare_markets", patterns: [/\bcompar/, /\bversus\b/, /\bvs\.?\b/, /\bwhich (market|branch|mandi)\b/, /\b(highest|lowest|best|cheapest)\b.*\b(market|branch|price|rate)/, /ಹೋಲಿಕೆ/, /ಹೋಲಿಸ/, /ಯಾವ ಮಾರುಕಟ್ಟೆ/] },
  { tool: "get_historical_prices", patterns: [/\bhistor/, /\btrend/, /\bpast\b/, /\blast (year|\d+ months?|month|season)\b/, /\bover (the )?(years|months)\b/, /\bmonthly prices?\b/, /\b20[12]\d\b.*\bprice/, /\bhow (has|have|did)\b.*\b(move|moved|changed?|gone|went)\b/, /\b(this|past) year\b/, /\bover (the )?(year|season)\b/, /ಇತಿಹಾಸ/, /ಹಿಂದಿನ/, /ಪ್ರವೃತ್ತಿ/, /ಕಳೆದ ವರ್ಷ/, /ಈ ವರ್ಷ/, /ಏರಿಳಿತ/, /ಬದಲಾಗಿದೆ/, /ಬದಲಾವಣೆ/] },
  { tool: "get_current_prices", patterns: [/\b(price|prices|rate|rates|quote|quotation)\b/, /\btoday\b/, /\bcurrent\b/, /\blatest\b/, /ಬೆಲೆ/, /ದರ/, /ಇಂದಿನ/] },
  { tool: "get_market_arrivals", patterns: [/\barrival/, /\btraded quantit/, /\bmarket (supply|volume)\b/, /\bquantity (arrived|traded)\b/, /ಆವಕ/] },
  { tool: "get_production_statistics", patterns: [/\bproduc(e|ed|es|ing|tion)\b/, /\byield\b/, /\bhectare/, /\bcultivated area\b/, /\barea under\b/, /\boutput\b/, /\bharvest/, /ಉತ್ಪಾದನೆ/, /ಇಳುವರಿ/, /ವಿಸ್ತೀರ್ಣ/, /ಕೊಯ್ಲು/, /ಫಸಲು/] },
  { tool: "get_trade_statistics", patterns: [/\bimport/, /\bexport/, /\btrade\b/, /ಆಮದು/, /ರಫ್ತು/] },
  { tool: "get_weather", patterns: [/\bweather\b/, /\brain/, /\btemperature\b/, /\bhumidity\b/, /\bmonsoon\b/, /ಮಳೆ/, /ಹವಾಮಾನ/, /ತಾಪಮಾನ/, /ಆರ್ದ್ರತೆ/] },
  { tool: "get_advisories", patterns: [/\badvisor/, /\b(crop|disease) risk\b/, /\brisk of\b/, /\balert\b/, /\bwarning\b/, /ಸಲಹೆ/, /ಎಚ್ಚರಿಕೆ/, /ಅಪಾಯ/] },
  { tool: "search_industry_news", patterns: [/\bnews\b/, /\bpolicy\b/, /\bpolicies\b/, /\bgovernment\b/, /\bnotification\b/, /\btariff\b/, /\bpress release\b/, /\bminist/, /ಸುದ್ದಿ/, /ಅಧಿಸೂಚನೆ/, /ಸರ್ಕಾರ/, /ಸುಂಕ/] },
  { tool: "search_agricultural_documents", patterns: [/\bdisease/, /\bpest/, /\bmahali\b/, /\bkoleroga\b/, /\bfruit rot\b/, /\byellow leaf\b/, /\bbud rot\b/, /\broot grub\b/, /\bmildew\b/, /\bcpcri\b/, /\bdasd\b/, /\bcultivation\b/, /\bmanage(ment)?\b/, /\bcontrol\b/, /\bfertili[sz]er/, /\bmanure\b/, /\bbordeaux\b/, /\bspray/, /\bpractice/, /\bresearch\b/, /\bnursery\b/, /\bseedling/, /\birrigation\b/, /\bcompost/, /\bintercrop/, /\bmixed crop/, /\bvariet(y|ies) (developed|released)\b/, /ರೋಗ/, /ಕೀಟ/, /ಕೊಳೆ/, /ಮಹಾಳಿ/, /ಹಳದಿ ಎಲೆ/, /ಬೇರು ಹುಳು/, /ಗೊಬ್ಬರ/, /ಸಿಂಪಡ/, /ನಿರ್ವಹಣೆ/, /ಬೇಸಾಯ/, /ಬೋರ್ಡೋ/, /ಕಾಂಪೋಸ್ಟ್/, /ಅಂತರ ?ಬೆಳೆ/, /ಮಿಶ್ರ ?ಬೆಳೆ/, /ನೀರಾವರಿ/, /ನರ್ಸರಿ/] },
];

/** Verified variety names used by ANI sources, with Kannada spellings. Matching is case-insensitive. */
const VARIETY_ALIASES: [canonical: string, patterns: RegExp[]][] = [
  // Checked before Rashi: new-crop Rashi is quoted and priced separately.
  ["New Rashi", [/\bnew ?rashi\b/i, /ಹೊಸ ?ರಾಶಿ/]],
  ["Rashi", [/\brashi\b/i, /\brasi\b/i, /ರಾಶಿ/]],
  ["Chali", [/\bchali\b/i, /ಚಾಲಿ/]],
  ["Bette", [/\bbette\b/i, /ಬೆಟ್ಟೆ/]],
  ["Bilegotu", [/\bbile ?gotu\b/i, /ಬಿಳೇ ?ಗೋಟು/, /ಬಿಳಿ ?ಗೋಟು/]],
  ["Kempugotu", [/\bkempu ?gotu\b/i, /ಕೆಂಪು ?ಗೋಟು/]],
  ["Saraku", [/\bsaraku\b/i, /\bsarakku\b/i, /ಸರಕು/]],
  ["Gorabalu", [/\bgorabalu\b/i, /ಗೊರಬಲು/]],
  ["Sippegotu", [/\bsippe ?gotu\b/i, /ಸಿಪ್ಪೆ ?ಗೋಟು/]],
  ["Hasa", [/\bhasa\b/i]],
  ["Handaedi", [/\bhanda ?edi\b/i]],
  ["Api", [/\bapi\b(?! key)/i, /ಅಪಿ/]],
  ["Edi", [/\bedi\b/i, /ಇಡಿ/]],
];

const DISTRICTS: [canonical: string, patterns: RegExp[]][] = [
  ["Shivamogga", [/\bshiv?a?mogg?a\b/i, /\bshimoga\b/i, /ಶಿವಮೊಗ್ಗ/]],
  ["Uttara Kannada", [/\buttara kannada\b/i, /\bnorth kanara\b/i, /\bsirsi\b/i, /ಉತ್ತರ ಕನ್ನಡ/, /ಶಿರಸಿ/]],
  ["Dakshina Kannada", [/\bdakshina kannada\b/i, /\bmangalo?re?\b/i, /\bputtur\b/i, /ದಕ್ಷಿಣ ಕನ್ನಡ/, /ಪುತ್ತೂರು/]],
  ["Chikkamagaluru", [/\bchikka?magalur(u)?\b/i, /ಚಿಕ್ಕಮಗಳೂರು/]],
  ["Davangere", [/\bdavang?ere\b/i, /\bchannagiri\b/i, /ದಾವಣಗೆರೆ/, /ಚನ್ನಗಿರಿ/]],
  ["Tumakuru", [/\btumakuru\b/i, /\btumkur\b/i, /ತುಮಕೂರು/]],
  ["Udupi", [/\budupi\b/i, /ಉಡುಪಿ/]],
  ["Hassan", [/\bhassan\b/i, /ಹಾಸನ/]],
  ["Kodagu", [/\bkodagu\b/i, /\bcoorg\b/i, /ಕೊಡಗು/]],
  ["Chitradurga", [/\bchitradurga\b/i, /ಚಿತ್ರದುರ್ಗ/]],
  ["Haveri", [/\bhaveri\b/i, /ಹಾವೇರಿ/]],
  ["Mandya", [/\bmandya\b/i, /ಮಂಡ್ಯ/]],
  ["Mysuru", [/\bmysuru\b/i, /\bmysore\b/i, /ಮೈಸೂರು/]],
];

const SOURCES: [canonical: "mamcos" | "tss" | "tumcos" | "agmarknet", patterns: RegExp[]][] = [
  ["mamcos", [/\bmamcos\b/i, /ಮ್ಯಾಮ್ಕೋಸ್/]],
  ["tss", [/\btss\b/i, /ಟಿಎಸ್ಎಸ್/]],
  ["tumcos", [/\btumcos\b/i, /ತುಮ್ಕೋಸ್/]],
  ["agmarknet", [/\bagmarknet\b/i, /\bapmc\b/i, /\bmandi\b/i, /ಎಪಿಎಂಸಿ/]],
];

export type CalculationHints = {
  quantity_quintals?: number;
  price?: number;
  commission_percent?: number;
  transport_cost?: number;
  hold_days?: number;
  storage_cost?: number;
  annual_finance_percent?: number;
  weight_loss_percent?: number;
  scenario_price?: number;
};

export type Classification = {
  tools: ToolName[];
  entities: {
    variety?: string;
    district?: string;
    /** A town named in the question (a PLACES name), for market-level history. */
    market?: string;
    source?: "mamcos" | "tss" | "tumcos" | "agmarknet";
    from_month?: string;
    to_month?: string;
    geography?: string;
  };
  calculation: CalculationHints;
};

export const MAX_TOOLS_PER_QUERY = 4;

function firstMatch<T extends string>(text: string, table: [T, RegExp[]][]): T | undefined {
  return table.find(([, patterns]) => patterns.some((pattern) => pattern.test(text)))?.[0];
}

function number(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

const AMOUNT = String.raw`(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)`;

/** Extract only values the user stated explicitly. Nothing is defaulted here. */
export function extractCalculationHints(raw: string): CalculationHints {
  const text = normalizeDigits(raw).toLowerCase();
  const hints: CalculationHints = {};
  const quantity = text.match(/([\d,]+(?:\.\d+)?)\s*(?:quintals?|qtls?|qtl\b|ಕ್ವಿಂಟಾಲ್)/);
  hints.quantity_quintals = number(quantity?.[1]);
  const commission = text.match(/([\d.]+)\s*%\s*commission|commission\s*(?:of|is|at|=)?\s*([\d.]+)\s*%|ಕಮಿಷನ್\s*([\d.]+)\s*%/);
  hints.commission_percent = number(commission?.[1] ?? commission?.[2] ?? commission?.[3]);
  const transport = text.match(new RegExp(`transport(?:ation)?(?: cost)?\\s*(?:of|is|=)?\\s*${AMOUNT}|${AMOUNT}\\s*(?:for )?transport`));
  hints.transport_cost = number(transport?.[1] ?? transport?.[2]);
  const storage = text.match(new RegExp(`storage(?: cost)?\\s*(?:of|is|=)?\\s*${AMOUNT}|${AMOUNT}\\s*(?:for )?storage`));
  hints.storage_cost = number(storage?.[1] ?? storage?.[2]);
  const finance = text.match(/([\d.]+)\s*%\s*(?:annual )?(?:interest|finance)|(?:interest|finance)\s*(?:rate)?\s*(?:of|is|at)?\s*([\d.]+)\s*%/);
  hints.annual_finance_percent = number(finance?.[1] ?? finance?.[2]);
  const loss = text.match(/([\d.]+)\s*%\s*(?:weight |moisture )?loss|(?:weight |moisture )?loss\s*(?:of|is)?\s*([\d.]+)\s*%/);
  hints.weight_loss_percent = number(loss?.[1] ?? loss?.[2]);
  const days = text.match(/(\d+)\s*(days?|weeks?|months?)|(\d+)\s*(ದಿನ|ತಿಂಗಳ)/);
  if (days) {
    const count = Number(days[1] ?? days[3]);
    const unit = days[2] ?? days[4] ?? "days";
    hints.hold_days = unit.startsWith("week") ? count * 7 : unit.startsWith("month") || unit === "ತಿಂಗಳ" ? count * 30 : count;
  }
  const scenario = text.match(new RegExp(`(?:rises? to|goes up to|reaches|becomes|increases? to|falls? to|drops? to|scenario(?: price)?(?: of)?)\\s*${AMOUNT}`));
  hints.scenario_price = number(scenario?.[1]);
  const prices = [...text.matchAll(new RegExp(AMOUNT, "g"))]
    .filter((match) => ![hints.transport_cost, hints.storage_cost, hints.scenario_price].includes(number(match[1])))
    .map((match) => number(match[1]));
  hints.price = prices.find((value) => value !== undefined && value >= 100);
  return Object.fromEntries(Object.entries(hints).filter(([, value]) => value !== undefined)) as CalculationHints;
}

function monthBounds(text: string) {
  const years = [...text.matchAll(/\b(20[1-3]\d)\b/g)].map((match) => Number(match[1])).sort();
  if (!years.length) return {};
  return { from_month: `${years[0]}-01`, to_month: `${years.at(-1)}-12` };
}

export function classifyQuestion(question: string): Classification {
  const text = normalizeDigits(question).toLowerCase();
  const tools: ToolName[] = [];
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text)) && !tools.includes(rule.tool)) tools.push(rule.tool);
  }
  // "last season", "past", "trend" only mean price history when prices are the subject (not "harvest last season").
  const priceWord = /\b(price|prices|rate|rates|quote|cost|value)\b|ಬೆಲೆ|ದರ/.test(text);
  const historyIndex = tools.indexOf("get_historical_prices");
  if (historyIndex >= 0 && !priceWord && tools.length > 1) tools.splice(historyIndex, 1);
  // Calculations and forecasts consume prices themselves; a generic "price" mention should not add a price table.
  const specific = tools.filter((tool) => tool !== "get_current_prices");
  const priceConsumers: ToolName[] = ["calculate_net_realization", "calculate_sell_hold", "get_price_forecast", "get_historical_prices", "compare_markets", "get_market_index"];
  const selected = specific.some((tool) => priceConsumers.includes(tool)) ? specific : tools;
  const entities: Classification["entities"] = {
    variety: firstMatch(question, VARIETY_ALIASES),
    district: firstMatch(question, DISTRICTS),
    market: PLACES.find((place) => place.level === "local" && (place.latin.test(question) || place.kannada.some((name) => question.includes(name))))?.name,
    source: firstMatch(question, SOURCES),
    ...monthBounds(text),
  };
  if (/\b(india|all india|national|country)\b|ಭಾರತ/.test(text)) entities.geography = "All India";
  const calculation = selected.some((tool) => tool.startsWith("calculate_")) ? extractCalculationHints(question) : {};
  return {
    tools: selected.slice(0, MAX_TOOLS_PER_QUERY),
    entities: Object.fromEntries(Object.entries(entities).filter(([, value]) => value !== undefined)) as Classification["entities"],
    calculation,
  };
}
