import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Truck } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { MONTH_NAMES_KN } from "../../../shared/dates";
import { api } from "../services/api";
import { formatDate, type Language } from "../services/formatting";
import { ageText, defineCopy, useLanguage } from "../services/language";
import { MARKET_PLACES, marketPath, type MarketPlace } from "../services/markets";
import { useMyTown } from "../services/myTown";
import { placeName } from "../services/places";
import type { RecentArrivals, RecentMarketArrivals } from "../services/supply";
import { LineSeriesChart } from "./InsightCharts";
import { ErrorState, SkeletonRows } from "./State";

/**
 * Market arrivals from the daily APMC reports (KRAMA): the latest day at one town's APMC, the busiest markets this week,
 * and the season pattern. Arrivals show how much reached a market, all varieties together; they are never a price.
 */

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_EN_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (month: number, language: Language, long = false) => language === "kn" ? MONTH_NAMES_KN[month - 1] : (long ? MONTHS_EN_LONG : MONTHS_EN)[month - 1];
const qtl = (value: number) => Math.round(value).toLocaleString("en-IN");
const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
/** "today", "yesterday" or the date, for a report date. */
const when = (date: string, language: Language) => { const age = daysBetween(date, todayIST()); return age <= 1 ? ageText(age, language) : formatDate(date, language); };
/** "today", "yesterday" or day and month without the year ("17 Nov", "17 ನವೆಂಬರ್"), for tight rows. */
const shortWhen = (date: string, language: Language) => {
  const age = daysBetween(date, todayIST());
  if (age <= 1) return ageText(age, language);
  const day = Number(date.slice(8, 10)), month = Number(date.slice(5, 7));
  return `${day} ${language === "kn" ? MONTH_NAMES_KN[month - 1] : MONTHS_EN[month - 1]}`;
};
/** Busier or quieter than the usual reporting day, by a quarter either way. */
const pace = (value: number, usual: number | null) => usual === null || usual <= 0 ? null : value >= usual * 1.25 ? "busy" : value <= usual * 0.75 ? "quiet" : "usual";

