/**
 * Knowledge cards: short, clean answers to the crop questions growers ask most, written from the ingested booklets
 * and approved by a subject expert. Booklet passages are often scanned (their digits cannot be trusted) or garbled
 * Kannada OCR; an approved card is the clean, checked version of what they say, so the assistant can state it directly.
 *
 * Rules:
 * - A card is used only when `status` is "reviewed". Drafts are inert: nothing a reader sees changes until a reviewer
 *   (an agronomist, KVK or CPCRI scientist, or an experienced grower) has checked every sentence against the cited pages.
 * - Every number in a card must appear on a cited page. Approved cards count as verified evidence, so the model may
 *   repeat their numbers.
 * - Name no banned or restricted pesticide (pesticides.ts); retrieval and grounding refuse them anyway.
 * - Keep the Kannada and English text saying the same thing. Keep each card under about 120 words.
 *
 * To approve a card: check it against the source pages, then set status "reviewed", reviewed_by (name and role) and
 * reviewed_on (YYYY-MM-DD). To withdraw it, set status back to "draft".
 */
import { diseasesNamed } from "./diseases";

export type KnowledgeCard = {
  id: string;
  /** Disease names from diseases.ts that this card answers. */
  diseases: string[];
  /** Further question words (English and Kannada) that make the card relevant. */
  keywords?: RegExp;
  title: { en: string; kn: string };
  body: { en: string; kn: string };
  sources: { document: string; pages: string; url: string }[];
  status: "draft" | "reviewed";
  reviewed_by?: string;
  reviewed_on?: string;
};

export const KNOWLEDGE_CARDS: KnowledgeCard[] = [
  {
    id: "koleroga-management",
    diseases: ["koleroga (fruit rot)"],
    title: { en: "Koleroga (Mahali): signs and control", kn: "ಕೊಳೆ ರೋಗ (ಮಹಾಳಿ): ಲಕ್ಷಣ ಮತ್ತು ನಿರ್ವಹಣೆ" },
    body: {
      en: "Koleroga is a fungal rot of arecanut fruits that comes with the south-west monsoon. The first sign is a water-soaked patch near the fruit stalk; the nuts lose their shine, rot and fall, and white fungal growth appears on fallen nuts. Spray 1% Bordeaux mixture as a protection: the first spray after the pre-monsoon showers and the second 40–45 days later, with a third if the monsoon continues. Cover the whole bunch with a fine spray. Collect and destroy fallen and infected nuts regularly.",
      kn: "ಕೊಳೆ ರೋಗ ನೈಋತ್ಯ ಮುಂಗಾರಿನಲ್ಲಿ ಅಡಿಕೆ ಕಾಯಿಗಳಿಗೆ ಬರುವ ಶಿಲೀಂಧ್ರ ರೋಗ. ಮೊದಲು ಕಾಯಿಯ ತೊಟ್ಟಿನ ಬಳಿ ನೀರು ತುಂಬಿದಂತಹ ಕಲೆ ಕಾಣುತ್ತದೆ; ಕಾಯಿ ಹೊಳಪು ಕಳೆದುಕೊಂಡು ಕೊಳೆತು ಉದುರುತ್ತದೆ, ಉದುರಿದ ಕಾಯಿಗಳ ಮೇಲೆ ಬಿಳಿ ಶಿಲೀಂಧ್ರ ಬೆಳೆಯುತ್ತದೆ. ರಕ್ಷಣೆಗಾಗಿ 1% ಬೋರ್ಡೋ ಮಿಶ್ರಣ ಸಿಂಪಡಿಸಿ: ಮೊದಲನೆಯದು ಮುಂಗಾರು ಪೂರ್ವ ಮಳೆಯ ನಂತರ, ಎರಡನೆಯದು 40–45 ದಿನಗಳ ನಂತರ; ಮಳೆ ಮುಂದುವರಿದರೆ ಮೂರನೆಯದು. ಗೊನೆ ಪೂರ್ತಿ ಸೂಕ್ಷ್ಮವಾಗಿ ಸಿಂಪಡಿಸಿ. ಉದುರಿದ ಮತ್ತು ರೋಗಪೀಡಿತ ಕಾಯಿಗಳನ್ನು ಆಗಾಗ ಸಂಗ್ರಹಿಸಿ ನಾಶಮಾಡಿ.",
    },
    sources: [{ document: "Koleroga (Mahali) of Arecanut, CPCRI Extension Folder No. 17 (1989)", pages: "pp. 1–3", url: "https://cpcri.gov.in/filemgr/webfs/publication/ext17.pdf" }],
    // Drafted from the scanned English folder; the scan drops the lime quantity for Bordeaux mixture, so the
    // preparation is left out until a reviewer adds it from the printed page.
    status: "draft",
  },
];

/** Approved cards that answer the question, best match first; at most two. Drafts are never returned. */
export function cardsFor(question: string, cards: KnowledgeCard[] = KNOWLEDGE_CARDS): KnowledgeCard[] {
  const named = new Set(diseasesNamed(question).map((disease) => disease.name));
  return cards
    .filter((card) => card.status === "reviewed" && card.reviewed_by && card.reviewed_on)
    .map((card) => ({ card, score: card.diseases.filter((name) => named.has(name)).length * 2 + (card.keywords?.test(question) ? 1 : 0) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((entry) => entry.card);
}
