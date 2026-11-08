import { useEffect, useState, type FormEvent } from "react";
import { calendarTodayIST } from "../../../shared/dates";
import { defineCopy, useCopy, useFormat } from "../services/language";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, QUEUE_PAGE_SIZE } from "../services/api";
import { QueuePager } from "./QueuePager";
import { reviewFlags, unitPublishable, type CooperativeQuote, type CooperativeSource } from "../services/cooperative";
import { EmptyState, ErrorState, LoadingState } from "./State";

const COPY = defineCopy({
  en: {
    unit: { source_confirmed: "source-confirmed", assumed: "operator assumption", source_conflict: "source unit label conflicts with value magnitude; not publishable" } as Record<CooperativeQuote["unit_status"], string>,
    commodity: { arecanut: "Arecanut", black_pepper: "Black pepper" } as Record<string, string>,
    missingVariety: "Missing variety", notReported: " (variety not reported by source)",
    dateLine: (date: string, unit: string, label: string, status: string) => `Market reporting date ${date} · ${unit}${label} — ${status} · Reported average, not an APMC modal price`,
    sourceLabel: (label: string) => ` (source label "${label}")`, missing: "Missing",
    prices: (min: string, avg: string, max: string) => `Minimum ${min} · Average ${avg} · Maximum ${max}`,
    normal: (normal: string) => `Normal rate ${normal} (separate from reported average)`,
    lots: (lots: number, bags: string, weight: string) => ` · Tender lots ${lots} · Bags ${bags} · Reported weight ${weight} (unit unconfirmed)`,
    flags: (flags: string) => `Review flags: ${flags}`, evidence: "Original source evidence", source: "Source",
    fetched: (time: string, published: string) => ` · Platform fetched ${time} · Source publication timestamp ${published}`, notSupplied: "not supplied",
    record: (id: string) => ` · Source record ${id}`, mode: (mode: string) => ` · Ingest mode ${mode}`,
    archiveNote: "Approval archives the record as accepted; it is not published while the unit is unconfirmed.",
    verify: "Verify average", accept: "Accept (unit unconfirmed)", reject: "Reject",
    mamcosDone: (received: number, inserted: number, invalid: number) => `MAMCOS: fetched ${received} rows; ${inserted} new or reactivated; ${invalid} invalid rows withheld.`,
    tssDone: (received: number, inserted: number, invalid: number, excluded: number) => `TSS: ${received} source rows; ${inserted} new or reactivated; ${invalid} invalid; ${excluded} non-arecanut items excluded. Approve rows below to publish them.`,
    backfillDone: (succeeded: number, dates: number, failures: string) => `TSS backfill: ${succeeded} of ${dates} dates fetched.${failures}`, failed: "failed",
    tumcosDone: (received: number, inScope: number, areca: number, pepper: number, inserted: number, invalid: number, conflicts: number, latest: string, updated: string, stale: boolean, matched: number, rows: number) =>
      `TUMCOS: ${received} source records; ${inScope} in scope (arecanut ${areca}, black pepper ${pepper}); ${inserted} new; ${invalid} invalid; ${conflicts} with unit conflict. Latest record date ${latest}; page "Last Updated" ${updated}${stale ? " (stale page metadata)" : ""}. Table cross-check ${matched}/${rows}.`,
    none: "none", absent: "absent",
    csvDone: (dryRun: boolean, received: number, pending: number, invalid: number, inserted: number, duplicates: number, rejected: string) =>
      `${dryRun ? "Dry run (nothing stored)" : "CSV import"}: ${received} rows; ${pending} pending review; ${invalid} invalid${dryRun ? "" : `; ${inserted} stored; ${duplicates} already present`}.${rejected}`,
    replayDone: (source: string, of: string, parsed: number, inserted: number, duplicates: number, invalid: number) => `Replayed ${source} snapshot ${of}: ${parsed} parsed; ${inserted} new; ${duplicates} unchanged; ${invalid} invalid.`,
    published: "Verified and published.", recorded: "Review recorded.",
    title: "Cooperative source review", intro: "MAMCOS, TSS and TUMCOS averages are separate from official modal prices and from each other. Invalid records cannot be approved. Approved records are published in INR/quintal.",
    token: "Cooperative reviewer token", unlock: "Unlock cooperative review", fetchingMamcos: "Fetching MAMCOS...", fetchMamcos: "Fetch latest MAMCOS snapshot", lock: "Lock cooperative review",
    tssDate: "TSS reporting date (IST)", lotsOption: "Add tender lot/bag/weight totals (personal data is discarded)", fetchingTss: "Fetching TSS...", fetchTss: "Fetch TSS reporting date",
    backfillStart: "TSS backfill start", backfillEnd: "TSS backfill end (max 5 days)", backfilling: "Backfilling TSS...", backfill: "Backfill TSS dates",
    tumcosScope: "TUMCOS scope", recent: "Recent records (latest 45 days)", full: "Full published history (backfill)", fetchingTumcos: "Fetching TUMCOS...", fetchTumcos: "Fetch TUMCOS arecanut and black pepper",
    csvTitle: "Authorized manual CSV import", csvSource: "Source", authorizedBy: "Authorized by", permissionReference: "Permission reference", csvFile: "CSV file (max 500 rows)", csvContent: "CSV content",
    attest: "I attest these rows are copied unaltered from the source under the recorded permission", dryRun: "Dry run (validate only)",
    importing: "Importing...", validate: "Validate CSV", import: "Import CSV for review",
    csvNote: "Imported rows enter the review queue. A unit is source-confirmed only when the declared unit is INR/quintal with recorded evidence. TSS and TUMCOS rows otherwise use the operator assumption of INR/quintal.",
    replayTitle: "Replay a stored raw snapshot", fetchId: "Stored fetch ID", replaying: "Replaying...", replay: "Re-parse stored snapshot",
    replayNote: "Replay re-parses the immutable archived source snapshot with the current parser. It never re-fetches the source.",
    queueSource: "Review queue source", allSources: "All cooperative sources", loadingQueue: "Loading cooperative review queue", queueClear: "Cooperative review queue is clear", records: "cooperative records",
    archivedNote: "Every fetch archives the raw source snapshot. Missing source history is not fabricated. Scheduled collection runs only after the source's permission is recorded as granted.",
    unitNote: "TSS publishes no unit, and TUMCOS labels values \"kg\" although their size is only plausible per quintal. Both are treated as INR/quintal by operator decision and published after review; the source's own label stays on each record. TUMCOS values under ₹1,000 stay unconfirmed because they could genuinely be per kg.",
  },
  kn: {
    unit: { source_confirmed: "ಮೂಲದಿಂದ ದೃಢಪಟ್ಟಿದೆ", assumed: "ನಿರ್ವಾಹಕರ ಊಹೆ", source_conflict: "ಮೂಲದ ಘಟಕ ಹೆಸರು ಮೌಲ್ಯದ ಗಾತ್ರಕ್ಕೆ ಹೊಂದುತ್ತಿಲ್ಲ; ಪ್ರಕಟಿಸಲಾಗದು" },
    commodity: { arecanut: "ಅಡಿಕೆ", black_pepper: "ಕರಿಮೆಣಸು" },
    missingVariety: "ತಳಿ ಇಲ್ಲ", notReported: " (ಮೂಲ ತಳಿ ತಿಳಿಸಿಲ್ಲ)",
    dateLine: (date: string, unit: string, label: string, status: string) => `ಮಾರುಕಟ್ಟೆ ವರದಿ ದಿನಾಂಕ ${date} · ${unit}${label} — ${status} · ವರದಿಯಾದ ಸರಾಸರಿ, ಎಪಿಎಂಸಿ ಮಾದರಿ ದರವಲ್ಲ`,
    sourceLabel: (label: string) => ` (ಮೂಲದ ಹೆಸರು "${label}")`, missing: "ಇಲ್ಲ",
    prices: (min: string, avg: string, max: string) => `ಕನಿಷ್ಠ ${min} · ಸರಾಸರಿ ${avg} · ಗರಿಷ್ಠ ${max}`,
    normal: (normal: string) => `ಸಾಮಾನ್ಯ ದರ ${normal} (ವರದಿಯಾದ ಸರಾಸರಿಯಿಂದ ಪ್ರತ್ಯೇಕ)`,
    lots: (lots: number, bags: string, weight: string) => ` · ಟೆಂಡರ್ ಲಾಟ್‌ಗಳು ${lots} · ಚೀಲಗಳು ${bags} · ವರದಿಯಾದ ತೂಕ ${weight} (ಘಟಕ ದೃಢಪಟ್ಟಿಲ್ಲ)`,
    flags: (flags: string) => `ಪರಿಶೀಲನಾ ಗುರುತುಗಳು: ${flags}`, evidence: "ಮೂಲದ ಆಧಾರ", source: "ಮೂಲ",
    fetched: (time: string, published: string) => ` · ತಂದ ಸಮಯ ${time} · ಮೂಲದ ಪ್ರಕಟಣೆ ಸಮಯ ${published}`, notSupplied: "ನೀಡಿಲ್ಲ",
    record: (id: string) => ` · ಮೂಲ ದಾಖಲೆ ${id}`, mode: (mode: string) => ` · ಸಂಗ್ರಹ ವಿಧಾನ ${mode}`,
    archiveNote: "ಅನುಮೋದನೆಯು ದಾಖಲೆಯನ್ನು ಸ್ವೀಕೃತ ಎಂದು ಉಳಿಸುತ್ತದೆ; ಘಟಕ ದೃಢಪಡುವವರೆಗೆ ಪ್ರಕಟವಾಗುವುದಿಲ್ಲ.",
    verify: "ಸರಾಸರಿ ದೃಢೀಕರಿಸಿ", accept: "ಸ್ವೀಕರಿಸಿ (ಘಟಕ ದೃಢಪಟ್ಟಿಲ್ಲ)", reject: "ತಿರಸ್ಕರಿಸಿ",
    mamcosDone: (received: number, inserted: number, invalid: number) => `MAMCOS: ${received} ಸಾಲುಗಳನ್ನು ತರಲಾಗಿದೆ; ${inserted} ಹೊಸ ಅಥವಾ ಮರುಸಕ್ರಿಯ; ${invalid} ಅಮಾನ್ಯ ಸಾಲುಗಳನ್ನು ತಡೆಹಿಡಿಯಲಾಗಿದೆ.`,
    tssDone: (received: number, inserted: number, invalid: number, excluded: number) => `TSS: ${received} ಮೂಲ ಸಾಲುಗಳು; ${inserted} ಹೊಸ ಅಥವಾ ಮರುಸಕ್ರಿಯ; ${invalid} ಅಮಾನ್ಯ; ${excluded} ಅಡಿಕೆಯಲ್ಲದ ವಸ್ತುಗಳನ್ನು ಬಿಡಲಾಗಿದೆ. ಪ್ರಕಟಿಸಲು ಕೆಳಗಿನ ಸಾಲುಗಳನ್ನು ಅನುಮೋದಿಸಿ.`,
    backfillDone: (succeeded: number, dates: number, failures: string) => `TSS ಹಿಂದಿನ ಸಂಗ್ರಹ: ${dates} ರಲ್ಲಿ ${succeeded} ದಿನಾಂಕಗಳನ್ನು ತರಲಾಗಿದೆ.${failures}`, failed: "ವಿಫಲ",
    tumcosDone: (received: number, inScope: number, areca: number, pepper: number, inserted: number, invalid: number, conflicts: number, latest: string, updated: string, stale: boolean, matched: number, rows: number) =>
      `TUMCOS: ${received} ಮೂಲ ದಾಖಲೆಗಳು; ${inScope} ವ್ಯಾಪ್ತಿಯಲ್ಲಿ (ಅಡಿಕೆ ${areca}, ಕರಿಮೆಣಸು ${pepper}); ${inserted} ಹೊಸದು; ${invalid} ಅಮಾನ್ಯ; ${conflicts} ಘಟಕ ಸಂಘರ್ಷ. ಇತ್ತೀಚಿನ ದಾಖಲೆ ದಿನಾಂಕ ${latest}; ಪುಟದ "Last Updated" ${updated}${stale ? " (ಹಳೆಯ ಪುಟ ಮಾಹಿತಿ)" : ""}. ಪಟ್ಟಿ ಹೋಲಿಕೆ ${matched}/${rows}.`,
    none: "ಇಲ್ಲ", absent: "ಇಲ್ಲ",
    csvDone: (dryRun: boolean, received: number, pending: number, invalid: number, inserted: number, duplicates: number, rejected: string) =>
      `${dryRun ? "ಪರೀಕ್ಷಾ ಓಟ (ಏನೂ ಉಳಿಸಿಲ್ಲ)" : "CSV ಆಮದು"}: ${received} ಸಾಲುಗಳು; ${pending} ಪರಿಶೀಲನೆಗೆ ಬಾಕಿ; ${invalid} ಅಮಾನ್ಯ${dryRun ? "" : `; ${inserted} ಉಳಿಸಲಾಗಿದೆ; ${duplicates} ಈಗಾಗಲೇ ಇದೆ`}.${rejected}`,
    replayDone: (source: string, of: string, parsed: number, inserted: number, duplicates: number, invalid: number) => `${source} ಸಂಗ್ರಹ ${of} ಮರು-ಓದಲಾಗಿದೆ: ${parsed} ಓದಲಾಗಿದೆ; ${inserted} ಹೊಸದು; ${duplicates} ಬದಲಾಗಿಲ್ಲ; ${invalid} ಅಮಾನ್ಯ.`,
    published: "ದೃಢೀಕರಿಸಿ ಪ್ರಕಟಿಸಲಾಗಿದೆ.", recorded: "ಪರಿಶೀಲನೆ ದಾಖಲಾಗಿದೆ.",
    title: "ಸಹಕಾರಿ ಮೂಲಗಳ ಪರಿಶೀಲನೆ", intro: "MAMCOS, TSS ಮತ್ತು TUMCOS ಸರಾಸರಿಗಳು ಅಧಿಕೃತ ಮಾದರಿ ದರಗಳಿಂದ ಮತ್ತು ಪರಸ್ಪರ ಪ್ರತ್ಯೇಕ. ಅಮಾನ್ಯ ದಾಖಲೆಗಳನ್ನು ಅನುಮೋದಿಸಲಾಗದು. ಅನುಮೋದಿತ ದಾಖಲೆಗಳು ₹/ಕ್ವಿಂಟಾಲ್‌ನಲ್ಲಿ ಪ್ರಕಟವಾಗುತ್ತವೆ.",
    token: "ಸಹಕಾರಿ ಪರಿಶೀಲಕರ ಟೋಕನ್", unlock: "ಸಹಕಾರಿ ಪರಿಶೀಲನೆ ತೆರೆಯಿರಿ", fetchingMamcos: "MAMCOS ತರಲಾಗುತ್ತಿದೆ...", fetchMamcos: "ಇತ್ತೀಚಿನ MAMCOS ಸಂಗ್ರಹ ತನ್ನಿ", lock: "ಸಹಕಾರಿ ಪರಿಶೀಲನೆ ಮುಚ್ಚಿ",
    tssDate: "TSS ವರದಿ ದಿನಾಂಕ (IST)", lotsOption: "ಟೆಂಡರ್ ಲಾಟ್/ಚೀಲ/ತೂಕದ ಒಟ್ಟುಗಳನ್ನು ಸೇರಿಸಿ (ವೈಯಕ್ತಿಕ ಮಾಹಿತಿ ಬಿಡಲಾಗುತ್ತದೆ)", fetchingTss: "TSS ತರಲಾಗುತ್ತಿದೆ...", fetchTss: "TSS ವರದಿ ದಿನಾಂಕ ತನ್ನಿ",
    backfillStart: "TSS ಹಿಂದಿನ ಸಂಗ್ರಹ ಆರಂಭ", backfillEnd: "TSS ಹಿಂದಿನ ಸಂಗ್ರಹ ಅಂತ್ಯ (ಗರಿಷ್ಠ 5 ದಿನ)", backfilling: "TSS ಹಿಂದಿನ ದತ್ತಾಂಶ ತರಲಾಗುತ್ತಿದೆ...", backfill: "TSS ದಿನಾಂಕಗಳನ್ನು ತನ್ನಿ",
    tumcosScope: "TUMCOS ವ್ಯಾಪ್ತಿ", recent: "ಇತ್ತೀಚಿನ ದಾಖಲೆಗಳು (ಕಳೆದ 45 ದಿನ)", full: "ಸಂಪೂರ್ಣ ಪ್ರಕಟಿತ ಇತಿಹಾಸ", fetchingTumcos: "TUMCOS ತರಲಾಗುತ್ತಿದೆ...", fetchTumcos: "TUMCOS ಅಡಿಕೆ ಮತ್ತು ಕರಿಮೆಣಸು ತನ್ನಿ",
    csvTitle: "ಅಧಿಕೃತ CSV ಆಮದು", csvSource: "ಮೂಲ", authorizedBy: "ಅನುಮತಿ ನೀಡಿದವರು", permissionReference: "ಅನುಮತಿ ಉಲ್ಲೇಖ", csvFile: "CSV ಕಡತ (ಗರಿಷ್ಠ 500 ಸಾಲು)", csvContent: "CSV ವಿಷಯ",
    attest: "ಈ ಸಾಲುಗಳನ್ನು ದಾಖಲಾದ ಅನುಮತಿಯಡಿ ಮೂಲದಿಂದ ಬದಲಿಸದೆ ನಕಲಿಸಲಾಗಿದೆ ಎಂದು ದೃಢೀಕರಿಸುತ್ತೇನೆ", dryRun: "ಪರೀಕ್ಷಾ ಓಟ (ಪರಿಶೀಲನೆ ಮಾತ್ರ)",
    importing: "ಆಮದು ಮಾಡಲಾಗುತ್ತಿದೆ...", validate: "CSV ಪರಿಶೀಲಿಸಿ", import: "ಪರಿಶೀಲನೆಗೆ CSV ಆಮದು ಮಾಡಿ",
    csvNote: "ಆಮದು ಮಾಡಿದ ಸಾಲುಗಳು ಪರಿಶೀಲನಾ ಸರದಿಗೆ ಹೋಗುತ್ತವೆ. ಘೋಷಿತ ಘಟಕ ₹/ಕ್ವಿಂಟಾಲ್ ಆಗಿದ್ದು ಆಧಾರ ದಾಖಲಾಗಿದ್ದರೆ ಮಾತ್ರ ಘಟಕ ದೃಢಪಟ್ಟಿದೆ. ಇಲ್ಲದಿದ್ದರೆ TSS ಮತ್ತು TUMCOS ಸಾಲುಗಳಿಗೆ ₹/ಕ್ವಿಂಟಾಲ್ ನಿರ್ವಾಹಕರ ಊಹೆ.",
    replayTitle: "ಸಂಗ್ರಹಿತ ಮೂಲ ದಾಖಲೆಯನ್ನು ಮತ್ತೆ ಓದಿ", fetchId: "ಸಂಗ್ರಹದ ಗುರುತು", replaying: "ಮತ್ತೆ ಓದಲಾಗುತ್ತಿದೆ...", replay: "ಸಂಗ್ರಹಿತ ದಾಖಲೆಯನ್ನು ಮತ್ತೆ ಓದಿ",
    replayNote: "ಬದಲಾಗದ ಸಂಗ್ರಹಿತ ಮೂಲ ದಾಖಲೆಯನ್ನು ಈಗಿನ ವಿಧಾನದಿಂದ ಮತ್ತೆ ಓದುತ್ತದೆ. ಮೂಲದಿಂದ ಮತ್ತೆ ತರುವುದಿಲ್ಲ.",
    queueSource: "ಪರಿಶೀಲನಾ ಸರದಿಯ ಮೂಲ", allSources: "ಎಲ್ಲಾ ಸಹಕಾರಿ ಮೂಲಗಳು", loadingQueue: "ಸಹಕಾರಿ ಪರಿಶೀಲನಾ ಸರದಿ ತರಲಾಗುತ್ತಿದೆ", queueClear: "ಸಹಕಾರಿ ಪರಿಶೀಲನಾ ಸರದಿ ಖಾಲಿ", records: "ಸಹಕಾರಿ ದಾಖಲೆಗಳು",
    archivedNote: "ಪ್ರತಿ ಸಂಗ್ರಹವೂ ಮೂಲ ದಾಖಲೆಯನ್ನು ಹಾಗೆಯೇ ಉಳಿಸುತ್ತದೆ. ಇಲ್ಲದ ಇತಿಹಾಸವನ್ನು ಕಲ್ಪಿಸುವುದಿಲ್ಲ. ಮೂಲದ ಅನುಮತಿ ದಾಖಲಾದ ನಂತರವೇ ನಿಯಮಿತ ಸಂಗ್ರಹ ನಡೆಯುತ್ತದೆ.",
    unitNote: "TSS ಘಟಕ ತಿಳಿಸುವುದಿಲ್ಲ; TUMCOS \"kg\" ಎನ್ನುತ್ತದೆ, ಆದರೆ ಮೌಲ್ಯಗಳ ಗಾತ್ರ ಪ್ರತಿ ಕ್ವಿಂಟಾಲ್‌ಗೆ ಮಾತ್ರ ಹೊಂದುತ್ತದೆ. ಎರಡನ್ನೂ ನಿರ್ವಾಹಕರ ನಿರ್ಧಾರದಂತೆ ₹/ಕ್ವಿಂಟಾಲ್ ಎಂದು ಪರಿಗಣಿಸಿ ಪರಿಶೀಲನೆಯ ನಂತರ ಪ್ರಕಟಿಸಲಾಗುತ್ತದೆ; ಮೂಲದ ಹೆಸರು ಪ್ರತಿ ದಾಖಲೆಯಲ್ಲೂ ಉಳಿಯುತ್ತದೆ. ₹1,000 ಕ್ಕಿಂತ ಕಡಿಮೆ TUMCOS ಮೌಲ್ಯಗಳು ನಿಜವಾಗಿ ಪ್ರತಿ ಕೆಜಿ ಆಗಿರಬಹುದಾದ್ದರಿಂದ ದೃಢಪಡಿಸುವುದಿಲ್ಲ.",
  },
});