const COPY = defineCopy({
  en: {
    apmc: (town: string) => `${town} APMC`,
    arrivalsAt: (market: string) => `Arrivals at ${market}`,
    quintals: "quintals", qtl: "qtl",
    on: (when: string) => when,
    noReport: (date: string) => `No report for ${date} yet`,
    busy: "Busier than usual", quiet: "Quieter than usual", usual: "About usual",
    short: { busy: "Busier", quiet: "Quieter", usual: "Usual" },
    usualDay: (value: string) => `Usual day: ${value} qtl`,
    week: "Last 7 days", weekTotal: (value: string, days: number) => `${value} qtl over ${days} report day${days === 1 ? "" : "s"}`,
    noDay: "No report", dayBar: (date: string, value: string) => `${date}: ${value} quintals`,
    weekAria: (market: string) => `${market} arrivals, last 7 days`,
    source: "Source: KRAMA, Department of Agricultural Marketing. All varieties together.",
    leadersTitle: "Where arecanut is arriving",
    leadersHint: (from: string, to: string) => `Last 7 days, ${from} – ${to} · quintals, all varieties`,
    leadersAria: "Markets by arrivals in the last 7 days",
    stateWeek: (value: string) => `Karnataka, last 7 days: ${value} qtl`,
    vsLastWeek: (change: number) => `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change)}% on the week before`,
    yourTown: "Your town",
    latestValue: (when: string, value: string) => `${when} ${value} qtl`, noLatest: (when: string) => `No report ${when}`,
    sevenDays: "qtl",
    columns: { market: "Market", week: "Last 7 days", pace: "Against usual", total: "7-day total" },
    sparkAria: (market: string, days: string) => `${market}, last 7 days: ${days}`,
    seasonTitle: "When arecanut reaches the markets",
    seasonHint: "Each month's share of a year's arrivals. Arrivals show supply reaching the yards, not where prices will go.",
    scope: "Market", allKarnataka: "All Karnataka",
    busiest: "Busiest month", quietest: "Quietest month", thisYear: "This year so far",
    shareOfYear: (value: number) => `${value}% of a year's arrivals`,
    likeForLike: (months: string, year: number, markets: number) => `vs ${months} ${year}${markets > 1 ? `, same ${markets} markets` : ""}`,
    ahead: { rise: "Arrivals usually rise over the next two months.", ease: "Arrivals usually ease over the next two months.", steady: "Arrivals usually hold steady over the next two months." },
    typical: "Typical year", range: "Range in most years", now: "Now",
    seasonDescription: (place: string) => `Share of a year's arecanut arrivals by month, ${place}`,
    yearsUsed: (first: number, last: number, count: number) => `Typical year: median of ${count} complete years, ${first}–${last}. The range leaves out the highest and lowest year.`,
    notEnough: "Not enough complete years of reports for this market yet.",
    loading: "Loading arrivals", failed: "Could not load the arrivals.", retry: "Try again",
    months: (from: number, to: number) => from === to ? MONTHS_EN[from - 1] : `${MONTHS_EN[from - 1]}–${MONTHS_EN[to - 1]}`,
  },
  kn: {
    apmc: (town: string) => `${town} ಎಪಿಎಂಸಿ`,
    arrivalsAt: (market: string) => `${market} ಆವಕ`,
    quintals: "ಕ್ವಿಂಟಾಲ್", qtl: "ಕ್ವಿಂ.",
    on: (when: string) => when,
    noReport: (date: string) => `${date} ವರದಿ ಇನ್ನೂ ಬಂದಿಲ್ಲ`,
    busy: "ಸಾಮಾನ್ಯಕ್ಕಿಂತ ಹೆಚ್ಚು", quiet: "ಸಾಮಾನ್ಯಕ್ಕಿಂತ ಕಡಿಮೆ", usual: "ಸಾಮಾನ್ಯ ಮಟ್ಟ",
    short: { busy: "ಹೆಚ್ಚು", quiet: "ಕಡಿಮೆ", usual: "ಸಾಮಾನ್ಯ" },
    usualDay: (value: string) => `ಸಾಮಾನ್ಯ ದಿನ: ${value} ಕ್ವಿಂ.`,
    week: "ಕಳೆದ 7 ದಿನ", weekTotal: (value: string, days: number) => `${days} ವರದಿ ದಿನಗಳಲ್ಲಿ ${value} ಕ್ವಿಂ.`,
    noDay: "ವರದಿ ಇಲ್ಲ", dayBar: (date: string, value: string) => `${date}: ${value} ಕ್ವಿಂಟಾಲ್`,
    weekAria: (market: string) => `${market} ಆವಕ, ಕಳೆದ 7 ದಿನ`,
    source: "ಮೂಲ: ಕೃಷಿ ಮಾರಾಟ ಇಲಾಖೆಯ KRAMA. ಎಲ್ಲ ತಳಿಗಳು ಸೇರಿ.",
    leadersTitle: "ಅಡಿಕೆ ಎಲ್ಲಿಗೆ ಹೆಚ್ಚು ಬರುತ್ತಿದೆ",
    leadersHint: (from: string, to: string) => `ಕಳೆದ 7 ದಿನ, ${from} – ${to} · ಕ್ವಿಂಟಾಲ್, ಎಲ್ಲ ತಳಿಗಳು`,
    leadersAria: "ಕಳೆದ 7 ದಿನಗಳ ಆವಕದ ಪ್ರಕಾರ ಮಾರುಕಟ್ಟೆಗಳು",
    stateWeek: (value: string) => `ಕರ್ನಾಟಕ, ಕಳೆದ 7 ದಿನ: ${value} ಕ್ವಿಂ.`,
    vsLastWeek: (change: number) => `ಹಿಂದಿನ ವಾರಕ್ಕಿಂತ ${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change)}%`,
    yourTown: "ನಿಮ್ಮ ಊರು",
    latestValue: (when: string, value: string) => `${when} ${value} ಕ್ವಿಂ.`, noLatest: (when: string) => `${when} ವರದಿ ಇಲ್ಲ`,
    sevenDays: "ಕ್ವಿಂ.",
    columns: { market: "ಮಾರುಕಟ್ಟೆ", week: "ಕಳೆದ 7 ದಿನ", pace: "ಸಾಮಾನ್ಯಕ್ಕೆ ಹೋಲಿಸಿ", total: "7 ದಿನಗಳ ಒಟ್ಟು" },
    sparkAria: (market: string, days: string) => `${market}, ಕಳೆದ 7 ದಿನ: ${days}`,
    seasonTitle: "ಅಡಿಕೆ ಮಾರುಕಟ್ಟೆಗೆ ಯಾವಾಗ ಹೆಚ್ಚು ಬರುತ್ತದೆ",
    seasonHint: "ವರ್ಷದ ಒಟ್ಟು ಆವಕದಲ್ಲಿ ಪ್ರತಿ ತಿಂಗಳ ಪಾಲು. ಆವಕ ಮಾರುಕಟ್ಟೆಗೆ ಬರುವ ಸರಕನ್ನು ತೋರಿಸುತ್ತದೆ, ದರ ಎತ್ತ ಹೋಗುತ್ತದೆ ಎಂದಲ್ಲ.",
    scope: "ಮಾರುಕಟ್ಟೆ", allKarnataka: "ಇಡೀ ಕರ್ನಾಟಕ",
    busiest: "ಹೆಚ್ಚು ಆವಕದ ತಿಂಗಳು", quietest: "ಕಡಿಮೆ ಆವಕದ ತಿಂಗಳು", thisYear: "ಈ ವರ್ಷ ಇದುವರೆಗೆ",
    shareOfYear: (value: number) => `ವರ್ಷದ ಆವಕದ ${value}%`,
    likeForLike: (months: string, year: number, markets: number) => `${months} ${year}ಕ್ಕೆ ಹೋಲಿಸಿ${markets > 1 ? `, ಅದೇ ${markets} ಮಾರುಕಟ್ಟೆಗಳು` : ""}`,
    ahead: { rise: "ಮುಂದಿನ ಎರಡು ತಿಂಗಳಲ್ಲಿ ಆವಕ ಸಾಮಾನ್ಯವಾಗಿ ಹೆಚ್ಚುತ್ತದೆ.", ease: "ಮುಂದಿನ ಎರಡು ತಿಂಗಳಲ್ಲಿ ಆವಕ ಸಾಮಾನ್ಯವಾಗಿ ಕಡಿಮೆಯಾಗುತ್ತದೆ.", steady: "ಮುಂದಿನ ಎರಡು ತಿಂಗಳಲ್ಲಿ ಆವಕ ಸಾಮಾನ್ಯವಾಗಿ ಸ್ಥಿರವಾಗಿರುತ್ತದೆ." },
    typical: "ಸಾಮಾನ್ಯ ವರ್ಷ", range: "ಹೆಚ್ಚಿನ ವರ್ಷಗಳ ವ್ಯಾಪ್ತಿ", now: "ಈಗ",
    seasonDescription: (place: string) => `ವರ್ಷದ ಅಡಿಕೆ ಆವಕದಲ್ಲಿ ತಿಂಗಳವಾರು ಪಾಲು, ${place}`,
    yearsUsed: (first: number, last: number, count: number) => `ಸಾಮಾನ್ಯ ವರ್ಷ: ${first}–${last} ನಡುವಿನ ${count} ಪೂರ್ಣ ವರ್ಷಗಳ ಮಧ್ಯಾಂಕ ಮೌಲ್ಯ. ವ್ಯಾಪ್ತಿಯಲ್ಲಿ ಅತಿ ಹೆಚ್ಚು ಮತ್ತು ಅತಿ ಕಡಿಮೆ ವರ್ಷ ಸೇರಿಲ್ಲ.`,
    notEnough: "ಈ ಮಾರುಕಟ್ಟೆಗೆ ಇನ್ನೂ ಸಾಕಷ್ಟು ಪೂರ್ಣ ವರ್ಷಗಳ ವರದಿ ಇಲ್ಲ.",
    loading: "ಆವಕದ ಮಾಹಿತಿ ಲೋಡ್ ಆಗುತ್ತಿದೆ", failed: "ಆವಕದ ಮಾಹಿತಿ ಲೋಡ್ ಆಗಲಿಲ್ಲ.", retry: "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",
    months: (from: number, to: number) => from === to ? MONTH_NAMES_KN[from - 1] : `${MONTH_NAMES_KN[from - 1]}–${MONTH_NAMES_KN[to - 1]}`,
  },
});

