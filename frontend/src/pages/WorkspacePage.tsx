import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { useCommodity } from "../services/commodity";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { IntelligenceScorecard, SourceLabel, StatusBadge } from "../components/Scorecard";
import { MonthlyInsights } from "../components/MonthlyInsights";
import { DATE_PRESETS, forecastValidationStatus, presetRange } from "../services/insights";
import { marketFeeds, type MarketFeed } from "../../../shared/commodities";
import { calendarTodayIST } from "../../../shared/dates";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { COMMON } from "../services/commonCopy";
import { AboutData } from "../components/AboutData";
import {
  createProfile, loadStore, profileSearch, removeProfile, saveStore, upsertProfile,
  WORKSPACE_ROLES, WORKSPACE_SECTIONS, type WorkspaceProfile, type WorkspaceRole, type WorkspaceSection, type WorkspaceStore,
} from "../services/workspace";

const inr = (value: number | null | undefined) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}`;

const COPY = defineCopy({
  en: {
    feeds: { official: "AGMARKNET · official APMC modal", mamcos: "MAMCOS · cooperative average", tss: "TSS · tender average", tumcos: "TUMCOS · cooperative average" } as Record<MarketFeed, string>,
    roles: {
      grower: { label: "Grower / farmer group", description: "Latest cooperative quotes near you, data freshness and decision-tool shortcuts." },
      trader: { label: "Trader / buyer", description: "Same-date market ranges, spreads and recent quotes across sources." },
      cooperative: { label: "Cooperative society", description: "Branch coverage, reporting completeness and published averages." },
      analyst: { label: "Analyst / researcher", description: "Monthly history, seasonality, volatility and forecast evaluation status." },
    } as Record<WorkspaceRole, { label: string; description: string }>,
    sections: { scorecard: "Intelligence scorecard", latest_quotes: "Latest reported quotes", monthly_insights: "Monthly seasonal and volatility analysis",
      forecast_status: "Forecast validation status", shortcuts: "Filtered page shortcuts" } as Record<WorkspaceSection, string>,
    title: "Workspace", intro: "Save a dashboard per organization or role with its own source, variety, reporting period and sections. Every panel reads the same verified Areca Pulse data as the main pages.",
    noStorage: "Browser storage is unavailable, so changes last only until this tab closes.",
    about: "Profiles are stored only in this browser (localStorage); they contain filter preferences, never market data, and are not shared with other users or devices.",
    profiles: "Dashboard profiles", saved: (n: number) => `${n} saved · up to 20`, noProfiles: "No profiles yet. Start from a role template.",
    activeProfile: "Active profile", template: "New profile template", profileName: "Profile name", create: "Create profile", limit: "A browser can store at most 20 dashboard profiles.",
    confirmDelete: (name: string) => `Delete the profile "${name}"? This does not affect any data.`,
    noneSelected: "No dashboard profile selected", noneSelectedHint: "Create a profile above to save filters and sections for your organization.",
    templateFilters: (role: string) => `${role} template · custom filters`, deleteProfile: "Delete profile", organization: "Organization", optional: "Optional",
    sourceType: "Source / price type", notAvailable: "Not available for this commodity", visible: "Visible sections",
    otherCommodity: "Profile saved for another commodity", otherCommodityHint: (commodity: string) => `This profile was created for ${commodity}. Switch the commodity selector to view its panels.`,
    notIntegrated: "Source not integrated for this commodity", chooseSource: "Choose one of the available sources above.",
    noMonthly: "Monthly history not integrated", noMonthlyHint: "Monthly analysis is available for arecanut only.",
    shortcuts: "Shortcuts with this profile's filters", shortcutsHint: "Source and commodity are applied; the variety filter is applied on cooperative pages.", shortcutsAria: "Profile shortcuts",
    links: { overview: "Overview", prices: "Market prices", analytics: "Price analytics", compare: "Market comparison", history: "Historical analytics", tools: "Decision tools", evaluation: "Forecast evaluation" },
    noSections: "No sections selected", noSectionsHint: "Tick at least one section above.",
    firstVariety: "First available variety", notInData: (variety: string) => `${variety} (not in current data)`,
    latestQuotes: "Latest reported quotes", latestHint: (period: string) => `${period} · up to 10 most recent rows · INR/quintal as published`,
    noQuotes: "No quotes in this period", noQuotesHint: (official: boolean) => `No ${official ? "verified official" : "published cooperative"} observations match these filters. Widen the reporting period or choose another source.`,
    quotesAria: "Latest quotes",
    forecastTitle: "Forecast validation status", forecastHint: "Models are labelled validated only after prospective outcomes beat their baseline.",
    forecastStatus: { not_evaluated: "No evaluation published", validated: "Validated prospectively", candidate: "Candidates under prospective evaluation", reference_only: "Reference baselines only" } as Record<string, string>,
    statusCounts: { reference: "reference", candidate: "candidate", not_better_than_baseline: "not better than baseline", validated: "validated", revoked: "revoked" } as Record<string, string>,
    outcomes: "Prospective outcomes matched", revoked: "Revoked model events", openEvaluation: "Open full evaluation",
  },
  kn: {
    feeds: { official: "AGMARKNET · ಅಧಿಕೃತ ಎಪಿಎಂಸಿ ಮಾದರಿ ದರ", mamcos: "MAMCOS · ಸಹಕಾರಿ ಸರಾಸರಿ", tss: "TSS · ಟೆಂಡರ್ ಸರಾಸರಿ", tumcos: "TUMCOS · ಸಹಕಾರಿ ಸರಾಸರಿ" },
    roles: {
      grower: { label: "ಬೆಳೆಗಾರ / ರೈತ ಗುಂಪು", description: "ಹತ್ತಿರದ ಸಹಕಾರಿ ಸಂಘಗಳ ಇತ್ತೀಚಿನ ದರ, ದತ್ತಾಂಶ ಹೊಸತನ ಮತ್ತು ಲೆಕ್ಕಾಚಾರ ಸಾಧನಗಳ ಕೊಂಡಿಗಳು." },
      trader: { label: "ವ್ಯಾಪಾರಿ / ಖರೀದಿದಾರ", description: "ಅದೇ ದಿನಾಂಕದ ಮಾರುಕಟ್ಟೆ ಶ್ರೇಣಿ, ಅಂತರ ಮತ್ತು ಎಲ್ಲಾ ಮೂಲಗಳ ಇತ್ತೀಚಿನ ದರಗಳು." },
      cooperative: { label: "ಸಹಕಾರಿ ಸಂಘ", description: "ಶಾಖೆಗಳ ವ್ಯಾಪ್ತಿ, ವರದಿಯ ಸಂಪೂರ್ಣತೆ ಮತ್ತು ಪ್ರಕಟಿತ ಸರಾಸರಿಗಳು." },
      analyst: { label: "ವಿಶ್ಲೇಷಕ / ಸಂಶೋಧಕ", description: "ತಿಂಗಳ ಇತಿಹಾಸ, ಋತುಮಾನ, ಏರಿಳಿತ ಮತ್ತು ಮುನ್ಸೂಚನೆ ಮೌಲ್ಯಮಾಪನದ ಸ್ಥಿತಿ." },
    },
    sections: { scorecard: "ಮಾಹಿತಿ ಸ್ಥಿತಿ ಪಟ್ಟಿ", latest_quotes: "ಇತ್ತೀಚಿನ ವರದಿಯಾದ ದರಗಳು", monthly_insights: "ತಿಂಗಳ ಋತುಮಾನ ಮತ್ತು ಏರಿಳಿತ ವಿಶ್ಲೇಷಣೆ",
      forecast_status: "ಮುನ್ಸೂಚನೆ ದೃಢೀಕರಣ ಸ್ಥಿತಿ", shortcuts: "ಫಿಲ್ಟರ್ ಸಹಿತ ಪುಟ ಕೊಂಡಿಗಳು" },
    title: "ಕಾರ್ಯಕ್ಷೇತ್ರ", intro: "ಪ್ರತಿ ಸಂಸ್ಥೆ ಅಥವಾ ಪಾತ್ರಕ್ಕೆ ಅದರದೇ ಮೂಲ, ತಳಿ, ವರದಿ ಅವಧಿ ಮತ್ತು ವಿಭಾಗಗಳೊಂದಿಗೆ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ಉಳಿಸಿ. ಪ್ರತಿ ಫಲಕವೂ ಮುಖ್ಯ ಪುಟಗಳಂತೆಯೇ ಪರಿಶೀಲಿತ Areca Pulse ದತ್ತಾಂಶವನ್ನು ಓದುತ್ತದೆ.",
    noStorage: "ಬ್ರೌಸರ್ ಸಂಗ್ರಹ ಲಭ್ಯವಿಲ್ಲ, ಆದ್ದರಿಂದ ಬದಲಾವಣೆಗಳು ಈ ಟ್ಯಾಬ್ ಮುಚ್ಚುವವರೆಗೆ ಮಾತ್ರ ಇರುತ್ತವೆ.",
    about: "ಪ್ರೊಫೈಲ್‌ಗಳನ್ನು ಈ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಮಾತ್ರ (localStorage) ಉಳಿಸಲಾಗುತ್ತದೆ; ಅವು ಫಿಲ್ಟರ್ ಆದ್ಯತೆಗಳನ್ನು ಮಾತ್ರ ಹೊಂದಿವೆ, ಮಾರುಕಟ್ಟೆ ದತ್ತಾಂಶವನ್ನಲ್ಲ, ಮತ್ತು ಬೇರೆ ಬಳಕೆದಾರರು ಅಥವಾ ಸಾಧನಗಳೊಂದಿಗೆ ಹಂಚಿಕೊಳ್ಳುವುದಿಲ್ಲ.",
    profiles: "ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ಪ್ರೊಫೈಲ್‌ಗಳು", saved: (n: number) => `${n} ಉಳಿಸಲಾಗಿದೆ · ಗರಿಷ್ಠ 20`, noProfiles: "ಇನ್ನೂ ಪ್ರೊಫೈಲ್‌ಗಳಿಲ್ಲ. ಪಾತ್ರದ ಮಾದರಿಯಿಂದ ಆರಂಭಿಸಿ.",
    activeProfile: "ಸಕ್ರಿಯ ಪ್ರೊಫೈಲ್", template: "ಹೊಸ ಪ್ರೊಫೈಲ್ ಮಾದರಿ", profileName: "ಪ್ರೊಫೈಲ್ ಹೆಸರು", create: "ಪ್ರೊಫೈಲ್ ರಚಿಸಿ", limit: "ಒಂದು ಬ್ರೌಸರ್ ಗರಿಷ್ಠ 20 ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ಪ್ರೊಫೈಲ್‌ಗಳನ್ನು ಉಳಿಸಬಹುದು.",
    confirmDelete: (name: string) => `"${name}" ಪ್ರೊಫೈಲ್ ಅಳಿಸಬೇಕೇ? ಇದು ಯಾವುದೇ ದತ್ತಾಂಶದ ಮೇಲೆ ಪರಿಣಾಮ ಬೀರುವುದಿಲ್ಲ.`,
    noneSelected: "ಯಾವುದೇ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ಪ್ರೊಫೈಲ್ ಆಯ್ಕೆಯಾಗಿಲ್ಲ", noneSelectedHint: "ನಿಮ್ಮ ಸಂಸ್ಥೆಯ ಫಿಲ್ಟರ್ ಮತ್ತು ವಿಭಾಗಗಳನ್ನು ಉಳಿಸಲು ಮೇಲೆ ಪ್ರೊಫೈಲ್ ರಚಿಸಿ.",
    templateFilters: (role: string) => `${role} ಮಾದರಿ · ನಿಮ್ಮ ಫಿಲ್ಟರ್‌ಗಳು`, deleteProfile: "ಪ್ರೊಫೈಲ್ ಅಳಿಸಿ", organization: "ಸಂಸ್ಥೆ", optional: "ಐಚ್ಛಿಕ",
    sourceType: "ಮೂಲ / ದರದ ವಿಧ", notAvailable: "ಈ ಬೆಳೆಗೆ ಲಭ್ಯವಿಲ್ಲ", visible: "ಕಾಣುವ ವಿಭಾಗಗಳು",
    otherCommodity: "ಬೇರೆ ಬೆಳೆಗೆ ಉಳಿಸಿದ ಪ್ರೊಫೈಲ್", otherCommodityHint: (commodity: string) => `ಈ ಪ್ರೊಫೈಲ್ ${commodity} ಗಾಗಿ ರಚಿಸಲಾಗಿದೆ. ಅದರ ಫಲಕಗಳನ್ನು ನೋಡಲು ಬೆಳೆ ಆಯ್ಕೆ ಬದಲಿಸಿ.`,
    notIntegrated: "ಈ ಬೆಳೆಗೆ ಮೂಲ ಸಂಪರ್ಕಿಸಿಲ್ಲ", chooseSource: "ಮೇಲಿನ ಲಭ್ಯ ಮೂಲಗಳಲ್ಲಿ ಒಂದನ್ನು ಆಯ್ಕೆಮಾಡಿ.",
    noMonthly: "ತಿಂಗಳ ಇತಿಹಾಸ ಸಂಪರ್ಕಿಸಿಲ್ಲ", noMonthlyHint: "ತಿಂಗಳ ವಿಶ್ಲೇಷಣೆ ಅಡಿಕೆಗೆ ಮಾತ್ರ ಲಭ್ಯ.",
    shortcuts: "ಈ ಪ್ರೊಫೈಲ್‌ನ ಫಿಲ್ಟರ್ ಸಹಿತ ಕೊಂಡಿಗಳು", shortcutsHint: "ಮೂಲ ಮತ್ತು ಬೆಳೆ ಅನ್ವಯಿಸುತ್ತವೆ; ತಳಿ ಫಿಲ್ಟರ್ ಸಹಕಾರಿ ಪುಟಗಳಲ್ಲಿ ಅನ್ವಯಿಸುತ್ತದೆ.", shortcutsAria: "ಪ್ರೊಫೈಲ್ ಕೊಂಡಿಗಳು",
    links: { overview: "ಸಮಗ್ರ ನೋಟ", prices: "ಮಾರುಕಟ್ಟೆ ದರಗಳು", analytics: "ದರ ವಿಶ್ಲೇಷಣೆ", compare: "ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ", history: "ಐತಿಹಾಸಿಕ ವಿಶ್ಲೇಷಣೆ", tools: "ಲೆಕ್ಕಾಚಾರ ಸಾಧನಗಳು", evaluation: "ಮುನ್ಸೂಚನೆ ಮೌಲ್ಯಮಾಪನ" },
    noSections: "ಯಾವುದೇ ವಿಭಾಗ ಆಯ್ಕೆಯಾಗಿಲ್ಲ", noSectionsHint: "ಮೇಲೆ ಕನಿಷ್ಠ ಒಂದು ವಿಭಾಗವನ್ನು ಆಯ್ಕೆಮಾಡಿ.",
    firstVariety: "ಮೊದಲ ಲಭ್ಯ ತಳಿ", notInData: (variety: string) => `${variety} (ಈಗಿನ ದತ್ತಾಂಶದಲ್ಲಿಲ್ಲ)`,
    latestQuotes: "ಇತ್ತೀಚಿನ ವರದಿಯಾದ ದರಗಳು", latestHint: (period: string) => `${period} · ಇತ್ತೀಚಿನ 10 ಸಾಲುಗಳವರೆಗೆ · ಪ್ರಕಟಿಸಿದಂತೆ ₹/ಕ್ವಿಂಟಾಲ್`,
    noQuotes: "ಈ ಅವಧಿಯಲ್ಲಿ ದರಗಳಿಲ್ಲ", noQuotesHint: (official: boolean) => `ಈ ಫಿಲ್ಟರ್‌ಗಳಿಗೆ ಹೊಂದುವ ${official ? "ಪರಿಶೀಲಿತ ಅಧಿಕೃತ" : "ಪ್ರಕಟಿತ ಸಹಕಾರಿ"} ದಾಖಲೆಗಳಿಲ್ಲ. ವರದಿ ಅವಧಿ ಹೆಚ್ಚಿಸಿ ಅಥವಾ ಬೇರೆ ಮೂಲ ಆಯ್ಕೆಮಾಡಿ.`,
    quotesAria: "ಇತ್ತೀಚಿನ ದರಗಳು",
    forecastTitle: "ಮುನ್ಸೂಚನೆ ದೃಢೀಕರಣ ಸ್ಥಿತಿ", forecastHint: "ಮುಂದಿನ ಫಲಿತಾಂಶಗಳು ಮೂಲ ಅಂದಾಜನ್ನು ಮೀರಿದ ನಂತರವೇ ಮಾದರಿಯನ್ನು ದೃಢೀಕರಿಸಲಾಗುತ್ತದೆ.",
    forecastStatus: { not_evaluated: "ಯಾವುದೇ ಮೌಲ್ಯಮಾಪನ ಪ್ರಕಟವಾಗಿಲ್ಲ", validated: "ಮುಂದಿನ ಫಲಿತಾಂಶಗಳಿಂದ ದೃಢೀಕರಿಸಲಾಗಿದೆ", candidate: "ಅಭ್ಯರ್ಥಿಗಳು ಮೌಲ್ಯಮಾಪನದಲ್ಲಿವೆ", reference_only: "ಉಲ್ಲೇಖ ಅಂದಾಜುಗಳು ಮಾತ್ರ" },
    statusCounts: { reference: "ಉಲ್ಲೇಖ", candidate: "ಅಭ್ಯರ್ಥಿ", not_better_than_baseline: "ಮೂಲ ಅಂದಾಜಿಗಿಂತ ಉತ್ತಮವಲ್ಲ", validated: "ದೃಢೀಕೃತ", revoked: "ಹಿಂಪಡೆದದ್ದು" },
    outcomes: "ಹೊಂದಿಕೆಯಾದ ಮುಂದಿನ ಫಲಿತಾಂಶಗಳು", revoked: "ಹಿಂಪಡೆದ ಮಾದರಿ ಘಟನೆಗಳು", openEvaluation: "ಪೂರ್ಣ ಮೌಲ್ಯಮಾಪನ ತೆರೆಯಿರಿ",
  },
});

export function WorkspacePage() {
  const t = useCopy(COPY);
  const { code: commodityCode, commodity, catalog } = useCommodity();
  const [store, setStore] = useState<WorkspaceStore>(() => loadStore());
  const [persisted, setPersisted] = useState(true);
  const [role, setRole] = useState<WorkspaceRole>("cooperative");
  const [name, setName] = useState("");
  const active = store.profiles.find((profile) => profile.id === store.activeId) ?? null;
  const feeds = marketFeeds(commodity);

  useEffect(() => { setPersisted(saveStore(store)); }, [store]);

  function update(patch: Partial<WorkspaceProfile>) {
    if (!active) return;
    setStore((current) => upsertProfile(current, { ...active, ...patch, updatedAt: new Date().toISOString() }));
  }
  function create() {
    const profile = createProfile(role, name.trim() || t.roles[role].label, new Date(), newId());
    const feed = feeds.includes(profile.feed) ? profile.feed : feeds[0];
    try { setStore((current) => upsertProfile(current, { ...profile, commodity: commodityCode, feed: feed ?? profile.feed })); setName(""); }
    catch { window.alert(t.limit); }
  }

  return <div className="page-stack">
    <section className="page-heading"><div><h1>{t.title}</h1><p>{t.intro}</p></div></section>
    {!persisted && <div className="data-disclosure" role="status">{t.noStorage}</div>}
    <AboutData><p>{t.about}</p></AboutData>

    <section className="panel workspace-panel"><div className="panel-heading"><div><h2>{t.profiles}</h2><p>{store.profiles.length ? t.saved(store.profiles.length) : t.noProfiles}</p></div></div>
      <div className="workspace-controls">
        {store.profiles.length > 0 && <label className="filter-control"><span>{t.activeProfile}</span><select value={store.activeId ?? ""} onChange={(event) => setStore((current) => ({ ...current, activeId: event.target.value }))}>
          {store.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.organization ? ` · ${profile.organization}` : ""}</option>)}</select></label>}
        <label className="filter-control"><span>{t.template}</span><select value={role} onChange={(event) => setRole(event.target.value as WorkspaceRole)}>
          {WORKSPACE_ROLES.map((value) => <option key={value} value={value}>{t.roles[value].label}</option>)}</select></label>
        <label className="filter-control"><span>{t.profileName}</span><input value={name} maxLength={80} placeholder={t.roles[role].label} onChange={(event) => setName(event.target.value)} /></label>
        <button type="button" className="button-primary" onClick={create}>{t.create}</button>
      </div>
      <p className="panel-note">{t.roles[role].description}</p>
    </section>

    {active ? <ProfileDashboard key={active.id} profile={active} feeds={feeds} defaultCommodity={catalog.default_commodity} commodityMatches={active.commodity === commodityCode} onChange={update} onDelete={() => { if (window.confirm(t.confirmDelete(active.name))) setStore((current) => removeProfile(current, active.id)); }} />
      : <EmptyState title={t.noneSelected}>{t.noneSelectedHint}</EmptyState>}
  </div>;
}

function ProfileDashboard({ profile, feeds, defaultCommodity, commodityMatches, onChange, onDelete }: {
  profile: WorkspaceProfile; feeds: MarketFeed[]; defaultCommodity: string; commodityMatches: boolean; onChange: (patch: Partial<WorkspaceProfile>) => void; onDelete: () => void;
}) {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const [draftName, setDraftName] = useState(profile.name);
  const show = (section: WorkspaceProfile["sections"][number]) => profile.sections.includes(section);
  const search = profileSearch(profile, defaultCommodity);
  const feedSupported = feeds.includes(profile.feed);
  return <>
    <section className="panel workspace-panel"><div className="panel-heading"><div><h2>{profile.name}</h2><p>{t.templateFilters(t.roles[profile.role].label)}</p></div>
      <button type="button" className="button-secondary" onClick={onDelete}>{t.deleteProfile}</button></div>
      <div className="workspace-controls">
        <label className="filter-control"><span>{t.profileName}</span><input value={draftName} maxLength={80} onChange={(event) => setDraftName(event.target.value)} onBlur={() => { if (draftName.trim()) onChange({ name: draftName.trim() }); else setDraftName(profile.name); }} /></label>
        <label className="filter-control"><span>{t.organization}</span><input value={profile.organization} maxLength={120} placeholder={t.optional} onChange={(event) => onChange({ organization: event.target.value })} /></label>
        <label className="filter-control"><span>{t.sourceType}</span><select value={feedSupported ? profile.feed : ""} onChange={(event) => onChange({ feed: event.target.value as MarketFeed, variety: "" })}>
          {!feedSupported && <option value="" disabled>{t.notAvailable}</option>}
          {feeds.map((feed) => <option key={feed} value={feed}>{t.feeds[feed]}</option>)}</select></label>
        <VarietyControl profile={profile} enabled={feedSupported && commodityMatches} onChange={(variety) => onChange({ variety })} />
        <label className="filter-control"><span>{c.reportingPeriod}</span><select value={profile.datePreset} onChange={(event) => onChange({ datePreset: event.target.value as WorkspaceProfile["datePreset"] })}>
          {DATE_PRESETS.filter((option) => option.value !== "custom").map((option) => <option key={option.value} value={option.value}>{c.datePresets[option.value]}</option>)}</select></label>
      </div>
      <fieldset className="workspace-sections"><legend>{t.visible}</legend>
        {WORKSPACE_SECTIONS.map((section) => <label key={section} className="check-option"><input type="checkbox" checked={show(section)} onChange={(event) => onChange({ sections: event.target.checked ? WORKSPACE_SECTIONS.filter((item) => item === section || profile.sections.includes(item)) : profile.sections.filter((item) => item !== section) })} />{t.sections[section]}</label>)}
      </fieldset>
    </section>

    {!commodityMatches ? <EmptyState title={t.otherCommodity}>{t.otherCommodityHint(profile.commodity.replace(/_/g, " "))}</EmptyState>
      : !feedSupported ? <EmptyState title={t.notIntegrated}>{t.chooseSource}</EmptyState> : <>
      {show("scorecard") && <IntelligenceScorecard feed={profile.feed} variety={profile.variety} />}
      {show("latest_quotes") && <LatestQuotes profile={profile} />}
      {show("forecast_status") && <ForecastStatusPanel />}
      {show("monthly_insights") && (profile.commodity === "arecanut" ? <MonthlyInsights /> : <EmptyState title={t.noMonthly}>{t.noMonthlyHint}</EmptyState>)}
      {show("shortcuts") && <section className="panel workspace-panel"><div className="panel-heading"><div><h2>{t.shortcuts}</h2><p>{t.shortcutsHint}</p></div></div>
        <nav className="workspace-links" aria-label={t.shortcutsAria}>
          <Link to={`/${search}`}>{t.links.overview}</Link><Link to={`/prices${search}`}>{t.links.prices}</Link><Link to={`/analytics${search}`}>{t.links.analytics}</Link>
          <Link to={`/compare${search}`}>{t.links.compare}</Link><Link to="/history">{t.links.history}</Link><Link to="/decision-tools">{t.links.tools}</Link><Link to="/forecasts/evaluation">{t.links.evaluation}</Link>
        </nav></section>}
      {!profile.sections.length && <EmptyState title={t.noSections}>{t.noSectionsHint}</EmptyState>}
    </>}
  </>;
}

function VarietyControl({ profile, enabled, onChange }: { profile: WorkspaceProfile; enabled: boolean; onChange: (variety: string) => void }) {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const official = profile.feed === "official";
  const varieties = useQuery({
    queryKey: ["workspace-varieties", profile.commodity, profile.feed], enabled,
    queryFn: async () => official ? api.varieties(profile.commodity)
      : Array.from(new Set((await api.cooperativePrices(profile.feed as "mamcos" | "tss" | "tumcos", undefined, profile.commodity as "arecanut" | "black_pepper", {})).data.map((row) => row.variety))).sort(),
  });
  return <label className="filter-control"><span>{c.variety}</span><select value={profile.variety} disabled={!enabled || varieties.isLoading} onChange={(event) => onChange(event.target.value)}>
    <option value="">{official ? t.firstVariety : c.allVarieties}</option>
    {profile.variety && !varieties.data?.includes(profile.variety) && <option value={profile.variety}>{t.notInData(profile.variety)}</option>}
    {(varieties.data ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>;
}

function LatestQuotes({ profile }: { profile: WorkspaceProfile }) {
  const t = useCopy(COPY);
  const c = useCopy(COMMON);
  const format = useFormat();
  const range = useMemo<{ from?: string; to?: string }>(() => presetRange(profile.datePreset, calendarTodayIST()) ?? {}, [profile.datePreset]);
  const official = profile.feed === "official";
  const query = useQuery({
    queryKey: ["workspace-quotes", profile.commodity, profile.feed, profile.variety, range],
    queryFn: async () => official
      ? (await api.prices({ commodity: profile.commodity, variety: profile.variety || undefined, from: range.from, to: range.to, limit: "10" })).data.map((row) => ({ key: row.id, place: row.market_name, date: row.reporting_date, variety: row.variety_name, min: row.minimum_price, central: row.modal_price, max: row.maximum_price }))
      : (await api.cooperativePrices(profile.feed as "mamcos" | "tss" | "tumcos", profile.variety || undefined, profile.commodity as "arecanut" | "black_pepper", range)).data
        .slice().sort((a, b) => b.reporting_date.localeCompare(a.reporting_date)).slice(0, 10)
        .map((row) => ({ key: row.id, place: row.branch, date: row.reporting_date, variety: row.variety, min: row.minimum_price, central: row.average_price, max: row.maximum_price })),
  });
  const period = c.datePresets[profile.datePreset] ?? "";
  return <section className="panel table-panel"><div className="panel-heading"><div><h2>{t.latestQuotes}</h2><p>{t.latestHint(period)}</p></div><SourceLabel>{t.feeds[profile.feed]}</SourceLabel></div>
    {query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : !query.data?.length ? <EmptyState title={t.noQuotes}>{t.noQuotesHint(official)}</EmptyState> :
      <div className="table-scroll" tabIndex={0} role="region" aria-label={t.quotesAria}><table><thead><tr><th>{official ? c.market : c.branch}</th><th>{c.reportingDate}</th><th>{c.variety}</th><th className="numeric">{c.minimum}</th><th className="numeric">{official ? c.modal : c.average}</th><th className="numeric">{c.maximum}</th></tr></thead><tbody>
        {query.data.map((row) => <tr key={row.key}><td>{row.place}</td><td>{format.date(row.date)}</td><td lang="en">{row.variety}</td><td className="numeric">{inr(row.min)}</td><td className="numeric">{inr(row.central)}</td><td className="numeric">{inr(row.max)}</td></tr>)}
      </tbody></table></div>}
  </section>;
}

function ForecastStatusPanel() {
  const t = useCopy(COPY);
  const overview = useQuery({ queryKey: ["forecasting-overview"], queryFn: () => api.forecastingOverview() });
  const status = forecastValidationStatus(overview.data?.status_counts, overview.data?.totals.validated_events ?? 0);
  return <section className="panel workspace-panel"><div className="panel-heading"><div><h2>{t.forecastTitle}</h2><p>{t.forecastHint}</p></div>
    <StatusBadge tone={status === "validated" ? "good" : status === "candidate" ? "warn" : status === "reference_only" ? "bad" : "neutral"}>{t.forecastStatus[status]}</StatusBadge></div>
    {overview.isLoading ? <LoadingState /> : overview.error ? <ErrorState error={overview.error} /> : <dl className="fact-list">
      {Object.entries(overview.data?.status_counts ?? {}).map(([key, value]) => <div key={key}><dt>{t.statusCounts[key] ?? key.replace(/_/g, " ")}</dt><dd>{value}</dd></div>)}
      <div><dt>{t.outcomes}</dt><dd>{overview.data?.totals.outcomes ?? 0}</dd></div>
      <div><dt>{t.revoked}</dt><dd>{overview.data?.totals.revoked_events ?? 0}</dd></div>
    </dl>}
    <div className="chart-foot"><Link to="/forecasts/evaluation">{t.openEvaluation}</Link></div>
  </section>;
}
