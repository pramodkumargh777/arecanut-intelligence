import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { C, FONT } from "./brand";
import { PalmMark } from "./BrandIntro";
import { NEW_GARDEN, type Slide, type Visual } from "./data/carousels/newGarden";

/**
 * Instagram carousel template (1080×1350, 4:5): one slide per frame, so `remotion still --frame=N` renders slide N+1.
 * Editorial "paper" look: ivory grain, heavy Kannada headlines with forest-green highlight boxes, real photos printed
 * in monochrome, and line diagrams for technical points. Content: src/data/carousels/*.ts.
 */
export const CAROUSEL_W = 1080;
export const CAROUSEL_H = 1350;

const INK = "#10261E";
const PAPER = "#F4F1E6";
const LEAF_SOFT = "#DCE8C8";
const stroke = { fill: "none", stroke: C.forest, strokeWidth: 4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const Paper: React.FC = () => (
  <AbsoluteFill style={{ background: PAPER }}>
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.32, mixBlendMode: "multiply" }}>
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="4" />
        <feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.42  0 0 0 0 0.35  0 0 0 0.55 0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
    <div style={{ position: "absolute", right: -120, bottom: 90, opacity: 0.05 }}>
      <PalmMark size={620} progress={1} />
    </div>
  </AbsoluteFill>
);

const Header: React.FC<{ n: number; total: number }> = ({ n, total }) => (
  <div style={{ position: "absolute", top: 50, left: 72, right: 72, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14, background: C.forest, borderRadius: 18, padding: "10px 22px 10px 12px" }}>
      <PalmMark size={64} progress={1} />
      <span style={{ fontSize: 34, fontWeight: 800, color: C.ivory }}>
        ಅಡಿಕೆ <span style={{ color: C.frond }}>ನಾಡಿ</span>
      </span>
    </div>
    <span style={{ fontSize: 30, fontWeight: 800, color: C.forest, border: `3px solid ${C.forest}`, borderRadius: 999, padding: "6px 22px", letterSpacing: 2 }}>
      {String(n).padStart(2, "0")} / {total}
    </span>
  </div>
);

const Footer: React.FC<{ last: boolean }> = ({ last }) => (
  <div style={{ position: "absolute", left: 72, right: 72, bottom: 44, display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `3px solid ${INK}`, paddingTop: 18 }}>
    <span style={{ fontSize: 26, fontWeight: 700, color: INK }}>ಅಡಿಕೆ ನಾಡಿ | Areca Pulse · adikenaadi.com</span>
    <span style={{ fontSize: 28, fontWeight: 800, color: C.forest }}>{last ? "@adike_naadi" : "ಸ್ವೈಪ್ ಮಾಡಿ ⟶"}</span>
  </div>
);

/** Plain words + one highlighted part in a forest box, like a marker on paper. */
const Title: React.FC<{ title: [string, string]; size: number }> = ({ title, size }) => (
  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, lineHeight: 1.35 }}>
    {title[0] && <span style={{ fontSize: size, fontWeight: 900, color: INK }}>{title[0]}</span>}
    <span style={{ fontSize: size, fontWeight: 900, color: C.ivory, background: C.forest, padding: `0 ${size * 0.22}px`, boxShadow: `8px 8px 0 ${C.leaf}` }}>{title[1]}</span>
  </div>
);

