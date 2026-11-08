import { ArrowRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useLanguage } from "../services/language";

const COPY = {
  en: {
    title: "Page not found",
    body: (path: string) => `There is no page at ${path}. The link may be old or mistyped.`,
    home: "Latest rates", prices: "Explore prices",
  },
  kn: {
    title: "ಪುಟ ಸಿಗಲಿಲ್ಲ",
    body: (path: string) => `${path} ಎಂಬ ಪುಟ ಇಲ್ಲ. ಲಿಂಕ್ ಹಳೆಯದಾಗಿರಬಹುದು ಅಥವಾ ತಪ್ಪಾಗಿರಬಹುದು.`,
    home: "ಇತ್ತೀಚಿನ ಧಾರಣೆ", prices: "ಮಾರುಕಟ್ಟೆ ದರಗಳು",
  },
} as const;

/** Shown for unknown addresses instead of silently redirecting, so a broken link is visible as one. */
export function NotFoundPage() {
  const { language } = useLanguage();
  const { pathname } = useLocation();
  const copy = COPY[language];
  return <div className="page-stack home" lang={language}>
    <section className="home-heading"><h1>{copy.title}</h1><p>{copy.body(pathname)}</p></section>
    <nav className="home-actions" aria-label={copy.title}>
      <Link to="/"><strong>{copy.home}</strong><ArrowRight size={18} aria-hidden="true" /></Link>
      <Link to="/prices"><strong>{copy.prices}</strong><ArrowRight size={18} aria-hidden="true" /></Link>
    </nav>
  </div>;
}