/** One shared, slowly refreshed copy of the recent arrivals for the town and home pages. */
const useRecentArrivals = () => useQuery({ queryKey: ["arrivals", "recent"], queryFn: api.recentArrivals, staleTime: 10 * 60_000 });

const townForMarket = (market: string) => MARKET_PLACES.find((place) => place.apmc === market);
/** Kannada names for the districts and the arrival markets that have no town page, as the arrival reports name them. */
const DISTRICT_KN = new Map([...MARKET_PLACES.map((place) => [place.district.en, place.district.kn] as const), ...Object.entries({
  "Bengaluru South": "ಬೆಂಗಳೂರು ದಕ್ಷಿಣ", Chamarajanagar: "ಚಾಮರಾಜನಗರ", Chikkaballapur: "ಚಿಕ್ಕಬಳ್ಳಾಪುರ", Chikkamagaluru: "ಚಿಕ್ಕಮಗಳೂರು", Chitradurga: "ಚಿತ್ರದುರ್ಗ",
  "Dakshina Kannada": "ದಕ್ಷಿಣ ಕನ್ನಡ", Davangere: "ದಾವಣಗೆರೆ", Hassan: "ಹಾಸನ", Haveri: "ಹಾವೇರಿ", Kodagu: "ಕೊಡಗು", Mandya: "ಮಂಡ್ಯ", Mysuru: "ಮೈಸೂರು",
  Shivamogga: "ಶಿವಮೊಗ್ಗ", Tumakuru: "ತುಮಕೂರು", Udupi: "ಉಡುಪಿ", "Uttara Kannada": "ಉತ್ತರ ಕನ್ನಡ", Bagalkot: "ಬಾಗಲಕೋಟೆ", Ramanagara: "ರಾಮನಗರ",
})]);
const MARKET_KN: Record<string, string> = {
  Holalkere: "ಹೊಳಲ್ಕೆರೆ", Kadur: "ಕಡೂರು", Gonikappal: "ಗೋಣಿಕೊಪ್ಪಲು", Arakalgud: "ಅರಕಲಗೂಡು", Periyapatna: "ಪಿರಿಯಾಪಟ್ಟಣ", Honnali: "ಹೊನ್ನಾಳಿ",
  Chitradurga: "ಚಿತ್ರದುರ್ಗ", "K.R.Nagar": "ಕೆ.ಆರ್. ನಗರ", "K.R. Pet": "ಕೆ.ಆರ್. ಪೇಟೆ", Davangere: "ದಾವಣಗೆರೆ", Sira: "ಶಿರಾ", Huliyar: "ಹುಳಿಯಾರು",
  Turvekere: "ತುರುವೇಕೆರೆ", Chamarajanagar: "ಚಾಮರಾಜನಗರ", Mudigere: "ಮೂಡಿಗೆರೆ", Karkala: "ಕಾರ್ಕಳ", Madikeri: "ಮಡಿಕೇರಿ", Kundapura: "ಕುಂದಾಪುರ",
  Holenarsipura: "ಹೊಳೆನರಸೀಪುರ", Byadagi: "ಬ್ಯಾಡಗಿ", Somvarpet: "ಸೋಮವಾರಪೇಟೆ", Tumakuru: "ತುಮಕೂರು", Hiriyur: "ಹಿರಿಯೂರು", Mysuru: "ಮೈಸೂರು",
  Arasikere: "ಅರಸೀಕೆರೆ", Ramanagara: "ರಾಮನಗರ", Tiptur: "ತಿಪಟೂರು", Gubbi: "ಗುಬ್ಬಿ", Chikkamagaluru: "ಚಿಕ್ಕಮಗಳೂರು", Gauribidanur: "ಗೌರಿಬಿದನೂರು",
  Haliyala: "ಹಳಿಯಾಳ", Hanagal: "ಹಾನಗಲ್", Hosadurga: "ಹೊಸದುರ್ಗ", Hunsur: "ಹುಣಸೂರು", Madhugiri: "ಮಧುಗಿರಿ", Mandya: "ಮಂಡ್ಯ", Kunigal: "ಕುಣಿಗಲ್",
  Badami: "ಬಾದಾಮಿ", Bhadravathi: "ಭದ್ರಾವತಿ",
};
const districtName = (district: string, language: Language) => language === "kn" ? DISTRICT_KN.get(district) ?? district : district;
/** A market as readers know it: the town page's name when there is one ("Shivamogga" for "Shimoga APMC"), else the source's. */
function marketLabel(market: string, language: Language) {
  const town = townForMarket(market);
  if (town) return language === "kn" ? town.kn : town.en;
  const place = market.replace(/\s*APMC\s*/i, " ").trim();
  return language === "kn" && MARKET_KN[place] ? MARKET_KN[place] : placeName(place, language);
}

