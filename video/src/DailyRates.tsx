import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "./brand";
import { Background, PalmMark } from "./BrandIntro";
import type { ApmcRow, CoopBlock, Quote, RatesData } from "./data/rates";
import { apmcVariety, change, fmtDate as knDate, place, rupees } from "./format";
import { lang, setLang, t, type Lang } from "./i18n";
import { SCENES, type SceneKey } from "./data/narration";

/**
 * Daily rates Reel / Short, 1080×1920 at 30 fps, filled from the live API at render time (see Root.tsx).
 * Every figure keeps its source, exact source label, branch and reporting date; sources are never combined.
 *
 * Timeline (frames): glance 0–90 · MAMCOS Rashi 90–285 · TSS Rashi + Chali 285–450 · APMC + others 450–615 ·
 * real trend chart 615–765 · call to action 765–855.
 */
/** Minimum length of each scene; a scene stretches to fit its voice-over clip when there is one. */
const T: Record<SceneKey, number> = { glance: 90, mamcos: 195, tss: 165, others: 165, trend: 150, cta: 90 };

export type VoiceClip = { src: string; frames: number };
export type DailyRatesProps = {
  data: RatesData;
  source: "live" | "snapshot";
  /** Per-scene voice-over written by voice/tts.py (paths relative to public/). */
  voice?: Partial<Record<SceneKey, VoiceClip>>;
  /** Optional background music under public/, e.g. "music/bed.mp3". */
  music?: string;
  /** Screen language; defaults to Kannada. */
  lang?: Lang;
};

const VOICE_DELAY = 5;
/** Lines follow each other with about half a second of air, so the voice flows across scenes. */
export const sceneDurations = (p: Pick<DailyRatesProps, "voice">) =>
  SCENES.map((k) => (p.voice?.[k] ? Math.max(60, p.voice[k]!.frames + VOICE_DELAY + 10) : T[k]));
export const totalFrames = (p: Pick<DailyRatesProps, "voice">) => sceneDurations(p).reduce((a, b) => a + b, 0);
export const DAILY_FRAMES = totalFrames({});

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const UP = C.frond;
const DOWN = "#FF9F80";
const GLASS = "rgba(248,246,238,0.07)";
const LINE = "rgba(248,246,238,0.12)";
const tab = { fontVariantNumeric: "tabular-nums" as const };

const usePop = (delay = 0, damping = 14) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass: 0.8 } });
};

const block = (d: RatesData, source: CoopBlock["source"], variety: string) =>
  d.coop.find((b) => b.source === source && b.variety === variety);

/** Most recent first, then highest average: the same order a grower scans on the website. */
const ordered = (q: Quote[]) => [...q].sort((a, b) => b.date.localeCompare(a.date) || b.avg - a.avg);

type SceneProps = { d: RatesData; newest: string; dur: number };

/* ---------- building blocks ---------- */

const Scene: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const fadeIn = interpolate(f, [0, 8], [0, 1], clamp);
  const out = interpolate(f, [dur - 10, dur], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, out), fontFamily: FONT, color: C.ivory }}>
      {children}
    </AbsoluteFill>
  );
};

/** Content column inside the Reels safe area: clear of the top bar, the caption area and the right-hand buttons. */
const Column: React.FC<{ children: React.ReactNode; top?: number }> = ({ children, top = 290 }) => (
  <div style={{ position: "absolute", left: 64, top, width: 870, display: "flex", flexDirection: "column" }}>{children}</div>
);

/** Logo and web address on every scene, just below Instagram's top bar so it is never covered. */
const TopBar: React.FC<{ date: string }> = ({ date }) => (
  <div style={{ position: "absolute", top: 190, left: 64, width: 870, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <PalmMark size={78} progress={1} />
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ fontSize: 40, fontWeight: 800 }}>
          {t().brandA} <span style={{ color: C.frond }}>{t().brandB}</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 600, opacity: 0.75 }}>adikenaadi.com</div>
      </div>
    </div>
    <span style={{ fontSize: 28, fontWeight: 600, opacity: 0.75 }}>{knDate(date)}</span>
  </div>
);

const FootNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: "absolute", top: 1548, left: 64, width: 870, fontSize: 26, fontWeight: 500, opacity: 0.62, lineHeight: 1.4 }}>
    {children}
  </div>
);

const Count: React.FC<{ value: number; delay: number; style?: React.CSSProperties }> = ({ value, delay, style }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [delay, delay + 22], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  // Counts up from 97% so the digits settle rather than spin from zero.
  return <span style={{ ...tab, ...style }}>{rupees(value * (0.97 + 0.03 * p))}</span>;
};

const Chip: React.FC<{ pct: number | null; prevDate: string | null; size?: number }> = ({ pct, prevDate, size = 30 }) => {
  if (pct == null) return <span />;
  const flat = Math.abs(pct) < 0.05;
  const color = flat ? C.ivory : pct > 0 ? UP : DOWN;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <span
        style={{
          ...tab,
          fontSize: size,
          fontWeight: 800,
          color,
          background: flat ? "rgba(248,246,238,0.12)" : pct > 0 ? "rgba(182,210,121,0.16)" : "rgba(255,159,128,0.16)",
          padding: "6px 16px",
          borderRadius: 999,
          whiteSpace: "nowrap",
        }}
      >
        {flat ? "● 0%" : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`}
      </span>
      {prevDate && <span style={{ fontSize: 22, opacity: 0.6, whiteSpace: "nowrap" }}>{t().vsReport(knDate(prevDate, false))}</span>}
    </div>
  );
};

const Header: React.FC<{ badge: string; badgeNote: string; title: string; sub: string }> = ({ badge, badgeNote, title, sub }) => {
  const p = usePop(0);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)`, marginBottom: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ background: C.ivory, color: C.forest, fontSize: 30, fontWeight: 800, padding: "6px 20px", borderRadius: 12, letterSpacing: 1 }}>
          {badge}
        </span>
        <span style={{ fontSize: 30, fontWeight: 600, opacity: 0.8 }}>{badgeNote}</span>
      </div>
      <div style={{ fontSize: 92, fontWeight: 800, lineHeight: 1.25, marginTop: 10 }}>{title}</div>
      <div style={{ fontSize: 29, fontWeight: 500, opacity: 0.75, marginTop: 2 }}>{sub}</div>
    </div>
  );
};

const unitNote = (q: Quote[]) => (q.some((x) => x.unit === "assumed") ? t().unitAssumed : t().unit);

const RateRow: React.FC<{ q: Quote; delay: number; height?: number }> = ({ q, delay, height = 112 }) => {
  const p = usePop(delay, 16);
  return (
    <div
      style={{
        height,
        display: "grid",
        // The last column fits "13 ನವೆಂಬರ್ ವರದಿಗೆ ಹೋಲಿಸಿ" on one line; narrower, it spills over the price range.
        gridTemplateColumns: "minmax(0, 1fr) auto 270px",
        alignItems: "center",
        gap: 20,
        padding: "0 26px",
        marginBottom: 12,
        background: GLASS,
        border: `2px solid ${LINE}`,
        borderRadius: 26,
        opacity: p,
        transform: `translateX(${(1 - p) * 120}px)`,
      }}
    >
      <div>
        <div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.2 }}>{place(q.branch)}</div>
        <div style={{ fontSize: 25, opacity: 0.68 }}>{knDate(q.date, false)}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <Count value={q.avg} delay={delay + 4} style={{ fontSize: 56, fontWeight: 800, display: "block", lineHeight: 1.15 }} />
        {q.min != null && q.max != null && (
          <span style={{ ...tab, fontSize: 24, opacity: 0.62 }}>
            {rupees(q.min)} – {rupees(q.max)}
          </span>
        )}
      </div>
      <Chip pct={change(q.avg, q.prevAvg)} prevDate={q.prevDate} />
    </div>
  );
};

/* ---------- scene 1: glance ---------- */

type Tile = { label: string; date: string; low: number; high: number; note: string };

