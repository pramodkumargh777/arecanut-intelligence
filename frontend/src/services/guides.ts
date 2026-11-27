/**
 * Reference text about arecanut grades: a short note per grade, the variety hub and the "Rashi and Chali" guide.
 * Every statement is paraphrased from a published source, linked beside it. Nothing here is the site's own opinion, and
 * a grade no source describes gets no note (its page says only what the data shows). Plain data only, so the build
 * (vite.config.ts) can import it without the app.
 *
 * Sources were read on 27 Nov 2026. TSS (The Totagars' Co-operative Sale Society, Sirsi) publishes an "About arecanut"
 * section; where its pages differ (red-nut drying: 7-8 days on one page, about 10 on another) both are given.
 */
export type Bilingual = { kn: string; en: string };
export type SourceLink = { label: string; url: string };

const TSS = {
  trading: { label: "TSS · Arecanut trading", url: "https://www.tssindia.in/about/branches/arecanut-trading" },
  processing: { label: "TSS · Processing", url: "https://www.tssindia.in/others/about-arecanut/problems-processing" },
  marketing: { label: "TSS · Marketing", url: "https://www.tssindia.in/others/about-arecanut/marketing" },
  quality: { label: "TSS · Quality factors", url: "https://www.tssindia.in/others/about-arecanut/quality-factors" },
  karnataka: { label: "TSS · Areca in Karnataka", url: "https://www.tssindia.in/others/about-arecanut/areca-in-karnataka" },
} satisfies Record<string, SourceLink>;

export type GradeNote = { text: Bilingual; sources: SourceLink[] };

