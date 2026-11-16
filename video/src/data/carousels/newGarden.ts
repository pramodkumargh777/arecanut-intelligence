/**
 * Carousel: ಹೊಸ ಅಡಿಕೆ ತೋಟ ಆರಂಭಿಸುವ ಮುನ್ನ ಗಮನಿಸಬೇಕಾದ 10 ವಿಷಯಗಳು (founder-written content, 2026-11-16).
 * Each slide: a title (with one highlighted part), the text, and a visual. Visuals: a photo in public/carousel/ or
 * one of the diagrams drawn in src/Carousel.tsx.
 */
export type Visual =
  | { kind: "photo"; src: string; caption?: string }
  | { kind: "checks"; items: string[] }
  | { kind: "drip" }
  | { kind: "soil" }
  | { kind: "varieties" }
  | { kind: "spacing"; photo: string }
  | { kind: "drainage" }
  | { kind: "crops"; items: string[]; note: string }
  | { kind: "budget"; items: string[]; reserve: string };

export type Slide = { title: [string, string]; text: string; visual: Visual; photoChecks?: string[] };

export const NEW_GARDEN = {
  kicker: "ಹೊಸ ಅಡಿಕೆ ತೋಟ ಆರಂಭಿಸುವ ಮುನ್ನ",
  cover: ["ಗಮನಿಸಬೇಕಾದ", "10 ವಿಷಯಗಳು"] as [string, string],
  closing: {
    label: "ನೆನಪಿಡಿ",
    text: "ಉತ್ತಮ ತೋಟದ ಅಡಿಪಾಯ ಸರಿಯಾದ ಯೋಜನೆ. ಸ್ಥಳೀಯ ಕೃಷಿ ತಜ್ಞರ ಸಲಹೆ ಪಡೆದು ಮುಂದುವರಿಯಿರಿ.",
    tags: "#ಅಡಿಕೆಕೃಷಿ #ಅಡಿಕೆನಾಡಿ",
  },
  slides: [
    {
      title: ["ದೀರ್ಘಕಾಲದ", "ಹೂಡಿಕೆ"],
      text: "ಅಡಿಕೆ ತೋಟ ಹಾಕುವುದು ದೀರ್ಘಕಾಲದ ಹೂಡಿಕೆ. ಗಿಡ ನೆಡುವ ಮೊದಲು ಭೂಮಿ, ನೀರು, ಮಣ್ಣು ಮತ್ತು ಮಾರುಕಟ್ಟೆ ಬಗ್ಗೆ ಯೋಜನೆ ಮಾಡಿ.",
      visual: { kind: "photo", src: "carousel/plantation.jpg" },
    },
    {
      title: ["", "ಭೂಮಿ"],
      text: "ಮಣ್ಣಿನ ಆಳ, ಇಳಿಜಾರು, ನೀರು ನಿಲ್ಲುವ ಸಮಸ್ಯೆ ಮತ್ತು ಬೇಸಿಗೆಯ ನೀರಿನ ಲಭ್ಯತೆ ಪರಿಶೀಲಿಸಿ.",
      visual: { kind: "checks", items: ["ಮಣ್ಣಿನ ಆಳ", "ಇಳಿಜಾರು", "ನೀರು ನಿಲ್ಲುವ ಸಮಸ್ಯೆ", "ಬೇಸಿಗೆಯ ನೀರು"] },
    },
    {
      title: ["", "ನೀರಾವರಿ"],
      text: "ಬೇಸಿಗೆಯಲ್ಲೂ ಸಾಕಷ್ಟು ನೀರು ಇದೆಯೇ ನೋಡಿ. ಹನಿ ನೀರಾವರಿ ವ್ಯವಸ್ಥೆಯನ್ನು ಮೊದಲೇ ಯೋಜಿಸಿ.",
      visual: { kind: "drip" },
    },
    {
      title: ["ಮಣ್ಣು", "ಪರೀಕ್ಷೆ"],
      text: "ಮಣ್ಣಿನ pH ಮತ್ತು ಪೋಷಕಾಂಶಗಳನ್ನು ಪರೀಕ್ಷಿಸಿ. ಫಲಿತಾಂಶಕ್ಕೆ ಅನುಗುಣವಾಗಿ ಗೊಬ್ಬರ ನಿರ್ವಹಣೆ ಮಾಡಿ.",
      visual: { kind: "soil" },
    },
    {
      title: ["ತಳಿ", "ಆಯ್ಕೆ"],
      text: "ಚಾಲಿ ಅಥವಾ ಕೆಂಪಡಿಕೆ ಉತ್ಪಾದನೆಯ ಗುರಿ ಮತ್ತು ನಿಮ್ಮ ಪ್ರದೇಶದ ಹವಾಮಾನಕ್ಕೆ ಹೊಂದುವ ತಳಿಯನ್ನು ಆಯ್ಕೆಮಾಡಿ.",
      visual: { kind: "varieties" },
    },
    {
      title: ["ಸಸಿ", "ಆಯ್ಕೆ"],
      text: "ಆರೋಗ್ಯಕರ, ಉತ್ತಮ ಗುಣಮಟ್ಟದ ಮತ್ತು ವಿಶ್ವಾಸಾರ್ಹ ನರ್ಸರಿಯ ಸಸಿಗಳನ್ನು ಮಾತ್ರ ಖರೀದಿಸಿ.",
      visual: { kind: "photo", src: "carousel/nursery.jpg" },
      photoChecks: ["ಆರೋಗ್ಯಕರ", "ಉತ್ತಮ ಗುಣಮಟ್ಟ", "ವಿಶ್ವಾಸಾರ್ಹ ನರ್ಸರಿ"],
    },
    {
      title: ["", "ಅಂತರ"],
      text: "ಸಾಮಾನ್ಯವಾಗಿ 2.7 × 2.7 ಮೀಟರ್ ಅಂತರ ಬಳಸಲಾಗುತ್ತದೆ. ಮಿಶ್ರ ಬೆಳೆ ಯೋಜನೆಯಿದ್ದರೆ ಅಂತರವನ್ನು ಮರುಪರಿಶೀಲಿಸಿ.",
      visual: { kind: "spacing", photo: "carousel/trunks.jpg" },
    },
    {
      title: ["ನೀರು", "ಹರಿವು"],
      text: "ಮಳೆಗಾಲದಲ್ಲಿ ನೀರು ನಿಲ್ಲದಂತೆ ಚರಂಡಿ ಮತ್ತು ತೋಟದ ವಿನ್ಯಾಸ ರೂಪಿಸಿ.",
      visual: { kind: "drainage" },
    },
    {
      title: ["ಮಿಶ್ರ", "ಬೆಳೆ"],
      text: "ಪ್ರದೇಶಕ್ಕೆ ಅನುಗುಣವಾಗಿ ಕಾಳುಮೆಣಸು, ಕೋಕೋ, ಕಾಫಿ ಅಥವಾ ಬಾಳೆ ಬೆಳೆಗಳನ್ನು ಪರಿಗಣಿಸಿ.",
      visual: { kind: "crops", items: ["ಕಾಳುಮೆಣಸು", "ಕೋಕೋ", "ಕಾಫಿ", "ಬಾಳೆ"], note: "ನೀರು ಮತ್ತು ಕಾರ್ಮಿಕರ ಲಭ್ಯತೆ ಮುಖ್ಯ" },
    },
    {
      title: ["", "ಬಜೆಟ್"],
      text: "ಎಲ್ಲಾ ವೆಚ್ಚವನ್ನು ಮೊದಲೇ ಲೆಕ್ಕಹಾಕಿ. ಅನಿರೀಕ್ಷಿತ ವೆಚ್ಚಕ್ಕೂ ಹಣ ಮೀಸಲಿಡಿ.",
      visual: { kind: "budget", items: ["ಸಸಿ", "ಗುಂಡಿ", "ಕಾರ್ಮಿಕರು", "ನೀರಾವರಿ", "ಬೇಲಿ", "ನಿರ್ವಹಣೆ"], reserve: "ಅನಿರೀಕ್ಷಿತ ವೆಚ್ಚ ಮೀಸಲು" },
    },
  ] as Slide[],
};
