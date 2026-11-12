import type { Language } from "./formatting";

/**
 * Kannada names for the variety labels AGMARKNET (and the monthly reference built from it) reports. Only names with an
 * established Kannada form are listed; any other label is shown as the source spells it, never guessed. The source label
 * always stays the value sent to the API. The same names are used on the sell-or-hold page.
 */
const KANNADA: Record<string, string> = {
  Rashi: "ರಾಶಿ", Chali: "ಚಾಲಿ", "Hosa Chali": "ಹೊಸ ಚಾಲಿ", "Hale Chali": "ಹಳೆ ಚಾಲಿ", Bette: "ಬೆಟ್ಟೆ", Gorabalu: "ಗೊರಬಲು",
  Bilegotu: "ಬಿಳೇಗೋಟು", Kempugotu: "ಕೆಂಪುಗೋಟು", Saraku: "ಸರಕು", Sippegotu: "ಸಿಪ್ಪೆಗೋಟು", api: "ಅಪಿ", Churu: "ಚೂರು",
};
/** English display names where the source's own spelling reads poorly. */
const ENGLISH: Record<string, string> = { api: "Api" };

export function agmarknetVarietyName(label: string, language: Language) {
  return (language === "kn" ? KANNADA[label] : undefined) ?? ENGLISH[label] ?? label;
}
