import { Link, useLocation } from "react-router-dom";
import brandIcon from "../assets/areca-pulse-icon.svg";
import darkLogo from "../assets/areca-pulse-logo-dark.svg";
import { defineCopy, useLanguage } from "../services/language";
import { useTheme } from "../services/theme";
import { Mail } from "lucide-react";
import { BRAND, BrandName, CONTACT } from "../services/brand";

const COPY = defineCopy({
  en: {
    reportTitle: "Spotted a wrong price or a missing market?",
    reportText: "Message us on WhatsApp or write to us. Reports from growers help keep every rate right.",
    reportButton: "Chat on WhatsApp",
    reportAria: "Report a wrong price or missing market on WhatsApp (opens WhatsApp)",
    reportMessage: (url: string) => `Hi Areca Pulse, I want to report a wrong price or missing market:\n\n\nPage: ${url}`,
    emailButton: "Email us",
    emailAria: `Report a wrong price or missing market by email to ${CONTACT.email}`,
    emailSubject: "Wrong price or missing market",
    contact: "Contact", emailLabel: "Email", whatsappLabel: "WhatsApp",
    follow: "Follow Areca Pulse", onInstagram: (handle: string) => `Areca Pulse on Instagram, @${handle} (opens Instagram)`, onX: (handle: string) => `Areca Pulse on X, @${handle} (opens X)`,
    onYouTube: (handle: string) => `Areca Pulse on YouTube, @${handle} (opens YouTube)`,
    rights: "All rights reserved.",
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
    reportText: "ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಸಂದೇಶ ಕಳುಹಿಸಿ ಅಥವಾ ಇಮೇಲ್ ಮಾಡಿ. ಬೆಳೆಗಾರರ ಮಾಹಿತಿಯಿಂದ ಪ್ರತಿ ದರ ಸರಿಯಾಗಿರುತ್ತದೆ.",
    reportButton: "ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ತಿಳಿಸಿ",
    reportAria: "ತಪ್ಪು ದರ ಅಥವಾ ಕಾಣದ ಮಾರುಕಟ್ಟೆಯನ್ನು ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ತಿಳಿಸಿ (ವಾಟ್ಸಾಪ್ ತೆರೆಯುತ್ತದೆ)",
    reportMessage: (url: string) => `ನಮಸ್ಕಾರ ಅಡಿಕೆ ನಾಡಿ, ತಪ್ಪು ದರ ಅಥವಾ ಕಾಣದ ಮಾರುಕಟ್ಟೆ ಬಗ್ಗೆ ತಿಳಿಸಲು ಬಯಸುತ್ತೇನೆ:\n\n\nಪುಟ: ${url}`,
    emailButton: "ಇಮೇಲ್ ಮಾಡಿ",
    emailAria: `ತಪ್ಪು ದರ ಅಥವಾ ಕಾಣದ ಮಾರುಕಟ್ಟೆಯನ್ನು ${CONTACT.email} ಗೆ ಇಮೇಲ್ ಮೂಲಕ ತಿಳಿಸಿ`,
    emailSubject: "ತಪ್ಪು ದರ ಅಥವಾ ಕಾಣದ ಮಾರುಕಟ್ಟೆ",
    contact: "ಸಂಪರ್ಕ", emailLabel: "ಇಮೇಲ್", whatsappLabel: "ವಾಟ್ಸಾಪ್",
    follow: "ಅಡಿಕೆ ನಾಡಿಯನ್ನು ಅನುಸರಿಸಿ", onInstagram: (handle: string) => `ಇನ್‌ಸ್ಟಾಗ್ರಾಮ್‌ನಲ್ಲಿ ಅಡಿಕೆ ನಾಡಿ, @${handle} (ಇನ್‌ಸ್ಟಾಗ್ರಾಮ್ ತೆರೆಯುತ್ತದೆ)`, onX: (handle: string) => `X ನಲ್ಲಿ ಅಡಿಕೆ ನಾಡಿ, @${handle} (X ತೆರೆಯುತ್ತದೆ)`,
    onYouTube: (handle: string) => `ಯೂಟ್ಯೂಬ್‌ನಲ್ಲಿ ಅಡಿಕೆ ನಾಡಿ, @${handle} (ಯೂಟ್ಯೂಬ್ ತೆರೆಯುತ್ತದೆ)`,
    rights: "ಎಲ್ಲ ಹಕ್ಕುಗಳನ್ನು ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ.",
    tagline: "ಮಾರುಕಟ್ಟೆ ತಿಳಿಯಿರಿ. ಅವಕಾಶ ಗುರುತಿಸಿ.",
    made: "ಕರ್ನಾಟಕದ ಅಡಿಕೆ ಬೆಳೆಗಾರರಿಗೆ ದಿನದ ಧಾರಣೆ, ಕನ್ನಡ ಮತ್ತು ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ.",
    rates: "ದರಗಳು", tools: "ಸಾಧನಗಳು", sources: "ದತ್ತಾಂಶ ಮೂಲಗಳು",
    links: { "/": "ಇತ್ತೀಚಿನ ಧಾರಣೆ", "/prices": "ಮಾರುಕಟ್ಟೆ ದರಗಳು", "/analytics": "ದರ ಪ್ರವೃತ್ತಿ", "/compare": "ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ",
      "/sell-or-hold": "ಮಾರಬೇಕೇ, ಕಾಯಬೇಕೇ", "/assistant": "ಪ್ರಶ್ನೆ ಕೇಳಿ", "/intelligence": "ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ" } as Record<string, string>,
    sourceNotes: { MAMCOS: "ಸಹಕಾರಿ ಸಂಘ, ಶಿವಮೊಗ್ಗ", TSS: "ಸಹಕಾರಿ ಸಂಘ, ಶಿರಸಿ", TUMCOS: "ಸಹಕಾರಿ ಸಂಘ, ಚನ್ನಗಿರಿ", AGMARKNET: "ಎಪಿಎಂಸಿ ಮಾರುಕಟ್ಟೆಗಳು, data.gov.in" } as Record<string, string>,
    disclaimer: "ದರಗಳು ಮೂಲ ಪ್ರಕಟಿಸಿದಂತೆಯೇ, ವರದಿ ದಿನಾಂಕದೊಂದಿಗೆ. ಅಡಿಕೆ ನಾಡಿ ಸ್ವತಂತ್ರ ತಾಣ, ಯಾವುದೇ ಸಹಕಾರಿ ಸಂಘ ಅಥವಾ ಎಪಿಎಂಸಿಗೆ ಸಂಬಂಧಿಸಿಲ್ಲ. ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ ಮಾತ್ರ, ಹಣಕಾಸು ಸಲಹೆ ಅಲ್ಲ.",
    region: "ಕರ್ನಾಟಕ, ಭಾರತ",
  },
});

