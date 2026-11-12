import { useLanguage, type Language } from "./language";

/**
 * The site's name in each language. Kannada readers see ಅಡಿಕೆ ನಾಡಿ ("the pulse of arecanut"), the Kannada form of
 * Areca Pulse; the logo artwork has the English name drawn into it, so the Kannada name is always live text.
 */
export const BRAND: Record<Language, { name: string; descriptor: string }> = {
  en: { name: "Areca Pulse", descriptor: "Market Intelligence" },
  kn: { name: "ಅಡಿಕೆ ನಾಡಿ", descriptor: "ಧಾರಣೆ, ಏರಿಳಿತ, ಸುದ್ದಿ" },
};

/** Public contact details, shown in the footer. index.html's structured data and security.txt (vite.config.ts) repeat the email. */
export const CONTACT = {
  email: "contact@adikenaadi.com",
  /** Country code and number without the plus, as wa.me expects. */
  whatsapp: "918660862841",
  whatsappDisplay: "+91 86608 62841",
  domain: "adikenaadi.com",
} as const;

export const brandLabel =(language: Language) => `${BRAND[language].name} · ${BRAND[language].descriptor}`;

/** The two-tone wordmark: the second word carries the leaf accent. */
export function BrandName() {
  const { language } = useLanguage();
  const [first, second] = BRAND[language].name.split(" ");
  return <>{first} <span className="brand-name-accent">{second}</span></>;
}
