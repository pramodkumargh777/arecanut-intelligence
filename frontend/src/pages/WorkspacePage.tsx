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
import { calendarTodayIST, formatCalendarDate } from "../../../shared/dates";
import {
  createProfile, loadStore, profileSearch, removeProfile, ROLE_TEMPLATES, saveStore, SECTION_LABELS, upsertProfile,
  WORKSPACE_ROLES, WORKSPACE_SECTIONS, type WorkspaceProfile, type WorkspaceRole, type WorkspaceStore,
} from "../services/workspace";

const FEED_LABEL: Record<MarketFeed, string> = { official: "AGMARKNET · official APMC modal", mamcos: "MAMCOS · cooperative average", tss: "TSS · tender average", tumcos: "TUMCOS · cooperative average" };
const inr = (value: number | null | undefined) => value == null ? "—" : `₹${Math.round(value).toLocaleString("en-IN")}`;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}`;

export function WorkspacePage() {
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
    const profile = createProfile(role, name.trim() || ROLE_TEMPLATES[role].label, new Date(), newId());
    const feed = feeds.includes(profile.feed) ? profile.feed : feeds[0];
    try { setStore((current) => upsertProfile(current, { ...profile, commodity: commodityCode, feed: feed ?? profile.feed })); setName(""); }
    catch (error) { window.alert((error as Error).message); }
  }

  return <div className="page-stack">
    <section className="page-heading"><div><div className="eyebrow">ORGANIZATION DASHBOARD</div><h1>Workspace</h1>
      <p>Save a dashboard per organization or role with its own source, variety, reporting period and sections. Every panel reads the same verified ANI data as the main pages.</p></div></section>
    <div className="data-disclosure">Profiles are stored only in this browser (localStorage); they contain filter preferences, never market data, and are not shared with other users or devices.{!persisted && " Browser storage is unavailable, so changes last only until this tab closes."}</div>

    <section className="panel workspace-panel"><div className="panel-heading"><div><h2>Dashboard profiles</h2><p>{store.profiles.length ? `${store.profiles.length} saved · up to 20` : "No profiles yet. Start from a role template."}</p></div></div>
      <div className="workspace-controls">
        {store.profiles.length > 0 && <label className="filter-control"><span>Active profile</span><select value={store.activeId ?? ""} onChange={(event) => setStore((current) => ({ ...current, activeId: event.target.value }))}>
          {store.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.organization ? ` · ${profile.organization}` : ""}</option>)}</select></label>}
        <label className="filter-control"><span>New profile template</span><select value={role} onChange={(event) => setRole(event.target.value as WorkspaceRole)}>
          {WORKSPACE_ROLES.map((value) => <option key={value} value={value}>{ROLE_TEMPLATES[value].label}</option>)}</select></label>
        <label className="filter-control"><span>Profile name</span><input value={name} maxLength={80} placeholder={ROLE_TEMPLATES[role].label} onChange={(event) => setName(event.target.value)} /></label>
        <button type="button" className="button-primary" onClick={create}>Create profile</button>
      </div>
      <p className="panel-note">{ROLE_TEMPLATES[role].description}</p>
    </section>

    {active ? <ProfileDashboard key={active.id} profile={active} feeds={feeds} defaultCommodity={catalog.default_commodity} commodityMatches={active.commodity === commodityCode} onChange={update} onDelete={() => { if (window.confirm(`Delete the profile "${active.name}"? This does not affect any data.`)) setStore((current) => removeProfile(current, active.id)); }} />
      : <EmptyState title="No dashboard profile selected">Create a profile above to save filters and sections for your organization.</EmptyState>}
  </div>;
}

function ProfileDashboard({ profile, feeds, defaultCommodity, commodityMatches, onChange, onDelete }: {
  profile: WorkspaceProfile; feeds: MarketFeed[]; defaultCommodity: string; commodityMatches: boolean; onChange: (patch: Partial<WorkspaceProfile>) => void; onDelete: () => void;
}) {
  const [draftName, setDraftName] = useState(profile.name);
  const show = (section: WorkspaceProfile["sections"][number]) => profile.sections.includes(section);
  const search = profileSearch(profile, defaultCommodity);
  const feedSupported = feeds.includes(profile.feed);
  return <>
    <section className="panel workspace-panel"><div className="panel-heading"><div><h2>{profile.name}</h2><p>{ROLE_TEMPLATES[profile.role].label} template · custom filters</p></div>
      <button type="button" className="button-secondary" onClick={onDelete}>Delete profile</button></div>
      <div className="workspace-controls">
        <label className="filter-control"><span>Profile name</span><input value={draftName} maxLength={80} onChange={(event) => setDraftName(event.target.value)} onBlur={() => { if (draftName.trim()) onChange({ name: draftName.trim() }); else setDraftName(profile.name); }} /></label>
        <label className="filter-control"><span>Organization</span><input value={profile.organization} maxLength={120} placeholder="Optional" onChange={(event) => onChange({ organization: event.target.value })} /></label>
        <label className="filter-control"><span>Source / price type</span><select value={feedSupported ? profile.feed : ""} onChange={(event) => onChange({ feed: event.target.value as MarketFeed, variety: "" })}>
          {!feedSupported && <option value="" disabled>Not available for this commodity</option>}
          {feeds.map((feed) => <option key={feed} value={feed}>{FEED_LABEL[feed]}</option>)}</select></label>
        <VarietyControl profile={profile} enabled={feedSupported && commodityMatches} onChange={(variety) => onChange({ variety })} />
        <label className="filter-control"><span>Reporting period</span><select value={profile.datePreset} onChange={(event) => onChange({ datePreset: event.target.value as WorkspaceProfile["datePreset"] })}>
          {DATE_PRESETS.filter((option) => option.value !== "custom").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      </div>
      <fieldset className="workspace-sections"><legend>Visible sections</legend>
        {WORKSPACE_SECTIONS.map((section) => <label key={section} className="check-option"><input type="checkbox" checked={show(section)} onChange={(event) => onChange({ sections: event.target.checked ? WORKSPACE_SECTIONS.filter((item) => item === section || profile.sections.includes(item)) : profile.sections.filter((item) => item !== section) })} />{SECTION_LABELS[section]}</label>)}
      </fieldset>
    </section>

    {!commodityMatches ? <EmptyState title="Profile saved for another commodity">This profile was created for {profile.commodity.replace(/_/g, " ")}. Switch the commodity selector to view its panels.</EmptyState>
      : !feedSupported ? <EmptyState title="Source not integrated for this commodity">Choose one of the available sources above.</EmptyState> : <>
      {show("scorecard") && <IntelligenceScorecard feed={profile.feed} variety={profile.variety} />}
      {show("latest_quotes") && <LatestQuotes profile={profile} />}
      {show("forecast_status") && <ForecastStatusPanel />}
      {show("monthly_insights") && (profile.commodity === "arecanut" ? <MonthlyInsights /> : <EmptyState title="Monthly history not integrated">Monthly analysis is available for arecanut only.</EmptyState>)}
      {show("shortcuts") && <section className="panel workspace-panel"><div className="panel-heading"><div><h2>Shortcuts with this profile's filters</h2><p>Source and commodity are applied; the variety filter is applied on cooperative pages.</p></div></div>
        <nav className="workspace-links" aria-label="Profile shortcuts">
          <Link to={`/${search}`}>Overview</Link><Link to={`/prices${search}`}>Market prices</Link><Link to={`/analytics${search}`}>Price analytics</Link>
          <Link to={`/compare${search}`}>Market comparison</Link><Link to="/history">Historical analytics</Link><Link to="/decision-tools">Decision tools</Link><Link to="/forecasts/evaluation">Forecast evaluation</Link>
        </nav></section>}
      {!profile.sections.length && <EmptyState title="No sections selected">Tick at least one section above.</EmptyState>}
    </>}
  </>;
}

function VarietyControl({ profile, enabled, onChange }: { profile: WorkspaceProfile; enabled: boolean; onChange: (variety: string) => void }) {
  const official = profile.feed === "official";
  const varieties = useQuery({
    queryKey: ["workspace-varieties", profile.commodity, profile.feed], enabled,
    queryFn: async () => official ? api.varieties(profile.commodity)
      : Array.from(new Set((await api.cooperativePrices(profile.feed as "mamcos" | "tss" | "tumcos", undefined, profile.commodity as "arecanut" | "black_pepper", {})).data.map((row) => row.variety))).sort(),
  });
  return <label className="filter-control"><span>Variety</span><select value={profile.variety} disabled={!enabled || varieties.isLoading} onChange={(event) => onChange(event.target.value)}>
    <option value="">{official ? "First available variety" : "All varieties"}</option>
    {profile.variety && !varieties.data?.includes(profile.variety) && <option value={profile.variety}>{profile.variety} (not in current data)</option>}
    {(varieties.data ?? []).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>;
}

function LatestQuotes({ profile }: { profile: WorkspaceProfile }) {
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
  const period = DATE_PRESETS.find((option) => option.value === profile.datePreset)?.label ?? "";
  return <section className="panel table-panel"><div className="panel-heading"><div><h2>Latest reported quotes</h2><p>{period} · up to 10 most recent rows · INR/quintal as published</p></div><SourceLabel>{FEED_LABEL[profile.feed]}</SourceLabel></div>
    {query.isLoading ? <LoadingState /> : query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : !query.data?.length ? <EmptyState title="No quotes in this period">No {official ? "verified official" : "published cooperative"} observations match these filters. Widen the reporting period or choose another source.</EmptyState> :
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Latest quotes"><table><thead><tr><th>{official ? "Market" : "Branch"}</th><th>Reporting date</th><th>Variety</th><th className="numeric">Minimum</th><th className="numeric">{official ? "Modal" : "Average"}</th><th className="numeric">Maximum</th></tr></thead><tbody>
        {query.data.map((row) => <tr key={row.key}><td>{row.place}</td><td>{formatCalendarDate(row.date)}</td><td>{row.variety}</td><td className="numeric">{inr(row.min)}</td><td className="numeric">{inr(row.central)}</td><td className="numeric">{inr(row.max)}</td></tr>)}
      </tbody></table></div>}
  </section>;
}

function ForecastStatusPanel() {
  const overview = useQuery({ queryKey: ["forecasting-overview"], queryFn: () => api.forecastingOverview() });
  const status = forecastValidationStatus(overview.data?.status_counts, overview.data?.totals.validated_events ?? 0);
  const text = { not_evaluated: "No evaluation published", validated: "Validated prospectively", candidate: "Candidates under prospective evaluation", reference_only: "Reference baselines only" }[status];
  return <section className="panel workspace-panel"><div className="panel-heading"><div><h2>Forecast validation status</h2><p>Models are labelled validated only after prospective outcomes beat their baseline.</p></div>
    <StatusBadge tone={status === "validated" ? "good" : status === "candidate" ? "warn" : status === "reference_only" ? "bad" : "neutral"}>{text}</StatusBadge></div>
    {overview.isLoading ? <LoadingState /> : overview.error ? <ErrorState error={overview.error} /> : <dl className="fact-list">
      {Object.entries(overview.data?.status_counts ?? {}).map(([key, value]) => <div key={key}><dt>{key.replace(/_/g, " ")}</dt><dd>{value}</dd></div>)}
      <div><dt>Prospective outcomes matched</dt><dd>{overview.data?.totals.outcomes ?? 0}</dd></div>
      <div><dt>Revoked model events</dt><dd>{overview.data?.totals.revoked_events ?? 0}</dd></div>
    </dl>}
    <div className="chart-foot"><Link to="/forecasts/evaluation">Open full evaluation</Link></div>
  </section>;
}
