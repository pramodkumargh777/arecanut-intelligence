import { useQuery } from "@tanstack/react-query";
import { FAQ_FILE, type FaqFile } from "../services/faq";
import { useLanguage } from "../services/language";
import { AboutData } from "./AboutData";

/**
 * The page's "today's rates" questions, in the same collapsed style as "About this data". The text comes from
 * /faq.json, written at each build from the same rates as the page's structured data, so both always say the same.
 * Only a deployed build has the file; elsewhere (dev, tests) nothing is fetched or shown.
 */
export function PageFaq({ path }: { path: string }) {
  const { language } = useLanguage();
  const faq = useQuery({
    queryKey: ["page-faq"],
    enabled: import.meta.env.PROD,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<FaqFile> => {
      const response = await fetch(FAQ_FILE);
      if (!response.ok || !response.headers.get("content-type")?.includes("json")) return {};
      return response.json() as Promise<FaqFile>;
    },
  });
  const items = faq.data?.[path];
  if (!items?.length) return null;
  return <AboutData title={language === "kn" ? "ಸಾಮಾನ್ಯ ಪ್ರಶ್ನೆಗಳು" : "Common questions"}>
    {items.map((item) => <p key={item.q.en}><strong>{item.q[language]}</strong><br />{item.a[language]}</p>)}
  </AboutData>;
}
