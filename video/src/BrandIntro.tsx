import React from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "./brand";

/**
 * 20-second brand Reel / Short (1080×1920, 30 fps). Shows NO prices: rate rows are placeholder bars and the trend
 * chart is labelled as illustrative, so it can be posted without cooperative republication permission.
 *
 * Timeline (frames): hook 0–90 · logo 90–200 · four features 200–488 · call to action 488–600.
 * Text stays inside the Instagram/Shorts safe area (roughly y 250–1550, clear of the right-hand buttons).
 */
export const HOOK = 90;
export const REVEAL = 110;
export const FEATURE = 72;
export const CTA = 112;
export const BRAND_INTRO_FRAMES = HOOK + REVEAL + FEATURE * 4 + CTA;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const usePop = (delay = 0, damping = 13) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass: 0.8 } });
};

/* ---------- shared pieces ---------- */

export const Background: React.FC = () => {
  const f = useCurrentFrame();
  const x = 50 + Math.sin(f / 80) * 14;
  const y = 32 + Math.cos(f / 110) * 10;
  return (
    <AbsoluteFill
      style={{ background: `radial-gradient(circle at ${x}% ${y}%, ${C.forestLight} 0%, ${C.forest} 48%, ${C.forestDeep} 100%)` }}
    >
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${C.ivory} 1.6px, transparent 1.6px)`,
          backgroundSize: "44px 44px",
          backgroundPosition: `0 ${-(f * 0.6) % 44}px`,
          opacity: 0.05,
        }}
      />
    </AbsoluteFill>
  );
};

/** Fades and lifts a scene out over its last 12 frames. */
const Scene: React.FC<{ dur: number; fadeOut?: boolean; children: React.ReactNode }> = ({ dur, fadeOut = true, children }) => {
  const f = useCurrentFrame();
  const out = fadeOut ? interpolate(f, [dur - 12, dur], [1, 0], clamp) : 1;
  const lift = fadeOut ? interpolate(f, [dur - 12, dur], [0, -50], clamp) : 0;
  return (
    <AbsoluteFill style={{ opacity: out, transform: `translateY(${lift}px)`, fontFamily: FONT, color: C.ivory }}>
      {children}
    </AbsoluteFill>
  );
};

const FRONDS = [
  "M75 39 C55 14 34 8 11 17",
  "M75 39 C65 11 51 0 34 1",
  "M75 39 C80 10 97 0 116 4",
  "M75 39 C101 19 124 19 143 31",
  "M75 39 C104 42 124 56 133 72",
  "M75 39 C56 40 38 50 27 66",
];

/** The site's palm mark, drawn stroke by stroke as `progress` goes 0 → 1. */
export const PalmMark: React.FC<{ size: number; progress: number }> = ({ size, progress }) => {
  const off = (start: number, len: number) => interpolate(progress, [start, start + len], [1, 0], clamp);
  const dash = { pathLength: 1, strokeDasharray: 1 };
  return (
    <svg width={size} height={(size * 165) / 225} viewBox="-5 -5 225 165" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 151 C40 132 83 134 115 141 C150 149 179 143 211 124" stroke={C.frond} strokeWidth={10} {...dash} strokeDashoffset={off(0, 0.35)} />
      <path d="M66 134 C70 105 73 72 75 38" stroke={C.ivory} strokeWidth={8} {...dash} strokeDashoffset={off(0.2, 0.3)} />
      {FRONDS.map((d, i) => (
        <path key={d} d={d} stroke={C.frond} strokeWidth={7} {...dash} strokeDashoffset={off(0.4 + i * 0.05, 0.3)} />
      ))}
    </svg>
  );
};

/** "Naadi" means pulse: an ECG line that draws across. */
const PulseLine: React.FC<{ progress: number; width: number }> = ({ progress, width }) => (
  <svg width={width} height={120} viewBox="0 0 900 120" fill="none" style={{ filter: `drop-shadow(0 0 10px ${C.frond})` }}>
    <path
      d="M0 60 L330 60 L360 60 L385 14 L420 106 L450 30 L472 60 L900 60"
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

const ProgressBar: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: "absolute", top: 0, left: 0, height: 8, width: `${(f / BRAND_INTRO_FRAMES) * 100}%`, background: C.leaf }} />
  );
};

/* ---------- scene 1: hook ---------- */

const Hook: React.FC = () => {
  const words = ["ಇಂದಿನ", "ಅಡಿಕೆ", "ಧಾರಣೆ"];
  const q = usePop(24, 9);
  const sub = usePop(50);
  const f = useCurrentFrame();
  const ring = (f - 24) % 30;
  return (
    <Scene dur={HOOK}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center", padding: "0 110px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0 28px", fontSize: 112, fontWeight: 800, lineHeight: 1.35 }}>
          {words.map((w, i) => {
            const p = usePop(i * 6);
            return (
              <span key={w} style={{ opacity: p, transform: `translateY(${(1 - p) * 70}px)`, display: "inline-block" }}>
                {w}
              </span>
            );
          })}
        </div>
        <div style={{ position: "relative", marginTop: 10 }}>
          {f > 24 && (
            <div
              style={{
                position: "absolute",
                inset: -40,
                borderRadius: 999,
                border: `4px solid ${C.leaf}`,
                opacity: interpolate(ring, [0, 30], [0.6, 0], clamp),
                transform: `scale(${interpolate(ring, [0, 30], [0.8, 1.4], clamp)})`,
              }}
            />
          )}
          <div style={{ fontSize: 210, fontWeight: 900, color: C.frond, transform: `scale(${0.5 + q * 0.5})`, opacity: q, lineHeight: 1.2 }}>
            ಎಷ್ಟು?
          </div>
        </div>
        <div style={{ marginTop: 50, fontSize: 56, fontWeight: 500, opacity: sub * 0.9, transform: `translateY(${(1 - sub) * 30}px)` }}>
          ಎಲ್ಲಾ ಮಾಹಿತಿ ಒಂದೇ ಕಡೆ
        </div>
      </AbsoluteFill>
    </Scene>
  );
};

/* ---------- scene 2: logo reveal ---------- */

const Reveal: React.FC = () => {
  const f = useCurrentFrame();
  const draw = interpolate(f, [0, 45], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const word = usePop(28);
  const en = usePop(40);
  const pulse = interpolate(f, [48, 78], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
  const tag = usePop(70);
  return (
    <Scene dur={REVEAL}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
        <PalmMark size={330} progress={draw} />
        <div style={{ marginTop: 30, fontSize: 150, fontWeight: 800, opacity: word, transform: `scale(${0.85 + word * 0.15})`, lineHeight: 1.3 }}>
          ಅಡಿಕೆ <span style={{ color: C.frond }}>ನಾಡಿ</span>
        </div>
        <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: 18, opacity: en * 0.85, marginTop: 4 }}>ARECA PULSE</div>
        <div style={{ marginTop: 20 }}>
          <PulseLine progress={pulse} width={820} />
        </div>
        <div style={{ marginTop: 10, fontSize: 54, fontWeight: 600, opacity: tag, transform: `translateY(${(1 - tag) * 30}px)` }}>
          ಧಾರಣೆ <span style={{ color: C.leaf }}>·</span> ಏರಿಳಿತ <span style={{ color: C.leaf }}>·</span> ಸುದ್ದಿ
        </div>
      </AbsoluteFill>
    </Scene>
  );
};

/* ---------- scene 3: features ---------- */

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const p = usePop(8, 15);
  return (
    <div
      style={{
        width: 860,
        marginTop: 60,
        background: C.ivory,
        color: C.forest,
        borderRadius: 44,
        padding: 48,
        boxShadow: "0 40px 90px rgba(0,0,0,0.35)",
        opacity: p,
        transform: `translateY(${(1 - p) * 160}px) scale(${0.94 + p * 0.06})`,
      }}
    >
      {children}
    </div>
  );
};

const Feature: React.FC<{ index: number; kicker?: string; title: string; sub: string; children: React.ReactNode }> = ({
  index,
  kicker,
  title,
  sub,
  children,
}) => {
  const f = useCurrentFrame();
  const t = usePop(0);
  const line = interpolate(f, [6, 26], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <Scene dur={FEATURE}>
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 290 }}>
        <div style={{ width: 860, opacity: t, transform: `translateX(${(1 - t) * -60}px)` }}>
          <div style={{ fontSize: 34, fontWeight: 700, color: C.frond, letterSpacing: 4 }}>
            0{index} / 04{kicker ? `  ·  ${kicker}` : ""}
          </div>
          <div style={{ fontSize: 100, fontWeight: 800, lineHeight: 1.3, marginTop: 6 }}>{title}</div>
          <div style={{ height: 10, width: 260 * line, background: C.leaf, borderRadius: 10, marginTop: 4 }} />
          <div style={{ fontSize: 48, fontWeight: 500, opacity: 0.88, marginTop: 26, lineHeight: 1.4 }}>{sub}</div>
        </div>
        <Card>{children}</Card>
      </AbsoluteFill>
    </Scene>
  );
};

/** Grey placeholder bar with a moving shimmer, used where a price would be. */
const Placeholder: React.FC<{ width: number; height?: number }> = ({ width, height = 40 }) => {
  const f = useCurrentFrame();
  const pos = ((f * 3) % 200) - 50;
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 12,
        background: `linear-gradient(100deg, #E2DFD3 ${pos - 30}%, #F3F1E8 ${pos}%, #E2DFD3 ${pos + 30}%)`,
      }}
    />
  );
};

