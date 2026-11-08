import { Check, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { shareText, type ShareOutcome } from "../services/share";

export type ShareLabels = { share: string; opening: string; shared: string; whatsapp: string };

/** How long the confirmation stays before the button reads "Share" again. */
const DONE_MS = 2500;

/**
 * The message is built on click, so it carries the rates on screen at that moment and the page's own address. The
 * button then says what happened (share sheet used, or WhatsApp opened), and the same words are announced.
 */
export function ShareButton({ labels, ariaLabel, title, message }: { labels: ShareLabels; ariaLabel: string; title: string; message: () => string }) {
  const [state, setState] = useState<"idle" | "opening" | ShareOutcome>("idle");
  useEffect(() => {
    if (state !== "shared" && state !== "whatsapp") return;
    const timer = setTimeout(() => setState("idle"), DONE_MS);
    return () => clearTimeout(timer);
  }, [state]);
  async function share() {
    setState("opening");
    const outcome = await shareText(message(), title);
    setState(outcome === "cancelled" ? "idle" : outcome);
  }
  const done = state === "shared" || state === "whatsapp";
  const text = state === "opening" ? labels.opening : state === "shared" ? labels.shared : state === "whatsapp" ? labels.whatsapp : labels.share;
  return <>
    <button type="button" className={`rate-share${done ? " rate-share-done" : ""}`} aria-label={ariaLabel} disabled={state === "opening"} onClick={() => void share()}>
      {done ? <Check size={14} aria-hidden="true" /> : <Share2 size={14} aria-hidden="true" />}<span aria-hidden="true">{text}</span>
    </button>
    <span className="sr-only" role="status">{state === "idle" ? "" : text}</span>
  </>;
}
