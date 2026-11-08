import { z } from "zod";
import type { MarketFeed } from "../../../shared/commodities";
import type { DatePreset } from "./insights";

/**
 * Organization dashboard profiles. They are saved filter/section preferences only: they hold no market data,
 * are stored in this browser's localStorage, and are never sent to the API.
 */
export const WORKSPACE_ROLES = ["grower", "trader", "cooperative", "analyst"] as const;
export type WorkspaceRole = typeof WORKSPACE_ROLES[number];
export const WORKSPACE_SECTIONS = ["scorecard", "latest_quotes", "monthly_insights", "forecast_status", "shortcuts"] as const;
export type WorkspaceSection = typeof WORKSPACE_SECTIONS[number];

const FEEDS = ["official", "mamcos", "tss", "tumcos"] as const;
const PRESETS = ["all", "7d", "30d", "90d", "365d", "ytd"] as const;

export const workspaceProfileSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  organization: z.string().trim().max(120).default(""),
  role: z.enum(WORKSPACE_ROLES),
  commodity: z.string().regex(/^[a-z_]{1,40}$/).default("arecanut"),
  feed: z.enum(FEEDS),
  variety: z.string().trim().max(80).default(""),
  datePreset: z.enum(PRESETS).default("30d"),
  sections: z.array(z.enum(WORKSPACE_SECTIONS)).max(WORKSPACE_SECTIONS.length),
  updatedAt: z.string(),
});
export type WorkspaceProfile = z.infer<typeof workspaceProfileSchema>;

const storeSchema = z.object({ version: z.literal(1), activeId: z.string().nullable(), profiles: z.array(workspaceProfileSchema).max(20) });
export type WorkspaceStore = z.infer<typeof storeSchema>;
export const WORKSPACE_STORAGE_KEY = "ani.workspace.v1";
export const EMPTY_STORE: WorkspaceStore = { version: 1, activeId: null, profiles: [] };

export const ROLE_TEMPLATES: Record<WorkspaceRole, { label: string; description: string; feed: MarketFeed; datePreset: Exclude<DatePreset, "custom">; sections: WorkspaceSection[] }> = {
  grower: { label: "Grower / farmer group", description: "Latest cooperative quotes near you, data freshness and decision-tool shortcuts.", feed: "mamcos", datePreset: "30d", sections: ["scorecard", "latest_quotes", "shortcuts"] },
  trader: { label: "Trader / buyer", description: "Same-date market ranges, spreads and recent quotes across sources.", feed: "mamcos", datePreset: "7d", sections: ["latest_quotes", "scorecard", "shortcuts"] },
  cooperative: { label: "Cooperative society", description: "Branch coverage, reporting completeness and published averages.", feed: "mamcos", datePreset: "90d", sections: ["scorecard", "latest_quotes", "monthly_insights", "shortcuts"] },
  analyst: { label: "Analyst / researcher", description: "Monthly history, seasonality, volatility and forecast evaluation status.", feed: "official", datePreset: "365d", sections: ["scorecard", "monthly_insights", "forecast_status", "shortcuts"] },
};

export function createProfile(role: WorkspaceRole, name: string, now: Date, id: string): WorkspaceProfile {
  const template = ROLE_TEMPLATES[role];
  return workspaceProfileSchema.parse({ id, name, organization: "", role, commodity: "arecanut", feed: template.feed, variety: "", datePreset: template.datePreset, sections: template.sections, updatedAt: now.toISOString() });
}

/** Invalid or tampered storage is discarded rather than partially trusted. */
export function parseStore(raw: string | null): WorkspaceStore {
  if (!raw) return EMPTY_STORE;
  try {
    const parsed = storeSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return EMPTY_STORE;
    const activeId = parsed.data.profiles.some((profile) => profile.id === parsed.data.activeId) ? parsed.data.activeId : parsed.data.profiles[0]?.id ?? null;
    return { ...parsed.data, activeId };
  } catch {
    return EMPTY_STORE;
  }
}

export function upsertProfile(store: WorkspaceStore, profile: WorkspaceProfile): WorkspaceStore {
  const valid = workspaceProfileSchema.parse(profile);
  const exists = store.profiles.some((item) => item.id === valid.id);
  if (!exists && store.profiles.length >= 20) throw new Error("A browser can store at most 20 dashboard profiles.");
  return { ...store, activeId: valid.id, profiles: exists ? store.profiles.map((item) => item.id === valid.id ? valid : item) : [...store.profiles, valid] };
}

export function removeProfile(store: WorkspaceStore, id: string): WorkspaceStore {
  const profiles = store.profiles.filter((item) => item.id !== id);
  return { ...store, profiles, activeId: store.activeId === id ? profiles[0]?.id ?? null : store.activeId };
}

/** Query string for a market page that applies a profile's filters; the pages read these parameters already. */
export function profileSearch(profile: Pick<WorkspaceProfile, "commodity" | "feed" | "variety">, defaultCommodity = "arecanut"): string {
  const params = new URLSearchParams();
  if (profile.commodity !== defaultCommodity) params.set("commodity", profile.commodity);
  params.set("feed", profile.feed);
  if (profile.variety) params.set("variety", profile.variety);
  return `?${params}`;
}

export function loadStore(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): WorkspaceStore {
  try { return parseStore(storage?.getItem(WORKSPACE_STORAGE_KEY) ?? null); } catch { return EMPTY_STORE; }
}

export function saveStore(store: WorkspaceStore, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): boolean {
  try { storage?.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(store)); return Boolean(storage); } catch { return false; }
}