const Tag: React.FC<{ children: React.ReactNode; dark?: boolean }> = ({ children, dark }) => (
  <span
    style={{
      fontSize: 30,
      fontWeight: 700,
      padding: "8px 22px",
      borderRadius: 999,
      background: dark ? C.forest : "rgba(110,159,67,0.16)",
      color: dark ? C.ivory : C.forest,
    }}
  >
    {children}
  </span>
);

const RatesFeature: React.FC = () => {
  const rows = ["ರಾಶಿ", "ಚಾಲಿ", "ಬೆಟ್ಟೆ", "ಸರಕು"];
  return (
    <Feature index={1} title="ಇಂದಿನ ಧಾರಣೆ" sub="ಪ್ರತಿ ಧಾರಣೆಗೂ ಮೂಲ ಮತ್ತು ದಿನಾಂಕ">
      {rows.map((r, i) => {
        const p = usePop(16 + i * 5);
        return (
          <div
            key={r}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "22px 0",
              borderBottom: i < rows.length - 1 ? "2px solid #E6E3D8" : "none",
              opacity: p,
              transform: `translateX(${(1 - p) * 60}px)`,
            }}
          >
            <span style={{ fontSize: 50, fontWeight: 700 }}>{r}</span>
            <Placeholder width={300} />
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 16, marginTop: 28 }}>
        <Tag>✓ ಮೂಲ</Tag>
        <Tag>✓ ದಿನಾಂಕ</Tag>
        <Tag>✓ ತಳಿ</Tag>
      </div>
    </Feature>
  );
};

