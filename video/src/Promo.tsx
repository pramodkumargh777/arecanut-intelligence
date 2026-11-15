import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont as loadKannada } from "@remotion/google-fonts/NotoSansKannada";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { knDate, knMonth, rupees, type PromoData } from "./data";

const { fontFamily: KANNADA } = loadKannada();
const { fontFamily: INTER } = loadInter();
const FONT = `${INTER}, ${KANNADA}, sans-serif`;

/** Brand tokens (docs/BRAND.md). */
const C = { forest: "#0B3D2E", deep: "#06271E", leaf: "#6E9F43", leafLight: "#A8C98A", ivory: "#F8F6EE", muted: "#C9D6CC", up: "#7FD49A", down: "#F2A08F" };

/** Scene lengths in frames at 30 fps; the total is the composition's duration (Root.tsx). */
export const SCENES = { intro: 75, rates: 135, trend: 105, features: 120, cta: 90 } as const;
export const PROMO_FRAMES = Object.values(SCENES).reduce((sum, frames) => sum + frames, 0);

const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
function useIn(delay = 0, length = 18) {
  const frame = useCurrentFrame();
  const t = interpolate(frame - delay, [0, length], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  return { opacity: t, transform: `translateY(${(1 - t) * 28}px)` };
}
/** Each scene fades out over its last frames, so cuts feel like one piece. */
function SceneFade({ length, children }: { length: number; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [length - 10, length], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function Wordmark({ size = 92 }: { size?: number }) {
  return <div style={{ fontSize: size, fontWeight: 700, letterSpacing: -1 }}>ಅಡಿಕೆ <span style={{ color: C.leaf }}>ನಾಡಿ</span></div>;
}

function Intro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  return <SceneFade length={SCENES.intro}>
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center", gap: 28 }}>
      <div style={{ transform: `scale(${0.85 + pop * 0.15})`, opacity: pop }}><Wordmark size={120} /></div>
      <div style={{ ...useIn(14), fontSize: 46, color: C.muted, fontFamily: INTER, letterSpacing: 6, textTransform: "uppercase" }}>Areca Pulse</div>
      <div style={{ ...useIn(26), fontSize: 50, marginTop: 30, lineHeight: 1.5 }}>ಅಡಿಕೆ ಬೆಳೆಗಾರರಿಗೆ<br />ದಿನದ ಧಾರಣೆ</div>
    </AbsoluteFill>
  </SceneFade>;
}

function RateCard({ rate, delay }: { rate: PromoData["rates"][number]; delay: number }) {
  return <div style={{ ...useIn(delay), background: "rgba(255,255,255,0.06)", border: "2px solid rgba(255,255,255,0.12)", borderRadius: 28, padding: "30px 36px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 34, color: C.muted }}>
      <span style={{ background: "rgba(110,159,67,0.25)", color: C.leafLight, padding: "4px 16px", borderRadius: 12, fontFamily: INTER, fontWeight: 700, fontSize: 30, letterSpacing: 2 }}>{rate.source}</span>
      <span>{knDate(rate.date)}</span>
    </div>
    <div style={{ marginTop: 14, fontSize: 40, color: C.ivory }}>{rate.variety}</div>
    <div style={{ marginTop: 4, fontSize: 64, fontWeight: 700, fontFamily: INTER, fontVariantNumeric: "tabular-nums" }}>
      {rate.low === rate.high ? rupees(rate.low) : <>{rupees(rate.low)}<span style={{ color: C.muted }}> – </span>{rupees(rate.high)}</>}
    </div>
    <div style={{ marginTop: 6, fontSize: 30, color: C.muted }}>ಕ್ವಿಂಟಾಲ್‌ಗೆ · {rate.branches === 1 ? "1 ಶಾಖೆ" : `${rate.branches} ಶಾಖೆಗಳು`}</div>
  </div>;
}

function Rates({ data }: { data: PromoData }) {
  return <SceneFade length={SCENES.rates}>
    <AbsoluteFill style={{ padding: "0 70px", gap: 30, justifyContent: "center" }}>
      <div style={useIn(0)}><div style={{ fontSize: 40, color: C.leafLight }}>ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ</div><div style={{ fontSize: 76, fontWeight: 700, marginTop: 6 }}>ಸಹಕಾರಿ ಸಂಘದ ದರಗಳು</div></div>
      {data.rates.map((rate, index) => <RateCard key={`${rate.source}-${rate.variety}`} rate={rate} delay={12 + index * 10} />)}
      <div style={{ ...useIn(60), fontSize: 30, color: C.muted, marginTop: 6 }}>ಪ್ರತಿ ದರ ಅದರ ವರದಿ ದಿನಾಂಕದೊಂದಿಗೆ · ಮೂಲದಿಂದ ನೇರವಾಗಿ</div>
    </AbsoluteFill>
  </SceneFade>;
}

function Trend({ data }: { data: PromoData }) {
  const frame = useCurrentFrame();
  const width = 940, height = 620, pad = 30;
  const prices = data.trend.map((point) => point.price);
  const low = Math.min(...prices), high = Math.max(...prices);
  const x = (index: number) => pad + (index * (width - 2 * pad)) / (data.trend.length - 1);
  const y = (price: number) => pad + ((high - price) * (height - 2 * pad)) / (high - low || 1);
  const path = data.trend.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.price).toFixed(1)}`).join(" ");
  const draw = interpolate(frame, [15, 70], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const first = data.trend[0], last = data.trend.at(-1)!;
  const change = (last.price / first.price - 1) * 100;
  return <SceneFade length={SCENES.trend}>
    <AbsoluteFill style={{ padding: "0 70px", gap: 26, justifyContent: "center" }}>
      <div style={useIn(0)}><div style={{ fontSize: 40, color: C.leafLight }}>ದರ ಪ್ರವೃತ್ತಿ</div><div style={{ fontSize: 72, fontWeight: 700, marginTop: 6 }}>{data.trendVariety}: ಕಳೆದ 12 ತಿಂಗಳು</div></div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ marginTop: 40, overflow: "visible" }}>
        {[0, 1, 2, 3].map((line) => <line key={line} x1={pad} x2={width - pad} y1={pad + (line * (height - 2 * pad)) / 3} y2={pad + (line * (height - 2 * pad)) / 3} stroke="rgba(255,255,255,0.08)" strokeWidth={2} />)}
        <path d={path} fill="none" stroke={C.leaf} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
        {draw > 0.98 && <circle cx={x(data.trend.length - 1)} cy={y(last.price)} r={16} fill={C.ivory} stroke={C.leaf} strokeWidth={8} />}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 34, color: C.muted, marginTop: 6 }}><span>{knMonth(first.month)}</span><span>{knMonth(last.month)}</span></div>
      <div style={{ ...useIn(70), display: "flex", gap: 40, fontSize: 40, marginTop: 20 }}>
        <span>{rupees(first.price)} → <b style={{ fontFamily: INTER }}>{rupees(last.price)}</b></span>
        <span style={{ color: change >= 0 ? C.up : C.down, fontFamily: INTER, fontWeight: 700 }}>{change >= 0 ? "↑" : "↓"} {Math.abs(change).toFixed(1)}%</span>
      </div>
      <div style={{ ...useIn(78), fontSize: 30, color: C.muted }}>ಕರ್ನಾಟಕ ತಿಂಗಳ ಸರಾಸರಿ (AGMARKNET) · 2014ರಿಂದ ದತ್ತಾಂಶ</div>
    </AbsoluteFill>
  </SceneFade>;
}

const FEATURES = [
  { icon: "⏳", title: "ಮಾರಬೇಕೇ, ಕಾಯಬೇಕೇ?", text: "ಹಿಂದಿನ ವರ್ಷಗಳಲ್ಲಿ ಕಾದಿದ್ದರೆ ಏನಾಗುತ್ತಿತ್ತು" },
  { icon: "💬", title: "ಪ್ರಶ್ನೆ ಕೇಳಿ", text: "ದರ, ಬೆಳೆ ಆರೈಕೆ, ಹವಾಮಾನ: ಮೂಲ ಸಹಿತ ಉತ್ತರ" },
  { icon: "📍", title: "22 ಊರುಗಳ ಧಾರಣೆ", text: "ಶಿರಸಿ, ಸಾಗರ, ಶಿವಮೊಗ್ಗ, ಪುತ್ತೂರು ಮತ್ತು ಇನ್ನಷ್ಟು" },
  { icon: "📈", title: "ದರ ಮುನ್ನೋಟ", text: "ಮುಂದಿನ ತಿಂಗಳ ಸಂಭಾವ್ಯ ದರ ಶ್ರೇಣಿ" },
];

function FeatureRow({ feature, delay }: { feature: (typeof FEATURES)[number]; delay: number }) {
  return <div style={{ ...useIn(delay), display: "flex", gap: 30, alignItems: "center", background: "rgba(255,255,255,0.06)", border: "2px solid rgba(255,255,255,0.12)", borderRadius: 28, padding: "30px 34px" }}>
    <div style={{ fontSize: 72, width: 100, textAlign: "center" }}>{feature.icon}</div>
    <div><div style={{ fontSize: 48, fontWeight: 700 }}>{feature.title}</div><div style={{ fontSize: 32, color: C.muted, marginTop: 6, lineHeight: 1.45 }}>{feature.text}</div></div>
  </div>;
}

function Features() {
  return <SceneFade length={SCENES.features}>
    <AbsoluteFill style={{ padding: "0 70px", gap: 30, justifyContent: "center" }}>
      <div style={useIn(0)}><div style={{ fontSize: 40, color: C.leafLight }}>ಒಂದೇ ಕಡೆ</div><div style={{ fontSize: 76, fontWeight: 700, marginTop: 6 }}>ಬೆಳೆಗಾರರಿಗೆ ಬೇಕಾದ್ದೆಲ್ಲ</div></div>
      {FEATURES.map((feature, index) => <FeatureRow key={feature.title} feature={feature} delay={14 + index * 12} />)}
      <div style={{ ...useIn(70), fontSize: 34, color: C.leafLight, textAlign: "center", marginTop: 10 }}>ಕನ್ನಡ ಮತ್ತು English · ಉಚಿತ</div>
    </AbsoluteFill>
  </SceneFade>;
}

function Cta({ data }: { data: PromoData }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - 8, fps, config: { damping: 12 } });
  return <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center", gap: 34 }}>
    <div style={useIn(0)}><Wordmark size={110} /></div>
    <div style={{ transform: `scale(${0.9 + pop * 0.1})`, opacity: pop, fontSize: 70, fontWeight: 700, fontFamily: INTER, background: C.leaf, color: C.deep, padding: "22px 48px", borderRadius: 999 }}>adikenaadi.com</div>
    <div style={{ ...useIn(20), fontSize: 44, lineHeight: 1.5 }}>ಇಂದೇ ನೋಡಿ · ಉಚಿತ<br /><span style={{ color: C.muted, fontSize: 34 }}>ಪ್ರತಿದಿನ ಬೆಳಿಗ್ಗೆ ಮತ್ತು ಸಂಜೆ ಹೊಸ ದರಗಳು</span></div>
    <div style={{ ...useIn(30), position: "absolute", bottom: 90, fontSize: 26, color: C.muted }}>ದರಗಳು {knDate(data.madeOn)} ರಂದು · ಮೂಲ: MAMCOS, TSS, AGMARKNET</div>
  </AbsoluteFill>;
}

export const Promo = ({ data }: { data: PromoData }) => {
  let start = 0;
  const at = (length: number) => { const from = start; start += length; return { from, durationInFrames: length }; };
  return <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 0%, ${C.forest} 0%, ${C.deep} 75%)`, color: C.ivory, fontFamily: FONT }}>
    <Sequence {...at(SCENES.intro)}><Intro /></Sequence>
    <Sequence {...at(SCENES.rates)}><Rates data={data} /></Sequence>
    <Sequence {...at(SCENES.trend)}><Trend data={data} /></Sequence>
    <Sequence {...at(SCENES.features)}><Features /></Sequence>
    <Sequence {...at(SCENES.cta)}><Cta data={data} /></Sequence>
  </AbsoluteFill>;
};