/** Variety key (services/varieties.ts) → what the sources say about that grade. */
export const GRADE_NOTES: Record<string, GradeNote> = {
  rashi: {
    text: {
      kn: "ರಾಶಿ ಕೆಂಪು ಅಡಿಕೆಯ ಮುಖ್ಯ ದರ್ಜೆ. ಎಳೆ ಹಸಿರು ಕಾಯಿಗಳನ್ನು ಕೊಯ್ದು, ಸುಲಿದು, ಕಾಯಿಯ ಕಣ್ಣು ಬಿಡುವವರೆಗೆ ಬೇಯಿಸಿ, ಬಿಸಿಲಲ್ಲಿ ಒಣಗಿಸಲಾಗುತ್ತದೆ. ಹೊಳೆಯುವ ಕೆಂಪು ಬಣ್ಣಕ್ಕಾಗಿ ಬೇಯಿಸಿದ ನೀರನ್ನು ಮತ್ತೆ ಕುದಿಸಿ ತಯಾರಿಸುವ ಚೊಗರನ್ನು ಲೇಪಿಸಲಾಗುತ್ತದೆ. ವ್ಯಾಪಾರಿಗಳು ಕೆಂಪು ಅಡಿಕೆಯನ್ನು ಬೆಟ್ಟೆ (ಬರದ), ಸಣ್ಣ ರಾಶಿ, ಆಪಿ ಮುಂತಾದ ದರ್ಜೆಗಳಾಗಿ ಮತ್ತೆ ವಿಂಗಡಿಸುತ್ತಾರೆ. ಸುಲಿದು ಬೇಯಿಸಿ ಒಣಗಿಸಿದ ಇಡೀ ಅಡಿಕೆಗೆ (ರಾಶಿ) ಶಿರಸಿ ಮಾರುಕಟ್ಟೆ ಹೆಸರುವಾಸಿ.",
      en: "Rashi is the main grade of red arecanut. Tender green nuts are harvested, peeled and boiled until the nut's \"eye\" comes out, then sun-dried; for a glossy red colour they are coated with chogaru, the boiling water reboiled into a thick extract. Traders sort red arecanut further into grades such as Bette (Barada), Sanna Rashi and Api. Sirsi is known for peeled, boiled and dried whole nuts (Rashi).",
    },
    sources: [TSS.trading, TSS.processing, TSS.karnataka],
  },
  chali: {
    text: {
      kn: "ಚಾಲಿ ಬಿಳಿ ಅಡಿಕೆ. ಪೂರ್ತಿ ಹಣ್ಣಾದ ಕಾಯಿಗಳನ್ನು ಸಿಪ್ಪೆ ಸಮೇತ ಸುಮಾರು 40–45 ದಿನ ಬಿಸಿಲಲ್ಲಿ ಒಣಗಿಸಿ, ನಂತರ ಸುಲಿಯಲಾಗುತ್ತದೆ; ಇದಕ್ಕೆ ಬಣ್ಣ ಹಾಕುವುದಿಲ್ಲ. ಬೆಳೆಗಾರರು ಇದನ್ನು ಚಾಲಿ, ಬಿಳೆಗೋಟು, ಕೋಕಾ ಮುಂತಾದ ದರ್ಜೆಗಳಾಗಿ ವಿಂಗಡಿಸುತ್ತಾರೆ; ವ್ಯಾಪಾರಿಗಳು ಮತ್ತೆ ಗಾತ್ರ, ಗುಣಮಟ್ಟದ ಆಧಾರದ ಮೇಲೆ ದರ್ಜೆ ಮಾಡುತ್ತಾರೆ. ಮುಂಬೈ, ಗುಜರಾತ್ ಮಾರುಕಟ್ಟೆಗಳಲ್ಲಿ ಚಾಲಿಗೆ ಬೇಡಿಕೆ ಇದೆ; ಕರಾವಳಿಯ ಮಾರುಕಟ್ಟೆಗಳು ಚಾಲಿಗೆ ಹೆಸರುವಾಸಿ.",
      en: "Chali is white arecanut. Fully ripe nuts are dried in the sun in their husk for about 40–45 days and then dehusked; it is not coloured. Farmers sort it into grades such as Chali, Bilegotu and Koka, and traders grade it again by size and quality. Chali is in demand in the Mumbai and Gujarat markets, and the coastal markets are known for it.",
    },
    sources: [TSS.trading, TSS.processing, TSS.marketing],
  },
  bette: {
    text: {
      kn: "ಬೆಟ್ಟೆ ಕೆಂಪು (ಬೇಯಿಸಿದ) ಅಡಿಕೆಯ ದೊಡ್ಡ ಗಾತ್ರದ ದರ್ಜೆ. ಟಿಎಸ್‌ಎಸ್ ಇದನ್ನು ಬರದ ಎಂದೂ ಕರೆಯುತ್ತದೆ ಮತ್ತು ರಾಶಿಯ ಉಪದರ್ಜೆಯಾಗಿ ಪಟ್ಟಿ ಮಾಡುತ್ತದೆ. ಕಾಯಿ ದೊಡ್ಡದಾದ್ದರಿಂದ 12 ದಿನಕ್ಕೂ ಹೆಚ್ಚು ಬಿಸಿಲಲ್ಲಿ ಒಣಗಿಸಬೇಕು. ಉತ್ತರ ಕನ್ನಡದಲ್ಲಿ ಶಿರಸಿ, ಸಿದ್ದಾಪುರ, ಯಲ್ಲಾಪುರ, ಜೊಯಿಡಾ ಮತ್ತು ಭಟ್ಕಳದ ಕೆಲ ಭಾಗ ಬೆಟ್ಟೆ ಪೂರೈಸುತ್ತವೆ; ಬರದ ಉತ್ತರ ಕರ್ನಾಟಕದ ಚಿಲ್ಲರೆ ವ್ಯಾಪಾರಿಗಳಿಗೆ ಹೋಗುತ್ತದೆ.",
      en: "Bette is a red (boiled) grade of large nuts; TSS also calls it Barada and lists it under Rashi. Because the nuts are big, it needs more than 12 days of sun-drying. In Uttara Kannada, Sirsi, Siddapur, Yellapur, Joida and parts of Bhatkal supply Bette, and Barada goes to retailers in north Karnataka.",
    },
    sources: [TSS.trading, TSS.processing, TSS.quality],
  },
  api: {
    text: {
      kn: "ಆಪಿ (ಚಿಕಣಿ ಎಂದೂ ಕರೆಯುತ್ತಾರೆ) ಕೆಂಪು, ಬೇಯಿಸಿದ ಅಡಿಕೆಯ ದರ್ಜೆ. ಸಾಮಾನ್ಯ ಕೊಯ್ಲಿಗಿಂತ ಸ್ವಲ್ಪ ಮೊದಲು ಕೊಯ್ದ ಎಳೆ ಕಾಯಿಯಿಂದ ಉತ್ತಮ ಆಪಿ ತಯಾರಾಗುತ್ತದೆ; ಮುರಿದಾಗ ಒಳಗೆ ಕೆನೆ ಬಿಳಿ ಬಣ್ಣ ಕಾಣಬೇಕು. ಯಲ್ಲಾಪುರ ಮಾರುಕಟ್ಟೆ ಕೆಂಪು ಅಡಿಕೆ ಮತ್ತು ಆಪಿಗೆ ಹೆಸರುವಾಸಿ; ಆಪಿ ರಾಜಸ್ಥಾನದಲ್ಲಿ ಬಳಕೆಯಾಗುತ್ತದೆ ಎನ್ನುತ್ತದೆ ಟಿಎಸ್‌ಎಸ್.",
      en: "Api (also called Chikani) is a red, boiled grade. TSS says the best Api is made from tender nuts harvested a little before the normal harvest, and shows a creamy white colour when broken. Yellapur is known for red arecanut and Api, and TSS says Api is consumed in Rajasthan.",
    },
    sources: [TSS.quality, TSS.marketing, TSS.trading],
  },
  "sanna-rashi": {
    text: {
      kn: "ಸಣ್ಣ ರಾಶಿ ಕೆಂಪು ಅಡಿಕೆಯ ಒಂದು ದರ್ಜೆ; ಟಿಎಸ್‌ಎಸ್ ಇದನ್ನು ರಾಶಿಯ ಉಪದರ್ಜೆಯಾಗಿ ಪಟ್ಟಿ ಮಾಡುತ್ತದೆ. ಸಣ್ಣ ರಾಶಿ ದೇಶದಾದ್ಯಂತ ಪಾನ್ ಮಸಾಲಾ ತಯಾರಕರಿಗೆ ಪೂರೈಕೆಯಾಗುತ್ತದೆ ಎನ್ನುತ್ತದೆ ಟಿಎಸ್‌ಎಸ್.",
      en: "Sanna Rashi is a red arecanut grade that TSS lists under Rashi. TSS says it is supplied to pan masala manufacturers across India.",
    },
    sources: [TSS.trading],
  },
  "bile-gotu": {
    text: {
      kn: "ಬಿಳೆಗೋಟು ಬಿಳಿ (ಚಾಲಿ) ಅಡಿಕೆಯ ದರ್ಜೆ: ಒಣಗಿಸಿ ಸುಲಿದ ಹಣ್ಣಡಿಕೆಯನ್ನು ಬೆಳೆಗಾರರು ಚಾಲಿ, ಬಿಳೆಗೋಟು, ಕೋಕಾ ಮುಂತಾಗಿ ವಿಂಗಡಿಸುತ್ತಾರೆ. ಬಿಳೆಗೋಟಿನ ಗುಣಮಟ್ಟವನ್ನು ಗಟ್ಟಿತನ, ತೂಕ, ಗಾತ್ರ ಮತ್ತು ಸಿಪ್ಪೆಯ ಬಣ್ಣದಿಂದ ಅಳೆಯಲಾಗುತ್ತದೆ.",
      en: "Bilegotu is a white (Chali) grade: farmers sort dried, dehusked ripe nuts into Chali, Bilegotu, Koka and other grades. Its quality is judged by strength, weight, size and the colour of the skin.",
    },
    sources: [TSS.trading, TSS.processing, TSS.quality],
  },
  "kempu-gotu": {
    text: {
      kn: "ಕೆಂಪುಗೋಟು ಕೆಂಪು (ಬೇಯಿಸಿದ) ಅಡಿಕೆಯ ಸಾಂಪ್ರದಾಯಿಕ ದರ್ಜೆಗಳಲ್ಲಿ ಒಂದು. ಬೇಯಿಸಿ ಒಣಗಿಸಿದ ಎಳೆ ಅಡಿಕೆಯನ್ನು ಆಪಿ, ರಾಶಿ, ಬೆಟ್ಟೆ ಜೊತೆಗೆ ಕೆಂಪುಗೋಟಾಗಿಯೂ ವಿಂಗಡಿಸಲಾಗುತ್ತದೆ.",
      en: "Kempugotu is one of the traditional red (boiled) grades: boiled and dried tender nuts are sorted into Api, Rashi, Bette and Kempugotu, among others.",
    },
    sources: [TSS.marketing, TSS.processing],
  },
  "sippe-gotu": {
    text: {
      kn: "ಸಿಪ್ಪೆಗೋಟು ಸಿಪ್ಪೆ ಸಮೇತ ಇರುವ ಹಣ್ಣಡಿಕೆ. ಟಿಎಸ್‌ಎಸ್ ಪ್ರಕಾರ ಬಿಸಿಲಲ್ಲಿ ಒಣಗಿಸುವ ಮೊದಲು ಇದನ್ನು ಸಿಪ್ಪೆಗೋಟು ಎನ್ನುತ್ತಾರೆ; ಒಣಗಿಸಿದ ಮೇಲೆ ಅದು ಒಣ ಚಾಲಿ, ಸಿಪ್ಪೆ ತೆಗೆದ ಮೇಲೆ ಚಾಲಿ ಆಗುತ್ತದೆ.",
      en: "Sippegotu is ripe arecanut still in its husk. TSS says the nut is called Sippegotu before it is sun-dried; once dried it becomes dry Chali, and once dehusked, Chali.",
    },
    sources: [TSS.processing],
  },
  koka: {
    text: {
      kn: "ಕೋಕಾ ಬಿಳಿ (ಚಾಲಿ) ಅಡಿಕೆಯ ದರ್ಜೆ; ಬೆಳೆಗಾರರು ಚಾಲಿ, ಬಿಳೆಗೋಟು ಜೊತೆಗೆ ಇದನ್ನೂ ವಿಂಗಡಿಸುತ್ತಾರೆ. ಕೋಕಾದ ಗುಣಮಟ್ಟವನ್ನು ದಪ್ಪ, ಬಣ್ಣ, ವಾಸನೆ ಮತ್ತು ಬಳಕೆಯಿಂದ ಅಳೆಯಲಾಗುತ್ತದೆ ಎನ್ನುತ್ತದೆ ಟಿಎಸ್‌ಎಸ್.",
      en: "Koka is a white (Chali) grade that farmers sort out alongside Chali and Bilegotu. TSS says Koka is judged by its thickness, colour, smell and use.",
    },
    sources: [TSS.trading, TSS.quality],
  },
  "laddu-koka": {
    text: {
      kn: "ಲಡ್ಡು ಕೋಕಾ ಒಣ ಬಿಳಿ (ಚಾಲಿ) ಅಡಿಕೆಯಿಂದ ವಿಂಗಡಿಸುವ ದರ್ಜೆಗಳಲ್ಲಿ ಒಂದು ಎಂದು ಟಿಎಸ್‌ಎಸ್ ಪಟ್ಟಿ ಮಾಡುತ್ತದೆ.",
      en: "TSS lists Laddu koka (Laddukoka) among the grades sorted from dried white (Chali) arecanut.",
    },
    sources: [TSS.processing],
  },
  arigere: {
    text: {
      kn: "ಅರಗೆರೆ ಒಣ ಬಿಳಿ (ಚಾಲಿ) ಅಡಿಕೆಯ ದರ್ಜೆಗಳಲ್ಲಿ ಒಂದು; ಟಿಎಸ್‌ಎಸ್ ಇದನ್ನು ಚಾಲಿ, ಬಿಳೆಗೋಟು ಮತ್ತು ಲಡ್ಡು ಕೋಕಾ ಜೊತೆಗೆ ಪಟ್ಟಿ ಮಾಡುತ್ತದೆ.",
      en: "Aragere is one of the grades of dried white (Chali) arecanut; TSS lists it with Chali, Bilegotu and Laddukoka.",
    },
    sources: [TSS.processing],
  },
  "ch-kempu": {
    text: {
      kn: "ಚಾಲಿ ಕೆಂಪು ಒಣ ಬಿಳಿ ಅಡಿಕೆಯಿಂದ ವಿಂಗಡಿಸುವ ದರ್ಜೆ. ಖರೀದಿದಾರರನ್ನು ಸೆಳೆಯಲು ಬಣ್ಣ ಹಾಕುವುದು ಚಾಲಿ ಕೆಂಪಿಗೆ ಮಾತ್ರ ಎನ್ನುತ್ತದೆ ಟಿಎಸ್‌ಎಸ್; ಇದರ ಗುಣಮಟ್ಟವನ್ನು ದಪ್ಪ, ಬಣ್ಣ, ವಾಸನೆ ಮತ್ತು ಬಳಕೆಯಿಂದ ಅಳೆಯಲಾಗುತ್ತದೆ.",
      en: "Chali kempu is a grade sorted from dried white arecanut. TSS says it is the only one of these that is coloured, to attract buyers, and that it is judged by its thickness, colour, smell and use.",
    },
    sources: [TSS.processing, TSS.quality],
  },
  gorabalu: {
    text: {
      kn: "ಗೊರಬಲು ಶಿವಮೊಗ್ಗ ಮತ್ತು ದಾವಣಗೆರೆ ಭಾಗದ ಅಡಿಕೆ ದರ್ಜೆ; ಟಿಎಸ್‌ಎಸ್ ಇದನ್ನು ಅಲ್ಲಿನ ಆಪಿ ಮತ್ತು ಇಡಿ ಜೊತೆಗೆ ಹೆಸರಿಸುತ್ತದೆ. ಈ ತಾಣದಲ್ಲಿ ಇದರ ದರವನ್ನು ಮ್ಯಾಮ್ಕೋಸ್ ಪ್ರಕಟಿಸುತ್ತದೆ.",
      en: "Gorabalu is a grade of the Shivamogga and Davanagere area; TSS names it alongside the Api and Idi grades there. On this site its rate comes from MAMCOS.",
    },
    sources: [TSS.karnataka],
  },
};

