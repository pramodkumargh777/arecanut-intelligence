import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "./brand";
import { PalmMark } from "./BrandIntro";
import type { CoopBlock, RatesData } from "./data/rates";
import { fmtDate, place, rupees } from "./format";
import type { Lang } from "./i18n";
import { apmcVariety } from "./format";
import { BAR_FRAMES, PROMO_FRAMES, PROMO_TIMELINE, type PromoScene } from "./data/promoScript";

/**
 * Premium promo Reel (1080×1920, 30 fps; about 100 s with voice, its length set by the voice-over) in Kannada or English: original 100 BPM music
 * (public/music/promo.wav, scripts/make-music.py) plus a voice-over explaining every feature, including the advanced
 * tools. Timeline and voice text: src/data/promoScript.ts. Figures shown are real (rates data), each with source and date.
 * The music dips under the voice automatically.
 */
const BEAT = 18;
export const PROMO_REEL_FRAMES = PROMO_FRAMES;
const VOICE_DELAY = 6;

/** marks: frames (from the start of the line) at which the PROMO_MARKS words are spoken. */
export type PromoVoice = Partial<Record<PromoScene, { src: string; frames: number; marks?: number[] }>>;
export type PromoReelProps = {
  data: RatesData;
  lang?: Lang;
  promoMusic?: string;
  voice?: PromoVoice;
  /** Scene lengths set by the voice step; without it the default bar lengths are used. */
  timeline?: { key: PromoScene; frames: number }[];
};
export const promoTimeline = (p: Pick<PromoReelProps, "timeline">) =>
  p.timeline?.length ? p.timeline : PROMO_TIMELINE.map((s) => ({ key: s.key, frames: s.bars * BAR_FRAMES }));
export const promoFrames = (p: Pick<PromoReelProps, "timeline">) => promoTimeline(p).reduce((a, s) => a + s.frames, 0);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.16, 1, 0.3, 1);
const tab = { fontVariantNumeric: "tabular-nums" as const };
const GLASS = "rgba(248,246,238,0.07)";
const LINE = "rgba(248,246,238,0.14)";