const CHART = Array.from({ length: 61 }, (_, i) => {
  const t = i / 60;
  const y = 0.55 - 0.22 * Math.sin(t * Math.PI * 1.6) - 0.08 * Math.sin(t * Math.PI * 7) - 0.15 * t;
  return [t * 760, y * 300] as const;
});

const TrendFeature: React.FC = () => {
  const f = useCurrentFrame();
  const progress = interpolate(f, [14, 58], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const n = Math.max(2, Math.round(progress * (CHART.length - 1)) + 1);
  const pts = CHART.slice(0, n);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [hx, hy] = pts[pts.length - 1];
  return (
    <Feature index={2} title="ಬೆಲೆ ಏರಿಳಿತ" sub="ವರ್ಷಗಳ ಬೆಲೆ ಏರಿಳಿತ ಚಾರ್ಟ್‌ನಲ್ಲಿ">
      <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 26, fontWeight: 600, opacity: 0.55, marginBottom: 8 }}>
        ಸಾಂಕೇತಿಕ ಚಿತ್ರ
      </div>
      <svg width={764} height={320} viewBox="-2 -10 764 320">
        <defs>
          <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={C.leaf} stopOpacity={0.35} />
            <stop offset="1" stopColor={C.leaf} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((g) => (
          <line key={g} x1={0} x2={760} y1={g * 100} y2={g * 100} stroke="#E2DFD3" strokeWidth={2} />
        ))}
        <path d={`${line} L${hx} 300 L0 300 Z`} fill="url(#area)" />
        <path d={line} stroke={C.forest} strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={hx} cy={hy} r={14} fill={C.leaf} stroke={C.ivory} strokeWidth={5} />
      </svg>
    </Feature>
  );
};