const RATE_LINKS = ["/", "/prices", "/analytics", "/compare"];
const TOOL_LINKS = ["/sell-or-hold", "/assistant", "/intelligence"];
const SOURCES = ["MAMCOS", "TSS", "TUMCOS", "AGMARKNET"];

/** Instagram and X marks, drawn inline like the WhatsApp one so they take the link's colour and need no extra request. */
function InstagramIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
    <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
  </svg>;
}
function XIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>;
}

function YouTubeIcon({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z" />
  </svg>;
}

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
  const whatsapp = `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(copy.reportMessage(page))}`;
  const reportEmail = `mailto:${CONTACT.email}?subject=${encodeURIComponent(copy.emailSubject)}&body=${encodeURIComponent(copy.reportMessage(page))}`;
  return <footer className="site-footer" lang={language}>
    <div className="site-footer-inner">
      <section className="footer-report" aria-labelledby="footer-report-title">
        <span className="footer-report-badge" aria-hidden="true"><WhatsAppIcon size={22} /></span>
        <div className="footer-report-text"><h2 id="footer-report-title">{copy.reportTitle}</h2><p>{copy.reportText}</p></div>
        <div className="footer-report-actions">
          <a className="footer-whatsapp" href={whatsapp} target="_blank" rel="noreferrer" aria-label={copy.reportAria}>
            <WhatsAppIcon /><strong>{copy.reportButton}</strong></a>
          <a className="footer-email" href={reportEmail} aria-label={copy.emailAria}>
            <Mail size={18} aria-hidden="true" /><strong>{copy.emailButton}</strong></a>
        </div>
      </section>

      <div className="footer-grid">
        <div className="footer-brand">
          <Link to="/" className="footer-logo" aria-label={BRAND[language].name}>
            <img className={`footer-logo-mark${theme === "dark" ? " footer-logo-mark-dark" : ""}`} src={theme === "dark" ? darkLogo : brandIcon} alt="" />
            <span lang={language}><span className="footer-logo-name"><BrandName /></span><span className="footer-logo-descriptor">{BRAND[language].descriptor}</span></span>
          </Link>
          <p className="footer-tagline">{copy.tagline}</p>
          <p className="footer-made">{copy.made}</p>
          <address className="footer-contact" aria-label={copy.contact}>
            <a href={`mailto:${CONTACT.email}`}><Mail size={16} aria-hidden="true" />
              <span className="sr-only">{copy.emailLabel}: </span><span translate="no" lang="en">{CONTACT.email}</span></a>
            <a href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noreferrer"><WhatsAppIcon size={16} />
              <span className="sr-only">{copy.whatsappLabel}: </span><span translate="no" lang="en">{CONTACT.whatsappDisplay}</span></a>
          </address>
          <ul className="footer-social" aria-label={copy.follow}>
            <li><a href={CONTACT.social.instagram.url} target="_blank" rel="noopener noreferrer" aria-label={copy.onInstagram(CONTACT.social.instagram.handle)}
              title={`@${CONTACT.social.instagram.handle}`}><InstagramIcon /></a></li>
            <li><a href={CONTACT.social.x.url} target="_blank" rel="noopener noreferrer" aria-label={copy.onX(CONTACT.social.x.handle)}
              title={`@${CONTACT.social.x.handle}`}><XIcon /></a></li>
            <li><a href={CONTACT.social.youtube.url} target="_blank" rel="noopener noreferrer" aria-label={copy.onYouTube(CONTACT.social.youtube.handle)}
              title={`@${CONTACT.social.youtube.handle}`}><YouTubeIcon /></a></li>
          </ul>
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
        <span>© {new Date().getFullYear()} {BRAND[language].name}. {copy.rights}</span>
        <span className="footer-bottom-meta"><span translate="no" lang="en">{CONTACT.domain}</span><span aria-hidden="true">·</span><span>{copy.region}</span></span>
      </div>
    </div>
  </footer>;
}
