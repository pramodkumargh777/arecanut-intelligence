import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { marketFeeds, routeAvailable } from "../../../shared/commodities";
import { commodityName, useCommodity } from "../services/commodity";
import { defineCopy, LanguageToggle, useLanguage } from "../services/language";
import { CommodityGate } from "./CommodityGate";
import { MarketSearch } from "./MarketSearch";
import { SiteFooter } from "./SiteFooter";
import type { MarketSuggestion } from "../services/marketSuggestions";
import brandIcon from "../assets/areca-pulse-icon.svg";
import darkLogo from "../assets/areca-pulse-logo-dark.svg";
import appIcon from "../assets/areca-pulse-app-icon.svg";
import { setTheme, useTheme } from "../services/theme";
import { Activity, ArrowLeftRight, BookOpenText, Calculator, CalendarRange, ChartNoAxesCombined, ChevronDown, Ellipsis, FlaskConical, Gauge, Hourglass, House, MapPin, Menu, MessageSquareText, Moon, PanelLeftClose, PanelLeftOpen, Search, SlidersHorizontal, Sun, TableProperties, X } from "lucide-react";

const primaryNavigation = [
    { to: "/", label: "Latest rates", kn: "ಇತ್ತೀಚಿನ ಧಾರಣೆ", icon: House, end: true },
    { to: "/prices", label: "Explore prices", kn: "ಮಾರುಕಟ್ಟೆ ದರಗಳು", icon: TableProperties },
    { to: "/analytics", label: "Price trends", kn: "ದರ ಪ್ರವೃತ್ತಿ", icon: ChartNoAxesCombined },
    { to: "/compare", label: "Compare markets", kn: "ಮಾರುಕಟ್ಟೆ ಹೋಲಿಕೆ", icon: ArrowLeftRight },
    { to: "/intelligence", label: "Market intelligence", kn: "ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ", icon: BookOpenText },
    { to: "/sell-or-hold", label: "Sell or wait", kn: "ಮಾರಬೇಕೇ, ಕಾಯಬೇಕೇ", icon: Hourglass },
    { to: "/assistant", label: "Ask a question", kn: "ಪ್ರಶ್ನೆ ಕೇಳಿ", icon: MessageSquareText },
];
const advancedGroups = [
  { label: "Market detail", kn: "ಮಾರುಕಟ್ಟೆ ವಿವರ", items: [
    { to: "/overview", label: "Market overview", kn: "ಸಮಗ್ರ ನೋಟ", icon: Activity },
    { to: "/monthly-trends", label: "Monthly trends", kn: "ತಿಂಗಳ ಪ್ರವೃತ್ತಿ", icon: CalendarRange },
    { to: "/supply", label: "Supply & weather", kn: "ಉತ್ಪಾದನೆ ಮತ್ತು ಹವಾಮಾನ", icon: MapPin },
  ] },
  { label: "Forecasting", kn: "ಮುನ್ಸೂಚನೆ", items: [
    { to: "/forecasts", label: "Experimental baselines", kn: "ಪ್ರಾಯೋಗಿಕ ಅಂದಾಜು", icon: FlaskConical, end: true },
    { to: "/forecasts/evaluation", label: "Forecast evaluation", kn: "ಅಂದಾಜಿನ ಪರಿಶೀಲನೆ", icon: Gauge },
  ] },
  { label: "Workspace", kn: "ಕಾರ್ಯಕ್ಷೇತ್ರ", items: [
    // Hidden from the menu for now: no organization uses it yet. The page still works at /workspace.
    // { to: "/workspace", label: "Organization dashboard", kn: "ಸಂಸ್ಥೆಯ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್", icon: LayoutDashboard },
    { to: "/decision-tools", label: "Decision tools", kn: "ಲೆಕ್ಕಾಚಾರ ಸಾಧನಗಳು", icon: Calculator },
    // Hidden from the menu for now: an internal review queue, not for growers. The page still works at /data-quality.
    // { to: "/data-quality", label: "Data quality", kn: "ದತ್ತಾಂಶ ಗುಣಮಟ್ಟ", icon: ClipboardCheck },
  ] },
];
const navigation: { to: string; label: string; kn: string; icon: typeof Activity; end?: boolean }[] = [...primaryNavigation, ...advancedGroups.flatMap((group) => group.items)];
const COLLAPSE_KEY = "areca-pulse-sidebar-collapsed";