const TOWNS = ["ಶಿವಮೊಗ್ಗ", "ಸಾಗರ", "ತೀರ್ಥಹಳ್ಳಿ", "ಶಿರಸಿ", "ಸಿದ್ದಾಪುರ", "ಯಲ್ಲಾಪುರ", "ಚನ್ನಗಿರಿ"];

const CompareFeature: React.FC = () => {
  const f = useCurrentFrame();
  const active = Math.floor(Math.max(0, f - 40) / 8) % TOWNS.length;
  return (
    <Feature index={3} title="ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ" sub="ಊರು ಊರಿನ ಧಾರಣೆ ಪಕ್ಕಪಕ್ಕ ಹೋಲಿಸಿ">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
        {TOWNS.map((t, i) => {
          const p = usePop(14 + i * 3, 10);
          const on = f > 40 && (i === active || i === (active + 3) % TOWNS.length);
          return (
            <div
              key={t}
              style={{
                fontSize: 44,
                fontWeight: 700,
                padding: "16px 30px",
                borderRadius: 999,
                background: on ? C.forest : "rgba(11,61,46,0.07)",
                color: on ? C.ivory : C.forest,
                transform: `scale(${p})`,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span style={{ width: 16, height: 16, borderRadius: 99, background: C.leaf, display: "inline-block" }} />
              {t}
            </div>
          );
        })}
      </div>
    </Feature>
  );
};

const segment = (s: string) => [...new Intl.Segmenter("kn", { granularity: "grapheme" }).segment(s)].map((x) => x.segment);

const AskFeature: React.FC = () => {
  const f = useCurrentFrame();
  const q = segment("ಶಿರಸಿಯಲ್ಲಿ ಇಂದಿನ ರಾಶಿ ಧಾರಣೆ ಎಷ್ಟು?");
  const typed = q.slice(0, Math.floor(interpolate(f, [12, 36], [0, q.length], clamp))).join("");
  const thinking = f > 38 && f < 50;
  const answer = usePop(50);
  return (
    <Feature index={4} kicker="Ask Areca Pulse" title="ಪ್ರಶ್ನೆ ಕೇಳಿ" sub="ಕನ್ನಡದಲ್ಲೇ ಕೇಳಿ, ಮೂಲ ಸಹಿತ ಉತ್ತರ">
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div
          style={{
            background: C.forest,
            color: C.ivory,
            fontSize: 40,
            fontWeight: 600,
            padding: "22px 30px",
            borderRadius: "36px 36px 8px 36px",
            maxWidth: 640,
            minHeight: 56,
            lineHeight: 1.4,
          }}
        >
          {typed}
          {f < 38 && <span style={{ opacity: f % 16 < 8 ? 1 : 0 }}>|</span>}
        </div>
      </div>
      <div style={{ display: "flex", marginTop: 26, minHeight: 170 }}>
        {thinking && (
          <div style={{ background: "rgba(11,61,46,0.07)", borderRadius: "36px 36px 36px 8px", padding: "28px 34px", display: "flex", gap: 14 }}>
            {[0, 1, 2].map((d) => (
              <span
                key={d}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 99,
                  background: C.leaf,
                  transform: `translateY(${Math.sin((f - d * 4) / 3) * 6}px)`,
                }}
              />
            ))}
          </div>
        )}
        {f >= 50 && (
          <div
            style={{
              background: "rgba(11,61,46,0.07)",
              borderRadius: "36px 36px 36px 8px",
              padding: "28px 34px",
              width: 600,
              opacity: answer,
              transform: `translateY(${(1 - answer) * 30}px)`,
            }}
          >
            <Placeholder width={420} height={34} />
            <div style={{ height: 16 }} />
            <Placeholder width={300} height={34} />
            <div style={{ display: "flex", gap: 14, marginTop: 22 }}>
              <Tag dark>ಮೂಲ</Tag>
              <Tag dark>ದಿನಾಂಕ</Tag>
            </div>
          </div>
        )}
      </div>
    </Feature>
  );
};

