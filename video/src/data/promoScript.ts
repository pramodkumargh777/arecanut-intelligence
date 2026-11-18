/**
 * The promo Reel's scenes and voice-over, in one place. The voice is written as one flowing story (linking words carry
 * it from scene to scene). With voice, each scene lasts as long as its line plus a breath, rounded up to the next beat
 * of the 100 BPM music, and the music is composed to that timeline (voice/promo_tts.py, scripts/make-music.py); the
 * voice is never sped up. `bars` is the length used without voice. Feature names match the website's own menu labels.
 * Plain, erasable TypeScript: also read by scripts/promo-prepare.mjs in Node.
 */
export type PromoScene =
  | "hook" | "logo" | "latest" | "explore" | "trends" | "compare" | "sellwait" | "intel" | "ask" | "advanced" | "trust" | "cta";

export const BAR_FRAMES = 72;

/** Scene order and length in bars. */
export const PROMO_TIMELINE: { key: PromoScene; bars: number; minBeats: number }[] = [
  { key: "hook", bars: 2, minBeats: 6 },
  { key: "logo", bars: 2, minBeats: 6 },
  { key: "latest", bars: 2, minBeats: 6 },
  { key: "explore", bars: 2, minBeats: 6 },
  { key: "trends", bars: 2, minBeats: 6 },
  { key: "compare", bars: 2, minBeats: 6 },
  { key: "sellwait", bars: 2, minBeats: 6 },
  { key: "intel", bars: 2, minBeats: 6 },
  { key: "ask", bars: 2, minBeats: 6 },
  { key: "advanced", bars: 4, minBeats: 12 },
  { key: "trust", bars: 2, minBeats: 6 },
  { key: "cta", bars: 2.5, minBeats: 8 },
];
export const PROMO_FRAMES = PROMO_TIMELINE.reduce((a, s) => a + s.bars * BAR_FRAMES, 0);

/**
 * Cuts of the same promo. "full" is the whole tour (YouTube, the website); "30" is the Reel to post and boost (hook,
 * logo, the three strongest features, where to go); "15" is for Stories and quick ads (hook, real rates, where to go).
 * Short cuts use the tighter lines in PROMO_VOICE_SHORT; their files carry a -30 / -15 suffix, so cuts never overwrite
 * each other.
 */
export type PromoCut = "full" | "30" | "15";
export const PROMO_CUTS: Record<PromoCut, { key: PromoScene; bars: number; minBeats: number }[]> = {
  full: PROMO_TIMELINE,
  "30": [
    { key: "hook", bars: 2, minBeats: 6 },
    { key: "logo", bars: 1.5, minBeats: 5 },
    { key: "latest", bars: 2, minBeats: 6 },
    { key: "trends", bars: 2, minBeats: 6 },
    { key: "ask", bars: 2, minBeats: 6 },
    { key: "cta", bars: 2.5, minBeats: 8 },
  ],
  "15": [
    { key: "hook", bars: 2, minBeats: 6 },
    { key: "latest", bars: 2, minBeats: 6 },
    { key: "cta", bars: 2, minBeats: 7 },
  ],
};
export const cutSuffix = (cut: PromoCut) => (cut === "full" ? "" : `-${cut}`);

