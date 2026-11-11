/* Shared by the TSS importer (api/src/tss.ts) and the grower variety catalogue (frontend/src/services/varieties.ts). */

/**
 * Arecanut grades captured from the TSS rate table, spelled exactly as TSS publishes them. Pepper, coconut, cocoa
 * and by-products (bale, mitli, dust…) are left out: TSS rows are stored as arecanut. "NEW CHALI" is listed ahead of
 * its first appearance so it is captured when the season starts. FRESH RED ARECANUT is fresh, undried nut (≈₹6,000
 * against ≈₹44,000 for NEW RASHI on 4 Nov 2026), so it is captured as its own grade, never merged into a dried one; the
 * other fresh lots (green, sippe, kole and raw green nut, ₹1,600–₹13,000 on 10 Nov 2026) are kept apart the same way.
 */
export const TSS_VARIETIES = [
  "RASHI", "NEW RASHI", "API", "BT RASHI", "SANNA RASHI",
  "CHALI", "NEW CHALI", "11-CHALI", "DNK CHALI", "SIPPE CHALI",
  "BETTE", "GOT BETTE", "KE.BETTE",
  "B.G.", "K.G.", "KARAGOTU", "SIPPE GOTU", "LA B GOT",
  "KOKA", "LA KOKA", "CH.KEMP", "ARAGERE", "MURI", "KOLE", "CHURU",
  "FRESH RED ARECANUT", "FRESH GREEN ARECANUT", "FRESH SIPPE ARECA", "FRESH KOLE RAW", "GREEN RAW ARECA", "ARECANUT",
] as const;
