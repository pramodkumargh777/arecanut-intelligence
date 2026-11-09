import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { defineCopy, useCopy, useLanguage } from "../services/language";
import type { Trade } from "../services/modules";

const COPY = defineCopy({
  en: {
    title: "Arecanut imports into India",
    context: "Imported nut competes with Indian arecanut, so yearly import totals help explain price moves.",
    tonnes: "tonnes", inYear: (year: string) => `in ${year}`,
    change: (percent: string, year: string) => `${percent} on ${year}`,
    top: "Largest sources", years: "Imports by financial year",
    source: "Source: DASD and Department of Commerce, financial years (April–March). Published once a year.",
  },
  kn: {
    title: "ಭಾರತಕ್ಕೆ ಅಡಿಕೆ ಆಮದು",
    context: "ಆಮದಾದ ಅಡಿಕೆ ದೇಶೀಯ ಅಡಿಕೆಯೊಂದಿಗೆ ಸ್ಪರ್ಧಿಸುತ್ತದೆ, ಹಾಗಾಗಿ ವಾರ್ಷಿಕ ಆಮದು ದರ ಬದಲಾವಣೆ ಅರಿಯಲು ನೆರವಾಗುತ್ತದೆ.",
    tonnes: "ಟನ್", inYear: (year: string) => `${year}ರಲ್ಲಿ`,
    change: (percent: string, year: string) => `${year}ಕ್ಕಿಂತ ${percent}`,
    top: "ಪ್ರಮುಖ ಮೂಲ ದೇಶಗಳು", years: "ಆರ್ಥಿಕ ವರ್ಷವಾರು ಆಮದು",
    source: "ಮೂಲ: DASD ಮತ್ತು ವಾಣಿಜ್ಯ ಇಲಾಖೆ, ಆರ್ಥಿಕ ವರ್ಷ (ಏಪ್ರಿಲ್–ಮಾರ್ಚ್). ವರ್ಷಕ್ಕೊಮ್ಮೆ ಪ್ರಕಟ.",
  },
});

const COUNTRIES: Record<string, string> = { Bangladesh: "ಬಾಂಗ್ಲಾದೇಶ", Bhutan: "ಭೂತಾನ್", Indonesia: "ಇಂಡೋನೇಷ್ಯಾ", Myanmar: "ಮ್ಯಾನ್ಮಾರ್", "Sri Lanka": "ಶ್ರೀಲಂಕಾ", UAE: "ಯುಎಇ" };
const TOTAL = "All partners (including others)";

/** Yearly import totals with the change on the year before and the largest partners: context for prices, not a forecast. */
export function ImportsPanel() {
  const t = useCopy(COPY);
  const { language } = useLanguage();
  const query = useQuery({ queryKey: ["intelligence", "trade"], queryFn: () => api.intelligence<Trade>("trade"), staleTime: 3_600_000 });
  const imports = (query.data?.data ?? []).filter((row) => row.direction === "Import");
  const totals = [...new Map(imports.filter((row) => row.partner === TOTAL && row.quantity_tonnes !== null).map((row) => [row.period, row])).values()]
    .sort((a, b) => a.period.localeCompare(b.period));
  const latest = totals.at(-1), previous = totals.at(-2);
  // Without a published total there is nothing honest to summarise, so the panel stays out of the way.
  if (!latest) return null;
  const tonnes = (value: number) => Math.round(value).toLocaleString("en-IN");
  const change = previous?.quantity_tonnes ? (latest.quantity_tonnes! - previous.quantity_tonnes) / previous.quantity_tonnes * 100 : null;
  const peak = Math.max(...totals.map((row) => row.quantity_tonnes!));
  const top = imports.filter((row) => row.period === latest.period && row.partner !== TOTAL && row.quantity_tonnes)
    .sort((a, b) => b.quantity_tonnes! - a.quantity_tonnes!).filter((row, index, all) => all.findIndex((other) => other.partner === row.partner) === index).slice(0, 3);
  const country = (name: string) => language === "kn" ? COUNTRIES[name] ?? name : name;
  return <section className="panel imports-panel" aria-labelledby="imports-title">
    <div className="imports-head">
      <div>
        <h2 id="imports-title">{t.title}</h2>
        <p className="imports-context phone-hide">{t.context}</p>
      </div>
      <div className="imports-figure">
        <strong>{tonnes(latest.quantity_tonnes!)} <small>{t.tonnes}</small></strong>
        <span>{t.inYear(latest.period)}{change !== null && previous && <> · <b>{t.change(`${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(0)}%`, previous.period)}</b></>}</span>
      </div>
    </div>
    <div className="imports-bars" role="img" aria-label={`${t.years}: ${totals.map((row) => `${row.period} ${tonnes(row.quantity_tonnes!)} ${t.tonnes}`).join(", ")}`}>
      {totals.map((row) => <div key={row.period} className={row === latest ? "imports-bar imports-bar-latest" : "imports-bar"}>
        <span className="imports-bar-plot">
          <span className="imports-bar-value">{Math.round(row.quantity_tonnes! / 1000)}k</span>
          <span className="imports-bar-fill" style={{ height: `${Math.max(5, row.quantity_tonnes! / peak * 80)}%` }} />
        </span>
        <span className="imports-bar-year">{row.period}</span>
      </div>)}
    </div>
    {top.length > 0 && <p className="imports-top"><span>{t.top} ({latest.period}):</span> {top.map((row) => `${country(row.partner)} ${tonnes(row.quantity_tonnes!)}`).join(" · ")} {t.tonnes}</p>}
    <p className="imports-source"><a href={latest.source_url} target="_blank" rel="noreferrer">{t.source}</a></p>
  </section>;
}
