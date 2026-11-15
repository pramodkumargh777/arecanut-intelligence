import { AbsoluteFill } from "remotion";
import { C, FONT } from "./brand";
import { PalmMark } from "./BrandIntro";
import type { CoopBlock, RatesData } from "./data/rates";
import { change, fmtDate, place, rupees } from "./format";
import { setLang, t, type Lang } from "./i18n";

/**
 * The daily rates Story: one still image, 1080×1920, for Instagram Stories and WhatsApp Status. Same data and rules as
 * the daily Reel (src/data/rates.ts): each card is one source and one exact variety, never merged; the range is the
 * branch averages on that source's latest reporting date, and that date is printed on the card. Instagram covers the
 * top ~250px (progress bar, name) and bottom ~300px (reply bar), so content stays between them.
 */
export type DailyStoryProps = { data: RatesData; lang?: Lang };

const S = {
  kn: { title: "ಇಂದಿನ ಅಡಿಕೆ ಧಾರಣೆ", sub: "ಸಹಕಾರಿ ಸಂಘಗಳ ಇತ್ತೀಚಿನ ವರದಿ", areca: "ಅಡಿಕೆ", branches: (n: number) => `${n} ${n === 1 ? "ಶಾಖೆ" : "ಶಾಖೆಗಳು"}`,
    vsPrev: "ಹಿಂದಿನ ವರದಿಗೆ", same: "ಬದಲಾವಣೆ ಇಲ್ಲ", more: "ಎಲ್ಲಾ ಶಾಖೆಗಳ ದರ", assumed: "* TSS, TUMCOS ಘಟಕ ತಿಳಿಸುವುದಿಲ್ಲ; ₹/ಕ್ವಿಂಟಾಲ್ ಎಂದು ಊಹಿಸಲಾಗಿದೆ",
    perQuintal: "ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ" },
  en: { title: "Today's arecanut rates", sub: "Latest cooperative reports", areca: "Arecanut", branches: (n: number) => `${n} branch${n === 1 ? "" : "es"}`,
    vsPrev: "vs previous report", same: "No change", more: "Every branch's rate", assumed: "* TSS and TUMCOS state no unit; ₹/quintal is assumed",
    perQuintal: "per quintal" },
};

const SOURCE: Record<CoopBlock["source"], string> = { mamcos: "MAMCOS", tss: "TSS", tumcos: "TUMCOS" };

/** One card's figures: the branch averages on the source's latest date, and their median change from each branch's previous report. */
function summary(block: CoopBlock) {
  const date = block.latest.reduce((latest, quote) => (quote.date > latest ? quote.date : latest), "");
  const day = block.latest.filter((quote) => quote.date === date);
  const prices = day.map((quote) => quote.avg);
  const changes = day.map((quote) => change(quote.avg, quote.prevAvg)).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const median = changes.length ? (changes.length % 2 ? changes[(changes.length - 1) / 2] : (changes[changes.length / 2 - 1] + changes[changes.length / 2]) / 2) : null;
  return { date, count: day.length, branch: day.length === 1 ? day[0].branch : null, low: Math.min(...prices), high: Math.max(...prices), median };
}

function Card({ block, s }: { block: CoopBlock; s: (typeof S)["kn"] }) {
  const x = summary(block);
  if (!x.count) return null;
  const name = block.source === "tumcos" ? s.areca : /CHALI/i.test(block.variety) ? t().chali : t().rashi;
  const assumed = block.source !== "mamcos";
  const tone = x.median === null || Math.abs(x.median) < 0.05 ? null : x.median > 0 ? "up" : "down";
  return <div style={{ background: "rgba(255,255,255,0.07)", border: "2px solid rgba(255,255,255,0.13)", borderRadius: 26, padding: "16px 28px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <span style={{ background: "rgba(110,159,67,0.28)", color: C.frond, borderRadius: 12, padding: "4px 14px", fontSize: 24, fontWeight: 700, letterSpacing: 2 }}>{SOURCE[block.source]}</span>
        <span style={{ fontSize: 38, fontWeight: 700 }}>{name}</span>
      </div>
      <span style={{ fontSize: 28, opacity: 0.8 }}>{fmtDate(x.date, false)}</span>
    </div>
    <div style={{ marginTop: 2, fontSize: 58, lineHeight: 1.15, fontWeight: 750, fontVariantNumeric: "tabular-nums", letterSpacing: -1 }}>
      {x.low === x.high ? rupees(x.low) : <>{rupees(x.low)}<span style={{ opacity: 0.55 }}> – </span>{rupees(x.high)}</>}{assumed && <span style={{ fontSize: 40, opacity: 0.7 }}>*</span>}
    </div>
    <div style={{ marginTop: 2, display: "flex", justifyContent: "space-between", fontSize: 27, opacity: 0.85 }}>
      {/* One branch: say which (Sirsi, Sagara…), as the Reel does; several: how many. */}
      <span>{s.perQuintal} · {x.branch ? place(x.branch) : s.branches(x.count)}</span>
      {x.median !== null && <span style={{ color: tone === "up" ? "#8FE0A8" : tone === "down" ? "#F5A693" : C.ivory, fontWeight: 650 }}>
        {tone ? `${tone === "up" ? "↑" : "↓"} ${Math.abs(x.median).toFixed(1)}% ${s.vsPrev}` : s.same}</span>}
    </div>
  </div>;
}

export const DailyStory: React.FC<DailyStoryProps> = ({ data, lang = "kn" }) => {
  setLang(lang);
  const s = S[lang];
  const blocks = data.coop.filter((block) => block.latest.length);
  const newest = blocks.flatMap((block) => block.latest.map((quote) => quote.date)).sort().at(-1) ?? "";
  return <AbsoluteFill style={{ background: `radial-gradient(120% 70% at 50% 0%, ${C.forestLight} 0%, ${C.forest} 45%, ${C.forestDeep} 100%)`, color: C.ivory, fontFamily: FONT }}>
    <div style={{ position: "absolute", top: 250, bottom: 300, left: 64, right: 64, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 46, fontWeight: 750 }}>
          <PalmMark size={64} progress={1} />
          <span>{t().brandA} <span style={{ color: C.leaf }}>{t().brandB}</span></span>
        </span>
        <span style={{ fontSize: 30, opacity: 0.85 }}>{fmtDate(newest)}</span>
      </div>
      <div><div style={{ fontSize: 66, fontWeight: 750, lineHeight: 1.15 }}>{s.title}</div><div style={{ fontSize: 30, color: C.frond, marginTop: 4 }}>{s.sub}</div></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4 }}>{blocks.map((block) => <Card key={`${block.source}-${block.variety}`} block={block} s={s} />)}</div>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8, alignItems: "center", textAlign: "center" }}>
        <div style={{ fontSize: 30 }}>{s.more}: <span style={{ background: C.leaf, color: C.forestDeep, fontWeight: 750, borderRadius: 999, padding: "6px 24px" }}>adikenaadi.com</span></div>
        <div style={{ fontSize: 22, opacity: 0.7 }}>{s.assumed}</div>
        <div style={{ fontSize: 22, opacity: 0.7 }}>{t().disclaimer}</div>
      </div>
    </div>
  </AbsoluteFill>;
};
