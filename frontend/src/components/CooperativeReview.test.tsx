import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LanguageContext } from "../services/language";
import type { Language } from "../services/formatting";
import type { CooperativeQuote } from "../services/cooperative";
import { QueueRow } from "./CooperativeReview";

const quote: CooperativeQuote = {
  id: "q1", source_key: "mamcos", branch: "SAGARA", reporting_date: "2026-11-05", variety: "RASHI EDI",
  minimum_price: 45000, maximum_price: 47000, average_price: 46000, price_type: "reported_average", price_unit: "INR/quintal",
  source_url: "https://example.org", fetched_at: "2026-11-05T12:00:00Z", status: "pending", unit_status: "source_confirmed", normal_price: null,
};
const render = (row: CooperativeQuote, language: Language = "en") => renderToStaticMarkup(
  <LanguageContext.Provider value={{ language, setLanguage: () => undefined }}><QueueRow row={row} busy={false} onReview={() => undefined} /></LanguageContext.Provider>);

describe("cooperative review queue row", () => {
  it("says why automatic checks hold a quotation and when it will be rejected automatically", () => {
    const held = { ...quote, hold_reason: "average 46000 is more than 20% from the recent branch median 30000", held_at: "2026-11-01T03:00:00Z", auto_reject_at: "2026-11-15T03:00:00Z" };
    const html = render(held);
    expect(html).toContain("Held by automatic checks since");
    expect(html).toContain('<span lang="en">average 46000 is more than 20% from the recent branch median 30000</span>');
    expect(html).toContain("otherwise it is rejected automatically from");
    expect(render(held, "kn")).toContain("ಸ್ವಯಂ ಪರಿಶೀಲನೆ ತಡೆಹಿಡಿದಿದೆ");
  });
  it("shows no hold note for a quotation that is simply waiting", () => {
    expect(render(quote)).not.toContain("Held by automatic checks");
  });
});
