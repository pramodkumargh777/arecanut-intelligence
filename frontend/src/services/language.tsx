import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { formatDate, formatMonth, formatTimestamp, type Language } from "./formatting";

export { formatDate, formatMonth, formatTimestamp };

export type { Language };

const STORAGE_KEY = "ani-language";

function storedLanguage(): Language {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "kn";
  } catch {
    return "kn";
  }
}

/** Exported so tests can render a page in a chosen language without touching browser storage. */
export const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void }>({ language: "kn", setLanguage: () => undefined });

/** Kannada is the default for growers. Every page is available in both languages, and the choice is remembered per browser. */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(storedLanguage);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  function setLanguage(next: Language) {
    setLanguageState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* The choice still applies until the page is closed. */ }
  }
  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  return <div className="language-toggle" role="group" aria-label="Language / ಭಾಷೆ">
    <button type="button" lang="kn" aria-pressed={language === "kn"} onClick={() => setLanguage("kn")}>ಕನ್ನಡ</button>
    <button type="button" lang="en" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button>
  </div>;
}

/** Reporting-date age for a reader. The date itself is always shown beside it. */
export function ageText(days: number, language: Language): string {
  if (language === "kn") return days <= 0 ? "ಇಂದು" : days === 1 ? "ನಿನ್ನೆ" : `${days} ದಿನಗಳ ಹಿಂದೆ`;
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * Both languages side by side. The Kannada block is checked against the English one, so a missing or misspelt key is a
 * type error rather than an untranslated sentence in production.
 */
export function defineCopy<T extends object>(copy: { en: T; kn: NoInfer<Text<T>> }): { en: Text<T>; kn: Text<T> } {
  return copy as { en: Text<T>; kn: Text<T> };
}

/** The shape of a copy block with every string widened, so a phrase chosen by a condition is still just text. */
export type Text<T> = T extends string ? string
  : T extends (...args: infer A) => infer R ? (...args: A) => Text<R>
  : T extends object ? { [K in keyof T]: Text<T[K]> } : T;

/** The current language's half of a `defineCopy` block. */
export function useCopy<T>(copy: { en: T; kn: T }): T {
  return copy[useLanguage().language];
}

/** Date, month and time formatters bound to the reader's language. */
export function useFormat() {
  const { language } = useLanguage();
  return {
    language,
    date: (value: string | null | undefined, missing = language === "kn" ? "ಲಭ್ಯವಿಲ್ಲ" : "Unavailable") => value ? formatDate(value, language) : missing,
    month: (value: string) => formatMonth(value, language),
    timestamp: (value: string) => formatTimestamp(value, language),
    age: (days: number) => ageText(days, language),
  };
}
