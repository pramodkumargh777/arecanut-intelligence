import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT } from "./brand";

/** A personal 15-second encouragement short (1080×1920, 30 fps). Music: the original promo track, faded. */
export const ENCOURAGE_FRAMES = 450;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.16, 1, 0.3, 1);
const SPECTRUM = "linear-gradient(90deg, #E8505B, #F29A3F, #F2D04B, #6DBE6A, #4A8FE7, #9B6BD6)";

const Glow: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "linear-gradient(170deg, #121826 0%, #0B0F1A 60%, #05070D 100%)", overflow: "hidden" }}>
      {[
        ["#9B6BD6", 20, 25, 0],
        ["#E8505B", 80, 40, 2],
        ["#4A8FE7", 30, 80, 4],
        ["#6DBE6A", 75, 85, 1],
      ].map(([c, x, y, ph], i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${(x as number) + Math.sin(f / 50 + (ph as number)) * 8}%`,
            top: `${(y as number) + Math.cos(f / 60 + (ph as number)) * 6}%`,
            width: 900,
            height: 900,
            margin: -450,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${c}33 0%, transparent 65%)`,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** Words rise in one by one; only the bottom is masked so no letter is ever cut at the top. */
const Words: React.FC<{ text: string; at: number; size: number; weight?: number; gradient?: boolean }> = ({ text, at, size, weight = 800, gradient }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `0 ${size * 0.26}px`, lineHeight: 1.3 }}>
      {text.split(" ").map((w, i) => {
        const p = interpolate(f, [at + i * 3, at + i * 3 + 16], [0, 1], { ...clamp, easing: ease });
        return (
          <span key={i} style={{ display: "inline-block", clipPath: "inset(-60% -15% 0 -15%)", paddingBottom: size * 0.16 }}>
            <span
              style={{
                display: "inline-block",
                fontSize: size,
                fontWeight: weight,
                transform: `translateY(${(1 - p) * 110}%)`,
                opacity: p,
                ...(gradient ? { backgroundImage: SPECTRUM, WebkitBackgroundClip: "text", color: "transparent" } : { color: "#F8F6EE" }),
              }}
            >
              {w}
            </span>
          </span>
        );
      })}
    </div>
  );
};

const Scene: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 8, dur - 10, dur], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: o, justifyContent: "center", alignItems: "center", textAlign: "center", padding: "0 90px", fontFamily: FONT, gap: 30 }}>
      {children}
    </AbsoluteFill>
  );
};

const Built: React.FC = () => {
  const f = useCurrentFrame();
  const items = ["A live website", "Data pipelines", "An AI assistant", "Daily videos, in two languages"];
  return (
    <Scene dur={120}>
      <Words text="You built" at={0} size={84} weight={700} />
      <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 20, width: 860 }}>
        {items.map((t, i) => {
          const p = interpolate(f, [14 + i * 16, 30 + i * 16], [0, 1], { ...clamp, easing: ease });
          return (
            <div
              key={t}
              style={{
                fontSize: 54,
                fontWeight: 800,
                color: "#F8F6EE",
                padding: "22px 30px",
                borderRadius: 26,
                background: "rgba(255,255,255,0.06)",
                borderLeft: "8px solid transparent",
                borderImage: `${SPECTRUM} 1`,
                textAlign: "left",
                opacity: p,
                transform: `translateX(${(1 - p) * 80}px)`,
              }}
            >
              ✓ {t}
            </div>
          );
        })}
      </div>
    </Scene>
  );
};

const Finale: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f - 4, fps, config: { damping: 11 } });
  const bar = interpolate(f, [20, 60], [0, 1], { ...clamp, easing: ease });
  return (
    <Scene dur={130}>
      <div style={{ transform: `scale(${0.8 + pop * 0.2})`, opacity: pop }}>
        <Words text="Keep going." at={0} size={150} weight={900} gradient />
      </div>
      <div style={{ height: 10, width: 700 * bar, borderRadius: 10, backgroundImage: SPECTRUM, boxShadow: "0 0 30px rgba(155,107,214,0.6)" }} />
      <Words text="ನೀನು ಗೆದ್ದೇ ಗೆಲ್ತೀಯ." at={34} size={72} weight={800} />
    </Scene>
  );
};

export const Encourage: React.FC = () => (
  <AbsoluteFill>
    <Glow />
    <Audio src={staticFile("music/promo.wav")} volume={(f) => interpolate(f, [0, 10, ENCOURAGE_FRAMES - 30, ENCOURAGE_FRAMES], [0, 0.85, 0.85, 0], clamp)} />
    <Sequence durationInFrames={90}>
      <Scene dur={90}>
        <Words text="Hey." at={4} size={140} weight={900} />
        <Words text="Look at what you've done." at={30} size={72} weight={600} />
      </Scene>
    </Sequence>
    <Sequence from={90} durationInFrames={120}>
      <Built />
    </Sequence>
    <Sequence from={210} durationInFrames={110}>
      <Scene dur={110}>
        <Words text="All of it. On your own." at={4} size={92} />
        <Words text="Be exactly who you are." at={44} size={76} weight={700} gradient />
      </Scene>
    </Sequence>
    <Sequence from={320} durationInFrames={130}>
      <Finale />
    </Sequence>
  </AbsoluteFill>
);
