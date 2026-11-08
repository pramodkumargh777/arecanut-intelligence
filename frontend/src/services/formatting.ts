import { calendarDateToTime, formatCalendarDate, formatCalendarMonth, formatTimestampIST, MONTH_NAMES_KN, timestampToTime } from "../../../shared/dates";

/** Plain formatters with no React dependency, so non-UI code (and the API's tests) can use them. */
export type Language = "kn" | "en";

const KN_MONTHS_SHORT = MONTH_NAMES_KN;

/** Calendar date ("2026-11-04") for a reader: "4 Nov 2026" or "4 ನವೆಂಬರ್ 2026". */
export function formatDate(value: string, language: Language): string {
  // Source dates that are not plain calendar dates are shown exactly as published rather than failing the page.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (language === "en") return formatCalendarDate(value);
  const date = new Date(calendarDateToTime(value));
  return `${date.getUTCDate()} ${KN_MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Reporting month ("2026-11"): "Nov 2026" or "ನವೆಂಬರ್ 2026". */
export function formatMonth(value: string, language: Language): string {
  if (language === "en") return formatCalendarMonth(value);
  const date = new Date(calendarDateToTime(`${value}-01`));
  return `${KN_MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Instant in India time: "4 Nov 2026, 18:00:00 IST" or "4 ನವೆಂಬರ್ 2026, 18:00:00 IST". */
export function formatTimestamp(value: string, language: Language): string {
  if (language === "en") return formatTimestampIST(value);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  }).formatToParts(new Date(timestampToTime(value))).map((part) => [part.type, part.value]));
  return `${parts.day} ${KN_MONTHS_SHORT[Number(parts.month) - 1]} ${parts.year}, ${parts.hour}:${parts.minute}:${parts.second} IST`;
}