const glanceTiles = (d: RatesData): Tile[] => {
  const tiles: Tile[] = [];
  const add = (label: string, b: CoopBlock | undefined) => {
    if (!b?.latest.length) return;
    const latest = b.latest.map((q) => q.date).sort().at(-1)!;
    const day = b.latest.filter((q) => q.date === latest).map((q) => q.avg);
    tiles.push({ label, date: latest, low: Math.min(...day), high: Math.max(...day), note: t().branchesAvg(day.length) });
  };
  add("MAMCOS · RASHI EDI", block(d, "mamcos", "RASHI EDI"));
  add("TSS · RASHI", block(d, "tss", "RASHI"));
  const apmc = d.apmc.find((r) => r.variety === "Rashi");
  if (apmc) tiles.push({ label: `${place(apmc.market)} APMC · Rashi`, date: apmc.date, low: apmc.modal, high: apmc.modal, note: t().modal });
  return tiles;
};

const Glance: React.FC<SceneProps> = ({ d, newest, dur }) => {
  const f = useCurrentFrame();
  const draw = interpolate(f, [0, 30], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const title = usePop(6);
  const pill = usePop(16);
  const tiles = glanceTiles(d);
  return (
    <Scene dur={dur}>
      <Column top={210}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <PalmMark size={130} progress={draw} />
          <div style={{ fontSize: 54, fontWeight: 800, opacity: title }}>
            {t().brandA} <span style={{ color: C.frond }}>{t().brandB}</span>
          </div>
        </div>
        <div style={{ fontSize: lang() === "en" ? 96 : 112, fontWeight: 900, lineHeight: 1.22, marginTop: 26, opacity: title, transform: `translateY(${(1 - title) * 40}px)` }}>
          {t().titleA} <span style={{ color: C.frond }}>{t().titleB}</span>
        </div>
        <div style={{ marginTop: 18, opacity: pill }}>
          <span style={{ fontSize: 34, fontWeight: 700, background: C.leaf, color: C.ivory, padding: "10px 26px", borderRadius: 999 }}>
            {t().latestReport} · {knDate(newest)}
          </span>
        </div>
        <div style={{ fontSize: 38, fontWeight: 700, marginTop: 56, marginBottom: 18, opacity: pill }}>{t().glanceHead}</div>
        {tiles.map((tile, i) => {
          const p = usePop(26 + i * 7, 15);
          return (
            <div
              key={tile.label}
              style={{
                background: i === 0 ? C.ivory : GLASS,
                color: i === 0 ? C.forest : C.ivory,
                border: i === 0 ? "none" : `2px solid ${LINE}`,
                borderRadius: 32,
                padding: "30px 34px",
                marginBottom: 22,
                opacity: p,
                transform: `translateY(${(1 - p) * 80}px)`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 28, fontWeight: 700, opacity: 0.8 }}>
                <span>{tile.label}</span>
                <span>{knDate(tile.date, false)}</span>
              </div>
              <div style={{ ...tab, fontSize: 82, fontWeight: 900, lineHeight: 1.2, marginTop: 6 }}>
                <Count value={tile.low} delay={30 + i * 7} />
                {tile.high !== tile.low && (
                  <>
                    <span style={{ opacity: 0.5 }}> – </span>
                    <Count value={tile.high} delay={30 + i * 7} />
                  </>
                )}
              </div>
              <div style={{ fontSize: 26, fontWeight: 600, opacity: 0.7 }}>{tile.note} · {t().unit}</div>
            </div>
          );
        })}
      </Column>
    </Scene>
  );
};

/* ---------- scene 2: MAMCOS Rashi ---------- */

const MAX_ROWS = 8;

const Mamcos: React.FC<SceneProps> = ({ d, newest, dur }) => {
  const b = block(d, "mamcos", "RASHI EDI");
  if (!b) return null;
  const rows = ordered(b.latest);
  const more = rows.length - MAX_ROWS;
  return (
    <Scene dur={dur}>
      <TopBar date={newest} />
      <Column>
        <Header badge="MAMCOS" badgeNote={t().mamcosNote} title={t().rashiRates} sub={`RASHI EDI · ${t().branchAvgMinMax} · ${unitNote(rows)}`} />
        {rows.slice(0, MAX_ROWS).map((q, i) => (
          <RateRow key={q.branch} q={q} delay={10 + i * 5} />
        ))}
      </Column>
      <FootNote>
        {more > 0 ? t().moreBranches(more) : t().eachRowDate}
      </FootNote>
    </Scene>
  );
};

/* ---------- scene 3: TSS Rashi + Chali ---------- */

const SubHead: React.FC<{ kn: string; label: string; delay: number }> = ({ kn, label, delay }) => {
  const p = usePop(delay);
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 16, margin: "14px 0 14px", opacity: p }}>
      <span style={{ fontSize: 50, fontWeight: 800, color: C.frond }}>{kn}</span>
      <span style={{ fontSize: 28, fontWeight: 600, opacity: 0.7 }}>{label}</span>
    </div>
  );
};