/** Seven bars for the week ending on the latest report date; a day without a report keeps an empty slot. */
function WeekBars({ data, market, row }: { data: RecentArrivals; market: string; row: RecentMarketArrivals }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const days = Array.from({ length: 7 }, (_, index) => addDays(data.week!.from, index));
  const byDate = new Map(row.days.map((day) => [day.date, day.quintals]));
  const max = Math.max(...row.days.map((day) => day.quintals), 1);
  return <figure className="arrivals-week" aria-label={copy.weekAria(market)}>
    <figcaption>{copy.week}</figcaption>
    <ol className="arrivals-bars">
      {days.map((date) => {
        const value = byDate.get(date);
        const label = value === undefined ? `${formatDate(date, language)}: ${copy.noDay}` : copy.dayBar(formatDate(date, language), qtl(value));
        return <li key={date} title={label} aria-label={label} className={value === undefined ? "is-empty" : date === data.latest_date ? "is-latest" : undefined}>
          <span className="arrivals-bar" style={{ blockSize: value === undefined ? undefined : `${Math.max(6, (value / max) * 100)}%` }} />
          <span className="arrivals-day" aria-hidden="true">{Number(date.slice(8, 10))}</span>
        </li>;
      })}
    </ol>
  </figure>;
}

/** Town page: today's arrivals at the town's APMC, against its usual day, with the last 7 days. Hidden when there is nothing recent. */
export function TownArrivals({ place }: { place: MarketPlace }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const query = useRecentArrivals();
  const headingId = useId();
  const data = query.data;
  const row = place.apmc ? data?.markets.find((market) => market.market === place.apmc) : undefined;
  // Nothing reported in the last 7 days: no strip, rather than a figure weeks old.
  if (!place.apmc || !data?.latest_date || !row || row.week_days === 0) return null;
  const market = copy.apmc(language === "kn" ? place.kn : place.en);
  const reported = row.latest_quintals !== null;
  const value = reported ? row.latest_quintals! : row.last_quintals;
  const status = pace(value, row.usual_quintals);
  return <section className="rate-card arrivals-strip" aria-labelledby={headingId}>
    <div className="arrivals-main">
      <span className="arrivals-icon" aria-hidden="true"><Truck size={18} /></span>
      <div className="arrivals-copy">
        <h2 id={headingId}>{copy.arrivalsAt(market)}</h2>
        <p className="arrivals-figure"><strong>{qtl(value)}</strong> <span>{copy.quintals}</span>
          <span className="arrivals-when">{when(reported ? data.latest_date : row.last_date, language)}</span></p>
        {!reported && <p className="arrivals-note">{copy.noReport(when(data.latest_date, language))}</p>}
      </div>
    </div>
    {(status || row.week_days > 0) && <div className="arrivals-pace">
      {status && <span className={`arrivals-chip is-${status}`}>{copy[status]}</span>}
      {row.usual_quintals !== null && <span className="arrivals-usual">{copy.usualDay(qtl(row.usual_quintals))}</span>}
      <span className="arrivals-usual">{copy.weekTotal(qtl(row.week_quintals), row.week_days)}</span>
    </div>}
    <WeekBars data={data} market={market} row={row} />
    <p className="arrivals-source">{copy.source}</p>
  </section>;
}