const Photo: React.FC<{ src: string; height: number; chips?: string[] }> = ({ src, height, chips }) => (
  <div style={{ position: "relative", height, borderRadius: 30, overflow: "hidden", border: `4px solid ${INK}`, boxShadow: `12px 12px 0 ${C.leaf}` }}>
    <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "grayscale(1) contrast(1.18) brightness(1.06)", mixBlendMode: "multiply" }} />
    <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, transparent 55%, rgba(11,61,46,0.55))`, mixBlendMode: "multiply" }} />
    {chips && (
      <div style={{ position: "absolute", left: 24, right: 24, bottom: 24, display: "flex", gap: 14, flexWrap: "wrap" }}>
        {chips.map((c) => (
          <span key={c} style={{ fontSize: 32, fontWeight: 800, background: C.ivory, color: C.forest, padding: "10px 22px", borderRadius: 999 }}>✓ {c}</span>
        ))}
      </div>
    )}
  </div>
);

const Tile: React.FC<{ children: React.ReactNode; label: string; style?: React.CSSProperties }> = ({ children, label, style }) => (
  <div style={{ background: "#FBFAF4", border: `3px solid ${INK}`, borderRadius: 26, padding: "26px 22px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, boxShadow: `8px 8px 0 ${LEAF_SOFT}`, ...style }}>
    {children}
    <span style={{ fontSize: 36, fontWeight: 800, color: INK, textAlign: "center", lineHeight: 1.3 }}>{label}</span>
  </div>
);

const Palm: React.FC<{ x: number; y: number; h: number }> = ({ x, y, h }) => (
  <g transform={`translate(${x} ${y})`} {...stroke}>
    <path d={`M0 0 L0 ${-h}`} strokeWidth={6} />
    {[-60, -25, 10, 45, 80, 120].map((a) => (
      <path key={a} d={`M0 ${-h} q ${Math.cos((a * Math.PI) / 180) * 30} ${-20} ${Math.cos((a * Math.PI) / 180) * 60} ${Math.sin((a * Math.PI) / 180) * 30 - 10}`} stroke={C.leaf} strokeWidth={5} />
    ))}
  </g>
);

const icon = {
  depth: <svg width="110" height="110" viewBox="0 0 64 64"><path {...stroke} d="M8 16h48M8 28h48M8 40h48" /><path {...stroke} stroke={C.leaf} d="M32 10v44m-8-8 8 8 8-8" /></svg>,
  slope: <svg width="110" height="110" viewBox="0 0 64 64"><path {...stroke} d="M6 52 L58 22 L58 52 Z" /><path {...stroke} stroke={C.leaf} d="M16 40 l18-10" /></svg>,
  water: <svg width="110" height="110" viewBox="0 0 64 64"><path {...stroke} d="M6 30c6-5 10 5 16 0s10 5 16 0 10 5 16 0M6 42c6-5 10 5 16 0s10 5 16 0 10 5 16 0" /><path {...stroke} stroke={C.leaf} d="M32 6 l0 12" /></svg>,
  summer: <svg width="110" height="110" viewBox="0 0 64 64"><circle {...stroke} cx="22" cy="22" r="10" /><path {...stroke} d="M22 4v4M22 36v4M4 22h4M36 22h4M9 9l3 3M32 32l3 3M9 35l3-3M32 12l3-3" /><path {...stroke} stroke={C.leaf} d="M46 30c6 8 8 12 8 16a8 8 0 0 1-16 0c0-4 2-8 8-16z" /></svg>,
};

const Visuals: React.FC<{ v: Visual; slide: Slide; height: number }> = ({ v, slide, height }) => {
  switch (v.kind) {
    case "photo":
      return <Photo src={v.src} height={height} chips={slide.photoChecks} />;
    case "checks": {
      const icons = [icon.depth, icon.slope, icon.water, icon.summer];
      return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 26, height }}>
          {v.items.map((t, i) => (
            <Tile key={t} label={t}>
              {icons[i % 4]}
              <span style={{ position: "absolute" }} />
            </Tile>
          ))}
        </div>
      );
    }
    case "drip":
      return (
        <div style={{ height, background: "#FBFAF4", border: `3px solid ${INK}`, borderRadius: 30, boxShadow: `12px 12px 0 ${LEAF_SOFT}`, position: "relative" }}>
          <svg width="100%" height="100%" viewBox="0 0 920 600">
            <circle {...stroke} cx="800" cy="100" r="44" stroke={C.leaf} />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
              <path key={a} {...stroke} stroke={C.leaf} d={`M${800 + Math.cos((a * Math.PI) / 180) * 60} ${100 + Math.sin((a * Math.PI) / 180) * 60} L${800 + Math.cos((a * Math.PI) / 180) * 80} ${100 + Math.sin((a * Math.PI) / 180) * 80}`} />
            ))}
            <path {...stroke} d="M30 470 H890" strokeWidth={5} />
            <path d="M30 470 H890 V600 H30 Z" fill="#E9E2CF" />
            {[150, 360, 570, 780].map((x) => (
              <g key={x}>
                <Palm x={x} y={470} h={230} />
                <circle cx={x + 40} cy={462} r={9} fill={C.forest} />
                {[0, 1, 2].map((k) => (
                  <path key={k} d={`M${x + 40} ${482 + k * 30} c-6 10 -6 16 0 18 c6 -2 6 -8 0 -18z`} fill="#4A8FBF" opacity={1 - k * 0.25} />
                ))}
              </g>
            ))}
            <path d="M30 462 H890" stroke={C.forest} strokeWidth={10} strokeLinecap="round" />
          </svg>
          <div style={{ position: "absolute", left: 30, top: 28, display: "flex", gap: 14 }}>
            <span style={{ fontSize: 32, fontWeight: 800, background: C.forest, color: C.ivory, padding: "8px 22px", borderRadius: 999 }}>ಹನಿ ನೀರಾವರಿ</span>
            <span style={{ fontSize: 32, fontWeight: 800, border: `3px solid ${C.forest}`, color: C.forest, padding: "6px 20px", borderRadius: 999 }}>ಬೇಸಿಗೆಯಲ್ಲೂ ನೀರು</span>
          </div>
        </div>
      );
    case "soil":
      return (
        <div style={{ height, display: "grid", gridTemplateColumns: "300px 1fr", gap: 30 }}>
          <Tile label="ಮಣ್ಣಿನ ಮಾದರಿ">
            <svg width="200" height="330" viewBox="0 0 120 200">
              <rect x="20" y="10" width="80" height="180" rx="14" {...stroke} />
              <rect x="24" y="60" width="72" height="40" fill="#A98B62" />
              <rect x="24" y="100" width="72" height="40" fill="#8A6B45" />
              <rect x="24" y="140" width="72" height="46" rx="10" fill="#6B4F31" />
              <path {...stroke} d="M30 30h60" />
            </svg>
          </Tile>
          <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
            <div style={{ background: "#FBFAF4", border: `3px solid ${INK}`, borderRadius: 26, padding: "26px 28px", boxShadow: `8px 8px 0 ${LEAF_SOFT}` }}>
              <div style={{ fontSize: 44, fontWeight: 900, color: INK }}>pH</div>
              <div style={{ height: 34, borderRadius: 999, marginTop: 14, background: "linear-gradient(90deg,#E8505B,#F29A3F,#F2D04B,#6DBE6A,#4A8FE7,#6B4FB0)" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, fontWeight: 700, marginTop: 10, color: INK }}>
                <span>ಆಮ್ಲೀಯ</span>
                <span>ತಟಸ್ಥ</span>
                <span>ಕ್ಷಾರೀಯ</span>
              </div>
            </div>
            <div style={{ background: "#FBFAF4", border: `3px solid ${INK}`, borderRadius: 26, padding: "26px 28px", boxShadow: `8px 8px 0 ${LEAF_SOFT}`, flex: 1 }}>
              <div style={{ fontSize: 40, fontWeight: 900, color: INK }}>ಪೋಷಕಾಂಶಗಳು</div>
              <div style={{ display: "flex", gap: 14, marginTop: 18 }}>
                {["N", "P", "K"].map((t) => (
                  <span key={t} style={{ width: 96, height: 96, borderRadius: 24, background: C.forest, color: C.ivory, fontSize: 48, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{t}</span>
                ))}
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: C.forest, marginTop: 22 }}>⟶ ಗೊಬ್ಬರ ನಿರ್ವಹಣೆ</div>
            </div>
          </div>
        </div>
      );
    case "varieties": {
      const nut = (inner: string, outer: string) => (
        <svg width="190" height="190" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill={outer} stroke={INK} strokeWidth="3" />
          <circle cx="50" cy="50" r="30" fill={inner} />
          {[0, 1, 2, 3, 4, 5].map((k) => (
            <path key={k} d={`M50 50 q ${12 * Math.cos(k)} ${12 * Math.sin(k)} ${26 * Math.cos(k + 0.6)} ${26 * Math.sin(k + 0.6)}`} stroke={outer} strokeWidth="3" fill="none" />
          ))}
        </svg>
      );
      return (
        <div style={{ height, display: "flex", flexDirection: "column", gap: 26 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 26, flex: 1 }}>
            <Tile label="ಚಾಲಿ">{nut("#EFE3C6", "#A8865A")}<span style={{ fontSize: 28, fontWeight: 600, color: INK, opacity: 0.75 }}>ಒಣಗಿಸಿದ ಬಿಳಿ ಅಡಿಕೆ</span></Tile>
            <Tile label="ಕೆಂಪಡಿಕೆ">{nut("#B5523A", "#6E2A1C")}<span style={{ fontSize: 28, fontWeight: 600, color: INK, opacity: 0.75 }}>ಬೇಯಿಸಿದ ಕೆಂಪು ಅಡಿಕೆ</span></Tile>
          </div>
          <div style={{ fontSize: 36, fontWeight: 800, background: C.forest, color: C.ivory, borderRadius: 22, padding: "22px 28px", textAlign: "center" }}>+ ನಿಮ್ಮ ಪ್ರದೇಶದ ಹವಾಮಾನಕ್ಕೆ ಹೊಂದುವ ತಳಿ</div>
        </div>
      );
    }
    case "spacing":
      return (
        <div style={{ height, display: "flex", flexDirection: "column", gap: 26 }}>
          <Photo src={v.photo} height={250} />
          <div style={{ flex: 1, background: "#FBFAF4", border: `3px solid ${INK}`, borderRadius: 30, boxShadow: `12px 12px 0 ${LEAF_SOFT}` }}>
            <svg width="100%" height="100%" viewBox="0 0 920 390">
              {[0, 1, 2].map((r) =>
                [0, 1, 2, 3, 4].map((c) => {
                  const x = 170 + c * 160, y = 60 + r * 108;
                  return (
                    <g key={`${r}${c}`}>
                      <circle cx={x} cy={y} r={30} fill={LEAF_SOFT} stroke={C.forest} strokeWidth={4} />
                      {[0, 60, 120, 180, 240, 300].map((a) => (
                        <path key={a} d={`M${x} ${y} l${Math.cos((a * Math.PI) / 180) * 30} ${Math.sin((a * Math.PI) / 180) * 30}`} stroke={C.leaf} strokeWidth={4} strokeLinecap="round" />
                      ))}
                      <circle cx={x} cy={y} r={6} fill={C.forest} />
                    </g>
                  );
                }),
              )}
              <path {...stroke} d="M170 330 H330 M170 318 v24 M330 318 v24" strokeWidth={5} />
              <text x="250" y="378" fontSize="34" fontWeight={900} fill={C.forest} textAnchor="middle" fontFamily={FONT}>2.7 ಮೀ</text>
              <path {...stroke} d="M100 60 V168 M88 60 h24 M88 168 h24" strokeWidth={5} />
              <text x="62" y="114" fontSize="34" fontWeight={900} fill={C.forest} textAnchor="middle" fontFamily={FONT} transform="rotate(-90 62 114)">2.7 ಮೀ</text>
            </svg>
          </div>
        </div>
      );
    case "drainage":
      return (
        <div style={{ height, background: "#FBFAF4", border: `3px solid ${INK}`, borderRadius: 30, boxShadow: `12px 12px 0 ${LEAF_SOFT}`, position: "relative" }}>
          <svg width="100%" height="100%" viewBox="0 0 920 600">
            {Array.from({ length: 26 }, (_, i) => (
              <path key={i} d={`M${40 + ((i * 137) % 840)} ${40 + ((i * 61) % 110)} l-8 22`} stroke="#4A8FBF" strokeWidth={4} strokeLinecap="round" />
            ))}
            <path d="M0 400 H340 L370 470 H550 L580 400 H920 V600 H0 Z" fill="#E9E2CF" stroke={INK} strokeWidth={4} />
            <path d="M378 462 H542" stroke="#4A8FBF" strokeWidth={14} strokeLinecap="round" />
            <path {...stroke} stroke="#4A8FBF" d="M300 380 q40 40 80 60 M620 380 q-40 40 -80 60" />
            <path {...stroke} stroke="#4A8FBF" d="M460 500 v60 m-14 -16 14 16 14 -16" />
            <Palm x={160} y={400} h={200} />
            <Palm x={760} y={400} h={200} />
          </svg>
          <span style={{ position: "absolute", left: 28, top: 28, fontSize: 30, fontWeight: 800, background: "#E3EEF6", color: "#2E6A93", padding: "6px 20px", borderRadius: 999 }}>ಮಳೆ ನೀರು</span>
          <span style={{ position: "absolute", left: "50%", bottom: 150, transform: "translateX(-50%)", fontSize: 32, fontWeight: 900, background: C.forest, color: C.ivory, padding: "8px 22px", borderRadius: 999 }}>ಚರಂಡಿ</span>
          <span style={{ position: "absolute", right: 28, top: 28, fontSize: 30, fontWeight: 800, border: `3px solid ${C.forest}`, color: C.forest, padding: "6px 20px", borderRadius: 999 }}>ನೀರು ನಿಲ್ಲಬಾರದು</span>
        </div>
      );
    case "crops": {
      const art = [
        <svg key="p" width="120" height="120" viewBox="0 0 64 64"><path {...stroke} d="M32 6v52" /><path {...stroke} stroke={C.leaf} d="M32 18c-10-2-16 4-18 10 8 2 14-2 18-10zM32 30c10-2 16 4 18 10-8 2-14-2-18-10z" />{[0, 1, 2, 3, 4].map((k) => <circle key={k} cx={26 + (k % 2) * 6} cy={40 + k * 4} r="3.4" fill="#8A2E22" />)}</svg>,
        <svg key="c" width="120" height="120" viewBox="0 0 64 64"><path {...stroke} d="M32 8c12 6 16 18 14 30s-8 18-14 20c-6-2-12-8-14-20S20 14 32 8z" fill="#E3B44C" /><path {...stroke} d="M32 10v46M24 14c-4 12-4 28 2 40M40 14c4 12 4 28-2 40" /></svg>,
        <svg key="f" width="120" height="120" viewBox="0 0 64 64"><ellipse {...stroke} cx="32" cy="32" rx="16" ry="22" fill="#6B4228" /><path {...stroke} stroke={C.ivory} d="M32 12c-6 8-6 32 0 40" /></svg>,
        <svg key="b" width="120" height="120" viewBox="0 0 64 64"><path {...stroke} d="M14 18c4 18 14 30 34 34" stroke="#C9A227" strokeWidth={8} /><path {...stroke} d="M20 14c6 16 16 26 32 30" stroke="#E3C54C" strokeWidth={8} /><path {...stroke} d="M14 12l4 6" /></svg>,
      ];
      return (
        <div style={{ height, display: "flex", flexDirection: "column", gap: 26 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, flex: 1 }}>
            {v.items.map((t, i) => (
              <Tile key={t} label={t}>{art[i % 4]}</Tile>
            ))}
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, background: C.forest, color: C.ivory, borderRadius: 22, padding: "20px 28px", textAlign: "center" }}>⚠ {v.note}</div>
        </div>
      );
    }
    case "budget":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
            {v.items.map((t) => (
              <div key={t} style={{ background: "#FBFAF4", border: `3px solid ${INK}`, borderRadius: 22, padding: "18px 10px", textAlign: "center", boxShadow: `6px 6px 0 ${LEAF_SOFT}` }}>
                <div style={{ fontSize: 34, fontWeight: 900, color: C.leaf, lineHeight: 1.2 }}>₹</div>
                <div style={{ fontSize: 32, fontWeight: 800, color: INK, lineHeight: 1.3 }}>{t}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 34, fontWeight: 900, background: C.leaf, color: C.ivory, borderRadius: 22, padding: "18px 28px", textAlign: "center" }}>+ {v.reserve}</div>
        </div>
      );
  }
};

export const Carousel: React.FC = () => {
  const i = useCurrentFrame();
  const c = NEW_GARDEN;
  const s = c.slides[i];
  const total = c.slides.length;
  const first = i === 0, last = i === total - 1;
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: INK }}>
      <Paper />
      <Header n={i + 1} total={total} />
      <div style={{ position: "absolute", top: 160, left: 72, right: 72 }}>
        {first ? (
          <>
            <div style={{ fontSize: 46, fontWeight: 800, color: C.forest }}>{c.kicker}</div>
            <div style={{ marginTop: 6 }}>
              <Title title={c.cover} size={100} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 30 }}>
              <span style={{ fontSize: 36, fontWeight: 800, borderBottom: `4px solid ${INK}` }}>ಸ್ವೈಪ್ ಮಾಡಿ, ಒಂದೊಂದಾಗಿ ನೋಡಿ</span>
              <svg width="120" height="24" viewBox="0 0 120 24"><path {...stroke} stroke={INK} d="M2 12h110m-12-10 12 10-12 10" /></svg>
            </div>
            <div style={{ marginTop: 38 }}>
              <Photo src={(s.visual as { src: string }).src} height={380} />
            </div>
            <div style={{ display: "flex", gap: 22, marginTop: 30, alignItems: "flex-start" }}>
              <span style={{ fontSize: 72, fontWeight: 900, color: C.leaf, lineHeight: 1.1, WebkitTextStroke: `2px ${INK}` }}>01</span>
              <div style={{ fontSize: 33, fontWeight: 600, lineHeight: 1.5 }}>
                <b style={{ fontWeight: 900, color: C.forest }}>{s.title.join(" ")}: </b>
                {s.text}
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
              <span style={{ fontSize: 132, fontWeight: 900, color: C.leaf, lineHeight: 1.05, WebkitTextStroke: `3px ${INK}` }}>{String(i + 1).padStart(2, "0")}</span>
              <Title title={s.title} size={92} />
            </div>
            <div style={{ fontSize: last ? 36 : 40, fontWeight: 600, lineHeight: 1.6, marginTop: 22, maxWidth: 930 }}>{s.text}</div>
            <div style={{ marginTop: 34 }}>
              <Visuals v={s.visual} slide={s} height={last ? 330 : 690 - (s.text.length > 70 ? 60 : 0)} />
            </div>
            {last && (
              <div style={{ marginTop: 34, background: C.forest, color: C.ivory, borderRadius: 28, padding: "26px 34px", boxShadow: `12px 12px 0 ${C.leaf}` }}>
                <div style={{ fontSize: 40, fontWeight: 900, color: C.frond }}>{c.closing.label}</div>
                <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.55, marginTop: 6 }}>{c.closing.text}</div>
                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 12, opacity: 0.85 }}>{c.closing.tags}</div>
              </div>
            )}
          </>
        )}
      </div>
      <Footer last={last} />
    </AbsoluteFill>
  );
};
