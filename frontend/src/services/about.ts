/**
 * "About this town / grade" text for town and variety pages. Written when the site is built (vite.config.ts), from the
 * same rates and arrivals the page shows plus the sourced grade notes (services/guides.ts), into /about.json and into
 * the page's HTML; the app shows the same text in a collapsed section (components/PageAbout.tsx), so what search
 * engines read is what a visitor can open. Plain data only, so the build can import it without the app.
 */
import type { Bilingual, SourceLink } from "./guides";

export type AboutEntry = {
  title: Bilingual;
  paragraphs: Bilingual[];
  /** Related pages (a variety's towns, a town's varieties). */
  links?: { path: string; label: Bilingual }[];
  sources?: SourceLink[];
};
/** Page path → its "about" text. */
export type AboutFile = Record<string, AboutEntry>;

export const ABOUT_FILE = "/about.json";