const S = {
  kn: {
    cold: ["ಇವತ್ತಿನ ಧಾರಣೆಗೆ ಹತ್ತು ಕಡೆ ಫೋನ್?", "ಹತ್ತಾರು ವಾಟ್ಸಾಪ್ ಗುಂಪು?"],
    coldEnd: "ಇನ್ಮೇಲೆ ಆ ತಲೆನೋವು ಬೇಡ.",
    brand: ["ಅಡಿಕೆ", "ನಾಡಿ"],
    other: "ARECA PULSE",
    tagline: "ಧಾರಣೆ · ಏರಿಳಿತ · ಸುದ್ದಿ",
    f: {
      latest: ["ಇತ್ತೀಚಿನ ಧಾರಣೆ", "ಎಲ್ಲಾ ಶಾಖೆ, ಎಲ್ಲಾ ತಳಿ — ದಿನಾಂಕ ಸಮೇತ"],
      explore: ["ಮಾರುಕಟ್ಟೆ ದರಗಳು", "ಎಪಿಎಂಸಿ, ಸೊಸೈಟಿ ದರ ಹುಡುಕಿ ನೋಡಿ"],
      trends: ["ದರ ಪ್ರವೃತ್ತಿ", "ಏರಿಳಿತ ಚಾರ್ಟ್‌ನಲ್ಲಿ ಸುಲಭವಾಗಿ"],
      compare: ["ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ", "ಯಾವ ಊರಲ್ಲಿ ಎಷ್ಟು ನಡೀತಿದೆ?"],
      sellwait: ["ಮಾರಬೇಕೇ, ಕಾಯಬೇಕೇ", "ಹಿಂದಿನ ವರ್ಷ ಏನಾಗಿತ್ತು ನೋಡಿ"],
      intel: ["ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ", "ಬೆಳೆ, ವ್ಯಾಪಾರ, ಸರ್ಕಾರದ ನೀತಿ, ಸುದ್ದಿ"],
      ask: ["ಪ್ರಶ್ನೆ ಕೇಳಿ", "ಕನ್ನಡದಲ್ಲೇ ಕೇಳಿ, ಮೂಲ ಸಮೇತ ಉತ್ತರ"],
    } as Record<string, [string, string]>,
    advTitle: "ಇನ್ನೂ ಆಳವಾಗಿ ನೋಡಿ",
    adv: [
      ["ಸಮಗ್ರ ನೋಟ", "ಮಾರುಕಟ್ಟೆಯ ಒಟ್ಟು ಚಿತ್ರಣ"],
      ["ತಿಂಗಳ ಪ್ರವೃತ್ತಿ", "ಹಲವು ವರ್ಷಗಳ ತಿಂಗಳ ಧಾರಣೆ"],
      ["ಉತ್ಪಾದನೆ ಮತ್ತು ಹವಾಮಾನ", "ಆವಕ, ಬೆಳೆ, ಮಳೆ"],
      ["ದರ ಮುನ್ನೋಟ", "ಪ್ರಾಯೋಗಿಕ · ಖಾತ್ರಿ ಅಲ್ಲ"],
      ["ಅಂದಾಜಿನ ಪರಿಶೀಲನೆ", "ಮುನ್ನೋಟ ಎಷ್ಟು ಸರಿ?"],
      ["ಲೆಕ್ಕಾಚಾರ ಸಾಧನಗಳು", "ನಿಮ್ಮ ಲೆಕ್ಕಕ್ಕೆ"],
    ],
    advFoot: "ತಳಿವಾರು ಪುಟ · ಊರುವಾರು ಪುಟ · ವಾಟ್ಸಾಪ್‌ನಲ್ಲಿ ಶೇರ್",
    search: "ಸಿದ್ದಾಪುರ",
    filters: ["ಎಪಿಎಂಸಿ", "ಸೊಸೈಟಿ", "ತಳಿ", "ದಿನಾಂಕ"],
    months: ["ಜ", "ಫೆ", "ಮಾ", "ಏ", "ಮೇ", "ಜೂ", "ಜು", "ಆ", "ಸೆ", "ಅ", "ನ", "ಡಿ"],
    sellNote: "ಹಿಂದಿನ ವರ್ಷಗಳ ಏರಿಳಿತ, ಇಟ್ಟುಕೊಂಡರೆ ಆಗೋ ಖರ್ಚು",
    sellBtns: ["ಈಗ ಮಾರಬೇಕಾ?", "ಕಾಯಬೇಕಾ?"],
    illustrative: "ಸಾಂಕೇತಿಕ ಚಿತ್ರ",
    intel: ["ಬೆಳೆ", "ವ್ಯಾಪಾರ", "ಹವಾಮಾನ", "ಸರ್ಕಾರದ ನೀತಿ", "ಸುದ್ದಿ", "ಆವಕ"],
    rashi: "ರಾಶಿ",
    question: "ಶಿರಸಿಯಲ್ಲಿ ರಾಶಿ ಎಷ್ಟು ನಡೀತಿದೆ?",
    followUps: ["ಚಾಲಿ ಎಷ್ಟು?", "ಕೊಳೆ ರೋಗ ಅಂದ್ರೆ?", "ಮಳೆ ಹೇಗಿದೆ?"],
    range: "ಕನಿಷ್ಠ – ಗರಿಷ್ಠ",
    example: "ಉದಾಹರಣೆ",
    sources: "ಮೂಲಗಳು",
    branches: "ಶಾಖೆ, ಮಾರುಕಟ್ಟೆಗಳು",
    everyRate: "ಪ್ರತಿ ಧಾರಣೆಗೂ ಮೂಲ, ದಿನಾಂಕ",
    trustTitle: "ನಂಬಬಹುದಾದ ಮಾಹಿತಿ",
    disclaimer: "ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ ಮಾತ್ರ, ಹಣಕಾಸು ಸಲಹೆ ಅಲ್ಲ.",
    stepsHead: "ಮಾರುವ ಮುನ್ನ",
    steps: ["adikenaadi.com ತೆರೆಯಿರಿ", "ನಿಮ್ಮ ಊರಿನ ಇಂದಿನ ಧಾರಣೆ ನೋಡಿ", "ಬೇರೆ ಕಡೆ ಹೋಲಿಸಿ, ನಂತರ ನಿರ್ಧರಿಸಿ"],
    unit: "₹/ಕ್ವಿಂಟಾಲ್",
  },
  en: {
    cold: ["Calling around for today's rate?", "Scrolling through endless groups?"],
    coldEnd: "Not anymore.",
    brand: ["Areca", "Pulse"],
    other: "ಅಡಿಕೆ ನಾಡಿ",
    tagline: "Rates · Trends · News",
    f: {
      latest: ["Latest rates", "Every branch, every variety — with its date"],
      explore: ["Explore prices", "Search APMC and co-operative prices"],
      trends: ["Price trends", "Charts from past reports"],
      compare: ["Compare markets", "Towns side by side"],
      sellwait: ["Sell or wait", "See what happened in past years"],
      intel: ["Market intelligence", "Production, trade, policy, news"],
      ask: ["Ask a question", "Kannada or English, answers with sources"],
    } as Record<string, [string, string]>,
    advTitle: "Advanced analysis",
    adv: [
      ["Market overview", "The whole market at a glance"],
      ["Monthly trends", "Long monthly series"],
      ["Supply & weather", "Arrivals, production, weather"],
      ["Price outlook", "Experimental · not a guarantee"],
      ["Forecast evaluation", "How accurate is the outlook?"],
      ["Decision tools", "Calculators for your numbers"],
    ],
    advFoot: "Variety pages · Town pages · WhatsApp sharing",
    search: "Siddapur",
    filters: ["APMC", "Co-operative", "Variety", "Date"],
    months: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"],
    sellNote: "Past years' movement and holding costs",
    sellBtns: ["Sell now?", "Wait?"],
    illustrative: "Illustration",
    intel: ["Production", "Trade", "Weather", "Policy", "News", "Arrivals"],
    rashi: "Rashi",
    question: "What is the Rashi rate in Sirsi?",
    followUps: ["Chali rate?", "Koleroga?", "Weather?"],
    range: "Min – max",
    example: "Example",
    sources: "sources",
    branches: "branches & markets",
    everyRate: "Source and date on every rate",
    trustTitle: "Information you can trust",
    disclaimer: "Market information only, not financial advice.",
    stepsHead: "Before you sell",
    steps: ["Open adikenaadi.com", "Check today's rate for your town", "Compare markets, then decide"],
    unit: "₹/quintal",
  },
};

const find = (d: RatesData, s: CoopBlock["source"], v: string) => d.coop.find((b) => b.source === s && b.variety === v);

/* ---------- atmosphere ---------- */

