import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, MapPin } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { calendarDateToTime, calendarTodayIST, DAY_MS, formatCalendarDate, formatPeriodKannada } from "../../../shared/dates";
import { DEFAULT_COMMODITY } from "../../../shared/commodities";
import { AboutData } from "../components/AboutData";
import { ShareButton } from "../components/ShareButton";
import { ErrorState, SkeletonRows } from "../components/State";
import { api } from "../services/api";
import type { CooperativeQuote, CooperativeSource } from "../services/cooperative";
import { ageText, defineCopy, type Language, useLanguage } from "../services/language";
import { COOPERATIVE_NAMES, COOPERATIVE_ORDER, MARKET_PLACES, MARKETS_PATH, marketBySlug, marketPath, sortByCatalogue, varietyForLabel, type MarketPlace } from "../services/markets";
import { varietyPath } from "../services/seo-pages";
import { shareMessage } from "../services/share";
import type { PriceObservation } from "../types";
import { NotFoundPage } from "./NotFoundPage";

/** APMC rows are looked for over the same window as the cooperative branch rates. */
const WINDOW_DAYS = 45;

const COPY = defineCopy({
  kn: {
    title: (place: string) => `${place} ಅಡಿಕೆ ಧಾರಣೆ`,
    intro: (district: string) => `${district} ಜಿಲ್ಲೆ. ಪ್ರತಿ ಮೂಲದ ಇತ್ತೀಚಿನ ದರ, ತಳಿವಾರು, ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ. ಪ್ರತಿ ದರಕ್ಕೂ ಅದರದೇ ವರದಿ ದಿನಾಂಕ ಇದೆ.`,
    branch: (source: string, place: string) => `${source} · ${place} ಶಾಖೆ`,
    coopBasis: "ಶಾಖೆಯ ಸರಾಸರಿ ದರ · ಕನಿಷ್ಠ – ಗರಿಷ್ಠ",
    tssBasis: "ಟೆಂಡರ್ ಸರಾಸರಿ ದರ · ಕನಿಷ್ಠ – ಗರಿಷ್ಠ",
    tumcosBasis: "ಸರಾಸರಿ ದರ · ತಳಿ ತಿಳಿಸಿಲ್ಲ",
    apmc: (name: string) => `ಎಪಿಎಂಸಿ · ${name}`,
    apmcBasis: "AGMARKNET · ಮೋಡಲ್ ದರ · ಕನಿಷ್ಠ – ಗರಿಷ್ಠ",
    noRates: (days: number) => `ಕಳೆದ ${days} ದಿನಗಳಲ್ಲಿ ಪ್ರಕಟಿತ ದರ ಇಲ್ಲ.`,
    unstated: "ಅಡಿಕೆ (ತಳಿ ತಿಳಿಸಿಲ್ಲ)",
    grade: "ದರ್ಜೆ",
    loading: "ದರಗಳನ್ನು ತರಲಾಗುತ್ತಿದೆ", failed: "ದರಗಳನ್ನು ತರಲಾಗಲಿಲ್ಲ.", retry: "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",
    source: "ಮೂಲ", allRates: "ಎಲ್ಲ ದರಗಳು",
    nearby: (district: string) => `${district} ಜಿಲ್ಲೆಯ ಇತರ ಊರುಗಳು`, allTowns: "ಎಲ್ಲ ಊರುಗಳು",
    share: "ಹಂಚಿಕೊಳ್ಳಿ", shareOpening: "ತೆರೆಯುತ್ತಿದೆ…", shareDone: "ಹಂಚಿಕೊಳ್ಳಲಾಗಿದೆ", shareWhatsapp: "ವಾಟ್ಸಾಪ್ ತೆರೆಯಿತು",
    shareAria: (place: string) => `${place} ಅಡಿಕೆ ಧಾರಣೆ ಹಂಚಿಕೊಳ್ಳಿ`,
    shareMore: (count: number) => `…ಇನ್ನೂ ${count} ದರಗಳು`,
    shareNote: "ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್ ದರ, ಮೂಲ ಪ್ರಕಟಿಸಿದಂತೆ. ನಿಮ್ಮ ಸರಕಿನ ದರ ಬೇರೆಯಾಗಬಹುದು.",
    about: "ಈ ದರಗಳ ಬಗ್ಗೆ",
    aboutText: "ಸಹಕಾರಿ ಸಂಘದ ಶಾಖೆಯ ಸರಾಸರಿ, ಟಿಎಸ್‌ಎಸ್ ಟೆಂಡರ್ ಸರಾಸರಿ ಮತ್ತು ಎಪಿಎಂಸಿ ಮೋಡಲ್ ದರ ಬೇರೆ ಬೇರೆ ಬೆಲೆಗಳು. ಅವುಗಳನ್ನು ಪಕ್ಕಪಕ್ಕ ತೋರಿಸಲಾಗಿದೆ, ಒಟ್ಟುಗೂಡಿಸಿಲ್ಲ.",
    aboutUnit: "ಟಿಎಸ್‌ಎಸ್ ಮತ್ತು ಟಮ್ಕೋಸ್ ಘಟಕವನ್ನು ತಿಳಿಸುವುದಿಲ್ಲ; ಅವುಗಳ ದರಗಳನ್ನು ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್ ಎಂದು ಓದಲಾಗಿದೆ.",
    indexTitle: "ಊರಿನ ಅಡಿಕೆ ಧಾರಣೆ",
    indexIntro: "ನಿಮ್ಮ ಊರನ್ನು ಆರಿಸಿ. ಪ್ರತಿ ಪುಟದಲ್ಲಿ ಅಲ್ಲಿನ ಸಹಕಾರಿ ಸಂಘ ಮತ್ತು ಎಪಿಎಂಸಿ ದರಗಳು ಇವೆ.",
    district: (name: string) => `${name} ಜಿಲ್ಲೆ`,
  },
  en: {
    title: (place: string) => `${place} arecanut rates`,
    intro: (district: string) => `${district} district. The latest rate from each source, by variety, per quintal. Every rate shows its own report date.`,
    branch: (source: string, place: string) => `${source} · ${place} branch`,
    coopBasis: "Branch average · minimum – maximum",
    tssBasis: "Tender average · minimum – maximum",
    tumcosBasis: "Average · variety not stated",
    apmc: (name: string) => `APMC · ${name}`,
    apmcBasis: "AGMARKNET · modal price · minimum – maximum",
    noRates: (days: number) => `No published rate in the last ${days} days.`,
    unstated: "Arecanut (variety not stated)",
    grade: "Grade",
    loading: "Loading rates", failed: "Rates could not be loaded.", retry: "Try again",
    source: "Source", allRates: "All rates",
    nearby: (district: string) => `Other towns in ${district}`, allTowns: "All towns",
    share: "Share", shareOpening: "Opening…", shareDone: "Shared", shareWhatsapp: "WhatsApp opened",
    shareAria: (place: string) => `Share ${place} arecanut rates`,
    shareMore: (count: number) => `…and ${count} more rate${count === 1 ? "" : "s"}`,
    shareNote: "Per quintal, as each source publishes it. The rate for your lot can differ.",
    about: "About these rates",
    aboutText: "A cooperative branch average, a TSS tender average and an APMC modal price are different prices. They are shown side by side, never combined.",
    aboutUnit: "TSS and TUMCOS do not state a unit; their rates are read as per quintal.",
    indexTitle: "Arecanut rates by town",
    indexIntro: "Choose your town. Each page has that town's cooperative and APMC rates.",
    district: (name: string) => `${name} district`,
  },
});

