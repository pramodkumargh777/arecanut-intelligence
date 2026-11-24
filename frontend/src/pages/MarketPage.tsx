import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ExternalLink, MapPin } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { calendarDateToTime, calendarTodayIST, DAY_MS, formatCalendarDate, formatPeriodKannada } from "../../../shared/dates";
import { DEFAULT_COMMODITY } from "../../../shared/commodities";
import { AboutData } from "../components/AboutData";
import { TownArrivals } from "../components/MarketArrivals";
import { PageFaq } from "../components/PageFaq";
import { ShareButton } from "../components/ShareButton";
import { ErrorState, SkeletonRows } from "../components/State";
import { api } from "../services/api";
import type { CooperativeQuote, CooperativeSource } from "../services/cooperative";
import { ageText, defineCopy, type Language, useLanguage } from "../services/language";
import { CARD_VARIETIES, COOPERATIVE_NAMES, COOPERATIVE_ORDER, MARKET_PLACES, MARKETS_PATH, marketBySlug, marketPath, sortByCatalogue, varietyForLabel, type MarketPlace } from "../services/markets";
import { varietyPath } from "../services/seo-pages";
import { setMyTown, useMyTown } from "../services/myTown";
import { apmcCatalogueOrder } from "../services/agmarknetVarieties";
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
    indexTitle: "ಊರಿನ ಅಡಿಕೆ ಧಾರಣೆ",
    indexIntro: "ನಿಮ್ಮ ಊರನ್ನು ಆರಿಸಿ. ಪ್ರತಿ ಪುಟದಲ್ಲಿ ಅಲ್ಲಿನ ಸಹಕಾರಿ ಸಂಘ ಮತ್ತು ಎಪಿಎಂಸಿ ದರಗಳು ಇವೆ.",
    mine: "ನಿಮ್ಮ ಊರು",
    townCount: (count: number) => `${count} ಊರು${count === 1 ? "" : "ಗಳು"}`,
    district: (name: string) => `${name} ಜಿಲ್ಲೆ`,
    showAll: (count: number) => `ಎಲ್ಲ ${count} ತಳಿಗಳನ್ನು ತೋರಿಸಿ`, showFewer: "ಕಡಿಮೆ ತೋರಿಸಿ",
    saveTown: "ಇದು ನನ್ನ ಊರು", savedTown: "ನನ್ನ ಊರು", savedTownHint: "ಮುಖಪುಟದಲ್ಲಿ ಈ ಊರಿನ ದರ ಮೊದಲು ಕಾಣುತ್ತದೆ. ಮತ್ತೆ ಒತ್ತಿದರೆ ತೆಗೆಯುತ್ತದೆ.",
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
    indexTitle: "Arecanut rates by town",
    indexIntro: "Choose your town. Each page has that town's cooperative and APMC rates.",
    mine: "Your town",
    townCount: (count: number) => `${count} town${count === 1 ? "" : "s"}`,
    district: (name: string) => `${name} district`,
    showAll: (count: number) => `Show all ${count} varieties`, showFewer: "Show fewer",
    saveTown: "Set as my town", savedTown: "My town", savedTownHint: "The home page shows this town's rate first. Tap again to remove.",
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

/**
 * A source's rates: the first three varieties in catalogue order (Rashi, Chali, Sippe gotu, …), the rest one tap away
 * under "Show all", so every card opens the same short height whichever source it is.
 */
