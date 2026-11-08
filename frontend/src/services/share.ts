/** A rate as one line of a shared message. The date is given only when it differs from the message's report date. */
export type ShareLine = { place: string; price: string; date?: string };

/** Lines beyond this are counted, not listed, so the message stays readable in a chat. */
export const MAX_SHARE_LINES = 8;

/**
 * Plain text for a chat message: title, report date, one line per rate, the price basis and a link back.
 * WhatsApp shows `*text*` as bold, and other apps show the asterisks harmlessly.
 */
export function shareMessage({ title, date, lines, more, note, url }: { title: string; date?: string; lines: ShareLine[]; more: (count: number) => string; note: string; url: string }) {
  const shown = lines.slice(0, MAX_SHARE_LINES);
  return [
    `*${title}*`,
    ...(date ? [date] : []),
    "",
    ...shown.map((line) => `• ${line.place}: ${line.price}${line.date ? ` (${line.date})` : ""}`),
    ...(lines.length > shown.length ? [more(lines.length - shown.length)] : []),
    "",
    note,
    `Areca Pulse: ${url}`,
  ].join("\n");
}

export type ShareOutcome = "shared" | "whatsapp" | "cancelled";

/**
 * Opens the phone's share sheet where the browser has one, and WhatsApp otherwise. The link goes inside the text
 * rather than as a separate `url`, because some apps keep only one of the two.
 */
export async function shareText(text: string, title: string): Promise<ShareOutcome> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text });
      return "shared";
    } catch (error) {
      // Closing the share sheet is a choice, not a failure; any other error falls through to WhatsApp.
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  return "whatsapp";
}
