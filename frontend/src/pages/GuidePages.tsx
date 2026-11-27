import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { balancedColumns } from "./MarketPage";
import { GUIDE_PATH, RASHI_CHALI_GUIDE, VARIETY_HUB_TEXT } from "../services/guides";
import { useLanguage } from "../services/language";
import { COOPERATIVE_NAMES } from "../services/markets";
import { varietyPath } from "../services/seo-pages";
import { VARIETIES, VARIETY_GROUPS } from "../services/varieties";

/**
 * Every grade the cooperatives publish, grouped as the rates screen groups them, in the town directory's layout (one
 * card per group, one row per grade naming the sources that publish it). Each row opens that grade's rates page.
 */
export function VarietyHubPage() {
  const { language } = useLanguage();
  const copy = VARIETY_HUB_TEXT[language];
  const groups = VARIETY_GROUPS.map((group) => ({ group, items: VARIETIES.filter((variety) => variety.group === group.key) }));
  return <div className="page-stack home market-page" lang={language}>
    <section className="home-heading market-directory-head"><div><h1>{copy.title}</h1><p>{copy.intro}</p></div></section>
    <nav className="home-actions" aria-label={copy.guide}>
      <Link to={GUIDE_PATH}><strong>{copy.guide}</strong><span>{copy.guideHint}</span><ArrowRight size={18} aria-hidden="true" /></Link>
    </nav>
    <div className="market-districts">
      {balancedColumns(groups, (item) => 1.25 + item.items.length).map((column, index) => <div className="market-column" key={index}>
        {column.map(({ group, items }) => <section className="market-district" key={group.key} aria-labelledby={`group-${group.key}`}>
          <header className="market-district-head">
            <h2 id={`group-${group.key}`}>{language === "kn" ? group.kn : group.en}</h2>
            <span className="market-district-count">{copy.count(items.length)}</span>
          </header>
          <ul className="market-rows">{items.map((variety) => {
            const sources = (["mamcos", "tss", "tms"] as const).filter((source) => variety.labels[source]?.length).map((source) => COOPERATIVE_NAMES[source].en);
            return <li key={variety.key}><Link to={varietyPath(variety.key)}>
              <span className="market-row-name"><strong>{language === "kn" ? variety.kn : variety.en}</strong></span>
              <span className="market-row-sources" lang="en">{sources.map((source) => <span key={source} data-source={source.toLowerCase()}>{source}</span>)}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link></li>;
          })}</ul>
        </section>)}
      </div>)}
    </div>
    <p className="panel-note">{copy.sources}</p>
  </div>;
}

/** Rashi and Chali side by side: how each is made, its grades and where it goes, every statement from TSS's pages. */
export function RashiChaliGuidePage() {
  const { language } = useLanguage();
  const guide = RASHI_CHALI_GUIDE;
  return <div className="page-stack home" lang={language}>
    <section className="home-heading"><h1>{guide.title[language]}</h1><p>{guide.intro[language]}</p></section>
    {guide.sections.map((section) => <article className="panel" key={section.heading.en}>
      <div className="panel-heading"><div><h2>{section.heading[language]}</h2></div></div>
      <p className="guide-text">{section.text[language]}</p>
    </article>)}
    <article className="panel">
      <div className="panel-heading"><div><h2>{guide.table.heading[language]}</h2></div></div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={guide.table.heading[language]}>
        <table className="guide-table">
          <thead><tr><th scope="col"><span className="sr-only">{guide.table.heading[language]}</span></th><th scope="col">{guide.table.columns.rashi[language]}</th><th scope="col">{guide.table.columns.chali[language]}</th></tr></thead>
          <tbody>{guide.table.rows.map((row) => <tr key={row.label.en}><th scope="row">{row.label[language]}</th><td>{row.rashi[language]}</td><td>{row.chali[language]}</td></tr>)}</tbody>
        </table>
      </div>
    </article>
    <article className="panel">
      <div className="panel-heading"><div><h2>{guide.prices.heading[language]}</h2></div></div>
      <p className="guide-text">{guide.prices.text[language]}</p>
    </article>
    <nav className="home-actions" aria-label={guide.links[language]}>
      <Link to={varietyPath("rashi")}><strong>{language === "kn" ? "ರಾಶಿ ಅಡಿಕೆ ಧಾರಣೆ" : "Rashi arecanut price"}</strong><span>{guide.links[language]}</span><ArrowRight size={18} aria-hidden="true" /></Link>
      <Link to={varietyPath("chali")}><strong>{language === "kn" ? "ಚಾಲಿ ಅಡಿಕೆ ಧಾರಣೆ" : "Chali arecanut price"}</strong><span>{guide.links[language]}</span><ArrowRight size={18} aria-hidden="true" /></Link>
    </nav>
    <p className="panel-note">{guide.sourcesHeading[language]}: {guide.sources.map((source, index) => <span key={source.url}>{index ? ", " : ""}<a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a></span>)}</p>
  </div>;
}