/** Whether the desktop menu was last left collapsed. The phone drawer ignores this. */
function storedCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === "true"; }
  catch { return false; }
}

/** Grower pages are arecanut-only and short, so they leave out the commodity and market-search controls. */
const GROWER_PAGES = ["/", "/sell-or-hold"];
/** A visitor's own saved profiles and the reviewer queue have nothing for search engines. */
const PRIVATE_PAGES = ["/workspace", "/data-quality"];

const SHELL_COPY = defineCopy({
  en: {
    skip: "Skip to content", openMenu: "Open menu", closeMenu: "Close menu", closeNavigation: "Close navigation", navigation: "Main navigation",
    moreTools: "More tools", marketTools: "Market tools", tools: "Tools", commodity: "Commodity", search: "Search markets · Enter", searchLabel: "Search markets, press Enter to search",
    region: "Karnataka", tagline: "Know the market. See the opportunity.", taglineHint: "Prices, trends, and insights for your next move.",
    notFound: "Page not found", noSource: "No data",
    noSourceFor: (name: string) => `No integrated source for ${name}`, unknown: (code: string) => `Unknown: ${code}`, configured: "configured",
    switchDark: "Switch to dark mode", switchLight: "Switch to light mode",
    collapse: "Collapse menu", expand: "Expand menu",
  },
  kn: {
    skip: "ಮುಖ್ಯ ವಿಷಯಕ್ಕೆ ಹೋಗಿ", openMenu: "ಮೆನು ತೆರೆಯಿರಿ", closeMenu: "ಮೆನು ಮುಚ್ಚಿ", closeNavigation: "ಮೆನು ಮುಚ್ಚಿ", navigation: "ಮುಖ್ಯ ಮೆನು",
    moreTools: "ಹೆಚ್ಚಿನ ಸಾಧನಗಳು", marketTools: "ಮಾರುಕಟ್ಟೆ ಸಾಧನಗಳು", tools: "ಸಾಧನಗಳು", commodity: "ಬೆಳೆ", search: "ಮಾರುಕಟ್ಟೆ ಹುಡುಕಿ · Enter", searchLabel: "ಮಾರುಕಟ್ಟೆ ಹುಡುಕಿ, Enter ಒತ್ತಿ",
    region: "ಕರ್ನಾಟಕ", tagline: "ಮಾರುಕಟ್ಟೆ ತಿಳಿಯಿರಿ. ಅವಕಾಶ ಗುರುತಿಸಿ.", taglineHint: "ನಿಮ್ಮ ಮುಂದಿನ ಹೆಜ್ಜೆಗೆ ದರಗಳು, ಪ್ರವೃತ್ತಿಗಳು ಮತ್ತು ಮಾರುಕಟ್ಟೆ ಮಾಹಿತಿ.",
    notFound: "ಪುಟ ಸಿಗಲಿಲ್ಲ", noSource: "ದತ್ತಾಂಶ ಇಲ್ಲ",
    noSourceFor: (name: string) => `${name} ಗೆ ದತ್ತಾಂಶ ಮೂಲ ಇಲ್ಲ`, unknown: (code: string) => `ಗೊತ್ತಿಲ್ಲ: ${code}`, configured: "ಸಂರಚಿತ",
    switchDark: "ಡಾರ್ಕ್ ಮೋಡ್‌ಗೆ ಬದಲಿಸಿ", switchLight: "ಲೈಟ್ ಮೋಡ್‌ಗೆ ಬದಲಿಸಿ",
    collapse: "ಮೆನು ಕಿರಿದಾಗಿಸಿ", expand: "ಮೆನು ವಿಸ್ತರಿಸಿ",
  },
});


