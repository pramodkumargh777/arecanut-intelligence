import { Link, useLocation } from "react-router-dom";
import brandIcon from "../assets/areca-pulse-icon.svg";
import darkLogo from "../assets/areca-pulse-logo-dark.svg";
import { defineCopy, useLanguage } from "../services/language";
import { useTheme } from "../services/theme";

/** WhatsApp number (country code, no plus) that receives reports of wrong prices or missing markets. */
const REPORT_WHATSAPP = "918660862841";

const COPY = defineCopy({
  en: {
    reportTitle: "Spotted a wrong price or a missing market?",
    reportText: "Message us on WhatsApp. Reports from growers help keep every rate right.",
    reportButton: "Chat on WhatsApp",
    reportAria: "Report a wrong price or missing market on WhatsApp (opens WhatsApp)",
    reportMessage: (url: string) => `Hi Areca Pulse, I want to report a wrong price or missing market:\n\n\nPage: ${url}`,
    tagline: "Know the market. See the opportunity.",
    made: "Daily arecanut rates for growers in Karnataka, in Kannada and English.",
    rates: "Rates", tools: "Tools", sources: "Data sources",
    links: { "/": "Latest rates", "/prices": "Explore prices", "/analytics": "Price trends", "/compare": "Compare markets",
      "/sell-or-hold": "Sell or wait", "/assistant": "Ask a question", "/intelligence": "Market intelligence" } as Record<string, string>,
    sourceNotes: { MAMCOS: "Cooperative, Shivamogga", TSS: "Cooperative, Sirsi", TUMCOS: "Cooperative, Channagiri", AGMARKNET: "APMC markets, data.gov.in" } as Record<string, string>,
    disclaimer: "Rates as each source publishes them, with the report date. Areca Pulse is independent, not affiliated with any cooperative or APMC. Market information only, not financial advice.",
    region: "Karnataka, India",
  },
  kn: {
    reportTitle: "ದರ ತಪ್ಪಾಗಿದೆಯೇ ಅಥವಾ ಮಾರುಕಟ್ಟೆ ಕಾಣುತ್ತಿಲ್ಲವೇ?",
    reportText: "ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಸಂದೇಶ ಕಳುಹಿಸಿ. ಬೆಳೆಗಾರರ ಮಾಹಿತಿಯಿಂದ ಪ್ರತಿ ದರ ಸರಿಯಾಗಿರುತ್ತದೆ.",
    reportButton: "ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ತಿಳಿಸಿ",
    reportAria: "ತಪ್ಪು ದರ ಅಥವಾ ಕಾಣದ ಮಾರುಕಟ್ಟೆಯನ್ನು ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ತಿಳಿಸಿ (ವಾಟ್ಸಾಪ್ ತೆರೆಯುತ್ತದೆ)",
    reportMessage: (url: string) => `ನಮಸ್ಕಾರ Areca Pulse, ತಪ್ಪು ದರ ಅಥವಾ ಕಾಣದ ಮಾರುಕಟ್ಟೆ ಬಗ್ಗೆ ತಿಳಿಸಲು ಬಯಸುತ್ತೇನೆ:\n\n\nಪುಟ: ${url}`,
    tagline: "ಮಾರುಕಟ್ಟೆ ತಿಳಿಯಿರಿ. ಅವಕಾಶ ಗುರುತಿಸಿ.",
    made: "ಕರ್ನಾಟಕದ ಅಡಿಕೆ ಬೆಳೆಗಾರರಿಗೆ ದಿನದ ಧಾರಣೆ, ಕನ್ನಡ ಮತ್ತು ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ.",
    rates: "ದರಗಳು", tools: "ಸಾಧನಗಳು", sources: "ದತ್ತಾಂಶ ಮೂಲಗಳು",
    links: { "/": "ಇತ್ತೀಚಿನ ಧಾರಣೆ", "/prices": "ಮಾರುಕಟ್ಟೆ ದರಗಳು", "/analytics": "ದರ ಪ್ರವೃತ್ತಿ", "/compare": "ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ",
      "/sell-or-hold": "ಮಾರಬೇಕೇ, ಕಾಯಬೇಕೇ", "/assistant": "ಪ್ರಶ್ನೆ ಕೇಳಿ", "/intelligence": "ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ" } as Record<string, string>,
    sourceNotes: { MAMCOS: "ಸಹಕಾರಿ ಸಂಘ, ಶಿವಮೊಗ್ಗ", TSS: "ಸಹಕಾರಿ ಸಂಘ, ಶಿರಸಿ", TUMCOS: "ಸಹಕಾರಿ ಸಂಘ, ಚನ್ನಗಿರಿ", AGMARKNET: "ಎಪಿಎಂಸಿ ಮಾರುಕಟ್ಟೆಗಳು, data.gov.in" } as Record<string, string>,
    disclaimer: "ದರಗಳು ಮೂಲ ಪ್ರಕಟಿಸಿದಂತೆಯೇ, ವರದಿ ದಿನಾಂಕದೊಂದಿಗೆ. Areca Pulse ಸ್ವತಂತ್ರ ತಾಣ, ಯಾವುದೇ ಸಹಕಾರಿ ಸಂಘ ಅಥವಾ ಎಪಿಎಂಸಿಗೆ ಸಂಬಂಧಿಸಿಲ್ಲ. ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ ಮಾತ್ರ, ಹಣಕಾಸು ಸಲಹೆ ಅಲ್ಲ.",
    region: "ಕರ್ನಾಟಕ, ಭಾರತ",
  },
});