function QueueRow({ row, busy, onReview }: { row: CooperativeQuote; busy: boolean; onReview: (action: "approve" | "reject") => void }) {
  const t = useCopy(COPY);
  const format = useFormat();
  const flags = reviewFlags(row.review_flags);
  const publishable = unitPublishable(row);
  const value = (price: number | null | undefined) => price == null ? t.missing : String(price);
  return <article className="review-row"><div className="review-details">
    <strong>{row.source_key.toUpperCase()} · {t.commodity[row.commodity ?? "arecanut"] ?? row.commodity} · {row.branch} · <span lang="en">{row.variety || t.missingVariety}</span>{row.variety_reported === 0 ? t.notReported : ""}</strong>
    <p>{t.dateLine(format.date(row.reporting_date), row.price_unit, row.source_unit_label ? t.sourceLabel(row.source_unit_label) : "", t.unit[row.unit_status])}</p>
    <p>{t.prices(value(row.minimum_price), value(row.average_price), value(row.maximum_price))}</p>
    {row.source_key === "tss" && <p>{t.normal(value(row.normal_price))}{row.lot_count != null ? t.lots(row.lot_count, value(row.bag_count), value(row.reported_weight)) : ""}</p>}
    {flags.length > 0 && <p role="note">{t.flags(flags.map((flag) => flag.replace(/_/g, " ")).join(", "))}</p>}
    {row.validation_message && <p role="note" lang="en">{row.validation_message}</p>}
    <details className="review-evidence"><summary>{t.evidence}</summary><p><a href={row.source_url} target="_blank" rel="noreferrer">{t.source}</a>{t.fetched(format.timestamp(row.fetched_at), row.source_published_at ?? t.notSupplied)}{row.source_record_id ? t.record(row.source_record_id) : ""}{row.ingest_mode ? t.mode(row.ingest_mode) : ""}</p><pre>{row.raw_record}</pre></details>
  </div><div className="review-actions"><button className="approve-button" disabled={busy || row.status !== "pending"} title={publishable ? undefined : t.archiveNote} onClick={() => onReview("approve")}>{publishable ? t.verify : t.accept}</button>
    <button className="reject-button" disabled={busy} onClick={() => onReview("reject")}>{t.reject}</button></div></article>;
}