export function AppShell() {
  const { language } = useLanguage();
  const theme = useTheme();
  const copy = SHELL_COPY[language];
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSE_KEY, String(next)); } catch { /* The choice still applies until the page is closed. */ }
  }
  const [marketToolsOpen, setMarketToolsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const sidebar = useRef<HTMLElement>(null);
  const mainColumn = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const currentItem = navigation.find((item) => item.to === location.pathname || (item.to === "/intelligence" && location.pathname.startsWith("/intelligence/")));
  const currentPage = currentItem ? (language === "kn" ? currentItem.kn : currentItem.label) : copy.notFound;
  const growerPage = GROWER_PAGES.includes(location.pathname);
  // The prices page has its own search box, so the top-bar one would be a second control for the same thing.
  const showTopSearch = location.pathname !== "/prices";
  const marketParams = new URLSearchParams(location.search);
  const marketContext = new URLSearchParams();
  const { code: commodityCode, commodity, catalog } = useCommodity();
  const commodityContext = new URLSearchParams();
  if (marketParams.get("commodity")) commodityContext.set("commodity", commodityCode);
  for (const key of ["commodity", "feed", "variety"]) {
    const value = marketParams.get(key);
    if (value) marketContext.set(key, value);
  }
  const marketSearch = marketContext.toString() ? `?${marketContext}` : "";
  const commoditySearch = commodityContext.toString() ? `?${commodityContext}` : "";
  const currentCommodity = commodityName(commodityCode, commodity, language);
  /** A chosen market opens its prices: APMC markets by id, cooperative branches by name under their own source. */
  function openMarket(suggestion: MarketSuggestion) {
    const params = new URLSearchParams();
    if (marketParams.get("commodity")) params.set("commodity", commodityCode);
    params.set("feed", suggestion.feed);
    // Variety labels differ between sources, so one is carried over only within the same source.
    if (marketParams.get("variety") && marketParams.get("feed") === suggestion.feed) params.set("variety", marketParams.get("variety")!);
    if (suggestion.marketId) params.set("market", suggestion.marketId);
    else params.set("branch", suggestion.name);
    setSearch("");
    navigate(`/prices?${params}`);
  }
  function selectCommodity(next: string) {
    // Variety, grade and feed filters are commodity-specific, so they are cleared on change.
    const params = new URLSearchParams();
    if (next !== catalog.default_commodity) params.set("commodity", next);
    navigate(`${location.pathname}${params.toString() ? `?${params}` : ""}`);
  }

  useEffect(() => {
    document.title = `${currentPage} · Areca Pulse`;
  }, [currentPage]);

  // Private pages, and addresses that match no page, are kept out of search results.
  const searchable = Boolean(currentItem) && !PRIVATE_PAGES.includes(location.pathname);
  useEffect(() => {
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (searchable) return robots?.remove();
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.append(robots);
    }
    robots.content = "noindex";
  }, [searchable]);

  useEffect(() => {
    setSearch(new URLSearchParams(location.search).get("search") ?? "");
    setMenuOpen(false);
    setMarketToolsOpen(false);
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
      const controls = Array.from(sidebar.current?.querySelectorAll<HTMLElement>("a[href], button, summary") ?? [])
        .filter((control) => control.getClientRects().length > 0
          && getComputedStyle(control).visibility !== "hidden"
          && (control.tagName === "SUMMARY" || !control.closest("details:not([open])")));
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
    <div className={`app-shell${collapsed ? " app-shell-collapsed" : ""}`}>
      <a className="skip-link" href="#main-content">{copy.skip}</a>
      {menuOpen && <button className="mobile-scrim" tabIndex={-1} aria-label={copy.closeNavigation} onClick={() => setMenuOpen(false)} />}
      <aside ref={sidebar} id="main-navigation" aria-label={copy.navigation} role={menuOpen ? "dialog" : undefined} aria-modal={menuOpen || undefined} className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <BrandLockup />
          <button className="icon-button mobile-close" onClick={() => setMenuOpen(false)} aria-label={copy.closeMenu}><X size={19} /></button>
        </div>
        <nav className="main-nav" aria-label={copy.navigation}>
          {(() => {
            const links = (items: typeof navigation) => items.map(({ to, label, kn, icon: Icon, end }) => {
              const available = routeAvailable(commodity, to);
              const unavailableText = copy.noSourceFor(currentCommodity);
              // The reason is visible as a badge and spoken in full, not only in a hover tooltip that touch and screen-reader users miss.
              return <NavLink key={to} to={["/overview", "/prices", "/analytics", "/compare"].includes(to) ? `${to}${marketSearch}` : `${to}${commoditySearch}`} end={end} onClick={() => setMenuOpen(false)}
                // A collapsed menu shows icons only, so the name appears on hover; screen readers still read the hidden label.
                title={collapsed ? `${language === "kn" ? kn : label}${available ? "" : ` · ${unavailableText}`}` : available ? undefined : unavailableText} className={({ isActive }) => `nav-link ${isActive ? "active" : ""} ${available ? "" : "nav-link-unavailable"}`}>
                <Icon size={15} strokeWidth={1.8} /><span lang={language}>{language === "kn" ? kn : label}</span>
                {!available && <><span className="nav-badge" aria-hidden="true">{copy.noSource}</span><span className="sr-only">({unavailableText})</span></>}
              </NavLink>;
            });
            return <>
              {links(primaryNavigation)}
              <details className="nav-advanced" open={advancedGroups.some((group) => group.items.some((item) => item.to === location.pathname)) || undefined}>
                <summary title={collapsed ? copy.moreTools : undefined}><Ellipsis className="nav-advanced-icon" size={15} aria-hidden="true" /><span>{copy.moreTools}</span></summary>
                {advancedGroups.map((group) => <div key={group.label} role="group" aria-label={language === "kn" ? group.kn : group.label}>
                  <div className="nav-group" aria-hidden="true">{language === "kn" ? group.kn : group.label}</div>
                  {links(group.items)}
                </div>)}
              </details>
            </>;
          })()}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-caption"><p>{copy.tagline}</p><small>{copy.taglineHint}</small></div>
        </div>
      </aside>
      <div className="main-column" ref={mainColumn}>
        <header className={`topbar${location.pathname === "/" ? " topbar-home" : ""}`}>
          <button ref={menuButton} className="icon-button menu-toggle" onClick={() => setMenuOpen(true)} aria-label={copy.openMenu} aria-expanded={menuOpen} aria-controls="main-navigation"><Menu size={21} /></button>
          {/* Desktop only, at the start of the top bar so it stays in view whatever the menu's height. */}
          <button type="button" className="icon-button sidebar-collapse" onClick={toggleCollapsed} aria-label={collapsed ? copy.expand : copy.collapse} title={collapsed ? copy.expand : copy.collapse} aria-controls="main-navigation">
            {collapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}
          </button>
          {/* Phones and tablets only. The bare palm mark, not the tiled app icon, so it reads as the logo beside outlined buttons; the dark logo is cropped to its mark. */}
          <Link to="/" className="topbar-brand" aria-label={BRAND_LABEL}><img className={`topbar-brand-mark${theme === "dark" ? " topbar-brand-mark-dark" : ""}`} src={theme === "dark" ? darkLogo : brandIcon} alt="" />
            <span className="topbar-brand-name" aria-hidden="true" lang="en">Areca <span className="brand-name-accent">Pulse</span></span></Link>
          <div className="breadcrumb"><span>{currentCommodity}</span><span className="breadcrumb-sep">/</span><strong>{currentPage}</strong></div>
          {!growerPage && <button type="button" className="button-secondary market-tools-toggle" aria-expanded={marketToolsOpen} aria-controls="header-market-tools" aria-label={copy.marketTools} onClick={() => setMarketToolsOpen((open) => !open)}><SlidersHorizontal size={15} aria-hidden="true" />{copy.tools}<ChevronDown className="market-tools-chevron" size={15} aria-hidden="true" /></button>}
          {!growerPage && <div id="header-market-tools" className={`topbar-tools${marketToolsOpen ? " topbar-tools-open" : ""}`}>
            <label className="commodity-select"><span>{copy.commodity}</span><select aria-label={copy.commodity} value={commodity ? commodityCode : ""} onChange={(event) => selectCommodity(event.target.value)}>
              {!commodity && <option value="" disabled>{copy.unknown(commodityCode)}</option>}
              {catalog.commodities.map((item) => <option key={item.code} value={item.code}>{commodityName(item.code, item, language)}{item.status === "production" ? "" : ` · ${copy.configured}`}</option>)}
            </select></label>
            {showTopSearch && <form role="search" onSubmit={(event) => {
              event.preventDefault();
              const next = new URLSearchParams(marketContext);
              if (search.trim()) next.set("search", search.trim());
              navigate(next.toString() ? `/prices?${next}` : "/prices");
            }}><label className="search-field"><Search size={16} /><MarketSearch feeds={marketFeeds(commodity)} ariaLabel={copy.searchLabel} placeholder={copy.search} value={search} onChange={setSearch} onSelect={openMarket} /></label></form>}
            <span className="region-pill"><MapPin size={13} /> {copy.region}</span>
          </div>}
          <div className="topbar-preferences">
            <LanguageToggle />
            <button type="button" className="icon-button theme-toggle" aria-label={theme === "dark" ? copy.switchLight : copy.switchDark} title={theme === "dark" ? copy.switchLight : copy.switchDark} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="page-content"><CommodityGate><Outlet /></CommodityGate></main>
        <SiteFooter />
      </div>
    </div>
  );
}

