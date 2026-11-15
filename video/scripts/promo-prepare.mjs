// Promo step 1: today's rates (for the real figures on screen) + the voice-over plan per language and scene.
//   out/promo-props-<lang>.json, out/promo-narration.json, out/promo-caption-<lang>.txt (the post's caption)
import { mkdirSync, writeFileSync } from "node:fs";
import { fetchRates } from "../src/data/rates.ts";
import { BAR_FRAMES, PROMO_CUTS, PROMO_MARKS, PROMO_MARKS_SHORT, PROMO_VOICE, PROMO_VOICE_SHORT, cutSuffix } from "../src/data/promoScript.ts";

// PROMO_CUT=30 or 15 (scripts/promo.sh 30) prepares a short cut; its files carry the suffix (-30 / -15).
const cut = process.env.PROMO_CUT ?? "full";
if (!PROMO_CUTS[cut]) throw new Error(`Unknown PROMO_CUT "${cut}" (use full, 30 or 15).`);
const suffix = cutSuffix(cut);
const scenes = PROMO_CUTS[cut];
const line = (lang, key) => (cut === "full" ? PROMO_VOICE[lang][key] : PROMO_VOICE_SHORT[lang][key] ?? PROMO_VOICE[lang][key]);

// First line is the hook (Instagram shows only a line or two before "more"); then what it does, where to go, sources.
const PROMO_CAPTION = {
  kn: [
    "ಅಡಿಕೆ ಧಾರಣೆಗೆ ಇನ್ನು ಹತ್ತು ಕಡೆ ಫೋನ್ ಬೇಡ 🌴",
    "",
    "ಅಡಿಕೆ ನಾಡಿ: ಬೆಳೆಗಾರರಿಗಾಗಿ ಕನ್ನಡದಲ್ಲಿ ಅಡಿಕೆ ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ.",
    "• MAMCOS, TSS, TUMCOS ಶಾಖೆಗಳ ಮತ್ತು ಎಪಿಎಂಸಿ ಧಾರಣೆ, ದಿನಾಂಕ ಸಮೇತ",
    "• ಏರಿಳಿತದ ಚಾರ್ಟ್, ಊರುಗಳ ಹೋಲಿಕೆ",
    "• ಮಾರಬೇಕಾ, ಕಾಯಬೇಕಾ: ಹಿಂದಿನ ವರ್ಷಗಳಲ್ಲಿ ಏನಾಗಿತ್ತು",
    "• ಕನ್ನಡದಲ್ಲೇ ಪ್ರಶ್ನೆ ಕೇಳಿ, ಮೂಲ ಸಮೇತ ಉತ್ತರ",
    "",
    "ಮಾರುವ ಮುನ್ನ ನೋಡಿ: https://adikenaadi.com",
    "ಮೂಲ: MAMCOS, TSS, TUMCOS ಪ್ರಕಟಿತ ದರಗಳು ಮತ್ತು AGMARKNET (data.gov.in).",
    "ಧ್ವನಿ: AI · ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ ಮಾತ್ರ, ಹಣಕಾಸು ಸಲಹೆ ಅಲ್ಲ.",
    "",
    "#ಅಡಿಕೆ #adike #arecanut #ಅಡಿಕೆಧಾರಣೆ #arecanutprice #adikerate #Shivamogga #Sirsi #Malnad",
  ].join("\n"),
  en: [
    "No more calling around for today's arecanut rate 🌴",
    "",
    "Areca Pulse: arecanut market information for growers, in Kannada and English.",
    "• Co-operative (MAMCOS, TSS, TUMCOS) and APMC rates, each with its date",
    "• Price trend charts and town-by-town comparison",
    "• Sell or wait: see what happened in past years",
    "• Ask in Kannada or English, answers with sources",
    "",
    "Check before you sell: https://adikenaadi.com",
    "Sources: MAMCOS, TSS and TUMCOS published rates, and AGMARKNET (data.gov.in).",
    "Voice: AI-generated · Market information only, not financial advice.",
    "",
    "#arecanut #arecanutprice #adike #ಅಡಿಕೆ #supari #Karnataka #Shivamogga #Sirsi #Malnad",
  ].join("\n"),
};

const at = (p) => new URL(`../${p}`, import.meta.url);
const langs = (process.env.LANGS ?? "kn en").split(/\s+/).filter((l) => l === "kn" || l === "en");
try {
  const data = await fetchRates(AbortSignal.timeout(30_000));
  mkdirSync(at("out/"), { recursive: true });
  const plan = { cut, suffix, langs: {} };
  // The cut's own scene list, used as is without voice; the voice step replaces it with voice-fitted lengths.
  const timeline = scenes.map((s) => ({ key: s.key, frames: Math.round(s.bars * BAR_FRAMES) }));
  for (const lang of langs) {
    writeFileSync(at(`out/promo-props-${lang}${suffix}.json`), JSON.stringify({ data, lang, cut, ...(cut === "full" ? {} : { timeline }) }));
    plan.langs[lang] = scenes.map((s) => ({ key: s.key, text: line(lang, s.key), minBeats: s.minBeats, marks: (cut === "full" ? PROMO_MARKS : PROMO_MARKS_SHORT)[lang][s.key] ?? [] }));
  }
  writeFileSync(at(`out/promo-narration${suffix}.json`), JSON.stringify(plan, null, 1));
  for (const lang of langs) writeFileSync(at(`out/promo-caption-${lang}${suffix}.txt`), PROMO_CAPTION[lang] + "\n");
  console.log(`✓ Promo (${cut === "full" ? "full" : `${cut} s`}) prepared · languages: ${langs.join(", ")}`);
} catch (err) {
  console.error(`✗ Could not fetch rates for the promo: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
