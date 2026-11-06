import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { routeAvailable } from "../../../shared/commodities";
import { useCommodity } from "../services/commodity";
import { LanguageToggle, useLanguage } from "../services/language";
import { CommodityGate } from "./CommodityGate";
import { Activity, ArrowLeftRight, BookOpenText, Calculator, CalendarRange, ChartNoAxesCombined, CircleHelp, ClipboardCheck, FlaskConical, Gauge, History, Hourglass, House, LayoutDashboard, Leaf, MapPin, Menu, MessageSquareText, Search, TableProperties, X } from "lucide-react";

const navigationGroups = [
  { label: "For growers", kn: "ಬೆಳೆಗಾರರಿಗೆ", items: [
    { to: "/", label: "Latest rates", kn: "ಇತ್ತೀಚಿನ ಧಾರಣೆ", icon: House, end: true },
    { to: "/sell-or-hold", label: "Sell or wait", kn: "ಮಾರಬೇಕೇ, ಕಾಯಬೇಕೇ", icon: Hourglass },
    { to: "/assistant", label: "Ask a question", kn: "ಪ್ರಶ್ನೆ ಕೇಳಿ", icon: MessageSquareText },
  ] },
  { label: "Markets", kn: "ಮಾರುಕಟ್ಟೆ", items: [
    { to: "/overview", label: "Overview", kn: "ಸಮಗ್ರ ನೋಟ", icon: Activity },
    { to: "/prices", label: "Market prices", kn: "ಮಾರುಕಟ್ಟೆ ದರಗಳು", icon: TableProperties },
    { to: "/analytics", label: "Price analytics", kn: "ದರ ವಿಶ್ಲೇಷಣೆ", icon: ChartNoAxesCombined },
    { to: "/compare", label: "Market comparison", kn: "ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ", icon: ArrowLeftRight },
  ] },
  { label: "History", kn: "ಇತಿಹಾಸ", items: [
    { to: "/monthly-trends", label: "Monthly trends", kn: "ತಿಂಗಳ ಪ್ರವೃತ್ತಿ", icon: CalendarRange },
    { to: "/history", label: "Historical analytics", kn: "ಐತಿಹಾಸಿಕ ವಿಶ್ಲೇಷಣೆ", icon: History },
  ] },
  { label: "Intelligence", kn: "ಮಾಹಿತಿ", items: [
    { to: "/intelligence", label: "Source intelligence", kn: "ಮೂಲ ಮಾಹಿತಿ", icon: BookOpenText },
    { to: "/supply", label: "Supply & weather", kn: "ಉತ್ಪಾದನೆ ಮತ್ತು ಹವಾಮಾನ", icon: MapPin },
  ] },
  { label: "Forecasting", kn: "ಮುನ್ಸೂಚನೆ", items: [
    { to: "/forecasts", label: "Experimental baselines", kn: "ಪ್ರಾಯೋಗಿಕ ಅಂದಾಜು", icon: FlaskConical, end: true },
    { to: "/forecasts/evaluation", label: "Forecast evaluation", kn: "ಅಂದಾಜಿನ ಪರಿಶೀಲನೆ", icon: Gauge },
  ] },
  { label: "Workspace", kn: "ಕಾರ್ಯಕ್ಷೇತ್ರ", items: [
    { to: "/workspace", label: "Organization dashboard", kn: "ಸಂಸ್ಥೆಯ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್", icon: LayoutDashboard },
    { to: "/decision-tools", label: "Decision tools", kn: "ಲೆಕ್ಕಾಚಾರ ಸಾಧನಗಳು", icon: Calculator },
    { to: "/data-quality", label: "Data quality", kn: "ದತ್ತಾಂಶ ಗುಣಮಟ್ಟ", icon: ClipboardCheck },
  ] },
];
const navigation: { to: string; label: string; kn: string; icon: typeof Activity; end?: boolean }[] = navigationGroups.flatMap((group) => group.items);
/** Grower pages are arecanut-only and short, so they leave out the commodity and market-search controls. */
const GROWER_PAGES = ["/", "/sell-or-hold"];