const Tss: React.FC<SceneProps> = ({ d, newest, dur }) => {
  const rashi = block(d, "tss", "RASHI");
  const chali = block(d, "tss", "CHALI");
  const all = [...(rashi?.latest ?? []), ...(chali?.latest ?? [])];
  return (
    <Scene dur={dur}>
      <TopBar date={newest} />
      <Column>
        <Header badge="TSS" badgeNote={t().tssNote} title={`${t().rashi} · ${t().chali}`} sub={`${t().branchAvgMinMax} · ${unitNote(all)}`} />
        {rashi && (
          <>
            <SubHead kn={t().rashi} label="RASHI" delay={8} />
            {ordered(rashi.latest).map((q, i) => (
              <RateRow key={`r${q.branch}`} q={q} delay={12 + i * 5} />
            ))}
          </>
        )}
        {chali && (
          <>
            <SubHead kn={t().chali} label="CHALI" delay={30} />
            {ordered(chali.latest).map((q, i) => (
              <RateRow key={`c${q.branch}`} q={q} delay={34 + i * 5} />
            ))}
          </>
        )}
      </Column>
      <FootNote>{t().tssUnitFoot}</FootNote>
    </Scene>
  );
};

/* ---------- scene 4: APMC + TUMCOS + MAMCOS Chali ---------- */

const ApmcCard: React.FC<{ rows: ApmcRow[] }> = ({ rows }) => {
  const p = usePop(6, 16);
  const first = rows[0];
  const sorted = [...rows].sort((a, b) => b.modal - a.modal);
  return (
    <div style={{ background: C.ivory, color: C.forest, borderRadius: 34, padding: "24px 32px 10px", opacity: p, transform: `translateY(${(1 - p) * 90}px)` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 50, fontWeight: 800 }}>{place(first.market)} {t().apmc}</span>
        <span style={{ fontSize: 28, fontWeight: 700, opacity: 0.7 }}>{knDate(first.date, false)}</span>
      </div>
      <div style={{ fontSize: 25, fontWeight: 600, opacity: 0.65, marginBottom: 10 }}>
        AGMARKNET · {t().modal} · {first.grade ? `${t().grade} ${first.grade} · ` : ""}{t().unit}
      </div>
      {sorted.map((r, i) => {
        const rp = usePop(12 + i * 4, 16);
        return (
          <div
            key={r.variety}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "9px 0",
              borderTop: "2px solid #E6E3D8",
              opacity: rp,
              transform: `translateX(${(1 - rp) * 60}px)`,
            }}
          >
            <span style={{ fontSize: 38, fontWeight: 700, flex: 1 }}>{apmcVariety(r.variety)}</span>
            {r.min != null && r.max != null && (
              <span style={{ ...tab, fontSize: 22, opacity: 0.6, marginRight: 24 }}>
                {rupees(r.min)} – {rupees(r.max)}
              </span>
            )}
            <Count value={r.modal} delay={16 + i * 4} style={{ fontSize: 44, fontWeight: 800, width: 210, textAlign: "right" }} />
          </div>
        );
      })}
    </div>
  );
};

