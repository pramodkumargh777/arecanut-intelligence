/**
 * "Today's rates" questions and answers for the home page and each town page. They are written when the site is built
 * (vite.config.ts), from the same rates the page shows, into /faq.json and into each page's FAQPage structured data;
 * the app shows the same text in a collapsed section (components/PageFaq.tsx), so what search engines read is what a
 * visitor can open. Plain data only, so the build can import it without the app.
 */
export type Bilingual = { kn: string; en: string };
export type FaqItem = { q: Bilingual; a: Bilingual };
/** Page path → its questions. */
export type FaqFile = Record<string, FaqItem[]>;

export const FAQ_FILE = "/faq.json";

/** schema.org FAQPage for one page, in the site's default language (Kannada), which is what a crawler is shown. */
export function faqJsonLd(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: "kn",
    mainEntity: items.map((item) => ({ "@type": "Question", name: item.q.kn, acceptedAnswer: { "@type": "Answer", text: item.a.kn } })),
  };
}

/** The question every page ends with: how fresh the rates are. Matches the API's 09:00 and 20:00 IST collections. */
export const UPDATE_QUESTION: FaqItem = {
  q: { kn: "ಅಡಿಕೆ ನಾಡಿಯಲ್ಲಿ ಧಾರಣೆ ಎಷ್ಟು ಬಾರಿ ನವೀಕರಣವಾಗುತ್ತದೆ?", en: "How often are the rates on Areca Pulse updated?" },
  a: {
    kn: "ಸಹಕಾರಿ ಸಂಘಗಳು ಮತ್ತು ಎಪಿಎಂಸಿಗಳು ಪ್ರಕಟಿಸುವ ದರಗಳನ್ನು ದಿನಕ್ಕೆ ಎರಡು ಬಾರಿ, ಬೆಳಿಗ್ಗೆ 9 ಮತ್ತು ರಾತ್ರಿ 8 ಗಂಟೆಗೆ ಸಂಗ್ರಹಿಸಲಾಗುತ್ತದೆ. ಪ್ರತಿ ದರದ ಜೊತೆಗೆ ಅದರ ವರದಿಯ ದಿನಾಂಕ ಮತ್ತು ಮೂಲ ಇರುತ್ತದೆ.",
    en: "Rates published by the cooperatives and APMCs are collected twice a day, at 9 am and 8 pm IST. Every rate is shown with its report date and source.",
  },
};