export function CooperativeReview() {
  const t = useCopy(COPY);
  const today = calendarTodayIST();
  const [token, setToken] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [queueSource, setQueueSource] = useState<CooperativeSource | "">("");
  const [tssDate, setTssDate] = useState(today);
  const [includeLots, setIncludeLots] = useState(false);
  const [backfillStart, setBackfillStart] = useState(today);
  const [backfillEnd, setBackfillEnd] = useState(today);
  const [tumcosScope, setTumcosScope] = useState<"recent" | "full_history">("recent");
  const [csvSource, setCsvSource] = useState<CooperativeSource>("mamcos");
  const [csvText, setCsvText] = useState("");
  const [authorizedBy, setAuthorizedBy] = useState("");
  const [permissionReference, setPermissionReference] = useState("");
  const [attested, setAttested] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [replayId, setReplayId] = useState("");
  const client = useQueryClient();
  const [queueOffset, setQueueOffset] = useState(0);
  const queue = useQuery({ queryKey: ["cooperative-quality", token, queueSource, queueOffset], queryFn: () => api.cooperativeQuality(token, queueSource || undefined, queueOffset), enabled: unlocked });
  const queueTotal = queue.data?.total;
  const queueEmptyPage = Boolean(queue.data && !queue.data.data.length);
  // Reviewing shrinks the queue; step back when the current page empties.
  useEffect(() => { if (queueEmptyPage && queueOffset > 0 && queueTotal) setQueueOffset(Math.max(0, queueOffset - QUEUE_PAGE_SIZE)); }, [queueEmptyPage, queueOffset, queueTotal]);
  async function invalidate() {
    for (const key of ["cooperative", "cooperative-quality", "cooperative-sources", "decision-prices", "aggregates"]) await client.invalidateQueries({ queryKey: [key] });
  }
  const done = (message: string) => async () => { setFeedback(message); await invalidate(); };
  const refresh = useMutation({ mutationFn: () => api.refreshMamcos(token), onError: invalidate,
    onSuccess: async (r) => done(t.mamcosDone(r.received_count, r.inserted_count, r.invalid_count))() });
  const tssRefresh = useMutation({ mutationFn: () => api.refreshTss(token, tssDate, includeLots), onError: invalidate,
    onSuccess: async (r) => done(t.tssDone(r.received_count, r.inserted_count, r.invalid_count, r.excluded_count))() });
  const tssBackfill = useMutation({ mutationFn: () => api.backfillTss(token, backfillStart, backfillEnd), onError: invalidate,
    onSuccess: async (r) => done(t.backfillDone(r.succeeded, r.dates, r.results.filter((x) => x.status === "failed").map((x) => ` ${x.date}: ${typeof x.detail === "string" ? x.detail : t.failed}.`).join("")))() });
  const tumcos = useMutation({ mutationFn: () => api.refreshTumcos(token, tumcosScope), onError: invalidate,
    onSuccess: async (r) => done(t.tumcosDone(r.received_count, r.in_scope_count, r.commodities.arecanut, r.commodities.black_pepper, r.inserted_count, r.invalid_count, r.unit_conflict_count, r.latest_record_date ?? t.none, r.page_last_updated ?? t.absent, Boolean(r.stale_page_metadata), r.table_check.matched, r.table_check.rows))() });
  const csvImport = useMutation({
    mutationFn: () => api.importCooperativeCsv(token, { source: csvSource, csv: csvText, authorized_by: authorizedBy, permission_reference: permissionReference, attestation: true, dry_run: dryRun }),
    onError: invalidate,
    onSuccess: async (r) => done(t.csvDone(Boolean(r.dry_run), r.received_count, r.pending_count, r.invalid_count, r.inserted_count, r.duplicate_count, r.rejected.slice(0, 5).map((x) => ` ${x.branch} ${x.reporting_date} ${x.variety}: ${x.reason}.`).join("")))(),
  });
  const replay = useMutation({ mutationFn: () => api.replayCooperativeSnapshot(token, replayId.trim()), onError: invalidate,
    onSuccess: async (r) => done(t.replayDone(r.source.toUpperCase(), r.replay_of, r.parsed_count, r.inserted_count, r.duplicate_count, r.invalid_count))() });
  const review = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) => api.cooperativeReview(id, token, action),
    onError: invalidate,
    onSuccess: async (r) => done(r.note ?? (r.published ? t.published : t.recorded))(),
  });
  const mutations = [refresh, tssRefresh, tssBackfill, tumcos, csvImport, replay, review];
  const busy = mutations.some((m) => m.isPending);
  function lock() {
    client.removeQueries({ queryKey: ["cooperative-quality"] });
    setToken(""); setUnlocked(false); setFeedback(""); setAttested(false); setCsvText("");
    mutations.forEach((m) => m.reset());
  }
  const submit = (action: () => void) => (event: FormEvent) => { event.preventDefault(); setFeedback(""); action(); };
  async function loadCsvFile(file: File | undefined) { if (file) setCsvText(await file.text()); }
  return <section className="panel"><div className="panel-heading"><div><h2>{t.title}</h2><p>{t.intro}</p></div></div>
    <div className="monthly-details">
      {!unlocked ? <form className="monthly-refresh" onSubmit={(event) => { event.preventDefault(); setUnlocked(true); }}>
        <label className="filter-control"><span>{t.token}</span><input type="password" autoComplete="off" required value={token} onChange={(event) => setToken(event.target.value)} /></label>
        <button className="button-secondary" disabled={!token}>{t.unlock}</button>
      </form> : <>
        <div className="monthly-refresh"><button className="button-secondary" disabled={busy} onClick={() => { setFeedback(""); refresh.mutate(); }}>{refresh.isPending ? t.fetchingMamcos : t.fetchMamcos}</button>
          <button className="button-secondary" disabled={busy} onClick={lock}>{t.lock}</button></div>
        <form className="monthly-refresh" onSubmit={submit(() => tssRefresh.mutate())}>
          <label className="filter-control"><span>{t.tssDate}</span><input type="date" required max={today} value={tssDate} onChange={(event) => setTssDate(event.target.value)} disabled={busy} /></label>
          <label><input type="checkbox" checked={includeLots} onChange={(event) => setIncludeLots(event.target.checked)} disabled={busy} /> {t.lotsOption}</label>
          <button className="button-secondary" disabled={busy || !tssDate}>{tssRefresh.isPending ? t.fetchingTss : t.fetchTss}</button>
        </form>
        <form className="monthly-refresh" onSubmit={submit(() => tssBackfill.mutate())}>
          <label className="filter-control"><span>{t.backfillStart}</span><input type="date" required max={today} value={backfillStart} onChange={(event) => setBackfillStart(event.target.value)} disabled={busy} /></label>
          <label className="filter-control"><span>{t.backfillEnd}</span><input type="date" required max={today} value={backfillEnd} onChange={(event) => setBackfillEnd(event.target.value)} disabled={busy} /></label>
          <button className="button-secondary" disabled={busy || backfillStart > backfillEnd}>{tssBackfill.isPending ? t.backfilling : t.backfill}</button>
        </form>
        <form className="monthly-refresh" onSubmit={submit(() => tumcos.mutate())}>
          <label className="filter-control"><span>{t.tumcosScope}</span><select value={tumcosScope} onChange={(event) => setTumcosScope(event.target.value === "full_history" ? "full_history" : "recent")} disabled={busy}>
            <option value="recent">{t.recent}</option><option value="full_history">{t.full}</option></select></label>
          <button className="button-secondary" disabled={busy}>{tumcos.isPending ? t.fetchingTumcos : t.fetchTumcos}</button>
        </form>
        <details className="review-evidence"><summary>{t.csvTitle}</summary>
          <form className="monthly-refresh" onSubmit={submit(() => csvImport.mutate())}>
            <label className="filter-control"><span>{t.csvSource}</span><select value={csvSource} onChange={(event) => setCsvSource(event.target.value as CooperativeSource)} disabled={busy}><option value="mamcos">MAMCOS</option><option value="tss">TSS</option><option value="tumcos">TUMCOS</option></select></label>
            <label className="filter-control"><span>{t.authorizedBy}</span><input required minLength={2} maxLength={200} value={authorizedBy} onChange={(event) => setAuthorizedBy(event.target.value)} disabled={busy} /></label>
            <label className="filter-control"><span>{t.permissionReference}</span><input required minLength={3} maxLength={500} value={permissionReference} onChange={(event) => setPermissionReference(event.target.value)} disabled={busy} /></label>
            <label className="filter-control"><span>{t.csvFile}</span><input type="file" accept=".csv,text/csv" onChange={(event) => void loadCsvFile(event.target.files?.[0])} disabled={busy} /></label>
            <label className="filter-control"><span>{t.csvContent}</span><textarea rows={4} required value={csvText} onChange={(event) => setCsvText(event.target.value)} disabled={busy} placeholder="branch,reporting_date,commodity,variety,minimum_price,maximum_price,average_price,declared_unit,unit_evidence,source_reference,source_record_id,lot_count,bag_count,reported_weight" /></label>
            <label><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} disabled={busy} /> {t.attest}</label>
            <label><input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} disabled={busy} /> {t.dryRun}</label>
            <button className="button-secondary" disabled={busy || !attested || !csvText.trim()}>{csvImport.isPending ? t.importing : dryRun ? t.validate : t.import}</button>
          </form>
          <p>{t.csvNote}</p>
        </details>
        <details className="review-evidence"><summary>{t.replayTitle}</summary>
          <form className="monthly-refresh" onSubmit={submit(() => replay.mutate())}>
            <label className="filter-control"><span>{t.fetchId}</span><input required value={replayId} onChange={(event) => setReplayId(event.target.value)} disabled={busy} /></label>
            <button className="button-secondary" disabled={busy || !replayId.trim()}>{replay.isPending ? t.replaying : t.replay}</button>
          </form>
          <p>{t.replayNote}</p>
        </details>
        <label className="filter-control"><span>{t.queueSource}</span><select value={queueSource} onChange={(event) => { setQueueSource(event.target.value as CooperativeSource | ""); setQueueOffset(0); }}><option value="">{t.allSources}</option><option value="mamcos">MAMCOS</option><option value="tss">TSS</option><option value="tumcos">TUMCOS</option></select></label>
        {queue.isLoading ? <LoadingState label={t.loadingQueue} /> : queue.error ? <ErrorState error={queue.error} onRetry={() => void queue.refetch()} /> : !queue.data?.data.length ? <EmptyState title={t.queueClear} /> : queue.data.data.map((row) => <QueueRow key={row.id} row={row} busy={busy} onReview={(action) => review.mutate({ id: row.id, action })} />)}
        {queue.data && <QueuePager offset={queueOffset} limit={QUEUE_PAGE_SIZE} total={queue.data.total} busy={queue.isFetching || busy} label={t.records} onChange={setQueueOffset} />}
      </>}
      {mutations.map((m, index) => m.error ? <ErrorState key={index} error={m.error} /> : null)}
      {feedback && <p role="status">{feedback}</p>}
      <p>{t.archivedNote}</p>
      <p>{t.unitNote}</p>
    </div>
  </section>;
}