const MiniCard: React.FC<{ badge: string; title: string; note: string; q: Quote; delay: number }> = ({ badge, title, note, q, delay }) => {
  const p = usePop(delay, 15);
  return (
    <div
      style={{
        flex: 1,
        background: GLASS,
        border: `2px solid ${LINE}`,
        borderRadius: 30,
        padding: "20px 24px",
        opacity: p,
        transform: `translateY(${(1 - p) * 80}px)`,
      }}
    >
      <span style={{ background: C.ivory, color: C.forest, fontSize: 24, fontWeight: 800, padding: "4px 14px", borderRadius: 10 }}>{badge}</span>
      <div style={{ fontSize: 42, fontWeight: 800, marginTop: 14, lineHeight: 1.2 }}>{title}</div>
      <div style={{ fontSize: 23, opacity: 0.68, lineHeight: 1.35 }}>{note}</div>
      <Count value={q.avg} delay={delay + 4} style={{ fontSize: 56, fontWeight: 900, display: "block", marginTop: 8 }} />
      {q.min != null && q.max != null && (
        <div style={{ ...tab, fontSize: 23, opacity: 0.62 }}>
          {rupees(q.min)} – {rupees(q.max)}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
        <span style={{ fontSize: 25, fontWeight: 600, opacity: 0.75, whiteSpace: "nowrap" }}>{knDate(q.date, false)}</span>
        <Chip pct={change(q.avg, q.prevAvg)} prevDate={null} size={26} />
      </div>
      {/* On its own line: beside the date it squeezed the date onto two lines. */}
      {change(q.avg, q.prevAvg) != null && q.prevDate && (
        <div style={{ fontSize: 22, opacity: 0.6, textAlign: "right", marginTop: 6, whiteSpace: "nowrap" }}>{t().vsReport(knDate(q.prevDate, false))}</div>
      )}
    </div>
  );
};

const Others: React.FC<SceneProps> = ({ d, newest, dur }) => {
  const tumcos = block(d, "tumcos", "areca")?.latest[0];
  const chali = ordered(block(d, "mamcos", "CHALI")?.latest ?? [])[0];
  return (
    <Scene dur={dur}>
      <TopBar date={newest} />
      <Column>
        <Header badge="APMC" badgeNote={t().othersNote} title={t().othersTitle} sub={t().othersSub} />
        {d.apmc.length > 0 && <ApmcCard rows={d.apmc} />}
        <div style={{ display: "flex", gap: 20, marginTop: 20 }}>
          {tumcos && (
            <MiniCard badge="TUMCOS" title={place(tumcos.branch)} note={t().tumcosNote} q={tumcos} delay={30} />
          )}
          {chali && <MiniCard badge="MAMCOS" title={`${place(chali.branch)} · ${t().chali}`} note={`CHALI · ${t().branchAvg}`} q={chali} delay={36} />}
        </div>
      </Column>
    </Scene>
  );
};

/* ---------- scene 5: real trend ---------- */

const W = 790;
const H = 640;
const PAD = 118;

const Trend: React.FC<SceneProps> = ({ d, newest, dur }) => {
  const f = useCurrentFrame();
  const b = block(d, "tss", "RASHI");
  const card = usePop(6, 16);
  if (!b || b.hist.length < 3) return null;
  const pts = b.hist;
  const values = pts.map((p) => p[1]);
  const lo = Math.floor((Math.min(...values) - 300) / 500) * 500;
  const hi = Math.ceil((Math.max(...values) + 300) / 500) * 500;
  const x = (i: number) => PAD + (i / (pts.length - 1)) * (W - PAD);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const progress = interpolate(f, [14, 70], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const shown = progress * (pts.length - 1);
  const whole = Math.floor(shown);
  const coords = pts.slice(0, whole + 1).map((p, i) => [x(i), y(p[1])] as [number, number]);
  if (whole < pts.length - 1) {
    const t = shown - whole;
    const a = pts[whole][1];
    const c = pts[whole + 1][1];
    coords.push([x(whole + t), y(a + (c - a) * t)]);
  }
  const path = coords.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
  const [hx, hy] = coords[coords.length - 1];
  const steps = Array.from({ length: (hi - lo) / 500 + 1 }, (_, i) => lo + i * 500).filter((_, i, all) => all.length <= 6 || i % 2 === 0);
  const maxI = values.indexOf(Math.max(...values));
  const minI = values.indexOf(Math.min(...values));
  const last = pts[pts.length - 1];
  const done = interpolate(f, [68, 80], [0, 1], clamp);
  const stat = (label: string, v: number, date: string) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 24, fontWeight: 700, opacity: 0.6 }}>{label}</div>
      <div style={{ ...tab, fontSize: 40, fontWeight: 800 }}>{rupees(v)}</div>
      <div style={{ fontSize: 22, opacity: 0.6 }}>{knDate(date, false)}</div>
    </div>
  );
  return (
    <Scene dur={dur}>
      <TopBar date={newest} />
      <Column>
        <Header
          badge="TSS"
          badgeNote={`${place(b.histBranch)} · RASHI`}
          title={t().trendTitle(place(b.histBranch))}
          sub={`${t().trendSub(pts.length)} · ${unitNote(b.latest)}`}
        />
        <div style={{ background: C.ivory, color: C.forest, borderRadius: 34, padding: "30px 30px 26px", opacity: card, transform: `translateY(${(1 - card) * 90}px)` }}>
          <svg width={W + 10} height={H + 70} viewBox={`-6 -14 ${W + 10} ${H + 70}`} style={{ overflow: "visible" }}>
            <defs>
              <linearGradient id="trendArea" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={C.leaf} stopOpacity={0.35} />
                <stop offset="1" stopColor={C.leaf} stopOpacity={0} />
              </linearGradient>
            </defs>
            {steps.map((s) => (
              <g key={s}>
                <line x1={PAD} x2={W} y1={y(s)} y2={y(s)} stroke="#E2DFD3" strokeWidth={2} />
                <text x={PAD - 14} y={y(s) + 8} fontSize={23} fill={C.forest} opacity={0.55} textAnchor="end" fontFamily={FONT} style={tab}>
                  {rupees(s)}
                </text>
              </g>
            ))}
            <path d={`${path} L${hx} ${H} L${PAD} ${H} Z`} fill="url(#trendArea)" />
            <path d={path} stroke={C.forest} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            {pts.map((p, i) => (i <= shown ? <circle key={p[0]} cx={x(i)} cy={y(p[1])} r={5} fill={C.forest} /> : null))}
            <circle cx={hx} cy={hy} r={14} fill={C.leaf} stroke={C.ivory} strokeWidth={5} />
            <g opacity={done}>
              <rect x={hx - 196} y={hy + (hy > H * 0.6 ? -86 : 30)} width={176} height={56} rx={16} fill={C.forest} />
              <text x={hx - 108} y={hy + (hy > H * 0.6 ? -48 : 68)} fontSize={30} fontWeight={800} fill={C.ivory} textAnchor="middle" fontFamily={FONT} style={tab}>
                {rupees(last[1])}
              </text>
            </g>
            {[0, Math.floor((pts.length - 1) / 2), pts.length - 1].map((i, k) => (
              <text
                key={i}
                x={x(i)}
                y={H + 44}
                fontSize={24}
                fontWeight={600}
                fill={C.forest}
                opacity={0.65}
                textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"}
                fontFamily={FONT}
              >
                {knDate(pts[i][0], false)}
              </text>
            ))}
          </svg>
          <div style={{ display: "flex", gap: 20, marginTop: 18, paddingTop: 20, borderTop: "2px solid #E6E3D8", opacity: done }}>
            {stat(t().latest, last[1], last[0])}
            {stat(t().highest, values[maxI], pts[maxI][0])}
            {stat(t().lowest, values[minI], pts[minI][0])}
          </div>
        </div>
      </Column>
      <FootNote>{t().trendFoot}</FootNote>
    </Scene>
  );
};

