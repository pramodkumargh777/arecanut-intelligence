import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { COMMON, fetchStatusText } from "../services/commonCopy";
import { defineCopy, useCopy, useFormat } from "../services/language";
import type { ModuleDomain } from "../services/modules";
import { ErrorState, LoadingState } from "./State";

const COPY = defineCopy({
  en: {
    title: "Intelligence source health", hint: "Review capture attempts and manage intelligence source refreshes.",
    domain: "Source area", domains: { production: "Production", trade: "Trade", weather: "Weather", policy: "Policy", news: "News" },
    healthHint: "Existing valid captures remain visible if a refresh fails. Re-fetching a historical release does not make it current news.",
    pdfRefresh: "Refresh verified official PDF tables locally with", pdfAfter: "This archives the original PDFs and validates positioned columns, units and reporting years. Layout changes fail explicitly.",
    token: "Source refresh reviewer token", capturing: "Capturing...", refreshWeather: "Refresh Sirsi weather", refreshReleases: "Refresh official releases", clearToken: "Clear token",
    refreshed: "Source capture refreshed.", attempts: "Recent capture attempts", noAttempts: "No attempts recorded.",
  },
  kn: {
    title: "ಮಾಹಿತಿ ಮೂಲಗಳ ಸ್ಥಿತಿ", hint: "ಸಂಗ್ರಹ ಪ್ರಯತ್ನಗಳನ್ನು ಪರಿಶೀಲಿಸಿ ಮತ್ತು ಮಾಹಿತಿ ಮೂಲಗಳನ್ನು ನವೀಕರಿಸಿ.",
    domain: "ಮೂಲ ವಿಭಾಗ", domains: { production: "ಉತ್ಪಾದನೆ", trade: "ವ್ಯಾಪಾರ", weather: "ಹವಾಮಾನ", policy: "ನೀತಿ", news: "ಸುದ್ದಿ" },
    healthHint: "ನವೀಕರಣ ವಿಫಲವಾದರೂ ಈಗಿನ ಮಾನ್ಯ ಸಂಗ್ರಹಗಳು ಕಾಣಿಸುತ್ತವೆ. ಹಳೆಯ ಪ್ರಕಟಣೆಯನ್ನು ಮತ್ತೆ ತಂದರೆ ಅದು ಹೊಸ ಸುದ್ದಿಯಾಗುವುದಿಲ್ಲ.",
    pdfRefresh: "ಪರಿಶೀಲಿತ ಅಧಿಕೃತ PDF ಪಟ್ಟಿಗಳನ್ನು ಸ್ಥಳೀಯವಾಗಿ ನವೀಕರಿಸಲು:", pdfAfter: "ಇದು ಮೂಲ PDF ಗಳನ್ನು ಸಂಗ್ರಹಿಸಿ ಕಾಲಮ್, ಘಟಕ ಮತ್ತು ವರದಿ ವರ್ಷಗಳನ್ನು ಪರಿಶೀಲಿಸುತ್ತದೆ. ವಿನ್ಯಾಸ ಬದಲಾದರೆ ಸ್ಪಷ್ಟವಾಗಿ ವಿಫಲವಾಗುತ್ತದೆ.",
    token: "ಮೂಲ ನವೀಕರಣ ಪರಿಶೀಲಕರ ಟೋಕನ್", capturing: "ಸಂಗ್ರಹಿಸಲಾಗುತ್ತಿದೆ...", refreshWeather: "ಶಿರಸಿ ಹವಾಮಾನ ನವೀಕರಿಸಿ", refreshReleases: "ಅಧಿಕೃತ ಪ್ರಕಟಣೆಗಳನ್ನು ನವೀಕರಿಸಿ", clearToken: "ಟೋಕನ್ ತೆರವುಗೊಳಿಸಿ",
    refreshed: "ಮೂಲ ಸಂಗ್ರಹ ನವೀಕರಿಸಲಾಗಿದೆ.", attempts: "ಇತ್ತೀಚಿನ ಸಂಗ್ರಹ ಪ್ರಯತ್ನಗಳು", noAttempts: "ಯಾವುದೇ ಪ್ರಯತ್ನ ದಾಖಲಾಗಿಲ್ಲ.",
  },
});

const DOMAINS: ModuleDomain[] = ["production", "trade", "weather", "policy", "news"];

export function IntelligenceSourceDetails({ domain }: { domain: ModuleDomain }) {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["intelligence", domain], queryFn: () => api.intelligence(domain) });
  const refresh = useMutation({
    mutationFn: () => api.refreshIntelligence(domain === "weather" ? "weather" : "news", token),
    onSuccess: () => setNotice(t.refreshed),
    onSettled: async () => { await client.invalidateQueries({ queryKey: ["intelligence"] }); },
  });
  return <>
    <p>{t.healthHint}</p>
    {domain === "production" || domain === "trade" ? <p>{t.pdfRefresh} <code>npm run refresh:intelligence</code>. {t.pdfAfter}</p>
      : <form className="monthly-refresh" onSubmit={(event) => { event.preventDefault(); setNotice(""); refresh.mutate(); }}>
        <label className="filter-control"><span>{t.token}</span><input type="password" autoComplete="off" required disabled={refresh.isPending} value={token} onChange={(event) => setToken(event.target.value)} /></label>
        <button className="button-secondary" disabled={refresh.isPending}>{refresh.isPending ? t.capturing : domain === "weather" ? t.refreshWeather : t.refreshReleases}</button>
        <button type="button" className="button-secondary" disabled={refresh.isPending} onClick={() => { setToken(""); setNotice(""); refresh.reset(); }}>{t.clearToken}</button>
      </form>}
    {refresh.error && <ErrorState error={refresh.error} />}
    {notice && <p role="status">{notice}</p>}
    <h3>{t.attempts}</h3>
    {query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : !query.data ? <LoadingState />
      : query.data.attempts.length ? <ul>{query.data.attempts.map((attempt) => <li key={attempt.id}>{attempt.source_key} · {fetchStatusText(c, attempt.status)} · {format.timestamp(attempt.started_at)}{attempt.error_message && ` · ${attempt.error_message}`}</li>)}</ul>
        : <p>{t.noAttempts}</p>}
  </>;
}

export function IntelligenceSourceHealth() {
  const t = useCopy(COPY);
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState<ModuleDomain>("production");
  return <section className="panel"><div className="panel-heading"><div><h2>{t.title}</h2><p>{t.hint}</p></div></div>
    <div className="monthly-details"><details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t.title}</summary>
      {open && <><label className="filter-control"><span>{t.domain}</span><select value={domain} onChange={(event) => {
        const selected = DOMAINS.find((item) => item === event.target.value);
        if (selected) setDomain(selected);
      }}>{DOMAINS.map((item) => <option key={item} value={item}>{t.domains[item]}</option>)}</select></label>
        <IntelligenceSourceDetails key={domain} domain={domain} /></>}
    </details></div>
  </section>;
}
