import { useLanguage, type Language } from "./language";

/**
 * The site's name in each language. Kannada readers see ಅಡಿಕೆ ನಾಡಿ ("the pulse of arecanut"), the Kannada form of
 * Areca Pulse; the logo artwork has the English name drawn into it, so the Kannada name is always live text.
 */
export const BRAND: Record<Language, { name: string; descriptor: string }> = {
  en: { name: "Areca Pulse", descriptor: "Market Intelligence" },
  kn: { name: "ಅಡಿಕೆ ನಾಡಿ", descriptor: "ಧಾರಣೆ, ಏರಿಳಿತ, ಸುದ್ದಿ" },
};

export const brandLabel = (language: Language) => `${BRAND[language].name} · ${BRAND[language].descriptor}`;

/** The two-tone wordmark: the second word carries the leaf accent. */
export function BrandName() {
  const { language } = useLanguage();
  const [first, second] = BRAND[language].name.split(" ");
  return <>{first} <span className="brand-name-accent">{second}</span></>;
}