/* ---------- scene 6: call to action ---------- */

const Cta: React.FC = () => {
  const f = useCurrentFrame();
  const a = usePop(0);
  const b = usePop(10, 10);
  const c = usePop(20);
  const shine = interpolate((f - 20) % 50, [0, 26], [-30, 130], clamp);
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: C.ivory, justifyContent: "center", alignItems: "center", textAlign: "center", paddingBottom: 140 }}>
      <div style={{ opacity: a, transform: `scale(${0.7 + a * 0.3}) translateY(${Math.sin(f / 14) * 6}px)` }}>
        <PalmMark size={200} progress={1} />
      </div>
      <div style={{ fontSize: 60, fontWeight: 800, marginTop: 24, lineHeight: 1.35, opacity: a, padding: "0 90px" }}>
        {t().ctaA}
        <br />
        {t().ctaB}
      </div>
      <div
        style={{
          marginTop: 40,
          position: "relative",
          overflow: "hidden",
          background: C.ivory,
          color: C.forest,
          fontSize: 76,
          fontWeight: 800,
          padding: "24px 60px",
          borderRadius: 999,
          transform: `scale(${b})`,
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
      <div style={{ marginTop: 46, fontSize: 42, fontWeight: 700, opacity: c }}>{t().share}</div>
      <div style={{ marginTop: 12, fontSize: 36, fontWeight: 600, opacity: c * 0.85 }}>{t().follow} @adike_naadi</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, width: 820, marginTop: 56 }}>
        {t().features.map((label, i) => {
          const p = usePop(26 + i * 4, 12);
          return (
            <div key={label} style={{ background: GLASS, border: `2px solid ${LINE}`, borderRadius: 24, padding: "20px 0", fontSize: 38, fontWeight: 700, transform: `scale(${p})` }}>
              {label}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 50, fontSize: 32, fontWeight: 500, opacity: c * 0.7 }}>{t().disclaimer}</div>
    </AbsoluteFill>
  );
};