export const PROMO_VOICE: Record<"kn" | "en", Record<PromoScene, string>> = {
  kn: {
    hook: "ಇವತ್ತಿನ ಅಡಿಕೆ ಧಾರಣೆ ಎಷ್ಟು ಅಂತ ಹತ್ತು ಕಡೆ ಫೋನ್ ಮಾಡ್ತೀರಾ? ಹತ್ತಾರು ವಾಟ್ಸಾಪ್ ಗುಂಪು ನೋಡ್ತೀರಾ? ಇನ್ಮೇಲೆ ಆ ತಲೆನೋವು ಬೇಡ.",
    logo: "ಇದು ಅಡಿಕೆ ನಾಡಿ, ಬೆಳೆಗಾರರ ಮಾರುಕಟ್ಟೆ ಜೊತೆಗಾರ.",
    latest: "ತೆರೆದ ತಕ್ಷಣ ಎಲ್ಲಾ ಶಾಖೆಗಳ ಹೊಸ ಧಾರಣೆ ಕಾಣುತ್ತೆ, ಯಾವ ದಿನದ್ದು ಅಂತ ಸಮೇತ.",
    explore: "ಬೇರೆ ಊರು, ಬೇರೆ ತಳಿ ಬೇಕಾ? ಎಪಿಎಂಸಿ, ಸೊಸೈಟಿ ದರ ಎಲ್ಲಾ ಹುಡುಕಿ ನೋಡಬಹುದು.",
    trends: "ಧಾರಣೆ ಹೇಗೆ ಏರಿದೆ, ಹೇಗೆ ಇಳಿದಿದೆ ಅಂತ ಚಾರ್ಟ್‌ನಲ್ಲಿ ಒಂದೇ ನೋಟಕ್ಕೆ ತಿಳಿಯುತ್ತೆ.",
    compare: "ಯಾವ ಊರಲ್ಲಿ ಎಷ್ಟು ನಡೀತಿದೆ ಅಂತ ಪಕ್ಕಪಕ್ಕ ಇಟ್ಟು ಹೋಲಿಸಿ ನೋಡಿ.",
    sellwait: "ಈಗ ಮಾರಬೇಕಾ, ಸ್ವಲ್ಪ ಕಾಯಬೇಕಾ ಅನ್ನೋ ಗೊಂದಲ ಇದ್ರೆ, ಹಿಂದಿನ ವರ್ಷಗಳಲ್ಲಿ ಏನಾಗಿತ್ತು ನೋಡಿ, ನೀವೇ ನಿರ್ಧರಿಸಿ.",
    intel: "ಬೆಳೆ, ವ್ಯಾಪಾರ, ಹವಾಮಾನ, ಸರ್ಕಾರದ ನೀತಿ, ಸುದ್ದಿ. ಮಾರುಕಟ್ಟೆಗೆ ಬೇಕಾದ ಮಾಹಿತಿ ಎಲ್ಲಾ ಒಂದೇ ಕಡೆ.",
    ask: "ಏನಾದ್ರೂ ಸಂಶಯ ಇದ್ರೆ ಕನ್ನಡದಲ್ಲೇ ಕೇಳಿ. ಉತ್ತರ ಎಲ್ಲಿಂದ ಬಂತು ಅನ್ನೋ ಮೂಲ ಸಮೇತ ಸಿಗುತ್ತೆ.",
    advanced:
      "ಇನ್ನೂ ಆಳವಾಗಿ ನೋಡೋರಿಗೆ, ಮಾರುಕಟ್ಟೆಯ ಒಟ್ಟು ಚಿತ್ರಣ, ಹಲವು ವರ್ಷಗಳ ತಿಂಗಳ ಧಾರಣೆ, ಬೆಳೆ ಮತ್ತು ಮಳೆಯ ಮಾಹಿತಿ ಇದೆ. ಜೊತೆಗೆ ಪ್ರಾಯೋಗಿಕ ದರ ಮುನ್ನೋಟ, ಅದು ಎಷ್ಟು ಸರಿ ಅನ್ನೋ ಪರಿಶೀಲನೆ, ಮತ್ತು ಲೆಕ್ಕಾಚಾರದ ಸಾಧನಗಳೂ ಇವೆ.",
    trust: "ಎಲ್ಲಾ ಧಾರಣೆಗೂ ಎಲ್ಲಿಂದ ಬಂತು, ಯಾವ ದಿನದ್ದು ಅಂತ ಸ್ಪಷ್ಟವಾಗಿ ತೋರಿಸ್ತೀವಿ. ಅದಕ್ಕೇ ನಂಬಬಹುದು.",
    cta: "ಮಾರುವ ಮುನ್ನ ಅಡಿಕೆ ನಾಡಿ ಡಾಟ್ ಕಾಮ್ ತೆರೆಯಿರಿ. ನಿಮ್ಮ ಊರಿನ ಇಂದಿನ ಧಾರಣೆ ನೋಡಿ, ಬೇರೆ ಕಡೆ ದರ ಹೋಲಿಸಿ, ನಂತರ ನಿರ್ಧರಿಸಿ. ನಿಮ್ಮ ಊರಿನ ಬೆಳೆಗಾರರಿಗೂ ಹೇಳಿ. ಇದು ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ ಮಾತ್ರ, ಸಲಹೆ ಅಲ್ಲ.",
  },
  en: {
    hook: "Still calling around for today's arecanut rate? Scrolling through endless groups? Not anymore.",
    logo: "This is Areca Pulse, a market companion for arecanut growers.",
    latest: "Open it, and the latest rate from every branch is right there, with the date it was reported.",
    explore: "Need another town or variety? Search APMC and co-operative prices in seconds.",
    trends: "See how rates have moved over time, in one simple chart.",
    compare: "Put towns side by side, and see what each one is paying.",
    sellwait: "Wondering whether to sell now or wait? See what happened in past years, and decide for yourself.",
    intel: "Production, trade, weather, government policy and news, all in one place.",
    ask: "Got a question? Ask in Kannada or English, and every answer shows where it came from.",
    advanced:
      "For a deeper look, there's a market overview, years of monthly rates, and supply and weather data. Plus an experimental price outlook, a check on how accurate it has been, and handy calculators.",
    trust: "Every rate shows its source and its date, so you always know what you're looking at.",
    cta: "Before you sell, open adikenaadi dot com. Check today's rate for your town, compare other markets, then decide. Share it with growers in your village. Market information only, not financial advice.",
  },
};