/** Seven slim bars, one per day of the week shown; the latest report day is the dark one, a day with no report a dot. */
function Sparkline({ data, row, label }: { data: RecentArrivals; row: RecentMarketArrivals; label: string }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const days = Array.from({ length: 7 }, (_, index) => addDays(data.week!.from, index));
  const byDate = new Map(row.days.map((day) => [day.date, day.quintals]));
  const max = Math.max(...row.days.map((day) => day.quintals), 1);
  const spoken = days.map((date) => `${formatDate(date, language)} ${byDate.has(date) ? `${qtl(byDate.get(date)!)} ${copy.qtl}` : copy.noDay}`).join(", ");
  return <span className="arrivals-spark" role="img" aria-label={copy.sparkAria(label, spoken)}>
    {days.map((date) => {
      const value = byDate.get(date);
      return <span key={date} className={value === undefined ? "is-empty" : date === data.latest_date ? "is-latest" : undefined}
        style={value === undefined ? undefined : { blockSize: `${Math.max(12, (value / max) * 100)}%` }} />;
    })}
  </span>;
}

/**
 * Home page: the markets with the most arrivals in the last 7 days as a small market board. Each row: the market, its
 * week day by day, whether the week runs busier or quieter than its usual day, the latest day, and the week's total
 * with its size against the leader. The reader's town is marked, and added when outside the top rows.
 */