const rupees = (value: number | null) => value === null ? "—" : `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const dateText = (date: string, language: Language) => language === "kn" ? formatPeriodKannada(date) : formatCalendarDate(date);
const ageDays = (date: string, today: string) => Math.round((calendarDateToTime(today) - calendarDateToTime(date)) / DAY_MS);
const placeLabel = (place: MarketPlace, language: Language) => language === "kn" ? place.kn : place.en;

/** One row per variety and grade: the market's latest report of each. Rows arrive newest first. */
function latestApmcRows(rows: PriceObservation[], market: string) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.variety_name}|${row.grade ?? ""}`;
    if (row.market_name !== market || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type Line = { key: string; name: string; to?: string; label?: string; date: string; price: number | null; minimum: number | null; maximum: number | null };

function RateLines({ lines, today, language }: { lines: Line[]; today: string; language: Language }) {
  return <ul className="rate-list">{lines.map((line) => {
    const age = ageDays(line.date, today);
    return <li className="rate-row" key={line.key}>
      <div className="rate-place">
        <strong>{line.to ? <Link to={line.to} className="market-variety-link">{line.name}</Link> : line.name}</strong>
        <span className="rate-meta"><span className={`rate-date${age > 2 ? " rate-date-old" : ""}`}>{dateText(line.date, language)} <span className="rate-age">{ageText(age, language)}</span></span>
          {line.label && <span className="rate-label" lang="en">{line.label}</span>}</span>
      </div>
      <div className="rate-price"><strong>{rupees(line.price)}</strong>
        {line.minimum !== null && line.maximum !== null && <span className="rate-sub"><span className="rate-range">{rupees(line.minimum)} – {rupees(line.maximum)}</span></span>}</div>
    </li>;
  })}</ul>;
}

function coopLines(source: CooperativeSource, rows: CooperativeQuote[], language: Language, unstated: string): Line[] {
  return sortByCatalogue(source, rows).map((row) => {
    const variety = varietyForLabel(source, row.variety);
    const name = source === "tumcos" ? unstated : variety ? (language === "kn" ? variety.kn : variety.en) : row.variety;
    return { key: row.id, name, to: variety ? varietyPath(variety.key) : undefined, label: source === "tumcos" ? undefined : row.variety,
      date: row.reporting_date, price: row.average_price, minimum: row.minimum_price, maximum: row.maximum_price };
  });
}

export function MarketPage() {
  const { slug } = useParams();
  const place = marketBySlug(slug);
  const { language } = useLanguage();
  const copy = COPY[language];
  const today = calendarTodayIST();
  const from = new Date(calendarDateToTime(today) - (WINDOW_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  const sources = place ? COOPERATIVE_ORDER.filter((source) => place.branches[source]) : [];
  const coop = useQueries({ queries: sources.map((source) => ({
    queryKey: ["branch-latest", source, place?.branches[source]],
    queryFn: () => api.branchLatest(source, place!.branches[source]!),
    refetchInterval: 300_000,
  })) });
  const apmc = useQuery({
    queryKey: ["market-apmc", place?.apmc, from],
    queryFn: () => api.prices({ commodity: DEFAULT_COMMODITY, q: place!.apmc, from, limit: "200", sort: "reporting_date", order: "desc", include_count: "false" }),
    enabled: Boolean(place?.apmc),
    refetchInterval: 300_000,
  });
  if (!place) return <NotFoundPage />;

  const name = placeLabel(place, language);
  const district = language === "kn" ? place.district.kn : place.district.en;
  const neighbours = MARKET_PLACES.filter((other) => other.district.en === place.district.en && other.slug !== place.slug);
  const shareLabels = { share: copy.share, opening: copy.shareOpening, shared: copy.shareDone, whatsapp: copy.shareWhatsapp };
  const apmcLines: Line[] = place.apmc ? latestApmcRows(apmc.data?.data ?? [], place.apmc).map((row) => ({
    key: row.id, name: row.variety_name, label: row.grade ? `${copy.grade}: ${row.grade}` : undefined,
    date: row.reporting_date, price: row.modal_price, minimum: row.minimum_price, maximum: row.maximum_price,
  })) : [];
  const allLines = [
    ...sources.flatMap((source, index) => coopLines(source, coop[index]?.data?.data ?? [], language, copy.unstated).map((line) => ({ ...line, source: COOPERATIVE_NAMES[source][language] }))),
    ...apmcLines.map((line) => ({ ...line, source: "APMC" })),
  ];
  const newest = allLines.reduce<string | null>((latest, line) => !latest || line.date > latest ? line.date : latest, null);

  return <div className="page-stack home market-page" lang={language}>
    <section className="home-heading">
      <p className="market-kicker"><MapPin size={15} aria-hidden="true" />{district}</p>
      <h1>{copy.title(name)}</h1>
      <p>{copy.intro(district)}</p>
      {allLines.length > 0 && <div className="market-share"><ShareButton labels={shareLabels} ariaLabel={copy.shareAria(name)} title={copy.title(name)} message={() => shareMessage({
        title: copy.title(name), date: newest ? dateText(newest, language) : undefined,
        lines: allLines.map((line) => ({ place: `${line.source} · ${line.name}`, price: rupees(line.price), date: line.date !== newest ? dateText(line.date, language) : undefined })),
        more: copy.shareMore, note: copy.shareNote, url: `${window.location.origin}${marketPath(place.slug)}`,
      })} /></div>}
    </section>

    <div className="rate-grid">
      {sources.map((source, index) => {
        const query = coop[index];
        const names = COOPERATIVE_NAMES[source];
        const rows = query?.data?.data ?? [];
        const basis = source === "tss" ? copy.tssBasis : source === "tumcos" ? copy.tumcosBasis : copy.coopBasis;
        return <section className="rate-card rate-card-coop" key={source} aria-labelledby={`market-${source}`}>
          <header className="rate-card-head">
            <div><h2 id={`market-${source}`} className="market-card-title">{copy.branch(language === "kn" ? names.kn : names.en, name)}</h2><span className="rate-card-basis">{basis}</span></div>
            {rows[0] && <a className="rate-source" href={rows[0].source_url} target="_blank" rel="noreferrer">{copy.source}<ExternalLink size={13} aria-hidden="true" /></a>}
          </header>
          {query?.isPending ? <SkeletonRows label={copy.loading} rows={3} /> : query?.isError ? <ErrorState error={new Error(copy.failed)} retryLabel={copy.retry} onRetry={() => void query.refetch()} />
            : rows.length ? <RateLines lines={coopLines(source, rows, language, copy.unstated)} today={today} language={language} /> : <p className="rate-empty">{copy.noRates(WINDOW_DAYS)}</p>}
          <footer className="rate-card-foot"><Link to={`/prices?feed=${source}`}>{copy.allRates} <ArrowRight size={14} aria-hidden="true" /></Link></footer>
        </section>;
      })}
      {place.apmc && <section className="rate-card" aria-labelledby="market-apmc">
        <header className="rate-card-head"><div><h2 id="market-apmc" className="market-card-title">{copy.apmc(name)}</h2><span className="rate-card-basis">{copy.apmcBasis}</span></div></header>
        {apmc.isPending ? <SkeletonRows label={copy.loading} rows={2} /> : apmc.isError ? <ErrorState error={new Error(copy.failed)} retryLabel={copy.retry} onRetry={() => void apmc.refetch()} />
          : apmcLines.length ? <RateLines lines={apmcLines} today={today} language={language} /> : <p className="rate-empty">{copy.noRates(WINDOW_DAYS)}</p>}
        <footer className="rate-card-foot"><Link to="/prices?feed=official">{copy.allRates} <ArrowRight size={14} aria-hidden="true" /></Link></footer>
      </section>}
    </div>

    <nav className="home-price-section" aria-labelledby="market-nearby">
      <div className="home-section-heading"><h2 id="market-nearby">{neighbours.length ? copy.nearby(district) : copy.allTowns}</h2></div>
      <ul className="market-chips">
        {neighbours.map((other) => <li key={other.slug}><Link to={marketPath(other.slug)}>{placeLabel(other, language)}</Link></li>)}
        <li><Link to={MARKETS_PATH} className="market-chip-all">{copy.allTowns} <ArrowRight size={14} aria-hidden="true" /></Link></li>
      </ul>
    </nav>

    <AboutData title={copy.about}><p>{copy.aboutText}</p><p>{copy.aboutUnit}</p></AboutData>
  </div>;
}

/** Every town, grouped by district, so a grower finds their own market in one look. */
export function MarketIndexPage() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const districts = [...new Map(MARKET_PLACES.map((place) => [place.district.en, place.district])).values()];
  return <div className="page-stack home market-page" lang={language}>
    <section className="home-heading"><h1>{copy.indexTitle}</h1><p>{copy.indexIntro}</p></section>
    {districts.map((district) => {
      const places = MARKET_PLACES.filter((place) => place.district.en === district.en);
      const id = `district-${district.en.toLowerCase().replace(/\s+/g, "-")}`;
      return <section className="home-price-section" key={district.en} aria-labelledby={id}>
        <div className="home-section-heading"><h2 id={id}>{copy.district(language === "kn" ? district.kn : district.en)}</h2></div>
        <ul className="market-index">{places.map((place) => {
          const sources = [...COOPERATIVE_ORDER.filter((source) => place.branches[source]).map((source) => COOPERATIVE_NAMES[source].en), ...(place.apmc ? ["APMC"] : [])];
          return <li key={place.slug}><Link to={marketPath(place.slug)}>
            <strong>{placeLabel(place, language)}</strong>
            <span lang="en">{sources.join(" · ")}</span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link></li>;
        })}</ul>
      </section>;
    })}
  </div>;
}