const Atmosphere: React.FC = () => {
  const f = useCurrentFrame();
  const blob = (x: number, y: number, r: number, color: string, speed: number, phase: number) => (
    <div
      style={{
        position: "absolute",
        left: `${x + Math.sin(f / speed + phase) * 8}%`,
        top: `${y + Math.cos(f / (speed * 1.3) + phase) * 6}%`,
        width: r,
        height: r,
        marginLeft: -r / 2,
        marginTop: -r / 2,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
      }}
    />
  );
  return (
    <AbsoluteFill style={{ background: `linear-gradient(170deg, #0E4A37 0%, ${C.forest} 45%, #041F17 100%)`, overflow: "hidden" }}>
      {blob(20, 18, 1100, "rgba(110,159,67,0.30)", 70, 0)}
      {blob(85, 62, 1200, "rgba(182,210,121,0.16)", 90, 2)}
      {blob(40, 95, 900, "rgba(21,88,63,0.55)", 60, 4)}
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.09, mixBlendMode: "overlay" }}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={Math.floor(f / 2) % 50} />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.45) 100%)" }} />
    </AbsoluteFill>
  );
};

/** Text revealed upward from behind a mask, word by word. */
const Reveal: React.FC<{ text: string; delay?: number; size: number; weight?: number; color?: string; stagger?: number }> = ({
  text,
  delay = 0,
  size,
  weight = 800,
  color = C.ivory,
  stagger = 3,
}) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `0 ${size * 0.28}px`, lineHeight: 1.3 }}>
      {text.split(" ").map((w, i) => {
        const p = interpolate(f, [delay + i * stagger, delay + i * stagger + 16], [0, 1], { ...clamp, easing: ease });
        return (
          <span key={i} style={{ display: "inline-block", clipPath: "inset(-60% -15% 0 -15%)", paddingBottom: size * 0.16 }}>
            <span style={{ display: "inline-block", fontSize: size, fontWeight: weight, color, transform: `translateY(${(1 - p) * 110}%)`, opacity: p }}>
              {w}
            </span>
          </span>
        );
      })}
    </div>
  );
};

/** AGMARKNET publishes "Cqca"; the promo shows it as "Coca". The daily video keeps the published label. */
const promoVariety = (label: string, lang: Lang) => (label === "Cqca" ? "Coca" : apmcVariety(label, lang));

const Fade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 6, dur - 8, dur], [0, 1, 1, 0], clamp);
  const s = interpolate(f, [dur - 8, dur], [1, 1.04], clamp);
  return <AbsoluteFill style={{ opacity: o, transform: `scale(${s})`, fontFamily: FONT, color: C.ivory }}>{children}</AbsoluteFill>;
};

const Pulse: React.FC<{ progress: number; width: number; glow?: number }> = ({ progress, width, glow = 14 }) => (
  <svg width={width} height={120} viewBox="0 0 900 120" fill="none" style={{ filter: `drop-shadow(0 0 ${glow}px ${C.frond})` }}>
    <path
      d="M0 60 L330 60 L360 60 L385 12 L420 108 L450 28 L472 60 L900 60"
      stroke={C.frond}
      strokeWidth={6}
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - progress}
    />
  </svg>
);

/* ---------- scenes ---------- */

const Cold: React.FC<{ s: typeof S.kn; dur: number; marks?: number[] }> = ({ s, dur, marks }) => {
  const f = useCurrentFrame();
  // Each line appears as the voice starts it (VOICE_DELAY + spoken time); fixed timings without voice. One mark means
  // the short cuts' two-line hook: the question, then the answer.
  const two = marks?.length === 1;
  const [m1, m2] = two ? [VOICE_DELAY + marks![0], VOICE_DELAY + marks![0]] : marks && marks.length >= 2 ? marks.map((m) => VOICE_DELAY + m) : [36, 90];
  const line = interpolate(f, [m2, m2 + 40], [0, 1], { ...clamp, easing: ease });
  return (
    <Fade dur={dur}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center", padding: "0 100px", gap: 26 }}>
        <div style={{ opacity: interpolate(f, [m1 - 4, m1 + 8], [1, 0.35], clamp) }}>
          <Reveal text={s.cold[0]} size={78} delay={VOICE_DELAY} />
        </div>
        {!two && (
          <div style={{ opacity: interpolate(f, [m2 - 4, m2 + 8], [1, 0.35], clamp) }}>
            <Reveal text={s.cold[1]} size={78} delay={m1} />
          </div>
        )}
        <div style={{ marginTop: 40 }}>
          <Reveal text={s.coldEnd} size={104} weight={900} color={C.frond} delay={m2} />
        </div>
        <div style={{ position: "absolute", bottom: 430 }}>
          <Pulse progress={line} width={880} />
        </div>
      </AbsoluteFill>
    </Fade>
  );
};

