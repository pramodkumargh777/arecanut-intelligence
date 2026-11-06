import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Language = "kn" | "en";

const STORAGE_KEY = "ani-language";

function storedLanguage(): Language {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "kn";
  } catch {
    return "kn";
  }
}

const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void }>({ language: "kn", setLanguage: () => undefined });

/** Kannada is the default for growers. Pages not yet translated stay in English, and the choice is remembered per browser. */
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
