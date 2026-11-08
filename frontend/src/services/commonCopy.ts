import type { DatePreset } from "./insights";
import { defineCopy } from "./language";

/**
 * Words used on many pages, translated once so a term reads the same everywhere. Page-specific sentences live beside
 * their page. Glossary: ದರ price · ಮಾದರಿ ದರ modal price · ಸರಾಸರಿ average · ಕನಿಷ್ಠ/ಗರಿಷ್ಠ min/max · ಮಧ್ಯಮ median ·
 * ಶಾಖೆ branch · ಮಾರುಕಟ್ಟೆ market · ತಳಿ variety · ದರ್ಜೆ grade · ವರದಿ ದಿನಾಂಕ reporting date · ಮೂಲ source · ಆವಕ arrivals ·
 * ಮುನ್ಸೂಚನೆ forecast · ಮಾನದಂಡ ದರ benchmark · ವ್ಯಾಪ್ತಿ coverage · ಪರಿಶೀಲನೆ review.
 */
export const COMMON = defineCopy({
  en: {
    source: "Source", sources: "Sources", variety: "Variety", exactVariety: "Exact variety", grade: "Grade", market: "Market",
    district: "District", branch: "Branch", location: "Location", state: "State", date: "Date", month: "Month", year: "Year",
    reportingDate: "Reporting date", reportingMonth: "Reporting month", minimum: "Minimum", maximum: "Maximum", average: "Average",
    modal: "Modal price", median: "Median", reportedAverage: "Reported average", arrivals: "Arrivals", unit: "Unit", status: "Status",
    quality: "Quality", value: "Value", note: "Note", period: "Period", count: "Count", total: "Total",
    perQuintal: "₹/quintal", inrQuintal: "INR/quintal", unitAssumed: "unit assumed", unitConfirmed: "unit confirmed",
    retry: "Retry", reset: "Reset", resetFilters: "Reset filters", clearFilters: "Clear all filters", search: "Search", moreFilters: "More filters", active: "active",
    from: "From", to: "To", reportingPeriod: "Reporting period", all: "All", allBranches: "All branches", allMarkets: "All markets",
    allDistricts: "All districts", allGrades: "All grades", allVarieties: "All varieties",
    exportCsv: "Export CSV", exportMatchingCsv: "Export matching CSV", exportPage: "Export page", previous: "Previous", next: "Next",
    page: (current: number, total: number) => `Page ${current} of ${total}`,
    notReported: "Not reported", unavailable: "Unavailable", never: "Never", unknown: "Unknown", none: "None", yes: "Yes", no: "No",
    loading: "Loading", save: "Save", delete: "Delete", cancel: "Cancel", apply: "Apply", refresh: "Refresh", open: "Open",
    approve: "Approve", reject: "Reject", invalidRange: "From date must not be after To date.",
    sourceRequest: "Source request", rows: (count: number) => `${count.toLocaleString("en-IN")} row${count === 1 ? "" : "s"}`,
    branches: (count: number) => `${count} branch${count === 1 ? "" : "es"}`, markets: (count: number) => `${count} market${count === 1 ? "" : "s"}`,
    observations: (count: number) => `${count.toLocaleString("en-IN")} observation${count === 1 ? "" : "s"}`,
    days: (count: number) => `${count} day${count === 1 ? "" : "s"}`, months: (count: number) => `${count} month${count === 1 ? "" : "s"}`,
    sortHint: "Sort", experimental: "Experimental", notAdvice: "Not trading advice",
    fetchStatus: { succeeded: "succeeded", failed: "failed", running: "running", partial: "partly succeeded", skipped: "skipped" } as Record<string, string>,
    datePresets: { all: "All reporting dates", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "365d": "Last 12 months", ytd: "Year to date", custom: "Custom range" } as Record<DatePreset, string>,
  },
  kn: {
    source: "ಮೂಲ", sources: "ಮೂಲಗಳು", variety: "ತಳಿ", exactVariety: "ನಿಖರ ತಳಿ", grade: "ದರ್ಜೆ", market: "ಮಾರುಕಟ್ಟೆ",
    district: "ಜಿಲ್ಲೆ", branch: "ಶಾಖೆ", location: "ಸ್ಥಳ", state: "ರಾಜ್ಯ", date: "ದಿನಾಂಕ", month: "ತಿಂಗಳು", year: "ವರ್ಷ",
    reportingDate: "ವರದಿ ದಿನಾಂಕ", reportingMonth: "ವರದಿ ತಿಂಗಳು", minimum: "ಕನಿಷ್ಠ", maximum: "ಗರಿಷ್ಠ", average: "ಸರಾಸರಿ",
    modal: "ಮಾದರಿ ದರ", median: "ಮಧ್ಯಮ", reportedAverage: "ವರದಿಯಾದ ಸರಾಸರಿ", arrivals: "ಆವಕ", unit: "ಘಟಕ", status: "ಸ್ಥಿತಿ",
    quality: "ಗುಣಮಟ್ಟ", value: "ಮೌಲ್ಯ", note: "ಟಿಪ್ಪಣಿ", period: "ಅವಧಿ", count: "ಸಂಖ್ಯೆ", total: "ಒಟ್ಟು",
    perQuintal: "₹/ಕ್ವಿಂಟಾಲ್", inrQuintal: "₹/ಕ್ವಿಂಟಾಲ್", unitAssumed: "ಘಟಕ ಊಹಿಸಲಾಗಿದೆ", unitConfirmed: "ಘಟಕ ದೃಢಪಟ್ಟಿದೆ",
    retry: "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ", reset: "ಮರುಹೊಂದಿಸಿ", resetFilters: "ಫಿಲ್ಟರ್ ತೆರವುಗೊಳಿಸಿ", clearFilters: "ಎಲ್ಲಾ ಫಿಲ್ಟರ್ ತೆರವುಗೊಳಿಸಿ", search: "ಹುಡುಕಿ", moreFilters: "ಇನ್ನಷ್ಟು ಫಿಲ್ಟರ್", active: "ಸಕ್ರಿಯ",
    from: "ಇಂದ", to: "ವರೆಗೆ", reportingPeriod: "ವರದಿ ಅವಧಿ", all: "ಎಲ್ಲಾ", allBranches: "ಎಲ್ಲಾ ಶಾಖೆಗಳು", allMarkets: "ಎಲ್ಲಾ ಮಾರುಕಟ್ಟೆಗಳು",
    allDistricts: "ಎಲ್ಲಾ ಜಿಲ್ಲೆಗಳು", allGrades: "ಎಲ್ಲಾ ದರ್ಜೆಗಳು", allVarieties: "ಎಲ್ಲಾ ತಳಿಗಳು",
    exportCsv: "CSV ಡೌನ್‌ಲೋಡ್", exportMatchingCsv: "ಹೊಂದುವ ದಾಖಲೆಗಳ CSV ಡೌನ್‌ಲೋಡ್", exportPage: "ಈ ಪುಟ ಡೌನ್‌ಲೋಡ್", previous: "ಹಿಂದಿನದು", next: "ಮುಂದಿನದು",
    page: (current: number, total: number) => `${total} ರಲ್ಲಿ ${current}ನೇ ಪುಟ`,
    notReported: "ವರದಿಯಾಗಿಲ್ಲ", unavailable: "ಲಭ್ಯವಿಲ್ಲ", never: "ಎಂದೂ ಇಲ್ಲ", unknown: "ಗೊತ್ತಿಲ್ಲ", none: "ಯಾವುದೂ ಇಲ್ಲ", yes: "ಹೌದು", no: "ಇಲ್ಲ",
    loading: "ತರಲಾಗುತ್ತಿದೆ", save: "ಉಳಿಸಿ", delete: "ಅಳಿಸಿ", cancel: "ರದ್ದುಮಾಡಿ", apply: "ಅನ್ವಯಿಸಿ", refresh: "ನವೀಕರಿಸಿ", open: "ತೆರೆಯಿರಿ",
    approve: "ಅನುಮೋದಿಸಿ", reject: "ತಿರಸ್ಕರಿಸಿ", invalidRange: "'ಇಂದ' ದಿನಾಂಕ 'ವರೆಗೆ' ದಿನಾಂಕದ ನಂತರ ಇರಬಾರದು.",
    sourceRequest: "ಮೂಲ ವಿನಂತಿ", rows: (count: number) => `${count.toLocaleString("en-IN")} ಸಾಲುಗಳು`,
    branches: (count: number) => `${count} ಶಾಖೆಗಳು`, markets: (count: number) => `${count} ಮಾರುಕಟ್ಟೆಗಳು`,
    observations: (count: number) => `${count.toLocaleString("en-IN")} ದಾಖಲೆಗಳು`,
    days: (count: number) => `${count} ದಿನ`, months: (count: number) => `${count} ತಿಂಗಳು`,
    sortHint: "ವಿಂಗಡಿಸಿ", experimental: "ಪ್ರಾಯೋಗಿಕ", notAdvice: "ವ್ಯಾಪಾರ ಸಲಹೆ ಅಲ್ಲ",
    fetchStatus: { succeeded: "ಯಶಸ್ವಿ", failed: "ವಿಫಲ", running: "ನಡೆಯುತ್ತಿದೆ", partial: "ಭಾಗಶಃ ಯಶಸ್ವಿ", skipped: "ಬಿಡಲಾಗಿದೆ" },
    datePresets: { all: "ಎಲ್ಲಾ ವರದಿ ದಿನಾಂಕಗಳು", "7d": "ಕಳೆದ 7 ದಿನ", "30d": "ಕಳೆದ 30 ದಿನ", "90d": "ಕಳೆದ 90 ದಿನ", "365d": "ಕಳೆದ 12 ತಿಂಗಳು", ytd: "ಈ ವರ್ಷ ಇಲ್ಲಿಯವರೆಗೆ", custom: "ನಿಮ್ಮ ಆಯ್ಕೆಯ ಅವಧಿ" },
  },
});

/** Fetch status in the reader's language; an unexpected status is shown as the source gave it. */
export const fetchStatusText = (copy: typeof COMMON.en, status: string) => copy.fetchStatus[status] ?? status;
