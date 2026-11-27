import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ABOUT_FILE, type AboutFile } from "../services/about";
import { useLanguage } from "../services/language";
import { AboutData } from "./AboutData";

/**
 * The page's "about this town / grade" text, in the same collapsed style as "About this data". The text comes from
 * /about.json, written at each build from the same data as the page's HTML, so both always say the same. Only a
 * deployed build has the file; elsewhere (dev, tests) nothing is fetched or shown.
 */
export function PageAbout({ path }: { path: string }) {
  const { language } = useLanguage();
  const about = useQuery({
    queryKey: ["page-about"],
    enabled: import.meta.env.PROD,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<AboutFile> => {
      const response = await fetch(ABOUT_FILE);
      if (!response.ok || !response.headers.get("content-type")?.includes("json")) return {};
      return response.json() as Promise<AboutFile>;
    },
  });
  const entry = about.data?.[path];
  if (!entry) return null;
  return <AboutData title={entry.title[language]}>
    {entry.paragraphs.map((paragraph) => <p key={paragraph.en}>{paragraph[language]}</p>)}
    {entry.links?.length ? <p>{entry.links.map((link, index) => <span key={link.path}>{index ? " · " : ""}<Link to={link.path}>{link.label[language]}</Link></span>)}</p> : null}
    {entry.sources?.length ? <p>{language === "kn" ? "ಮೂಲ: " : "Source: "}{entry.sources.map((source, index) => <span key={source.url}>{index ? ", " : ""}<a href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a></span>)}</p> : null}
  </AboutData>;
}