const Logo: React.FC<{ s: typeof S.kn; dur: number }> = ({ s, dur }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flash = interpolate(f, [0, 10], [0.55, 0], clamp);
  const draw = interpolate(f, [0, 40], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const pop = spring({ frame: f - 14, fps, config: { damping: 12, mass: 0.9 } });
  const sweep = interpolate(f, [40, 80], [-40, 140], clamp);
  const ring = interpolate(f, [0, 50], [0, 1], { ...clamp, easing: ease });
  return (
    <Fade dur={dur}>
      <AbsoluteFill style={{ background: C.ivory, opacity: flash }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <div
          style={{
            position: "absolute",
            width: 900 * ring,
            height: 900 * ring,
            borderRadius: "50%",
            border: `3px solid rgba(182,210,121,${0.5 * (1 - ring)})`,
          }}
        />
        <div style={{ transform: `scale(${0.9 + draw * 0.1})` }}>
          <PalmMark size={360} progress={draw} />
        </div>
        <div style={{ position: "relative", clipPath: "inset(-40% 0 -40% 0)", marginTop: 26, padding: "20px 0", transform: `scale(${0.8 + pop * 0.2})`, opacity: pop }}>
          <div style={{ fontSize: 168, fontWeight: 900, lineHeight: 1.25, letterSpacing: -2 }}>
            {s.brand[0]} <span style={{ color: C.frond }}>{s.brand[1]}</span>
          </div>
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${sweep}%`,
              width: 160,
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
              mixBlendMode: "overlay",
              transform: "skewX(-20deg)",
            }}
          />
        </div>
        <div style={{ fontSize: 46, fontWeight: 600, letterSpacing: s.other === "ARECA PULSE" ? 18 : 2, opacity: interpolate(f, [30, 46], [0, 0.85], clamp) }}>
          {s.other}
        </div>
        <div style={{ marginTop: 18 }}>
          <Pulse progress={interpolate(f, [40, 76], [0, 1], { ...clamp, easing: ease })} width={820} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Reveal text={s.tagline} size={56} weight={600} delay={66} stagger={4} />
        </div>
      </AbsoluteFill>
    </Fade>
  );
};

/** Feature frame: kicker number, title, subtitle, then a tilted glass card that settles in on the bar. */
const Feature: React.FC<{ n: number; total: number; dur: number; title: string; sub: string; children: React.ReactNode }> = ({ n, total, dur, title, sub, children }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [4, 26], [0, 1], { ...clamp, easing: ease });
  const beat = 1 + 0.012 * Math.max(0, 1 - (f % BEAT) / 6);
  return (
    <Fade dur={dur}>
      <div style={{ position: "absolute", top: 300, left: 80, width: 860, textAlign: "center" }}>
        {/* No "01 / 01" when a cut shows a single feature. */}
        {total > 1 && <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, color: C.frond, opacity: p }}>0{n} / 0{total}</div>}
        <Reveal text={title} size={title.length > 15 ? 72 : 96} delay={0} />
        <div style={{ fontSize: 40, fontWeight: 500, opacity: 0.85 * p, marginTop: 6, textAlign: "center" }}>{sub}</div>
      </div>
      <div style={{ position: "absolute", top: 600, left: 80, width: 860, perspective: 1600 }}>
        <div
          style={{
            transform: `rotateX(${(1 - p) * 18}deg) translateY(${(1 - p) * 160}px) scale(${(0.92 + p * 0.08) * beat})`,
            transformOrigin: "50% 100%",
            opacity: p,
            background: "rgba(248,246,238,0.97)",
            color: C.forest,
            borderRadius: 44,
            padding: "44px 48px",
            minHeight: 860,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            boxShadow: "0 50px 120px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.4) inset",
          }}
        >
          {children}
        </div>
      </div>
      <div style={{ position: "absolute", top: 1615, left: 0, right: 0, display: total > 1 ? "flex" : "none", justifyContent: "center", alignItems: "center", gap: 14, opacity: p }}>
        {Array.from({ length: total }, (_, k) => k + 1).map((i) => (
          <span key={i} style={{ width: i === n ? 46 : 14, height: 14, borderRadius: 99, background: i === n ? C.frond : "rgba(248,246,238,0.3)" }} />
        ))}
      </div>
    </Fade>
  );
};

const RatesCard: React.FC<{ d: RatesData; lang: Lang; s: typeof S.kn }> = ({ d, lang, s }) => {
  const f = useCurrentFrame();
  const b = find(d, "mamcos", "RASHI EDI");
  const rows = [...(b?.latest ?? [])].sort((x, y) => y.date.localeCompare(x.date) || y.avg - x.avg).slice(0, 7);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, fontWeight: 800, opacity: 0.65 }}>
        <span>MAMCOS · {s.rashi} (RASHI EDI)</span>
        <span>{s.unit}</span>
      </div>
      {rows.map((q, i) => {
        const p = interpolate(f, [14 + i * 4, 30 + i * 4], [0, 1], { ...clamp, easing: ease });
        return (
          <div key={q.branch} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 0", borderTop: i ? "2px solid #E6E3D8" : "none", marginTop: i ? 0 : 14, opacity: p, transform: `translateX(${(1 - p) * 50}px)` }}>
            <span>
              <span style={{ fontSize: 50, fontWeight: 800 }}>{place(q.branch, lang)}</span>
              <span style={{ fontSize: 26, opacity: 0.6, marginLeft: 14 }}>{fmtDate(q.date, false, lang)}</span>
            </span>
            <span style={{ ...tab, fontSize: 58, fontWeight: 900 }}>{rupees(q.avg * (0.96 + 0.04 * p))}</span>
          </div>
        );
      })}
    </div>
  );
};

const TrendCard: React.FC<{ d: RatesData; lang: Lang; s: typeof S.kn }> = ({ d, lang, s }) => {
  const f = useCurrentFrame();
  const b = find(d, "tss", "RASHI");
  const pts = b?.hist ?? [];
  if (pts.length < 3) return null;
  const W = 764, H = 560;
  const vals = pts.map((p) => p[1]);
  const lo = Math.min(...vals) - 300, hi = Math.max(...vals) + 300;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const prog = interpolate(f, [12, 56], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const n = Math.max(2, Math.round(prog * (pts.length - 1)) + 1);
  const path = pts.slice(0, n).map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(" ");
  const last = pts[n - 1];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, fontWeight: 800, opacity: 0.65, marginBottom: 14 }}>
        <span>TSS · {place(b!.histBranch, lang)} · {s.rashi}</span>
        <span>{fmtDate(pts[0][0], false, lang)} – {fmtDate(pts[pts.length - 1][0], false, lang)}</span>
      </div>
      <svg width={W} height={H + 20} viewBox={`0 -10 ${W} ${H + 20}`} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="pa" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={C.leaf} stopOpacity={0.4} />
            <stop offset="1" stopColor={C.leaf} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={`${path} L${x(n - 1)} ${H} L0 ${H} Z`} fill="url(#pa)" />
        <path d={path} stroke={C.forest} strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(n - 1)} cy={y(last[1])} r={15} fill={C.leaf} stroke="#fff" strokeWidth={5} />
      </svg>
      <div style={{ ...tab, fontSize: 64, fontWeight: 900, marginTop: 18 }}>
        {rupees(last[1])} <span style={{ fontSize: 28, fontWeight: 600, opacity: 0.6 }}>· {fmtDate(last[0], false, lang)}</span>
      </div>
    </div>
  );
};

const CompareCard: React.FC<{ d: RatesData; lang: Lang; s: typeof S.kn }> = ({ d, lang, s }) => {
  const f = useCurrentFrame();
  const b = find(d, "mamcos", "RASHI EDI");
  const day = b?.latest.map((q) => q.date).sort().at(-1);
  const rows = (b?.latest ?? []).filter((q) => q.date === day).sort((x, y) => y.avg - x.avg).slice(0, 6);
  if (!rows.length) return null;
  const min = Math.min(...rows.map((r) => r.avg)) * 0.985, max = Math.max(...rows.map((r) => r.avg));
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 800, opacity: 0.65, marginBottom: 18 }}>
        MAMCOS · {s.rashi} · {fmtDate(day!, false, lang)}
      </div>
      {rows.map((q, i) => {
        const p = interpolate(f, [12 + i * 4, 40 + i * 4], [0, 1], { ...clamp, easing: ease });
        const w = 0.25 + 0.75 * ((q.avg - min) / (max - min || 1));
        return (
          <div key={q.branch} style={{ marginBottom: rows.length <= 4 ? 44 : 26 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: rows.length <= 4 ? 52 : 44, fontWeight: 800 }}>
              <span>{place(q.branch, lang)}</span>
              <span style={tab}>{rupees(q.avg)}</span>
            </div>
            <div style={{ height: 24, background: "#E6E3D8", borderRadius: 12, marginTop: 8 }}>
              <div style={{ height: 24, width: `${w * p * 100}%`, borderRadius: 10, background: `linear-gradient(90deg, ${C.leaf}, ${C.forest})` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const AskCard: React.FC<{ d: RatesData; lang: Lang; s: typeof S.kn }> = ({ d, lang, s }) => {
  const f = useCurrentFrame();
  const q = [...(find(d, "tss", "RASHI")?.latest ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0];
  const chars = [...new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(s.question)].map((x) => x.segment);
  const typed = chars.slice(0, Math.floor(interpolate(f, [8, 30], [0, chars.length], clamp))).join("");
  const ans = interpolate(f, [36, 50], [0, 1], { ...clamp, easing: ease });
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, fontWeight: 800, opacity: 0.5 }}>
        <span>Ask Areca Pulse</span>
        <span>{s.example}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <div style={{ background: C.forest, color: C.ivory, fontSize: 48, fontWeight: 700, padding: "30px 38px", borderRadius: "34px 34px 8px 34px", minHeight: 54 }}>
          {typed}
          {f < 32 && <span style={{ opacity: f % 14 < 7 ? 1 : 0 }}>|</span>}
        </div>
      </div>
      {q && (
        <div style={{ marginTop: 30, background: "rgba(11,61,46,0.07)", borderRadius: "34px 34px 34px 8px", padding: "34px 36px", opacity: ans, transform: `translateY(${(1 - ans) * 30}px)` }}>
          <div style={{ fontSize: 28, fontWeight: 700, opacity: 0.65 }}>TSS · {place(q.branch, lang)} · {s.rashi}</div>
          <div style={{ ...tab, fontSize: 110, fontWeight: 900, margin: "10px 0" }}>{rupees(q.avg)}</div>
          {q.min != null && q.max != null && (
            <div style={{ ...tab, fontSize: 32, fontWeight: 600, opacity: 0.7, marginBottom: 14 }}>
              {s.range}: {rupees(q.min)} – {rupees(q.max)}
            </div>
          )}
          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            {[fmtDate(q.date, true, lang), "TSS", s.unit].map((t) => (
              <span key={t} style={{ fontSize: 28, fontWeight: 700, background: C.forest, color: C.ivory, padding: "6px 16px", borderRadius: 999 }}>{t}</span>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 30, opacity: interpolate(f, [48, 60], [0, 1], clamp) }}>
        {s.followUps.map((t) => (
          <span key={t} style={{ fontSize: 36, fontWeight: 700, border: `3px solid ${C.forest}`, padding: "14px 26px", borderRadius: 999 }}>{t}</span>
        ))}
      </div>
    </div>
  );
};

const ExploreCard: React.FC<{ d: RatesData; lang: Lang; s: typeof S.kn }> = ({ d, lang, s }) => {
  const f = useCurrentFrame();
  const chars = [...new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(s.search)].map((x) => x.segment);
  const typed = chars.slice(0, Math.floor(interpolate(f, [6, 22], [0, chars.length], clamp))).join("");
  const rows = [...d.apmc].sort((a, b) => b.modal - a.modal).slice(0, 6);
  const first = rows[0];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, border: `3px solid ${C.forest}`, borderRadius: 999, padding: "14px 26px", fontSize: 40, fontWeight: 700 }}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.forest} strokeWidth="2.6" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <span>{typed}<span style={{ opacity: f % 14 < 7 && f < 26 ? 1 : 0 }}>|</span></span>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
        {s.filters.map((t, i) => {
          const p = interpolate(f, [16 + i * 3, 26 + i * 3], [0, 1], { ...clamp, easing: ease });
          return <span key={t} style={{ fontSize: 30, fontWeight: 800, padding: "8px 22px", borderRadius: 999, background: i === 0 ? C.forest : "rgba(11,61,46,0.08)", color: i === 0 ? C.ivory : C.forest, transform: `scale(${p})` }}>{t}</span>;
        })}
      </div>
      {first && (
        <div style={{ fontSize: 26, fontWeight: 700, opacity: 0.6, margin: "22px 0 6px" }}>
          {place(first.market, lang)} APMC · AGMARKNET · {fmtDate(first.date, false, lang)} · {s.unit}
        </div>
      )}
      {rows.map((r, i) => {
        const p = interpolate(f, [26 + i * 4, 40 + i * 4], [0, 1], { ...clamp, easing: ease });
        return (
          <div key={r.variety} style={{ display: "flex", justifyContent: "space-between", padding: "18px 0", borderTop: "2px solid #E6E3D8", opacity: p, transform: `translateY(${(1 - p) * 20}px)` }}>
            <span style={{ fontSize: 46, fontWeight: 800 }}>{promoVariety(r.variety, lang)}</span>
            <span style={{ ...tab, fontSize: 50, fontWeight: 900 }}>{rupees(r.modal)}</span>
          </div>
        );
      })}
    </div>
  );
};

/** Sell or wait: an illustrative season strip (no figures), as the page compares past years with holding costs. */
const SellWaitCard: React.FC<{ s: typeof S.kn }> = ({ s }) => {
  const f = useCurrentFrame();
  const heights = [0.55, 0.62, 0.7, 0.66, 0.58, 0.5, 0.46, 0.52, 0.6, 0.72, 0.68, 0.6];
  const now = 10;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, fontWeight: 800, opacity: 0.55 }}>
        <span>{s.sellNote}</span>
        <span>{s.illustrative}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 540, marginTop: 30 }}>
        {heights.map((h, i) => {
          const p = interpolate(f, [8 + i * 2, 30 + i * 2], [0, 1], { ...clamp, easing: ease });
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{ width: "100%", height: 480 * h * p, borderRadius: 14, background: i === now ? C.leaf : i > now ? "rgba(110,159,67,0.35)" : "rgba(11,61,46,0.18)", border: i > now ? `3px dashed ${C.leaf}` : "none" }} />
              <span style={{ fontSize: 26, fontWeight: 800, color: i === now ? C.leaf : C.forest }}>{s.months[i]}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 30, opacity: interpolate(f, [40, 54], [0, 1], clamp) }}>
        <span style={{ flex: 1, textAlign: "center", fontSize: 34, fontWeight: 800, padding: "18px 0", borderRadius: 22, background: C.forest, color: C.ivory }}>{s.sellBtns[0]}</span>
        <span style={{ flex: 1, textAlign: "center", fontSize: 34, fontWeight: 800, padding: "18px 0", borderRadius: 22, border: `3px solid ${C.forest}` }}>{s.sellBtns[1]}</span>
      </div>
    </div>
  );
};

const IntelCard: React.FC<{ s: typeof S.kn }> = ({ s }) => {
  const f = useCurrentFrame();
  const icons = [
    "M4 20h16M7 20V10m5 10V6m5 14v-7", // production bars
    "M4 7h12l-3-3M20 17H8l3 3", // trade arrows
    "M7 16a4 4 0 1 1 .8-7.9A5 5 0 0 1 17.6 9 3.5 3.5 0 1 1 17 16H7z", // cloud
    "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z", // shield / policy
    "M5 5h14v14H5zM8 9h8M8 13h8M8 17h5", // news
    "M3 17l5-5 4 4 8-8M15 8h5v5", // arrivals rising
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      {s.intel.map((t, i) => {
        const p = interpolate(f, [8 + i * 4, 26 + i * 4], [0, 1], { ...clamp, easing: ease });
        return (
          <div key={t} style={{ background: "rgba(11,61,46,0.06)", borderRadius: 28, padding: "40px 30px", minHeight: 200, display: "flex", flexDirection: "column", gap: 18, opacity: p, transform: `scale(${0.85 + p * 0.15})` }}>
            <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke={C.leaf} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={icons[i]} /></svg>
            <span style={{ fontSize: 46, fontWeight: 800 }}>{t}</span>
          </div>
        );
      })}
    </div>
  );
};

const Advanced: React.FC<{ s: typeof S.kn; dur: number; marks?: number[] }> = ({ s, dur, marks }) => {
  const f = useCurrentFrame();
  return (
    <Fade dur={dur}>
      <div style={{ position: "absolute", top: 300, left: 80, width: 860, textAlign: "center" }}>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, color: C.frond }}>PRO</div>
        <Reveal text={s.advTitle} size={s.advTitle.length > 14 ? 80 : 96} />
      </div>
      <div style={{ position: "absolute", top: 580, left: 80, width: 860, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        {s.adv.map(([title, sub], i) => {
          // Each tile lights up as the voice names that tool; spread evenly without voice timings.
          const at = marks && marks.length === s.adv.length ? VOICE_DELAY + marks[i] - 4 : 14 + i * Math.max(18, (dur - 70) / 6);
          const p = interpolate(f, [at, at + 18], [0, 1], { ...clamp, easing: ease });
          const glow = interpolate(f, [at, at + 10, at + 40], [0, 1, 0], clamp);
          return (
            <div key={title} style={{ background: `rgba(248,246,238,${0.08 + 0.1 * glow})`, border: `2px solid rgba(182,210,121,${0.2 + 0.6 * glow})`, borderRadius: 32, padding: "34px 28px", minHeight: 230, opacity: p, transform: `translateY(${(1 - p) * 60}px) scale(${0.92 + p * 0.08})` }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: C.frond }}>0{i + 1}</div>
              <div style={{ fontSize: 46, fontWeight: 900, lineHeight: 1.25, marginTop: 10 }}>{title}</div>
              <div style={{ fontSize: 28, fontWeight: 600, opacity: 0.75, marginTop: 10, lineHeight: 1.35 }}>{sub}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", top: 1575, left: 80, width: 860, textAlign: "center", fontSize: 32, fontWeight: 700, opacity: interpolate(f, [dur - 50, dur - 30], [0, 0.85], clamp) }}>
        {s.advFoot}
      </div>
    </Fade>
  );
};

const Trust: React.FC<{ d: RatesData; s: typeof S.kn; dur: number }> = ({ d, s, dur }) => {
  const f = useCurrentFrame();
  const places = new Set([...d.coop.flatMap((b) => b.latest.map((q) => `${b.source}:${q.branch.toUpperCase()}`)), ...d.apmc.map((r) => `apmc:${r.market}`)]).size;
  const stat = (value: string, label: string, i: number) => {
    const p = interpolate(f, [10 + i * 10, 34 + i * 10], [0, 1], { ...clamp, easing: ease });
    return (
      <div style={{ flex: 1, background: GLASS, border: `2px solid ${LINE}`, borderRadius: 38, padding: "50px 20px", textAlign: "center", opacity: p, transform: `translateY(${(1 - p) * 60}px)` }}>
        <div style={{ ...tab, fontSize: 150, fontWeight: 900, color: C.frond, lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 38, fontWeight: 700, marginTop: 10, lineHeight: 1.3 }}>{label}</div>
      </div>
    );
  };
  const c = (n: number, i: number) => String(Math.round(n * interpolate(f, [10 + i * 10, 40 + i * 10], [0, 1], { ...clamp, easing: ease })));
  const chk = interpolate(f, [44, 64], [0, 1], { ...clamp, easing: ease });
  return (
    <Fade dur={dur}>
      <div style={{ position: "absolute", top: 500, left: 80, width: 860 }}>
        <Reveal text={s.trustTitle} size={96} />
        <div style={{ display: "flex", gap: 24, marginTop: 60 }}>
          {stat(c(4, 0), s.sources, 0)}
          {stat(`${c(places, 1)}+`, s.branches, 1)}
        </div>
        <div style={{ textAlign: "center", fontSize: 30, fontWeight: 600, opacity: 0.7 * chk, marginTop: 24 }}>MAMCOS · TSS · TUMCOS · AGMARKNET</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginTop: 50, opacity: chk, transform: `scale(${0.9 + chk * 0.1})` }}>
          <span style={{ width: 64, height: 64, borderRadius: 99, background: C.leaf, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 900 }}>✓</span>
          <span style={{ fontSize: 46, fontWeight: 800 }}>{s.everyRate}</span>
        </div>
      </div>
    </Fade>
  );
};

const Cta: React.FC<{ s: typeof S.kn }> = ({ s }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: f, fps, config: { damping: 14 } });
  const b = spring({ frame: f - 10, fps, config: { damping: 10 } });
  const sweep = interpolate((f - 24) % 54, [0, 28], [-30, 130], clamp);
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: C.ivory, justifyContent: "center", alignItems: "center", textAlign: "center", paddingBottom: 160, opacity: interpolate(f, [0, 8], [0, 1], clamp) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22, transform: `scale(${0.8 + a * 0.2})`, opacity: a }}>
        <PalmMark size={130} progress={1} />
        <div style={{ fontSize: 92, fontWeight: 900, lineHeight: 1.25 }}>
          {s.brand[0]} <span style={{ color: C.frond }}>{s.brand[1]}</span>
        </div>
      </div>
      {/* What to do with it: three steps, each landing a beat apart. */}
      <div style={{ fontSize: 44, fontWeight: 800, color: C.frond, marginTop: 40, opacity: b }}>{s.stepsHead}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: 860, marginTop: 22 }}>
        {s.steps.map((step, i) => {
          const p = spring({ frame: f - 18 - i * 10, fps, config: { damping: 14 } });
          return (
            <div key={step} style={{ display: "flex", alignItems: "center", gap: 24, textAlign: "left", background: GLASS, border: `2px solid ${LINE}`, borderRadius: 28, padding: "20px 28px", opacity: p, transform: `translateX(${(1 - p) * 80}px)` }}>
              <span style={{ ...tab, flex: "none", width: 58, height: 58, borderRadius: 99, background: C.leaf, color: C.ivory, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 900 }}>{i + 1}</span>
              <span style={{ fontSize: 42, fontWeight: 750, lineHeight: 1.3 }}>{step}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 44, position: "relative", overflow: "hidden", background: C.ivory, color: C.forest, fontSize: 76, fontWeight: 900, padding: "22px 60px", borderRadius: 999, transform: `scale(${spring({ frame: f - 48, fps, config: { damping: 10 } })})`, boxShadow: `0 0 0 ${10 + Math.sin(f / 5) * 5}px rgba(182,210,121,0.3), 0 30px 80px rgba(0,0,0,0.4)` }}>
        adikenaadi.com
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${sweep}%`, width: 100, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)", transform: "skewX(-20deg)" }} />
      </div>
      <div style={{ marginTop: 40, fontSize: 34, fontWeight: 600, opacity: 0.85 * b, lineHeight: 1.5 }}>
        Instagram @adike_naadi · YouTube · X @adikenaadi
      </div>
      <div style={{ marginTop: 24, fontSize: 30, fontWeight: 500, opacity: 0.65 * b }}>{s.disclaimer}</div>
    </AbsoluteFill>
  );
};

/**
 * A quiet brand mark for the whole video: palm and "adikenaadi.com" (the brand and where to go, in one line), no box,
 * at low opacity, in the top-right corner. Top-right because Instagram's buttons and audio disc cover the bottom-right,
 * and the caption covers the bottom. It sits below Instagram's top bar and steps aside while the full logo is on screen.
 */
const Watermark: React.FC<{ hide: [number, number][] }> = ({ hide }) => {
  const f = useCurrentFrame();
  const o = Math.min(interpolate(f, [8, 30], [0, 1], clamp), ...hide.map(([a, b]) => interpolate(f, [a - 12, a, b, b + 18], [1, 0, 0, 1], clamp)));
  return (
    <div style={{ position: "absolute", top: 236, right: 60, display: "flex", alignItems: "center", gap: 10, fontFamily: FONT, color: C.ivory, opacity: 0.62 * o, filter: "drop-shadow(0 2px 10px rgba(0,0,0,0.35))" }}>
      <PalmMark size={36} progress={1} />
      <span style={{ fontSize: 25, fontWeight: 500, letterSpacing: 1.2 }}>adikenaadi.com</span>
    </div>
  );
};

const FEATURES: PromoScene[] = ["latest", "explore", "trends", "compare", "sellwait", "intel", "ask"];

export const PromoReel: React.FC<PromoReelProps> = ({ data, lang = "kn", promoMusic = "music/promo.wav", voice, timeline }) => {
  const s = S[lang];
  const scenes = promoTimeline({ timeline });
  const features = scenes.map((sc) => sc.key).filter((k) => FEATURES.includes(k));
  const starts: Record<string, number> = {};
  let acc = 0;
  for (const sc of scenes) {
    starts[sc.key] = acc;
    acc += sc.frames;
  }
  // Music sits under the voice; short pauses between lines don't pump it back up, longer ones let it breathe.
  const raw = scenes.flatMap((sc) => {
    const v = voice?.[sc.key];
    return v ? [[starts[sc.key] + VOICE_DELAY, starts[sc.key] + VOICE_DELAY + v.frames]] : [];
  });
  const spans: number[][] = [];
  for (const [a, b] of raw) {
    const last = spans[spans.length - 1];
    if (last && a - last[1] < 30) last[1] = b;
    else spans.push([a, b]);
  }
  const musicVolume = (f: number) => {
    const under = Math.max(0, ...spans.map(([a, b]) => interpolate(f, [a - 10, a, b, b + 14], [0, 1, 1, 0], clamp)));
    return 0.9 - 0.6 * under;
  };
  const card = (k: PromoScene) => {
    switch (k) {
      case "latest": return <RatesCard d={data} lang={lang} s={s} />;
      case "explore": return <ExploreCard d={data} lang={lang} s={s} />;
      case "trends": return <TrendCard d={data} lang={lang} s={s} />;
      case "compare": return <CompareCard d={data} lang={lang} s={s} />;
      case "sellwait": return <SellWaitCard s={s} />;
      case "intel": return <IntelCard s={s} />;
      default: return <AskCard d={data} lang={lang} s={s} />;
    }
  };
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Atmosphere />
      {promoMusic && <Audio src={staticFile(promoMusic)} volume={musicVolume} />}
      {scenes.map((sc) => {
        const dur = sc.frames;
        const v = voice?.[sc.key];
        let body: React.ReactNode;
        if (sc.key === "hook") body = <Cold s={s} dur={dur} marks={v?.marks} />;
        else if (sc.key === "logo") body = <Logo s={s} dur={dur} />;
        else if (sc.key === "advanced") body = <Advanced s={s} dur={dur} marks={v?.marks} />;
        else if (sc.key === "trust") body = <Trust d={data} s={s} dur={dur} />;
        else if (sc.key === "cta") body = <Cta s={s} />;
        else {
          const [title, sub] = s.f[sc.key];
          body = (
            <Feature n={features.indexOf(sc.key) + 1} total={features.length} dur={dur} title={title} sub={sub}>
              {card(sc.key)}
            </Feature>
          );
        }
        return (
          <Sequence key={sc.key} from={starts[sc.key]} durationInFrames={sc.key === "cta" ? undefined : dur}>
            {body}
            {v && (
              <Sequence from={VOICE_DELAY} durationInFrames={dur - VOICE_DELAY}>
                <Audio src={staticFile(v.src)} />
              </Sequence>
            )}
          </Sequence>
        );
      })}
      <Watermark
        hide={scenes.filter((sc) => sc.key === "logo" || sc.key === "cta").map((sc) => [starts[sc.key], sc.key === "cta" ? 1e9 : starts[sc.key] + sc.frames] as [number, number])}
      />
    </AbsoluteFill>
  );
};
