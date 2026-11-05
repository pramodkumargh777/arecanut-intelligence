export const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

export function calendarDateToTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid calendar date: ${value}`);
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return time;
}

export function formatCalendarDate(value: string): string {
  return new Date(calendarDateToTime(value)).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export function formatCalendarMonth(value: string): string {
  return new Date(calendarDateToTime(`${value}-01`)).toLocaleDateString("en-IN", {
    month: "short", year: "numeric", timeZone: "UTC",
  });
}

export function formatChartDate(time: number): string {
  if (!Number.isFinite(time)) throw new Error("Invalid chart time");
  return formatCalendarDate(new Date(time).toISOString().slice(0, 10));
}

export function timestampToTime(value: string): number {
  // D1 CURRENT_TIMESTAMP is UTC but has no suffix. Never interpret it in browser-local time.
  const canonical = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(canonical)) {
    throw new Error(`Timestamp requires an explicit timezone: ${value}`);
  }
  calendarDateToTime(canonical.slice(0, 10));
  const time = Date.parse(canonical);
  if (!Number.isFinite(time)) throw new Error(`Invalid timestamp: ${value}`);
  return time;
}

export function formatTimestampIST(value: string): string {
  return `${new Date(timestampToTime(value)).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    second: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  })} IST`;
}

export function calendarTodayIST(now = new Date()): string {
  if (!Number.isFinite(now.valueOf())) throw new Error("Invalid current time");
  return new Date(now.valueOf() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function shiftCalendarMonth(month: string, offset: number): string {
  calendarDateToTime(`${month}-01`);
  if (!Number.isInteger(offset)) throw new Error("Invalid month offset");
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + offset, 1)).toISOString().slice(0, 7);
}

export function completedMonthIST(now = new Date()): string {
  return shiftCalendarMonth(calendarTodayIST(now).slice(0, 7), -1);
}