function RateLines({ lines, today, language }: { lines: Line[]; today: string; language: Language }) {
  const [open, setOpen] = useState(false);
  const copy = COPY[language];
  const shown = open ? lines : lines.slice(0, CARD_VARIETIES);
  return <>{rateList(shown, today, language)}
    {lines.length > CARD_VARIETIES && <button type="button" className="rate-more-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      {open ? copy.showFewer : copy.showAll(lines.length)}<ChevronDown size={16} aria-hidden="true" /></button>}</>;
}

function rateList(lines: Line[], today: string, language: Language) {
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
  const myTown = useMyTown();
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
  const apmcLines: Line[] = place.apmc ? apmcCatalogueOrder(latestApmcRows(apmc.data?.data ?? [], place.apmc)).map((row) => ({
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
      {/* The way back to the town list, where the eyebrow sat; the district is in the line under the title. */}
      <Link className="market-back" to={MARKETS_PATH}><ArrowLeft size={16} aria-hidden="true" />{copy.allTowns}</Link>
      <h1>{copy.title(name)}</h1>
      <p>{copy.intro(district)}</p>
      <div className="market-actions">
      <button type="button" className={`my-town-save${myTown?.slug === place.slug ? " is-saved" : ""}`} aria-pressed={myTown?.slug === place.slug}
        title={copy.savedTownHint} onClick={() => setMyTown(myTown?.slug === place.slug ? null : place.slug)}>
        {myTown?.slug === place.slug ? <Check size={16} aria-hidden="true" /> : <MapPin size={16} aria-hidden="true" />}
        {myTown?.slug === place.slug ? copy.savedTown : copy.saveTown}</button>
      {allLines.length > 0 && <div className="market-share"><ShareButton labels={shareLabels} ariaLabel={copy.shareAria(name)} title={copy.title(name)} message={() => shareMessage({
        title: copy.title(name), date: newest ? dateText(newest, language) : undefined,
        lines: allLines.map((line) => ({ place: `${line.source} · ${line.name}`, price: rupees(line.price), date: line.date !== newest ? dateText(line.date, language) : undefined })),
        more: copy.shareMore, note: copy.shareNote, url: `${window.location.origin}${marketPath(place.slug)}`,
      })} /></div>}
      </div>
    </section>

    {/* How busy the town's APMC is: the latest day's arrivals, before the rates a grower checks next. */}
    <TownArrivals place={place} />

    {/* Cards stretch to one height, so their "All rates" footers sit on one line however many varieties each lists. */}
    <div className="rate-grid rate-grid-even">
      {sources.map((source, index) => {
        const query = coop[index];
        const names = COOPERATIVE_NAMES[source];
        const rows = query?.data?.data ?? [];
        const basis = source === "tss" || source === "tms" ? copy.tssBasis : source === "tumcos" ? copy.tumcosBasis : copy.coopBasis;
        // Not .rate-card-coop: that hides the card header on phones, where home-page rows name their source instead.
        // Rows here do not, so the header ("MAMCOS · Sagara branch") is the source and must show on every screen.
        return <section className="rate-card" data-source={source} key={source} aria-labelledby={`market-${source}`}>
          <header className="rate-card-head">
            <div><h2 id={`market-${source}`} className="market-card-title">{copy.branch(language === "kn" ? names.kn : names.en, name)}</h2><span className="rate-card-basis">{basis}</span></div>
            {rows[0] && <a className="rate-source" href={rows[0].source_url} target="_blank" rel="noreferrer">{copy.source}<ExternalLink size={14} aria-hidden="true" /></a>}
          </header>
          {query?.isPending ? <SkeletonRows label={copy.loading} rows={3} /> : query?.isError ? <ErrorState error={new Error(copy.failed)} retryLabel={copy.retry} onRetry={() => void query.refetch()} />
            : rows.length ? <RateLines lines={coopLines(source, rows, language, copy.unstated)} today={today} language={language} /> : <p className="rate-empty">{copy.noRates(WINDOW_DAYS)}</p>}
          <footer className="rate-card-foot"><Link to={`/prices?feed=${source}`}>{copy.allRates} <ArrowRight size={14} aria-hidden="true" /></Link></footer>
        </section>;
      })}
      {place.apmc && <section className="rate-card" data-source="apmc" aria-labelledby="market-apmc">
        <header className="rate-card-head"><div><h2 id="market-apmc" className="market-card-title">{copy.apmc(name)}</h2><span className="rate-card-basis">{copy.apmcBasis}</span></div></header>
        {apmc.isPending ? <SkeletonRows label={copy.loading} rows={2} /> : apmc.isError ? <ErrorState error={new Error(copy.failed)} retryLabel={copy.retry} onRetry={() => void apmc.refetch()} />
          : apmcLines.length ? <RateLines lines={apmcLines} today={today} language={language} /> : <p className="rate-empty">{copy.noRates(WINDOW_DAYS)}</p>}
        <footer className="rate-card-foot"><Link to="/prices?feed=official">{copy.allRates} <ArrowRight size={14} aria-hidden="true" /></Link></footer>
      </section>}
    </div>

    {/* Nearby towns: the heading carries "All towns" at its right, so the chips stay one row (scrolling sideways on phones). */}
    <nav className="home-price-section market-nearby" aria-labelledby="market-nearby">
      <div className="market-nearby-head">
        <h2 id="market-nearby">{neighbours.length ? copy.nearby(district) : copy.allTowns}</h2>
        <Link to={MARKETS_PATH} className="market-nearby-all">{copy.allTowns} <ArrowRight size={14} aria-hidden="true" /></Link>
      </div>
      {neighbours.length > 0 && <ul className="market-chips">
        {neighbours.map((other) => <li key={other.slug}><Link to={marketPath(other.slug)}>{placeLabel(other, language)}</Link></li>)}
      </ul>}
    </nav>

    <AboutData title={copy.about}><p>{copy.aboutText}</p></AboutData>
    <PageFaq path={marketPath(place.slug)} />
  </div>;
}

/**
 * Every town, grouped by district, as a compact directory: one card per district, one row per town naming its sources,
 * the cards set in columns so the whole list fits in about one screen on a computer. The saved town leads, beside the
 * heading, and is marked in its district.
 */
/**
 * Districts split into two columns of as near equal height as possible (a district is its heading plus one row per
 * town), each keeping the catalogue's order. The last card in each column stretches, so both columns end level.
 */
export function balancedColumns<T>(items: T[], size: (item: T) => number): [T[], T[]] {
  let best: [T[], T[]] = [items, []];
  let bestGap = Infinity, bestOrder = Infinity;
  for (let mask = 0; mask < 1 << items.length; mask += 1) {
    const left = items.filter((_, index) => !(mask & (1 << index)));
    const right = items.filter((_, index) => mask & (1 << index));
    if (!left.length || !right.length) continue;
    const gap = Math.abs(left.reduce((sum, item) => sum + size(item), 0) - right.reduce((sum, item) => sum + size(item), 0));
    // The first district always leads the left column; between equally even splits, the one keeping more of the
    // catalogue's order on the left wins, so the columns read top to bottom as the list does.
    const order = left.reduce((sum, item) => sum + items.indexOf(item), 0);
    if (items.indexOf(left[0]) === 0 && (gap < bestGap - 1e-9 || (Math.abs(gap - bestGap) < 1e-9 && order < bestOrder))) { best = [left, right]; bestGap = gap; bestOrder = order; }
  }
  return best;
}

export function MarketIndexPage() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const myTown = useMyTown();
  const districts = [...new Map(MARKET_PLACES.map((place) => [place.district.en, place.district])).values()];
  return <div className="page-stack home market-page" lang={language}>
    <section className="home-heading market-directory-head">
      <div><h1>{copy.indexTitle}</h1><p>{copy.indexIntro}</p></div>
      {myTown && <Link className="market-mine" to={marketPath(myTown.slug)}>
        <MapPin size={16} aria-hidden="true" /><span>{copy.mine}</span><strong>{placeLabel(myTown, language)}</strong><ArrowRight size={16} aria-hidden="true" />
      </Link>}
    </section>
    <div className="market-districts">
      {balancedColumns(districts, (district) => 1.25 + MARKET_PLACES.filter((place) => place.district.en === district.en).length).map((column, index) => <div className="market-column" key={index}>
      {column.map((district) => {
        const places = MARKET_PLACES.filter((place) => place.district.en === district.en);
        const id = `district-${district.en.toLowerCase().replace(/\s+/g, "-")}`;
        return <section className="market-district" key={district.en} aria-labelledby={id}>
          <header className="market-district-head">
            <h2 id={id}>{copy.district(language === "kn" ? district.kn : district.en)}</h2>
            <span className="market-district-count">{copy.townCount(places.length)}</span>
          </header>
          <ul className="market-rows">{places.map((place) => {
            const sources = [...COOPERATIVE_ORDER.filter((source) => place.branches[source]).map((source) => COOPERATIVE_NAMES[source].en), ...(place.apmc ? ["APMC"] : [])];
            const mine = myTown?.slug === place.slug;
            return <li key={place.slug}><Link to={marketPath(place.slug)} className={mine ? "is-mine" : undefined} aria-current={mine ? "true" : undefined}>
              <span className="market-row-name"><strong>{placeLabel(place, language)}</strong>{mine && <span className="market-row-mine">{copy.mine}</span>}</span>
              <span className="market-row-sources" lang="en">{sources.map((source) => <span key={source} data-source={source.toLowerCase()}>{source}</span>)}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link></li>;
          })}</ul>
        </section>;
      })}
      </div>)}
    </div>
  </div>;
}