export function AppShell() {
  const { language } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const sidebar = useRef<HTMLElement>(null);
  const mainColumn = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const currentItem = navigation.find((item) => item.to === location.pathname || (item.to === "/intelligence" && location.pathname.startsWith("/intelligence/")));
  const currentPage = currentItem ? (language === "kn" ? currentItem.kn : currentItem.label) : "Overview";
  const growerPage = GROWER_PAGES.includes(location.pathname);
  const marketParams = new URLSearchParams(location.search);
  const marketContext = new URLSearchParams();
  const { code: commodityCode, commodity, catalog, unit } = useCommodity();
  const commodityContext = new URLSearchParams();
  if (marketParams.get("commodity")) commodityContext.set("commodity", commodityCode);
  for (const key of ["commodity", "feed", "variety"]) {
    const value = marketParams.get(key);
    if (value) marketContext.set(key, value);
  }
  const marketSearch = marketContext.toString() ? `?${marketContext}` : "";
  const commoditySearch = commodityContext.toString() ? `?${commodityContext}` : "";
  function selectCommodity(next: string) {
    // Variety, grade and feed filters are commodity-specific, so they are cleared on change.
    const params = new URLSearchParams();
    if (next !== catalog.default_commodity) params.set("commodity", next);
    navigate(`${location.pathname}${params.toString() ? `?${params}` : ""}`);
  }

  useEffect(() => {
    setSearch(new URLSearchParams(location.search).get("search") ?? "");
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 961px)");
    const closeOnDesktop = () => { if (media.matches) setMenuOpen(false); };
    media.addEventListener("change", closeOnDesktop);
    return () => media.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mainColumn.current?.setAttribute("inert", "");
    const closeButton = sidebar.current?.querySelector<HTMLButtonElement>(".mobile-close");
    closeButton?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
      if (event.key !== "Tab") return;
      const controls = sidebar.current?.querySelectorAll<HTMLElement>("a[href], button");
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      mainColumn.current?.removeAttribute("inert");
      document.removeEventListener("keydown", handleKey);
      menuButton.current?.focus();
    };
  }, [menuOpen]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      {menuOpen && <button className="mobile-scrim" tabIndex={-1} aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside ref={sidebar} id="main-navigation" aria-label="Market intelligence navigation" role={menuOpen ? "dialog" : undefined} aria-modal={menuOpen || undefined} className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark"><Leaf size={15} strokeWidth={2.2} /></span>
          <span className="brand-copy"><strong>ANI</strong><small>Arecanut Intelligence</small></span>
          <button className="icon-button mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={19} /></button>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          {navigationGroups.map((group) => <div key={group.label} role="group" aria-label={group.label}>
            <div className="nav-group" aria-hidden="true">{language === "kn" ? group.kn : group.label}</div>
            {(group.items as typeof navigation).map(({ to, label, kn, icon: Icon, end }) => {
              const available = routeAvailable(commodity, to);
              return <NavLink key={to} to={["/overview", "/prices", "/analytics", "/compare"].includes(to) ? `${to}${marketSearch}` : `${to}${commoditySearch}`} end={end} onClick={() => setMenuOpen(false)} title={available ? undefined : `No integrated source for ${commodity?.display_name ?? commodityCode}`} className={({ isActive }) => `nav-link ${isActive ? "active" : ""} ${available ? "" : "nav-link-unavailable"}`}>
                <Icon size={15} strokeWidth={1.8} /><span lang={language}>{language === "kn" ? kn : label}</span>
              </NavLink>;
            })}
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="source-note"><span className="source-note-icon"><CircleHelp size={15} /></span><span><b>Reviewed source records</b><small>Every quote has a source and date.</small></span></div>
          <div className="sidebar-foot">KARNATAKA · {unit}</div>
        </div>
      </aside>
      <div className="main-column" ref={mainColumn}>
        <header className="topbar">
          <button ref={menuButton} className="icon-button menu-toggle" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen} aria-controls="main-navigation"><Menu size={21} /></button>
          <div className="breadcrumb"><span>{commodity?.display_name ?? commodityCode}</span><span className="breadcrumb-sep">/</span><strong>{currentPage}</strong></div>
          <div className={`topbar-tools${growerPage ? " topbar-tools-grower" : ""}`}>
            <LanguageToggle />
            {!growerPage && <><label className="commodity-select"><span>Commodity</span><select aria-label="Commodity" value={commodity ? commodityCode : ""} onChange={(event) => selectCommodity(event.target.value)}>
              {!commodity && <option value="" disabled>Unknown: {commodityCode}</option>}
              {catalog.commodities.map((item) => <option key={item.code} value={item.code}>{item.display_name}{item.status === "production" ? "" : " · configured"}</option>)}
            </select></label>
            <form role="search" onSubmit={(event) => {
              event.preventDefault();
              const next = new URLSearchParams(marketContext);
              if (search.trim()) next.set("search", search.trim());
              navigate(next.toString() ? `/prices?${next}` : "/prices");
            }}><label className="search-field"><Search size={16} /><input type="search" aria-label="Search markets, press Enter to search" placeholder="Search markets · Enter" value={search} onChange={(event) => setSearch(event.target.value)} /></label></form>
            <span className="region-pill"><MapPin size={13} /> Karnataka</span></>}
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="page-content"><CommodityGate><Outlet /></CommodityGate></main>
        <footer className="site-footer"><span>Arecanut Intelligence</span><span>Market observations · Not financial advice</span></footer>
      </div>
    </div>
  );
}