export function ArrivalsLeaders({ town, limit = 6 }: { town?: MarketPlace; limit?: number }) {
  const { language } = useLanguage();
  const copy = COPY[language];
  const query = useRecentArrivals();
  const data = query.data;
  if (query.isPending) return <section className="home-price-section" aria-label={copy.leadersTitle}><SkeletonRows label={copy.loading} rows={3} /></section>;
  if (!data?.week || !data.state || !data.latest_date || data.markets.length < 3) return null;
  const latest = data.latest_date;
  const leaders = data.markets.slice(0, limit);
  const mine = town?.apmc ? data.markets.findIndex((row) => row.market === town.apmc) : -1;
  const rows = mine >= limit ? [...leaders, data.markets[mine]] : leaders;
  const max = leaders[0].week_quintals || 1;
  const change = data.state.previous_week_quintals > 0 ? Math.round((data.state.week_quintals / data.state.previous_week_quintals - 1) * 100) : null;
  return <section className="home-price-section" aria-labelledby="arrivals-leaders-heading">
    <div className="home-section-heading"><h2 id="arrivals-leaders-heading">{copy.leadersTitle}</h2>
      <p>{copy.leadersHint(formatDate(data.week.from, language), formatDate(data.week.to, language))}</p></div>
    <div className="rate-card arrivals-leaders">
      {/* Column names for wide screens; each row also carries its own labels, so this stays out of the reading order. */}
      <div className="arrivals-leaders-head" aria-hidden="true"><span /><span>{copy.columns.market}</span><span>{copy.columns.week}</span>
        <span>{copy.columns.pace}</span><span>{copy.columns.total}</span></div>
      <ol aria-label={copy.leadersAria}>
        {rows.map((row) => {
          const rank = data.markets.indexOf(row) + 1;
          const place = townForMarket(row.market);
          const isMine = Boolean(town?.apmc && row.market === town.apmc);
          const name = marketLabel(row.market, language);
          // The week's average report day against the market's usual day: steadier than one day for a whole-state board.
          const status = row.week_days ? pace(row.week_quintals / row.week_days, row.usual_quintals) : null;
          return <li key={row.market} className={[rank === 1 ? "is-first" : "", isMine ? "is-mine" : ""].filter(Boolean).join(" ") || undefined}>
            <span className="arrivals-rank" aria-hidden="true">{rank}</span>
            <span className="arrivals-name">
              {place ? <Link to={marketPath(place.slug)}>{name}</Link> : <span>{name}</span>}
              <small>{isMine ? copy.yourTown : row.district ? districtName(row.district, language) : ""}</small>
            </span>
            <Sparkline data={data} row={row} label={name} />
            <span className="arrivals-status">
              {/* Phones show the short word ("Busier"); the full phrase stays for screen readers and wider screens. */}
              {status ? <span className={`arrivals-chip is-${status}`} title={copy[status]}><span className="chip-long">{copy[status]}</span>
                <span className="chip-short" aria-hidden="true">{status === "busy" ? "↑ " : status === "quiet" ? "↓ " : ""}{copy.short[status]}</span></span>
                : <span className="arrivals-chip is-none" aria-hidden="true">–</span>}
              <small>{row.latest_quintals !== null ? copy.latestValue(shortWhen(latest, language), qtl(row.latest_quintals)) : copy.noLatest(shortWhen(latest, language))}</small>
            </span>
            <span className="arrivals-total">
              <span className="arrivals-value"><strong>{qtl(row.week_quintals)}</strong> <span>{copy.sevenDays}</span></span>
              <span className="arrivals-meter" aria-hidden="true"><span style={{ inlineSize: `${Math.max(3, (row.week_quintals / max) * 100)}%` }} /></span>
            </span>
          </li>;
        })}
      </ol>
      <footer className="arrivals-leaders-foot">
        <span>{copy.stateWeek(qtl(data.state.week_quintals))}{change !== null && <> · {copy.vsLastWeek(change)}</>}</span>
        <a className="rate-source" href={data.source.url} target="_blank" rel="noreferrer">KRAMA<ExternalLink size={14} aria-hidden="true" /></a>
      </footer>
    </div>
  </section>;
}

