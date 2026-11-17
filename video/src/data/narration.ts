/**
 * Kannada voice-over script and Instagram caption, generated only from the rates data so the voice can never say a
 * figure that isn't on screen. Spoken prices are rounded to the nearest ₹100 and prefixed "ಸುಮಾರು" (about); the
 * screen keeps the exact figure. Numbers are written out as words so the voice reads them exactly as intended.
 * Kannada and English are built from the same facts. Runs in Node (scripts/fetch-rates.mjs): keep it plain, erasable TS.
 */
import type { CoopBlock, Quote, RatesData } from "./rates.ts";
import { apmcVariety, change, fmtDate, place, rupees } from "../format.ts";
import type { Lang } from "../i18n.ts";

export type SceneKey = "glance" | "mamcos" | "tss" | "others" | "trend" | "cta";
export const SCENES: SceneKey[] = ["glance", "mamcos", "tss", "others", "trend", "cta"];
/** The 30-second cut (Instagram and Facebook Stories): the headline rates and the call to action only. */
export const SHORT_SCENES: SceneKey[] = ["glance", "mamcos", "tss", "cta"];
export type Cut = "full" | "30";
export const scenesFor = (cut: Cut | undefined) => (cut === "30" ? SHORT_SCENES : SCENES);

const ONES = ["", "ಒಂದು", "ಎರಡು", "ಮೂರು", "ನಾಲ್ಕು", "ಐದು", "ಆರು", "ಏಳು", "ಎಂಟು", "ಒಂಬತ್ತು"];
const TEENS = ["ಹತ್ತು", "ಹನ್ನೊಂದು", "ಹನ್ನೆರಡು", "ಹದಿಮೂರು", "ಹದಿನಾಲ್ಕು", "ಹದಿನೈದು", "ಹದಿನಾರು", "ಹದಿನೇಳು", "ಹದಿನೆಂಟು", "ಹತ್ತೊಂಬತ್ತು"];
const TENS = ["", "", "ಇಪ್ಪತ್ತು", "ಮೂವತ್ತು", "ನಲವತ್ತು", "ಐವತ್ತು", "ಅರವತ್ತು", "ಎಪ್ಪತ್ತು", "ಎಂಬತ್ತು", "ತೊಂಬತ್ತು"];
const HUNDREDS = ["", "ನೂರು", "ಇನ್ನೂರು", "ಮುನ್ನೂರು", "ನಾನೂರು", "ಐನೂರು", "ಆರುನೂರು", "ಏಳುನೂರು", "ಎಂಟುನೂರು", "ಒಂಬೈನೂರು"];
/** Vowel signs that join a vowel-initial unit onto a tens stem: ಇಪ್ಪತ್ತ + ಒಂದು → ಇಪ್ಪತ್ತೊಂದು. */
const SIGN: Record<string, string> = { "ಒ": "ೊ", "ಎ": "ೆ", "ಐ": "ೈ", "ಆ": "ಾ", "ಏ": "ೇ" };
const MONTHS = ["ಜನವರಿ", "ಫೆಬ್ರವರಿ", "ಮಾರ್ಚ್", "ಏಪ್ರಿಲ್", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗಸ್ಟ್", "ಸೆಪ್ಟೆಂಬರ್", "ಅಕ್ಟೋಬರ್", "ನವೆಂಬರ್", "ಡಿಸೆಂಬರ್"];

function under100(n: number): string {
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  const tens = TENS[Math.floor(n / 10)];
  const unit = ONES[n % 10];
  if (!unit) return tens;
  const stem = tens.slice(0, -1); // drop the final ು: ಇಪ್ಪತ್ತು → ಇಪ್ಪತ್ತ
  const sign = SIGN[unit[0]];
  return sign ? stem + sign + unit.slice(1) : stem + unit;
}

/** 0–99,999 in Kannada words: 47800 → "ನಲವತ್ತೇಳು ಸಾವಿರದ ಎಂಟುನೂರು". */
export function knNumber(n: number): string {
  n = Math.round(n);
  if (n < 0 || n > 99_999) throw new Error(`knNumber supports 0–99,999, got ${n}`);
  if (n === 0) return "ಸೊನ್ನೆ";
  const th = Math.floor(n / 1000);
  const h = Math.floor((n % 1000) / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (th) parts.push(`${th === 1 ? "ಒಂದು" : under100(th)} ${h || r ? "ಸಾವಿರದ" : "ಸಾವಿರ"}`);
  if (h) parts.push(r ? HUNDREDS[h].slice(0, -1) : HUNDREDS[h]); // ನೂರು → ನೂರ before a remainder
  if (r) parts.push(under100(r));
  return parts.join(" ");
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const EN_ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0–99,999 in English words: 47800 → "forty-seven thousand eight hundred". */
export function enNumber(n: number): string {
  n = Math.round(n);
  if (n < 0 || n > 99_999) throw new Error(`enNumber supports 0–99,999, got ${n}`);
  if (n === 0) return "zero";
  const two = (x: number) => (x < 20 ? EN_ONES[x] : EN_TENS[Math.floor(x / 10)] + (x % 10 ? `-${EN_ONES[x % 10]}` : ""));
  const th = Math.floor(n / 1000), h = Math.floor((n % 1000) / 100), r = n % 100;
  return [th ? `${two(th)} thousand` : "", h ? `${EN_ONES[h]} hundred` : "", r ? two(r) : ""].filter(Boolean).join(" ");
}

/** 1–31 as spoken dates: 14 → "fourteenth", 21 → "twenty-first". */
function enOrdinal(d: number): string {
  const special: Record<number, string> = { 1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth", 9: "ninth", 12: "twelfth", 20: "twentieth", 30: "thirtieth" };
  if (special[d]) return special[d];
  if (d > 20 && d % 10) return `${EN_TENS[Math.floor(d / 10)]}-${enOrdinal(d % 10)}`;
  return `${enNumber(d)}th`;
}

const round100 = (n: number) => Math.round(n / 100) * 100;
const say = {
  kn: {
    num: knNumber,
    rupees: (n: number) => `ಸುಮಾರು ${knNumber(round100(n))} ರೂಪಾಯಿ`,
    date: (iso: string) => { const [, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${knNumber(d)}`; },
  },
  en: {
    num: enNumber,
    rupees: (n: number) => `about ${enNumber(round100(n))} rupees`,
    date: (iso: string) => { const [, m, d] = iso.split("-").map(Number); return `${MONTHS_EN[m - 1]} ${enOrdinal(d)}`; },
  },
};
type Move = "up" | "down" | "same" | null;
const move = (q: Quote): Move => {
  const pct = change(q.avg, q.prevAvg);
  if (pct == null) return null;
  return Math.abs(pct) < 0.05 ? "same" : pct > 0 ? "up" : "down";
};

const find = (d: RatesData, source: CoopBlock["source"], variety: string) => d.coop.find((b) => b.source === source && b.variety === variety);
const newestFirst = (q: Quote[]) => [...q].sort((a, b) => b.date.localeCompare(a.date) || b.avg - a.avg);

export function newestDate(d: RatesData) {
  return [...d.coop.flatMap((b) => b.latest.map((q) => q.date)), ...d.apmc.map((r) => r.date)].sort().at(-1) ?? "";
}

/** The facts both languages narrate, picked once so Kannada and English always say the same thing. */
function facts(d: RatesData) {
  const mamcos = find(d, "mamcos", "RASHI EDI");
  let mamcosDay: { lo: number; hi: number; count: number; date: string } | null = null;
  let down = 0, up = 0;
  if (mamcos?.latest.length) {
    const date = mamcos.latest.map((q) => q.date).sort().at(-1)!;
    const avgs = mamcos.latest.filter((q) => q.date === date).map((q) => q.avg);
    mamcosDay = { lo: Math.min(...avgs), hi: Math.max(...avgs), count: avgs.length, date };
    const moves = mamcos.latest.map(move);
    down = moves.filter((m) => m === "down").length;
    up = moves.filter((m) => m === "up").length;
  }
  const trend = find(d, "tss", "RASHI");
  return {
    newest: newestDate(d),
    mamcosDay, down, up,
    tssRashi: newestFirst(find(d, "tss", "RASHI")?.latest ?? [])[0],
    tssChali: newestFirst(find(d, "tss", "CHALI")?.latest ?? [])[0],
    apmc: d.apmc.find((r) => r.variety === "Rashi") ?? d.apmc[0],
    tumcos: find(d, "tumcos", "areca")?.latest[0],
    mamcosChali: newestFirst(find(d, "mamcos", "CHALI")?.latest ?? [])[0],
    trend: trend && trend.hist.length >= 3 ? { branch: trend.histBranch, n: trend.hist.length } : null,
  };
}

const empty = (): Record<SceneKey, string[]> => ({ glance: [], mamcos: [], tss: [], others: [], trend: [], cta: [] });

/** "ಶಿರಸಿ" → "ಶಿರಸಿಯಲ್ಲಿ", "ಸಾಗರ" → "ಸಾಗರದಲ್ಲಿ", "ಬೀರೂರು" → "ಬೀರೂರಿನಲ್ಲಿ". */
export function knIn(name: string) {
  const last = name.slice(-1);
  if (last === "ಿ" || last === "ೀ" || last === "ೆ" || last === "ೇ") return `${name}ಯಲ್ಲಿ`;
  if (last === "ು") return `${name.slice(0, -1)}ಿನಲ್ಲಿ`;
  return `${name}ದಲ್ಲಿ`;
}

function narrationKn(f: ReturnType<typeof facts>) {
  const s = say.kn, o = empty();
  const r = (n: number) => `${s.num(round100(n))} ರೂಪಾಯಿ`;
  const mv = (q: Quote) => {
    const m = move(q);
    return m ? ({ up: ", ಹಿಂದಿನ ವರದಿಗಿಂತ ಏರಿದೆ", down: ", ಹಿಂದಿನ ವರದಿಗಿಂತ ಇಳಿದಿದೆ", same: ", ಹಿಂದಿನ ವರದಿಯಷ್ಟೇ ಇದೆ" })[m] : "";
  };
  const town = (n: string) => place(n, "kn");
  o.glance.push("ನಮಸ್ಕಾರ, ಅಡಿಕೆ ನಾಡಿಗೆ ಸ್ವಾಗತ.", `ಇವತ್ತಿನ ಅಡಿಕೆ ಧಾರಣೆ. ಕೊನೆಯ ವರದಿ ${s.date(f.newest)}.`);
  if (f.mamcosDay) {
    const { lo, hi } = f.mamcosDay;
    o.mamcos.push(round100(lo) !== round100(hi)
      ? `ಮೊದಲು ಮ್ಯಾಮ್ಕೋಸ್. ರಾಶಿಗೆ ಶಾಖೆಗಳ ಸರಾಸರಿ ಸುಮಾರು ${s.num(round100(lo))} ರೂಪಾಯಿಯಿಂದ ${s.num(round100(hi))} ರೂಪಾಯಿವರೆಗೆ ಇದೆ.`
      : `ಮೊದಲು ಮ್ಯಾಮ್ಕೋಸ್. ರಾಶಿಗೆ ಶಾಖೆಗಳ ಸರಾಸರಿ ಸುಮಾರು ${r(lo)} ಇದೆ.`);
    const n = (k: number, w: string) => `${s.num(k)} ${k === 1 ? "ಶಾಖೆಯಲ್ಲಿ" : "ಶಾಖೆಗಳಲ್ಲಿ"} ${w}`;
    const parts = [f.down ? n(f.down, "ಇಳಿದಿದೆ") : "", f.up ? n(f.up, "ಏರಿದೆ") : ""].filter(Boolean);
    if (parts.length) o.mamcos.push(`ಹಿಂದಿನ ವರದಿಗೆ ಹೋಲಿಸಿದ್ರೆ ${parts.join(", ")}.`);
  }
  if (f.tssRashi || f.tssChali) o.tss.push("ಇನ್ನು ಟಿ ಎಸ್ ಎಸ್ ಕಡೆ ಬಂದ್ರೆ,");
  if (f.tssRashi) o.tss.push(`${knIn(town(f.tssRashi.branch))} ರಾಶಿ ಸುಮಾರು ${r(f.tssRashi.avg)}${mv(f.tssRashi)}.`);
  if (f.tssChali) {
    const same = f.tssRashi && f.tssRashi.branch === f.tssChali.branch;
    o.tss.push(`${same ? "" : `${knIn(town(f.tssChali.branch))} `}ಚಾಲಿ ಸುಮಾರು ${r(f.tssChali.avg)}${mv(f.tssChali)}.`);
  }
  if (f.apmc) o.others.push(`ಬೇರೆ ಕಡೆ ನೋಡಿದ್ರೆ, ${town(f.apmc.market)} ಎಪಿಎಂಸಿಯಲ್ಲಿ ${apmcVariety(f.apmc.variety, "kn")} ಮಾದರಿ ದರ ಸುಮಾರು ${r(f.apmc.modal)}.`);
  if (f.tumcos) o.others.push(`ತುಮ್ಕೋಸ್, ${knIn(town(f.tumcos.branch))} ಸುಮಾರು ${r(f.tumcos.avg)}.`);
  if (f.mamcosChali) o.others.push(`ಮ್ಯಾಮ್ಕೋಸ್, ${knIn(town(f.mamcosChali.branch))} ಚಾಲಿ ಸುಮಾರು ${r(f.mamcosChali.avg)}.`);
  if (f.trend) o.trend.push(`ಕೊನೆಯದಾಗಿ, ${town(f.trend.branch)} ರಾಶಿ ಕಳೆದ ${s.num(f.trend.n)} ವರದಿಗಳಲ್ಲಿ ಹೇಗೆ ಏರಿಳಿದಿದೆ ನೋಡಿ.`, "ನೆನಪಿರಲಿ, ಹಿಂದಿನ ಧಾರಣೆ ಮುಂದಿನ ಭವಿಷ್ಯ ಅಲ್ಲ.");
  o.cta.push("ಎಲ್ಲಾ ಶಾಖೆಗಳ ಧಾರಣೆಗೆ ಅಡಿಕೆ ನಾಡಿ ಡಾಟ್ ಕಾಮ್ ನೋಡಿ, ನಿಮ್ಮ ಊರಿನ ಬೆಳೆಗಾರರಿಗೂ ಶೇರ್ ಮಾಡಿ.", "ಇದು ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ ಮಾತ್ರ, ಸಲಹೆ ಅಲ್ಲ.");
  // Any Latin letter or digit left means an unmapped name: drop the sentence rather than mispronounce it.
  for (const k of SCENES) o[k] = o[k].filter((x) => !/[A-Za-z0-9]/.test(x));
  return o;
}

function narrationEn(f: ReturnType<typeof facts>) {
  const s = say.en, o = empty();
  const mv = (q: Quote) => { const m = move(q); return m ? ({ up: ", up from the previous report", down: ", down from the previous report", same: ", unchanged from the previous report" })[m] : ""; };
  const town = (n: string) => place(n, "en");
  o.glance.push("Hello, and welcome to Areca Pulse.", `Here are today's arecanut rates, from reports up to ${s.date(f.newest)}.`);
  if (f.mamcosDay) {
    const { lo, hi } = f.mamcosDay;
    o.mamcos.push(round100(lo) !== round100(hi)
      ? `First, Mamcos. On the latest day, Rashi branch averages ranged from about ${s.num(round100(lo))} to ${s.num(round100(hi))} rupees.`
      : `First, Mamcos. The Rashi branch average was ${s.rupees(lo)}.`);
    const n = (k: number, w: string) => `${s.num(k)} ${k === 1 ? "branch" : "branches"} ${w}`;
    const parts = [f.down ? n(f.down, "fell") : "", f.up ? n(f.up, "rose") : ""].filter(Boolean);
    if (parts.length) o.mamcos.push(`Compared with the previous report, ${parts.join(" and ")}.`);
  }
  if (f.tssRashi || f.tssChali) o.tss.push("Next, T S S.");
  if (f.tssRashi) o.tss.push(`In ${town(f.tssRashi.branch)}, Rashi was ${s.rupees(f.tssRashi.avg)}${mv(f.tssRashi)}.`);
  if (f.tssChali) {
    const same = f.tssRashi && f.tssRashi.branch === f.tssChali.branch;
    o.tss.push(`${same ? "Chali" : `In ${town(f.tssChali.branch)}, Chali`} was ${s.rupees(f.tssChali.avg)}${mv(f.tssChali)}.`);
  }
  if (f.apmc) o.others.push(`Elsewhere, at ${town(f.apmc.market)} A P M C, the modal rate for ${f.apmc.variety} was ${s.rupees(f.apmc.modal)}.`);
  if (f.tumcos) o.others.push(`Tumcos in ${town(f.tumcos.branch)} was ${s.rupees(f.tumcos.avg)}.`);
  if (f.mamcosChali) o.others.push(`And at Mamcos ${town(f.mamcosChali.branch)}, Chali was ${s.rupees(f.mamcosChali.avg)}.`);
  if (f.trend) o.trend.push(`Finally, here is how ${town(f.trend.branch)} Rashi moved over the last ${s.num(f.trend.n)} reports.`, "Remember, past rates are not a forecast.");
  o.cta.push("See rates for every branch at adikenaadi dot com, and share this with growers in your village.", "This is market information only, not financial advice.");
  for (const k of SCENES) o[k] = o[k].filter((x) => !/[0-9]/.test(x));
  return o;
}

/** One short line per scene, so the 30-second cut fits: the same facts as the full script, fewer words. */
function narrationShort(f: ReturnType<typeof facts>, l: Lang) {
  const o = empty();
  const kn = l === "kn";
  const s = say[l];
  const town = (n: string) => place(n, l);
  o.glance.push(kn ? `ಇವತ್ತಿನ ಅಡಿಕೆ ಧಾರಣೆ, ${s.date(f.newest)}.` : `Today's arecanut rates, ${s.date(f.newest)}.`);
  if (f.mamcosDay) {
    const lo = round100(f.mamcosDay.lo), hi = round100(f.mamcosDay.hi);
    o.mamcos.push(kn
      ? (lo !== hi ? `ಮ್ಯಾಮ್ಕೋಸ್ ರಾಶಿ ಸುಮಾರು ${s.num(lo)} ರೂಪಾಯಿಯಿಂದ ${s.num(hi)} ರೂಪಾಯಿವರೆಗೆ.` : `ಮ್ಯಾಮ್ಕೋಸ್ ರಾಶಿ ${s.rupees(lo)}.`)
      : (lo !== hi ? `Mamcos Rashi, about ${s.num(lo)} to ${s.num(hi)} rupees.` : `Mamcos Rashi, ${s.rupees(lo)}.`));
  }
  const { tssRashi: r, tssChali: c } = f;
  if (r && c && r.branch === c.branch) {
    o.tss.push(kn ? `ಟಿ ಎಸ್ ಎಸ್ ${knIn(town(r.branch))} ರಾಶಿ ${s.rupees(r.avg)}, ಚಾಲಿ ${s.rupees(c.avg)}.` : `T S S ${town(r.branch)}: Rashi ${s.rupees(r.avg)}, Chali ${s.rupees(c.avg)}.`);
  } else {
    if (r) o.tss.push(kn ? `ಟಿ ಎಸ್ ಎಸ್ ${knIn(town(r.branch))} ರಾಶಿ ${s.rupees(r.avg)}.` : `T S S ${town(r.branch)} Rashi, ${s.rupees(r.avg)}.`);
    if (c) o.tss.push(kn ? `${knIn(town(c.branch))} ಚಾಲಿ ${s.rupees(c.avg)}.` : `${town(c.branch)} Chali, ${s.rupees(c.avg)}.`);
  }
  o.cta.push(kn ? "ಎಲ್ಲಾ ಶಾಖೆಗಳ ಧಾರಣೆಗೆ ಅಡಿಕೆ ನಾಡಿ ಡಾಟ್ ಕಾಮ್ ನೋಡಿ." : "Every branch's rate at adikenaadi dot com.");
  const bad = kn ? /[A-Za-z0-9]/ : /[0-9]/;
  for (const k of SCENES) o[k] = o[k].filter((x) => !bad.test(x));
  return o;
}

export function buildNarration(d: RatesData, l: Lang = "kn", cut: Cut = "full"): Record<SceneKey, string[]> {
  const f = facts(d);
  if (cut === "30") return narrationShort(f, l);
  return l === "en" ? narrationEn(f) : narrationKn(f);
}

/** Instagram / YouTube caption, following the project's description rule (site first, sources, hashtags, disclaimer). */
/** One line per rate, with source, place and date: shared by the Reel caption and the WhatsApp message, so they agree. */
export function rateLines(d: RatesData, l: Lang = "kn"): string[] {
  const f = facts(d);
  const kn = l === "kn";
  const date = (iso: string) => fmtDate(iso, false, l);
  const town = (n: string) => place(n, l);
  const lines: string[] = [];
  if (f.mamcosDay) {
    const { lo, hi, count, date: day } = f.mamcosDay;
    const range = count > 1 ? `${rupees(lo)} – ${rupees(hi)}` : rupees(lo);
    lines.push(kn ? `• MAMCOS ರಾಶಿ (RASHI EDI): ${range} · ${count} ಶಾಖೆಗಳ ಸರಾಸರಿ ದರಗಳು · ${date(day)}` : `• MAMCOS Rashi (RASHI EDI): ${range} · averages of ${count} branches · ${date(day)}`);
  }
  if (f.tssRashi) lines.push(`• TSS ${town(f.tssRashi.branch)} ${kn ? "ರಾಶಿ" : "Rashi"}: ${rupees(f.tssRashi.avg)} · ${date(f.tssRashi.date)}`);
  if (f.tssChali) lines.push(`• TSS ${town(f.tssChali.branch)} ${kn ? "ಚಾಲಿ" : "Chali"}: ${rupees(f.tssChali.avg)} · ${date(f.tssChali.date)}`);
  if (f.apmc) lines.push(`• ${town(f.apmc.market)} APMC ${apmcVariety(f.apmc.variety, l)} (${kn ? "ಮಾದರಿ ದರ" : "modal rate"}): ${rupees(f.apmc.modal)} · ${date(f.apmc.date)}`);
  if (f.mamcosChali) lines.push(`• MAMCOS ${town(f.mamcosChali.branch)} ${kn ? "ಚಾಲಿ" : "Chali"}: ${rupees(f.mamcosChali.avg)} · ${date(f.mamcosChali.date)}`);
  if (f.tumcos) lines.push(`• TUMCOS ${town(f.tumcos.branch)} (${kn ? "ತಳಿ ತಿಳಿಸಿಲ್ಲ" : "variety not stated"}): ${rupees(f.tumcos.avg)} · ${date(f.tumcos.date)}`);
  return lines;
}

export function buildCaption(d: RatesData, withVoice: boolean, l: Lang = "kn"): string {
  const f = facts(d);
  const kn = l === "kn";
  const date = (iso: string, y = false) => fmtDate(iso, y, l);
  const lines = [kn ? `ಇವತ್ತಿನ ಅಡಿಕೆ ಧಾರಣೆ · ಕೊನೆಯ ವರದಿ ${date(f.newest, true)}` : `Today's arecanut rates · latest report ${date(f.newest, true)}`, ""];
  lines.push(...rateLines(d, l));
  lines.push(
    "",
    kn ? "ಎಲ್ಲಾ ಶಾಖೆಗಳ ಧಾರಣೆ, ಚಾರ್ಟ್, ಹೋಲಿಕೆ: https://adikenaadi.com" : "Every branch, charts and comparisons: https://adikenaadi.com",
    kn
      ? "ಮೂಲ: MAMCOS, TSS, TUMCOS ಪ್ರಕಟಿತ ದರಗಳು ಮತ್ತು AGMARKNET (data.gov.in). ದರಗಳು ₹/ಕ್ವಿಂಟಾಲ್; TSS ಮತ್ತು TUMCOS ಘಟಕ ಊಹಿಸಲಾಗಿದೆ."
      : "Sources: MAMCOS, TSS and TUMCOS published rates, and AGMARKNET (data.gov.in). Rates in ₹/quintal; TSS and TUMCOS units are assumed.",
    ...(withVoice ? [kn ? "ಧ್ವನಿ: AI" : "Voice: AI-generated"] : []),
    kn ? "ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ ಮಾತ್ರ, ಹಣಕಾಸು ಸಲಹೆ ಅಲ್ಲ." : "Market information only, not financial advice.",
    "",
    kn ? "#ಅಡಿಕೆ #adike #arecanut #ಅಡಿಕೆಧಾರಣೆ #arecanutprice #adikerate #Shivamogga #Sirsi #Malnad" : "#arecanut #arecanutprice #adike #ಅಡಿಕೆ #supari #Karnataka #Shivamogga #Sirsi #Malnad",
  );
  return lines.join("\n");
}

/** YouTube title (≤ 100 characters): what, the report date, and the search words growers type. */
export function buildYouTubeTitle(d: RatesData, l: Lang = "kn"): string {
  const date = fmtDate(newestDate(d) ?? "", true, l);
  const title = l === "kn" ? `ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ | ${date} | MAMCOS, TSS ರಾಶಿ, ಚಾಲಿ ದರ` : `Arecanut Rate Today | ${date} | MAMCOS, TSS Rashi & Chali`;
  return title.slice(0, 100);
}
