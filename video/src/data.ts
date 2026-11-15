/**
 * Live figures for the promo, read from the public Areca Pulse API just before each render (Remotion's
 * calculateMetadata), so the video always carries the rates of the day it was made. A failed read stops the render:
 * the video never shows an invented or stale price.
 */
export const API = "https://ani-market-api.arecanut.workers.dev/api/v1";

export type RateRange = { source: "MAMCOS" | "TSS"; variety: string; low: number; high: number; branches: number; date: string };
export type PromoData = { rates: RateRange[]; trend: { month: string; price: number }[]; trendVariety: string; madeOn: string };

async function json<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

type Quote = { branch: string; average_price: number | null; reporting_date: string };

/** The range of branch averages on the cooperative's latest reporting date, as the site's "at a glance" shows it. */
async function range(source: "mamcos" | "tss", variety: string, label: string): Promise<RateRange> {
  const body = await json<{ latest_by_branch: Quote[] }>(`/cooperative/prices?${new URLSearchParams({ source, variety })}`);
  const rows = body.latest_by_branch.filter((row) => row.average_price !== null);
  const date = rows.reduce((latest, row) => (row.reporting_date > latest ? row.reporting_date : latest), "");
  const sameDay = rows.filter((row) => row.reporting_date === date).map((row) => row.average_price!);
  if (!sameDay.length) throw new Error(`No ${source} ${variety} rates`);
  return { source: source === "mamcos" ? "MAMCOS" : "TSS", variety: label, low: Math.min(...sameDay), high: Math.max(...sameDay), branches: sameDay.length, date };
}

export async function loadPromoData(): Promise<PromoData> {
  const rates = await Promise.all([
    range("mamcos", "RASHI EDI", "ರಾಶಿ"), range("tss", "RASHI", "ರಾಶಿ"),
    range("mamcos", "CHALI", "ಚಾಲಿ"), range("tss", "CHALI", "ಚಾಲಿ"),
  ]);
  const months = await json<{ points: { reporting_month: string; weighted_price: number | null }[] }>("/history/monthly?variety=Rashi&basis=long&from=2025-11&to=2026-10");
  const trend = months.points.filter((point) => point.weighted_price !== null).map((point) => ({ month: point.reporting_month, price: point.weighted_price! }));
  if (trend.length < 6) throw new Error("Too few months of Rashi history");
  return { rates, trend, trendVariety: "ರಾಶಿ", madeOn: new Date().toISOString().slice(0, 10) };
}

const KN_MONTHS = ["ಜನವರಿ", "ಫೆಬ್ರವರಿ", "ಮಾರ್ಚ್", "ಏಪ್ರಿಲ್", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗಸ್ಟ್", "ಸೆಪ್ಟೆಂಬರ್", "ಅಕ್ಟೋಬರ್", "ನವೆಂಬರ್", "ಡಿಸೆಂಬರ್"];
export const knDate = (date: string) => `${Number(date.slice(8, 10))} ${KN_MONTHS[Number(date.slice(5, 7)) - 1]}`;
export const knMonth = (month: string) => KN_MONTHS[Number(month.slice(5, 7)) - 1];
export const rupees = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