/** Tighter lines for the short cuts: one idea per scene, same voice and natural pace (never sped up). */
export const PROMO_VOICE_SHORT: Record<"kn" | "en", Partial<Record<PromoScene, string>>> = {
  kn: {
    hook: "ಇವತ್ತಿನ ಧಾರಣೆಗೆ ಹತ್ತು ಕಡೆ ಫೋನ್? ಇನ್ಮೇಲೆ ಆ ತಲೆನೋವು ಬೇಡ.",
    logo: "ಇದು ಅಡಿಕೆ ನಾಡಿ.",
    latest: "ಎಲ್ಲಾ ಶಾಖೆಗಳ ಹೊಸ ಧಾರಣೆ, ದಿನಾಂಕ ಸಮೇತ.",
    trends: "ಏರಿಳಿತ ಒಂದೇ ನೋಟಕ್ಕೆ.",
    ask: "ಸಂಶಯ ಇದ್ರೆ ಕನ್ನಡದಲ್ಲೇ ಕೇಳಿ.",
    cta: "ಮಾರುವ ಮುನ್ನ ಅಡಿಕೆ ನಾಡಿ ಡಾಟ್ ಕಾಮ್ ನೋಡಿ.",
  },
  en: {
    hook: "Calling around for today's rate? Not anymore.",
    logo: "This is Areca Pulse.",
    latest: "Every branch's latest rate, with its date.",
    trends: "Every rise and fall, in one chart.",
    ask: "Questions? Ask in Kannada or English.",
    cta: "Before you sell, check adikenaadi dot com.",
  },
};

/** Short cuts: a two-line hook, so one mark (the answer line). */
export const PROMO_MARKS_SHORT: Record<"kn" | "en", Partial<Record<PromoScene, string[]>>> = {
  kn: { hook: ["ಇನ್ಮೇಲೆ"] },
  en: { hook: ["Not anymore"] },
};

/**
 * Words in the voice-over that on-screen moments wait for. The voice step reports the time each one is spoken
 * (from the voice service's word/sentence timings), so text appears exactly as it is said.
 *   hook: the second and third lines; advanced: each of the six tools as it is named.
 */
export const PROMO_MARKS: Record<"kn" | "en", Partial<Record<PromoScene, string[]>>> = {
  kn: {
    hook: ["ಹತ್ತಾರು ವಾಟ್ಸಾಪ್", "ಇನ್ಮೇಲೆ"],
    advanced: ["ಒಟ್ಟು ಚಿತ್ರಣ", "ತಿಂಗಳ ಧಾರಣೆ", "ಬೆಳೆ ಮತ್ತು ಮಳೆ", "ದರ ಮುನ್ನೋಟ", "ಪರಿಶೀಲನೆ", "ಲೆಕ್ಕಾಚಾರ"],
  },
  en: {
    hook: ["Scrolling", "Not anymore"],
    advanced: ["market overview", "monthly rates", "supply and weather", "price outlook", "how accurate", "calculators"],
  },
};