/* ---------- scene 4: call to action ---------- */

const CallToAction: React.FC = () => {
  const f = useCurrentFrame();
  const logo = usePop(0);
  const head = usePop(8);
  const pill = usePop(18, 10);
  const rest = usePop(32);
  const shine = interpolate((f - 30) % 60, [0, 30], [-30, 130], clamp);
  return (
    <Scene dur={CTA} fadeOut={false}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center", paddingBottom: 80 }}>
        <div style={{ opacity: logo, transform: `translateY(${Math.sin(f / 15) * 8}px) scale(${0.7 + logo * 0.3})` }}>
          <PalmMark size={220} progress={1} />
        </div>
        <div style={{ fontSize: 96, fontWeight: 800, marginTop: 20, opacity: head, lineHeight: 1.3 }}>
          ಅಡಿಕೆ <span style={{ color: C.frond }}>ನಾಡಿ</span>
        </div>
        <div style={{ fontSize: 60, fontWeight: 600, marginTop: 30, opacity: head }}>ಇಂದೇ ಭೇಟಿ ನೀಡಿ</div>
        <div
          style={{
            marginTop: 40,
            position: "relative",
            overflow: "hidden",
            background: C.ivory,
            color: C.forest,
            fontSize: 76,
            fontWeight: 800,
            padding: "26px 64px",
            borderRadius: 999,
            transform: `scale(${pill})`,
            boxShadow: `0 0 0 ${8 + Math.sin(f / 6) * 4}px rgba(182,210,121,0.35)`,
          }}
        >
          adikenaadi.com
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${shine}%`,
              width: 90,
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)",
              transform: "skewX(-20deg)",
            }}
          />
        </div>
        <div style={{ marginTop: 50, fontSize: 40, fontWeight: 600, opacity: rest * 0.9 }}>
          <div>Instagram @adike_naadi</div>
          <div style={{ marginTop: 8 }}>YouTube · X @adikenaadi</div>
        </div>
        <div style={{ marginTop: 70, fontSize: 36, fontWeight: 500, opacity: rest * 0.7 }}>ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ ಮಾತ್ರ, ಹಣಕಾಸು ಸಲಹೆ ಅಲ್ಲ.</div>
      </AbsoluteFill>
    </Scene>
  );
};

/* ---------- composition ---------- */

export const BrandIntro: React.FC = () => {
  const features = [RatesFeature, TrendFeature, CompareFeature, AskFeature];
  const start = HOOK + REVEAL;
  return (
    <AbsoluteFill>
      <Background />
      <Sequence durationInFrames={HOOK}>
        <Hook />
      </Sequence>
      <Sequence from={HOOK} durationInFrames={REVEAL}>
        <Reveal />
      </Sequence>
      {features.map((F, i) => (
        <Sequence key={i} from={start + i * FEATURE} durationInFrames={FEATURE}>
          <F />
        </Sequence>
      ))}
      <Sequence from={start + 4 * FEATURE}>
        <CallToAction />
      </Sequence>
      <ProgressBar />
    </AbsoluteFill>
  );
};