/* ---------- composition ---------- */

/** Sits below the main column, where the Reels caption may cover it; nothing essential lives here. */
const SourceStrip: React.FC<{ end: number }> = ({ end }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [6, 20, end - 10, end], [0, 1, 1, 0], clamp);
  return (
    <div style={{ position: "absolute", top: 1640, left: 64, width: 870, fontFamily: FONT, color: C.ivory, opacity: o * 0.8 }}>
      <svg width={870} height={40} viewBox="0 0 870 40" style={{ display: "block" }}>
        <path d="M0 20 L360 20 L380 20 L396 4 L418 36 L436 10 L450 20 L870 20" stroke={C.leaf} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, fontWeight: 600, marginTop: 14, opacity: 0.75 }}>
        <span>MAMCOS · TSS · TUMCOS · AGMARKNET</span>
        <span>adikenaadi.com</span>
      </div>
    </div>
  );
};

const ProgressBar: React.FC<{ total: number }> = ({ total }) => {
  const f = useCurrentFrame();
  return <div style={{ position: "absolute", top: 0, left: 0, height: 8, width: `${(f / total) * 100}%`, background: C.leaf }} />;
};

export const DailyRates: React.FC<DailyRatesProps> = ({ data, voice, music, lang: language = "kn" }) => {
  setLang(language);
  const newest = [...data.coop.flatMap((b) => b.latest.map((q) => q.date)), ...data.apmc.map((r) => r.date)].sort().at(-1) ?? "";
  const durs = sceneDurations({ voice });
  const total = durs.reduce((a, b) => a + b, 0);
  const render = (k: SceneKey, dur: number): React.ReactNode => {
    const p = { d: data, newest, dur };
    switch (k) {
      case "glance": return <Glance {...p} />;
      case "mamcos": return <Mamcos {...p} />;
      case "tss": return <Tss {...p} />;
      case "others": return <Others {...p} />;
      case "trend": return <Trend {...p} />;
      case "cta": return <Cta />;
    }
  };
  let from = 0;
  return (
    <AbsoluteFill>
      <Background />
      {/* Composed to this video's scenes by scripts/make-music.py --daily; low enough to sit under the voice. */}
      {music && <Audio src={staticFile(music)} volume={0.16} />}
      {SCENES.map((k, i) => {
        const clip = voice?.[k];
        const seq = (
          <Sequence key={k} from={from} durationInFrames={durs[i]}>
            {render(k, durs[i])}
            {clip && (
              <Sequence from={VOICE_DELAY}>
                <Audio src={staticFile(clip.src)} />
              </Sequence>
            )}
          </Sequence>
        );
        from += durs[i];
        return seq;
      })}
      <SourceStrip end={total - durs[durs.length - 1]} />
      <ProgressBar total={total} />
    </AbsoluteFill>
  );
};