const BRAND_LABEL = "Areca Pulse · Market Intelligence";

/**
 * Compact lockup: the brand symbol beside a live-text wordmark. The full horizontal logo is not shrunk into the sidebar,
 * because its descriptor and tagline become unreadably small (brand guide: use the icon at small sizes). Live text also
 * renders in the app's own Inter, which an SVG loaded through <img> cannot use.
 */
function BrandLockup() {
  const theme = useTheme();
  return <Link to="/" className="brand-lockup" aria-label={BRAND_LABEL}>
    {/* Shown instead of the lockup when the desktop menu is collapsed. */}
    <img className="brand-collapsed-icon" src={theme === "dark" ? appIcon : brandIcon} alt="" width={36} height={28} />
    {/* On phones the dark logo's built-in tagline is too small to read, so the mark and live wordmark replace it. */}
    {theme === "dark" ? <><img className="brand-dark-logo" src={darkLogo} alt="" />
      <span className="brand-lockup-row brand-lockup-phone">
        <img className="brand-icon topbar-brand-mark-dark" src={darkLogo} alt="" width={40} height={31} />
        <span className="brand-words" aria-hidden="true" lang="en">
          <span className="brand-name">Areca <span className="brand-name-accent">Pulse</span></span>
          <span className="brand-descriptor">Market Intelligence</span>
        </span>
      </span></> :
    <span className="brand-lockup-row">
      <img className="brand-icon" src={brandIcon} alt="" width={40} height={31} />
      <span className="brand-words" aria-hidden="true" lang="en">
        <span className="brand-name">Areca <span className="brand-name-accent">Pulse</span></span>
        <span className="brand-descriptor">Market Intelligence</span>
      </span>
    </span>}
  </Link>;
}