const RATE_LINKS = ["/", "/prices", "/analytics", "/compare"];
const TOOL_LINKS = ["/sell-or-hold", "/assistant", "/intelligence"];
const SOURCES = ["MAMCOS", "TSS", "TUMCOS", "AGMARKNET"];

/** The WhatsApp mark, drawn inline so it takes the button's colour and needs no extra request. */
function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
  </svg>;
}

export function SiteFooter() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const theme = useTheme();
  const location = useLocation();
  // The page address goes into the message, so a report says which rates it is about.
  const page = `${typeof window === "undefined" ? "" : window.location.origin}${location.pathname}${location.search}`;
  const whatsapp = `https://wa.me/${REPORT_WHATSAPP}?text=${encodeURIComponent(copy.reportMessage(page))}`;
  return <footer className="site-footer" lang={language}>
    <div className="site-footer-inner">
      <section className="footer-report" aria-labelledby="footer-report-title">
        <span className="footer-report-badge" aria-hidden="true"><WhatsAppIcon size={22} /></span>
        <div className="footer-report-text"><h2 id="footer-report-title">{copy.reportTitle}</h2><p>{copy.reportText}</p></div>
        <a className="footer-whatsapp" href={whatsapp} target="_blank" rel="noreferrer" aria-label={copy.reportAria}>
          <WhatsAppIcon /><strong>{copy.reportButton}</strong></a>
      </section>

      <div className="footer-grid">
        <div className="footer-brand">
          <Link to="/" className="footer-logo" aria-label="Areca Pulse">
            <img className={`footer-logo-mark${theme === "dark" ? " footer-logo-mark-dark" : ""}`} src={theme === "dark" ? darkLogo : brandIcon} alt="" />
            <span lang="en"><span className="footer-logo-name">Areca <span className="brand-name-accent">Pulse</span></span><span className="footer-logo-descriptor">Market Intelligence</span></span>
          </Link>
          <p className="footer-tagline">{copy.tagline}</p>
          <p className="footer-made">{copy.made}</p>
        </div>
        <nav className="footer-column" aria-labelledby="footer-rates"><h2 id="footer-rates">{copy.rates}</h2>
          <ul>{RATE_LINKS.map((to) => <li key={to}><Link to={to}>{copy.links[to]}</Link></li>)}</ul></nav>
        <nav className="footer-column" aria-labelledby="footer-tools"><h2 id="footer-tools">{copy.tools}</h2>
          <ul>{TOOL_LINKS.map((to) => <li key={to}><Link to={to}>{copy.links[to]}</Link></li>)}</ul></nav>
        <div className="footer-column"><h2>{copy.sources}</h2>
          <ul className="footer-sources">{SOURCES.map((name) => <li key={name}><span lang="en">{name}</span><small>{copy.sourceNotes[name]}</small></li>)}</ul></div>
      </div>

      <p className="footer-disclaimer">{copy.disclaimer}</p>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Areca Pulse</span>
        <span>{copy.region}</span>
      </div>
    </div>
  </footer>;
}