/** Sell or wait: the season pattern for Karnataka or one town's APMC, with the next two months in words. */
export function ArrivalSeasonCard() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const myTown = useMyTown();
  const towns = MARKET_PLACES.filter((place) => place.apmc).sort((a, b) => a.en.localeCompare(b.en));
  const [market, setMarket] = useState<string>(myTown?.apmc ?? "");
  // The saved town is only a starting point: a reader's own choice is never overridden.
  const [chosen, setChosen] = useState(false);
  const query = useQuery({ queryKey: ["arrivals", "season", market], queryFn: () => api.arrivalSeason(market || undefined), staleTime: 30 * 60_000, placeholderData: (previous) => previous });
  const data = query.data;
  const selectId = useId();
  const place = market ? (language === "kn" ? townForMarket(market)?.kn : townForMarket(market)?.en) ?? market : copy.allKarnataka;
  const categories = Array.from({ length: 12 }, (_, index) => monthName(index + 1, language));
  const ready = data && data.share.filter((item) => item.median !== null).length === 12;
  // A saved town's market with too few complete years falls back to the whole state, unless the reader picked it.
  const settled = !query.isPlaceholderData && !query.isFetching;
  useEffect(() => {
    if (!chosen && market && settled && data && !ready) setMarket("");
  }, [chosen, market, settled, data, ready]);
  const nowMonth = data?.latest_date ? Number(data.latest_date.slice(5, 7)) : null;
  const ahead = (() => {
    if (!ready || !nowMonth) return null;
    const now = data.share[nowMonth - 1].median!, next = (data.share[nowMonth % 12].median! + data.share[(nowMonth + 1) % 12].median!) / 2;
    return next >= now * 1.15 ? copy.ahead.rise : next <= now * 0.85 ? copy.ahead.ease : copy.ahead.steady;
  })();
  const like = data?.like_for_like;
  return <section className="rate-card arrivals-season" aria-labelledby="arrivals-season-heading" aria-busy={query.isFetching}>
    <header className="arrivals-season-head">
      <div><h2 id="arrivals-season-heading">{copy.seasonTitle}</h2><p className="rate-caption">{copy.seasonHint}</p></div>
      <label className="fx-select arrivals-scope" htmlFor={selectId}><span>{copy.scope}</span>
        <select id={selectId} value={market} onChange={(event) => { setChosen(true); setMarket(event.target.value); }}>
          <option value="">{copy.allKarnataka}</option>
          {towns.map((town) => <option key={town.slug} value={town.apmc}>{copy.apmc(language === "kn" ? town.kn : town.en)}</option>)}
        </select></label>
    </header>
    {query.isPending ? <SkeletonRows label={copy.loading} rows={4} /> : query.isError && !data ? <ErrorState error={new Error(copy.failed)} retryLabel={copy.retry} onRetry={() => void query.refetch()} />
      : !ready ? <p className="rate-empty">{copy.notEnough}</p> : <>
      <dl className="arrivals-facts">
        {data.peak_month && <div><dt>{copy.busiest}</dt><dd>{monthName(data.peak_month, language, true)}</dd>
          <dd className="arrivals-fact-sub">{copy.shareOfYear(data.share[data.peak_month - 1].median!)}</dd></div>}
        {data.quiet_month && <div><dt>{copy.quietest}</dt><dd>{monthName(data.quiet_month, language, true)}</dd>
          <dd className="arrivals-fact-sub">{copy.shareOfYear(data.share[data.quiet_month - 1].median!)}</dd></div>}
        {like && <div><dt>{copy.thisYear}</dt><dd className={like.change_percent > 0 ? "is-up" : like.change_percent < 0 ? "is-down" : undefined}>
          {like.change_percent > 0 ? "+" : like.change_percent < 0 ? "−" : ""}{Math.abs(Math.round(like.change_percent))}%</dd>
          <dd className="arrivals-fact-sub">{copy.likeForLike(copy.months(1, like.through_month), like.previous_year, like.markets)}</dd></div>}
      </dl>
      {ahead && <p className="arrivals-ahead">{ahead}</p>}
      <LineSeriesChart categories={categories} valueFormat="percent" zeroBased height={280} description={copy.seasonDescription(place)}
        series={[
          { name: copy.typical, values: data.share.map((item) => item.median), markers: true },
          ...(data.previous_share ? [{ name: String(data.previous_share.year), values: data.previous_share.values, dotted: true }] : []),
        ]}
        band={{ name: copy.range, lower: data.share.map((item) => item.low), upper: data.share.map((item) => item.high) }}
        regions={nowMonth ? [{ from: categories[nowMonth - 1], to: categories[nowMonth - 1], label: copy.now }] : []} />
      <p className="rate-caption">{copy.yearsUsed(data.years_used[0], data.years_used.at(-1)!, data.years_used.length)} {copy.source}</p>
    </>}
  </section>;
}