/* ---------- the variety hub and the Rashi and Chali guide ---------- */

export const VARIETY_HUB_PATH = "/variety";
export const GUIDE_PATH = "/guide/rashi-vs-chali";

export const VARIETY_HUB_TEXT = {
  kn: {
    title: "ಅಡಿಕೆ ತಳಿಗಳು ಮತ್ತು ದರ್ಜೆಗಳು",
    intro: "ಅಡಿಕೆ ಎರಡು ಮುಖ್ಯ ವಿಧ: ಎಳೆ ಕಾಯಿಯನ್ನು ಸುಲಿದು ಬೇಯಿಸಿ ಒಣಗಿಸುವ ಕೆಂಪು ಅಡಿಕೆ (ರಾಶಿ), ಮತ್ತು ಹಣ್ಣಡಿಕೆಯನ್ನು ಸಿಪ್ಪೆ ಸಮೇತ ಒಣಗಿಸಿ ಸುಲಿಯುವ ಬಿಳಿ ಅಡಿಕೆ (ಚಾಲಿ). ಪ್ರತಿಯೊಂದನ್ನೂ ಹಲವು ದರ್ಜೆಗಳಾಗಿ ವಿಂಗಡಿಸಲಾಗುತ್ತದೆ. ಸಹಕಾರಿ ಸಂಘಗಳು ಪ್ರಕಟಿಸುವ ಪ್ರತಿ ದರ್ಜೆಯ ಇಂದಿನ ಧಾರಣೆ ಮತ್ತು ವಿವರ ಕೆಳಗಿವೆ.",
    guide: "ರಾಶಿ ಮತ್ತು ಚಾಲಿ: ವ್ಯತ್ಯಾಸವೇನು?",
    guideHint: "ಹೇಗೆ ತಯಾರಾಗುತ್ತವೆ, ಯಾವ ದರ್ಜೆಗಳು, ಎಲ್ಲಿಗೆ ಹೋಗುತ್ತವೆ",
    count: (n: number) => `${n} ದರ್ಜೆಗಳು`,
    sources: "ದರ್ಜೆಗಳ ವಿವರ: ಟಿಎಸ್‌ಎಸ್ ಶಿರಸಿಯ ಪ್ರಕಟಣೆಗಳಿಂದ, ಪ್ರತಿ ದರ್ಜೆಯ ಪುಟದಲ್ಲಿ ಮೂಲದ ಲಿಂಕ್ ಇದೆ.",
  },
  en: {
    title: "Arecanut varieties and grades",
    intro: "Arecanut comes in two main types: red arecanut (Rashi), made by peeling, boiling and drying tender nuts, and white arecanut (Chali), made by drying ripe nuts in their husk and then dehusking them. Each is sorted into many grades. Below is every grade the cooperatives publish, with today's rate and what it is.",
    guide: "Rashi and Chali: what is the difference?",
    guideHint: "How each is made, its grades and where it goes",
    count: (n: number) => `${n} grades`,
    sources: "Grade descriptions are from TSS Sirsi's published pages; each grade's page links its source.",
  },
};

