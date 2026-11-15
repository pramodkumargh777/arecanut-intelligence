import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

/** Brand palette. `frond` is the lighter leaf green the site's palm mark uses. */
export const C = {
  forest: "#0B3D2E",
  forestDeep: "#072A20",
  forestLight: "#15583F",
  ivory: "#F8F6EE",
  leaf: "#6E9F43",
  frond: "#B6D279",
} as const;

export const FONT = '"Areca Kannada", "Noto Sans Kannada", sans-serif';

/**
 * Bundled Noto Sans Kannada (the same font the website ships), so a render looks the same on any machine.
 * Rendering waits until both faces are loaded.
 */
const handle = delayRender("Loading Noto Sans Kannada");
const faces = [
  new FontFace("Areca Kannada", `url(${staticFile("fonts/noto-sans-kannada-kannada-wght-normal.woff2")}) format("woff2")`, {
    weight: "100 900",
    unicodeRange:
      "U+0951-0952,U+0964-0965,U+0C80-0CF3,U+1CD0,U+1CD2-1CD3,U+1CDA,U+1CF2,U+1CF4,U+200C-200D,U+20B9,U+25CC,U+A830-A835",
  }),
  new FontFace("Areca Kannada", `url(${staticFile("fonts/noto-sans-kannada-latin-wght-normal.woff2")}) format("woff2")`, {
    weight: "100 900",
    unicodeRange:
      "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  }),
];
Promise.all(faces.map((f) => f.load()))
  .then((loaded) => {
    loaded.forEach((f) => (document.fonts as unknown as Set<FontFace>).add(f));
    continueRender(handle);
  })
  .catch((err) => cancelRender(err));