export type GuideRow = { label: Bilingual; rashi: Bilingual; chali: Bilingual };

export const RASHI_CHALI_GUIDE = {
  title: { kn: "ರಾಶಿ ಮತ್ತು ಚಾಲಿ ಅಡಿಕೆ: ವ್ಯತ್ಯಾಸವೇನು?", en: "Rashi and Chali arecanut: what is the difference?" },
  intro: {
    kn: "ಅಡಿಕೆ ಎರಡು ಮುಖ್ಯ ವಿಧ: ಕೆಂಪು ಅಡಿಕೆ (ರಾಶಿ) ಮತ್ತು ಬಿಳಿ ಅಡಿಕೆ (ಚಾಲಿ). ಎರಡೂ ಒಂದೇ ಮರದ ಕಾಯಿ; ಕೊಯ್ಯುವ ಹಂತ ಮತ್ತು ಸಂಸ್ಕರಣೆ ಬೇರೆ. ಟಿಎಸ್‌ಎಸ್ ಶಿರಸಿಯ ಪ್ರಕಟಣೆಗಳ ಆಧಾರದ ಮೇಲೆ ಈ ವ್ಯತ್ಯಾಸ ಇಲ್ಲಿದೆ.",
    en: "Arecanut comes in two main types: red arecanut (Rashi) and white arecanut (Chali). Both come from the same palm; what differs is when the nut is harvested and how it is processed. This comparison is based on TSS Sirsi's published pages.",
  },
  sections: [
    {
      heading: { kn: "ರಾಶಿ (ಕೆಂಪು ಅಡಿಕೆ) ಹೇಗೆ ತಯಾರಾಗುತ್ತದೆ", en: "How Rashi (red arecanut) is made" },
      text: {
        kn: "ಸಿಪ್ಪೆ ಇನ್ನೂ ಹಸಿರಾಗಿರುವಾಗಲೇ ಎಳೆ ಕಾಯಿಗಳನ್ನು ಕೊಯ್ಯಲಾಗುತ್ತದೆ. ಕೊಯ್ಲಾದ 4–5 ದಿನಗಳಲ್ಲಿ ಸುಲಿದು, ಕಾಯಿಯ ಕಣ್ಣು ಬಿಡುವವರೆಗೆ (ಸುಮಾರು ಒಂದು ಗಂಟೆ) ತಾಮ್ರದ ಪಾತ್ರೆಯಲ್ಲಿ ಬೇಯಿಸಲಾಗುತ್ತದೆ. ನಂತರ 7–10 ದಿನ ಬಿಸಿಲಲ್ಲಿ ಒಣಗಿಸಲಾಗುತ್ತದೆ; ದೊಡ್ಡ ಗಾತ್ರದ ಬೆಟ್ಟೆಗೆ 12 ದಿನಕ್ಕೂ ಹೆಚ್ಚು ಬೇಕು. ಬೇಯಿಸಿದ ನೀರನ್ನು ಮತ್ತೆ ಕುದಿಸಿ ತಯಾರಿಸುವ ಚೊಗರನ್ನು ಲೇಪಿಸಿದಾಗ ಅಡಿಕೆಗೆ ಹೊಳೆಯುವ ಕೆಂಪು ಬಣ್ಣ ಬರುತ್ತದೆ.",
        en: "Tender nuts are harvested while the husk is still green. Within 4–5 days of harvest they are peeled and boiled in a copper vessel, for about an hour, until the nut's \"eye\" comes out. They are then sun-dried for 7–10 days; the large Bette grade needs more than 12. Coating the nuts with chogaru, the boiling water reboiled into a thick extract, gives them a glossy red colour.",
      },
    },
    {
      heading: { kn: "ಚಾಲಿ (ಬಿಳಿ ಅಡಿಕೆ) ಹೇಗೆ ತಯಾರಾಗುತ್ತದೆ", en: "How Chali (white arecanut) is made" },
      text: {
        kn: "ಪೂರ್ತಿ ಹಣ್ಣಾದ ಕಾಯಿಗಳನ್ನು ಕೊಯ್ದು, ಸಿಪ್ಪೆ ತೆಗೆಯದೆ ಸುಮಾರು 40–45 ದಿನ ಬಿಸಿಲಲ್ಲಿ ಒಣಗಿಸಲಾಗುತ್ತದೆ; 10–15 ದಿನಕ್ಕೊಮ್ಮೆ ಮಗುಚಿ ಹರಡಲಾಗುತ್ತದೆ. ಒಣಗುವ ಮೊದಲು ಇದು ಸಿಪ್ಪೆಗೋಟು; ಒಣಗಿ ಸಿಪ್ಪೆ ತೆಗೆದ ಮೇಲೆ ಚಾಲಿ. ಚಾಲಿಗೆ ಬಣ್ಣ ಹಾಕುವುದಿಲ್ಲ. ದೀರ್ಘಕಾಲ ದಾಸ್ತಾನು ಇಡಲು ಧೂಮೀಕರಣ ಮಾಡಲಾಗುತ್ತದೆ. ಕರಾವಳಿಯಲ್ಲಿ ಹಣ್ಣಡಿಕೆ ಅಕ್ಟೋಬರ್ ಕೊನೆಯಿಂದ ಜನವರಿ ಕೊನೆಯವರೆಗೆ ಬರುತ್ತದೆ.",
        en: "Fully ripe nuts are harvested and sun-dried in their husk, for about 40–45 days, turned and re-spread every 10–15 days. Before drying the nut is Sippegotu; dried and dehusked, it is Chali. Chali is not coloured, and it is fumigated so it can be stored for a long time. On the coast, ripe nuts come in from the end of October to the end of January.",
      },
    },
  ],
  table: {
    heading: { kn: "ಒಂದು ನೋಟದಲ್ಲಿ", en: "At a glance" },
    columns: { label: { kn: "", en: "" }, rashi: { kn: "ರಾಶಿ (ಕೆಂಪು)", en: "Rashi (red)" }, chali: { kn: "ಚಾಲಿ (ಬಿಳಿ)", en: "Chali (white)" } },
    rows: [
      { label: { kn: "ಕೊಯ್ಯುವ ಹಂತ", en: "Harvested" },
        rashi: { kn: "ಎಳೆ, ಹಸಿರು ಕಾಯಿ", en: "Tender, green nuts" }, chali: { kn: "ಪೂರ್ತಿ ಹಣ್ಣಾದ ಕಾಯಿ", en: "Fully ripe nuts" } },
      { label: { kn: "ಸಂಸ್ಕರಣೆ", en: "Processing" },
        rashi: { kn: "ಸುಲಿದು, ಬೇಯಿಸಿ, ಒಣಗಿಸುವುದು", en: "Peeled, boiled, dried" }, chali: { kn: "ಸಿಪ್ಪೆ ಸಮೇತ ಒಣಗಿಸಿ, ನಂತರ ಸುಲಿಯುವುದು", en: "Dried in the husk, then dehusked" } },
      { label: { kn: "ಬಿಸಿಲಲ್ಲಿ ಒಣಗಿಸುವುದು", en: "Sun-drying" },
        rashi: { kn: "7–10 ದಿನ (ಬೆಟ್ಟೆ 12+)", en: "7–10 days (Bette 12+)" }, chali: { kn: "ಸುಮಾರು 40–45 ದಿನ", en: "About 40–45 days" } },
      { label: { kn: "ಬಣ್ಣ", en: "Colour" },
        rashi: { kn: "ಚೊಗರಿನಿಂದ ಹೊಳೆಯುವ ಕೆಂಪು", en: "Glossy red, from chogaru" }, chali: { kn: "ಬಣ್ಣ ಹಾಕುವುದಿಲ್ಲ", en: "Not coloured" } },
      { label: { kn: "ದರ್ಜೆಗಳು", en: "Grades" },
        rashi: { kn: "ರಾಶಿ, ಬೆಟ್ಟೆ (ಬರದ), ಸಣ್ಣ ರಾಶಿ, ಆಪಿ (ಚಿಕಣಿ), ಕೆಂಪುಗೋಟು", en: "Rashi, Bette (Barada), Sanna Rashi, Api (Chikani), Kempugotu" },
        chali: { kn: "ಚಾಲಿ, ಬಿಳೆಗೋಟು, ಕೋಕಾ, ಅರಗೆರೆ, ಲಡ್ಡು ಕೋಕಾ; ವ್ಯಾಪಾರಿಗಳು ಗಾತ್ರದ ಪ್ರಕಾರ ಮತ್ತೆ ವಿಂಗಡಿಸುತ್ತಾರೆ", en: "Chali, Bilegotu, Koka, Aragere, Laddu koka; traders grade it again by size" } },
      { label: { kn: "ಹೆಸರುವಾಸಿ ಮಾರುಕಟ್ಟೆ", en: "Known markets" },
        rashi: { kn: "ಶಿರಸಿ (ಇಡೀ ರಾಶಿ), ಯಲ್ಲಾಪುರ (ಆಪಿ)", en: "Sirsi (whole Rashi), Yellapur (Api)" }, chali: { kn: "ಕರಾವಳಿಯ ಮಾರುಕಟ್ಟೆಗಳು, ಮಂಗಳೂರು", en: "Coastal markets, Mangaluru" } },
      { label: { kn: "ಎಲ್ಲಿಗೆ ಹೋಗುತ್ತದೆ", en: "Where it goes" },
        rashi: { kn: "ಸಣ್ಣ ರಾಶಿ ಪಾನ್ ಮಸಾಲಾ ತಯಾರಕರಿಗೆ, ಬರದ ಉತ್ತರ ಕರ್ನಾಟಕಕ್ಕೆ, ಆಪಿ ರಾಜಸ್ಥಾನಕ್ಕೆ", en: "Sanna Rashi to pan masala makers, Barada to north Karnataka, Api to Rajasthan" },
        chali: { kn: "ಉತ್ತಮ ದರ್ಜೆ ಪಾನ್ ಅಂಗಡಿಗಳಿಗೆ, ಎರಡನೇ ದರ್ಜೆ ಪಾನ್ ಮಸಾಲಾ ಮತ್ತು ಸಿಹಿ ಸುಪಾರಿ ತಯಾರಕರಿಗೆ; ಗುಜರಾತ್, ಮಹಾರಾಷ್ಟ್ರ, ದೆಹಲಿ", en: "Top grades to pan shops, second grades to pan masala and sweet supari makers; Gujarat, Maharashtra, Delhi" } },
    ] satisfies GuideRow[],
  },
  prices: {
    heading: { kn: "ದರ ಹೋಲಿಕೆ ಬಗ್ಗೆ ಒಂದು ಮಾತು", en: "A note on comparing their rates" },
    text: {
      kn: "ರಾಶಿ ಮತ್ತು ಚಾಲಿ ಬೇರೆ ಬೇರೆ ಉತ್ಪನ್ನಗಳು: ಬೇರೆ ಹಂತದಲ್ಲಿ ಕೊಯ್ದು, ಬೇರೆ ರೀತಿ ತಯಾರಿಸಿ, ಬೇರೆ ಖರೀದಿದಾರರಿಗೆ ಮಾರಾಟವಾಗುತ್ತವೆ. ಆದ್ದರಿಂದ ಅವುಗಳ ದರಗಳನ್ನು ಪ್ರತ್ಯೇಕವಾಗಿ ತೋರಿಸಲಾಗುತ್ತದೆ; ಒಂದರ ದರ ಇನ್ನೊಂದಕ್ಕಿಂತ ಹೆಚ್ಚು ಅಥವಾ ಕಡಿಮೆ ಇರುವುದು ಒಂದು ತಳಿ ಉತ್ತಮ ಎಂದು ಅರ್ಥವಲ್ಲ.",
      en: "Rashi and Chali are different products: harvested at different stages, made differently and sold to different buyers. Their rates are therefore shown separately, and one being higher than the other does not make it the better choice.",
    },
  },
  links: { kn: "ಇಂದಿನ ಧಾರಣೆ", en: "Today's rates" },
  sources: [TSS.trading, TSS.processing, TSS.marketing, TSS.quality, TSS.karnataka],
  sourcesHeading: { kn: "ಮೂಲಗಳು", en: "Sources" },
};
