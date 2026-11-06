import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPABILITIES, FALLBACK_CATALOG, PRICE_BASES, capabilityStatus, filterObservations, findCommodity, gradeOptions, marketFeeds,
  normalizePrice, parsePriceUnit, priceBasisForSource, resolveGrade, resolveVariety, routeAvailable, routeCapability, unitLabel, varietyOptions,
  type CommodityCatalog, type UnitDef,
} from "../../shared/commodities";
import { app, type Env } from "./index";
import { loadCatalog, validateCommodityModel } from "./commodity-routes";
import { applyMigrations, LocalDatabase } from "./test-support/local-d1";

const units: UnitDef[] = [
  { code: "kg", label: "kg", dimension: "mass", base_unit: "kg", factor_to_base: 1 },
  { code: "quintal", label: "quintal", dimension: "mass", base_unit: "kg", factor_to_base: 100 },
  { code: "thousand_nuts", label: "1000 nuts", dimension: "count", base_unit: "nut", factor_to_base: 1000 },
];

describe("commodity domain helpers", () => {
  it("assigns each integrated source its own price basis and never labels cooperative averages as APMC modal", () => {
    expect(priceBasisForSource("agmarknet")).toBe("APMC_MODAL");
    expect(priceBasisForSource("agmarknet_csv")).toBe("APMC_MODAL");
    expect(priceBasisForSource("mamcos")).toBe("COOPERATIVE_AVERAGE");
    expect(priceBasisForSource("tumcos")).toBe("COOPERATIVE_AVERAGE");
    expect(priceBasisForSource("tss")).toBe("COOPERATIVE_TENDER_AVERAGE");
    expect(() => priceBasisForSource("unknown_source")).toThrow("No price basis");
    expect(PRICE_BASES).toEqual(["APMC_MODAL", "APMC_MIN_MAX", "COOPERATIVE_AVERAGE", "COOPERATIVE_TENDER_AVERAGE",
      "AUCTION_LOT_PRICE", "BUYER_QUOTATION", "FARMER_TRANSACTION"]);
  });

  it("normalizes prices only between units of the same dimension", () => {
    expect(normalizePrice(44000, "quintal", "kg", units)).toBe(440);
    expect(normalizePrice(440, "kg", "quintal", units)).toBe(44000);
    expect(normalizePrice(44000, "quintal", "quintal", units)).toBe(44000);
    expect(normalizePrice(30000, "thousand_nuts", "kg", units)).toBeNull();
    expect(normalizePrice(100, "bag", "kg", units)).toBeNull();
    expect(normalizePrice(Number.NaN, "kg", "kg", units)).toBeNull();
  });

  it("parses only known source unit labels", () => {
    const aliases = [{ source_label: "Rs./Quintal", unit_code: "quintal", currency: "INR", mapping_status: "verified" as const }];
    expect(parsePriceUnit("Rs./Quintal", aliases)).toBe("quintal");
    expect(parsePriceUnit(" Rs./Quintal ", aliases)).toBe("quintal");
    expect(parsePriceUnit("Rs./Kg", aliases)).toBeNull();
    expect(parsePriceUnit(null, aliases)).toBeNull();
  });

  it("resolves variety and grade aliases within one commodity and one source only", () => {
    const aliases = [
      { commodity_id: "commodity-arecanut", variety_id: "variety-arecanut-other", source_key: "agmarknet", source_name: "Other", mapping_status: "verified" as const },
    ];
    expect(resolveVariety(aliases, "commodity-arecanut", "agmarknet", "Other")?.variety_id).toBe("variety-arecanut-other");
    expect(resolveVariety(aliases, "commodity-black-pepper", "agmarknet", "Other")).toBeNull();
    expect(resolveVariety(aliases, "commodity-arecanut", "mamcos", "Other")).toBeNull();
    expect(resolveVariety(aliases, "commodity-arecanut", "agmarknet", "other")).toBeNull();
    const grades = [{ commodity_id: "commodity-arecanut", source_key: "agmarknet", source_label: "FAQ", grade_id: "grade-arecanut-faq", mapping_status: "verified" as const }];
    expect(resolveGrade(grades, "commodity-arecanut", "agmarknet", "FAQ")?.grade_id).toBe("grade-arecanut-faq");
    expect(resolveGrade(grades, "commodity-coffee", "agmarknet", "FAQ")).toBeNull();
    expect(resolveGrade(grades, "commodity-arecanut", "agmarknet", null)).toBeNull();
  });

  it("filters observations by commodity, variety, grade and basis without crossing commodities", () => {
    const rows = [
      { id: 1, commodity_code: "arecanut", variety_id: "variety-arecanut-rashi", variety_label: "Rashi", grade_id: "grade-arecanut-local", grade_label: "Local", price_basis: "APMC_MODAL" },
      { id: 2, commodity_code: "arecanut", variety_id: null, variety_label: "RASHI EDI", grade_id: null, grade_label: null, price_basis: "COOPERATIVE_AVERAGE" },
      { id: 3, commodity_code: "black_pepper", variety_id: null, variety_label: "Rashi", grade_id: null, grade_label: "Local", price_basis: "COOPERATIVE_AVERAGE" },
    ];
    expect(filterObservations(rows, { commodity: "arecanut" }).map((row) => row.id)).toEqual([1, 2]);
    expect(filterObservations(rows, { commodity: "arecanut", variety: "Rashi" }).map((row) => row.id)).toEqual([1]);
    expect(filterObservations(rows, { commodity: "arecanut", grade: "Local" }).map((row) => row.id)).toEqual([1]);
    expect(filterObservations(rows, { commodity: "arecanut", priceBasis: "COOPERATIVE_AVERAGE" }).map((row) => row.id)).toEqual([2]);
    expect(filterObservations(rows, { commodity: "coffee" })).toEqual([]);
  });

  it("maps routes to commodity capabilities", () => {
    expect(routeCapability("/")).toBe("market_data");
    expect(routeCapability("/compare")).toBe("market_data");
    expect(routeCapability("/history")).toBe("monthly_history");
    expect(routeCapability("/intelligence/production")).toBe("production");
    expect(routeCapability("/intelligence/quality")).toBe("quality");
    expect(routeCapability("/intelligence/unknown")).toBe("intelligence");
    expect(routeCapability("/data-quality")).toBeNull();
  });

  it("keeps a complete arecanut fallback so production pages work without the catalogue endpoint", () => {
    const arecanut = findCommodity(FALLBACK_CATALOG, "arecanut");
    expect(CAPABILITIES.every((capability) => capabilityStatus(arecanut, capability) === "available")).toBe(true);
    expect(marketFeeds(arecanut)).toEqual(["mamcos", "tss", "tumcos", "official"]);
    expect(unitLabel(FALLBACK_CATALOG, arecanut)).toBe("INR / QUINTAL");
    expect(unitLabel(FALLBACK_CATALOG, arecanut, "text")).toBe("INR / quintal");
    expect(gradeOptions(arecanut).map((grade) => grade.label)).toEqual(["Local", "Large", "Medium", "FAQ"]);
  });
});

describe("commodity master after migration", () => {
  let db: LocalDatabase;
  let env: Env["Bindings"];
  let catalog: CommodityCatalog;
  beforeEach(async () => {
    db = applyMigrations(new LocalDatabase());
    env = { DB: db as unknown as D1Database, INGESTION_TOKEN: "import", ADMIN_TOKEN: "review", MIN_INDEX_MARKETS: "3", COOPERATIVE_FETCH_ATTEMPTS: "1" };
    catalog = await loadCatalog(env.DB);
  });
  afterEach(() => { db.sqlite.close(); vi.unstubAllGlobals(); });

  it("configures seven commodities with arecanut as the only production commodity", () => {
    expect(catalog.commodities.map((commodity) => commodity.code)).toEqual(
      ["arecanut", "black_pepper", "coffee", "cardamom", "coconut_copra", "cocoa", "natural_rubber"]);
    expect(catalog.commodities.filter((commodity) => commodity.status === "production").map((commodity) => commodity.code)).toEqual(["arecanut"]);
    expect(catalog.commodities.every((commodity) => commodity.config !== null)).toBe(true);
    expect(catalog.commodities.filter((commodity) => commodity.code !== "arecanut").every((commodity) => commodity.config?.config_status === "reference_unverified")).toBe(true);
    expect(catalog.price_bases.map((basis) => basis.code)).toEqual([...PRICE_BASES]);
  });

  it("keeps commodity-specific grading systems separate", () => {
    const arecanut = findCommodity(catalog, "arecanut");
    const coffee = findCommodity(catalog, "coffee");
    const pepper = findCommodity(catalog, "black_pepper");
    expect(varietyOptions(arecanut).slice(0, 3).map((variety) => variety.label)).toEqual(["Rashi", "Chali", "Bette"]);
    expect(gradeOptions(arecanut).map((grade) => grade.label)).toEqual(["Local", "Large", "Medium", "FAQ"]);
    expect(varietyOptions(coffee).map((variety) => variety.label)).toEqual(["Arabica", "Robusta"]);
    const arabica = coffee!.varieties.find((variety) => variety.code === "arabica")!.id;
    const arabicaGrades = gradeOptions(coffee, arabica).map((grade) => grade.code);
    expect(arabicaGrades).toEqual(["arabica_plantation", "arabica_cherry", "aa", "a", "pb"]);
    expect(arabicaGrades).not.toContain("robusta_parchment");
    expect(varietyOptions(pepper)).toEqual([]);
    expect(gradeOptions(pepper).map((grade) => grade.grade_type)).toEqual(expect.arrayContaining(["commercial_grade", "physical_quality"]));
    for (const commodity of catalog.commodities) {
      expect(commodity.grades.every((grade) => !grade.variety_id || commodity.varieties.some((variety) => variety.id === grade.variety_id))).toBe(true);
    }
    expect(catalog.commodities.filter((commodity) => commodity.code !== "arecanut")
      .flatMap((commodity) => [...commodity.varieties, ...commodity.grades]).every((item) => item.mapping_status === "unverified")).toBe(true);
  });

  it("keeps coconut and copra forms in their own units and refuses cross-dimension normalization", () => {
    const coconut = findCommodity(catalog, "coconut_copra")!;
    expect(Object.fromEntries(coconut.varieties.map((variety) => [variety.code, variety.unit_code])))
      .toEqual({ coconut: "thousand_nuts", milling_copra: "quintal", ball_copra: "quintal" });
    expect(normalizePrice(30000, "thousand_nuts", "quintal", catalog.units)).toBeNull();
    expect(normalizePrice(15000, "quintal", "kg", catalog.units)).toBe(150);
  });

  it("exposes capability-driven feeds: pepper only via TUMCOS, other configured commodities none", () => {
    expect(marketFeeds(findCommodity(catalog, "arecanut"))).toEqual(["mamcos", "tss", "tumcos", "official"]);
    expect(marketFeeds(findCommodity(catalog, "black_pepper"))).toEqual(["tumcos"]);
    expect(capabilityStatus(findCommodity(catalog, "black_pepper"), "cooperative_tumcos")).toBe("available");
    expect(marketFeeds(findCommodity(catalog, "coffee"))).toEqual([]);
    expect(capabilityStatus(findCommodity(catalog, "coffee"), "daily_prices")).toBe("not_integrated");
    const fallback = findCommodity(FALLBACK_CATALOG, "arecanut")!;
    expect(Object.keys(findCommodity(catalog, "arecanut")!.capabilities).sort()).toEqual(Object.keys(fallback.capabilities).sort());
  });

  it("gates routes by commodity capability so unintegrated commodities never render arecanut data", () => {
    const arecanut = findCommodity(catalog, "arecanut");
    const pepper = findCommodity(catalog, "black_pepper");
    const coffee = findCommodity(catalog, "coffee");
    for (const path of ["/", "/prices", "/analytics", "/compare", "/history", "/monthly-trends", "/forecasts", "/decision-tools", "/intelligence/production", "/intelligence/quality"]) {
      expect(routeAvailable(arecanut, path), path).toBe(true);
      expect(routeAvailable(coffee, path), path).toBe(false);
    }
    expect(routeAvailable(pepper, "/prices")).toBe(true);
    expect(routeAvailable(pepper, "/history")).toBe(false);
    expect(routeAvailable(pepper, "/forecasts")).toBe(false);
    expect(routeAvailable(undefined, "/prices")).toBe(false);
    expect(routeAvailable(coffee, "/data-quality")).toBe(true);
  });

  it("serves the catalogue over HTTP", async () => {
    const response = await app.request("/api/v1/commodities", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ default_commodity: "arecanut", commodities: expect.arrayContaining([expect.objectContaining({ code: "cocoa" })]) });
  });

  it("enforces price-basis rules in storage", () => {
    db.sqlite.exec(`INSERT INTO cooperative_fetches (id, source_key, source_url, started_at, status) VALUES
      ('f1', 'tss', 'https://web.tssindia.in/', '2026-11-01T00:00:00Z', 'succeeded')`);
    const insertTss = (basis: string) => db.sqlite.prepare(`INSERT INTO cooperative_quotes (id, source_key, branch, reporting_date, variety,
      price_type, price_unit, unit_status, source_url, fetched_at, fetch_id, raw_record, status, price_basis)
      VALUES (?, 'tss', 'SIRSI', '2026-11-01', 'RASHI', 'reported_average', 'INR/quintal', 'assumed', 'https://web.tssindia.in/',
      '2026-11-01T00:00:00Z', 'f1', '{}', 'pending', ?)`).run(`q-${basis}`, basis);
    expect(() => insertTss("COOPERATIVE_AVERAGE")).toThrow("price basis does not match");
    expect(() => insertTss("APMC_MODAL")).toThrow();
    insertTss("COOPERATIVE_TENDER_AVERAGE");
    expect(() => db.sqlite.exec("UPDATE cooperative_quotes SET price_basis = 'COOPERATIVE_AVERAGE'")).toThrow("immutable");
  });
});

describe("upgrading existing arecanut data to the commodity model", () => {
  let db: LocalDatabase;
  let env: Env["Bindings"];
  beforeEach(() => {
    db = applyMigrations(new LocalDatabase(), "0013_cooperative_sources.sql");
    db.sqlite.exec(`
      INSERT INTO markets (id, name, district, state, mapping_status) VALUES ('m-sirsi', 'Sirsi', 'Uttara Kannada', 'Karnataka', 'verified');
      INSERT INTO market_price_observations (id, source_id, source_record_id, market_id, reporting_date, commodity_name, original_commodity_name,
        variety_name, original_variety_name, minimum_price, maximum_price, modal_price, original_unit, price_unit, validation_status, raw_payload, grade)
      VALUES
        ('o1', 'source-agmarknet', 'r1', 'm-sirsi', '2026-11-01', 'Arecanut', 'Arecanut(Betelnut/Supari)', 'Rashi', 'Rashi', 40000, 50000, 45000, 'Rs./Quintal', 'INR/quintal', 'verified', '{}', 'Local'),
        ('o2', 'source-agmarknet', 'r2', 'm-sirsi', '2026-11-01', 'Arecanut', 'Arecanut(Betelnut/Supari)', 'Other', 'Other', 30000, 36000, 33000, 'Rs./Quintal', 'INR/quintal', 'validated', '{}', 'FAQ'),
        ('o3', 'source-agmarknet-csv', 'r3', 'm-sirsi', '2026-10-01', 'Arecanut', 'Arecanut(Betelnut/Supari)', 'Mystery', 'Mystery', 1, 2, 1, 'Rs./Quintal', 'INR/quintal', 'review_required', '{}', NULL);
      INSERT INTO cooperative_fetches (id, source_key, source_url, started_at, status) VALUES
        ('fm', 'mamcos', 'https://mamcos.info/areca-market-rates', '2026-11-01T00:00:00Z', 'succeeded'),
        ('ft', 'tss', 'https://web.tssindia.in/', '2026-11-01T00:00:00Z', 'succeeded'),
        ('fu', 'tumcos', 'https://www.tumcos.com/market-rates.php?lang=en', '2026-11-01T00:00:00Z', 'succeeded');
      INSERT INTO cooperative_quotes (id, source_key, commodity, branch, reporting_date, variety, minimum_price, maximum_price, average_price,
        price_type, price_unit, unit_status, source_url, fetched_at, fetch_id, raw_record, status) VALUES
        ('cm', 'mamcos', 'arecanut', 'SIRSI', '2026-11-01', 'RASHI EDI', 40000, 50000, 45000, 'reported_average', 'INR/quintal', 'source_confirmed', 'https://mamcos.info/areca-market-rates', '2026-11-01T00:00:00Z', 'fm', '{"a":1}', 'verified'),
        ('ct', 'tss', 'arecanut', 'SIRSI', '2026-11-01', 'RASHI', 40000, 50000, 45000, 'reported_average', 'INR/quintal', 'assumed', 'https://web.tssindia.in/', '2026-11-01T00:00:00Z', 'ft', '{"t":1}', 'accepted_unit_unconfirmed'),
        ('cp', 'tumcos', 'black_pepper', 'Channagiri', '2026-11-01', 'black pepper', 60000, 65000, 62000, 'reported_average', 'unconfirmed', 'source_conflict', 'https://www.tumcos.com/market-rates.php?lang=en', '2026-11-01T00:00:00Z', 'fu', '{"p":1}', 'pending');
    `);
    env = { DB: db as unknown as D1Database, INGESTION_TOKEN: "import", ADMIN_TOKEN: "review", MIN_INDEX_MARKETS: "3", COOPERATIVE_FETCH_ATTEMPTS: "1" };
  });
  afterEach(() => db.sqlite.close());

  it("preserves every existing observation, original label and price, and assigns the correct basis", async () => {
    const snapshot = (sql: string) => JSON.stringify(db.sqlite.prepare(sql).all());
    const dailyBefore = snapshot("SELECT * FROM market_price_observations ORDER BY id");
    const coopBefore = snapshot("SELECT * FROM cooperative_quotes ORDER BY id");
    applyMigrations(db, undefined, "0013_cooperative_sources.sql");
    const dailyAfter = db.sqlite.prepare("SELECT * FROM market_price_observations ORDER BY id").all();
    const coopAfter = db.sqlite.prepare("SELECT * FROM cooperative_quotes ORDER BY id").all();
    expect(JSON.stringify(dailyAfter.map(({ price_basis: _basis, ...row }) => row))).toBe(dailyBefore);
    // Migration 0020 applies the operator unit decision; every source value and label must still be untouched.
    const evidence = (rows: Record<string, unknown>[]) => rows.map(({ price_basis: _basis, status: _status, price_unit: _unit, unit_status: _unitStatus, ...row }) => row);
    expect(evidence(coopAfter)).toEqual(evidence(JSON.parse(coopBefore)));
    expect(Object.fromEntries(coopAfter.map((row) => [row.id, [row.status, row.price_unit, row.unit_status]]))).toEqual({
      cm: ["verified", "INR/quintal", "source_confirmed"], ct: ["verified", "INR/quintal", "assumed"], cp: ["pending", "INR/quintal", "assumed"],
    });
    expect(dailyAfter.map((row) => row.price_basis)).toEqual(["APMC_MODAL", "APMC_MODAL", "APMC_MODAL"]);
    expect(Object.fromEntries(coopAfter.map((row) => [row.id, row.price_basis])))
      .toEqual({ cm: "COOPERATIVE_AVERAGE", cp: "COOPERATIVE_AVERAGE", ct: "COOPERATIVE_TENDER_AVERAGE" });

    const view = db.sqlite.prepare("SELECT * FROM price_observations ORDER BY observation_id").all();
    expect(view).toHaveLength(6);
    const byId = Object.fromEntries(view.map((row) => [row.observation_id, row]));
    expect(byId.o1).toMatchObject({ commodity_code: "arecanut", variety_id: "variety-arecanut-rashi", original_variety_label: "Rashi",
      grade_id: "grade-arecanut-local", price_basis: "APMC_MODAL", modal_price: 45000, average_price: null, published: 1, market_kind: "apmc" });
    expect(byId.o2).toMatchObject({ variety_id: "variety-arecanut-other", grade_id: "grade-arecanut-faq", published: 0 });
    expect(byId.o3).toMatchObject({ variety_id: null, original_variety_label: "Mystery", published: 0 });
    expect(byId.cm).toMatchObject({ commodity_code: "arecanut", variety_id: null, original_variety_label: "RASHI EDI", price_basis: "COOPERATIVE_AVERAGE",
      modal_price: null, average_price: 45000, normalized_unit: "INR/quintal", market_kind: "cooperative_branch", published: 1 });
    expect(byId.ct).toMatchObject({ variety_id: "variety-arecanut-rashi", variety_mapping_status: "unverified", price_basis: "COOPERATIVE_TENDER_AVERAGE",
      normalized_unit: "INR/quintal", published: 1 });
    expect(byId.cp).toMatchObject({ commodity_code: "black_pepper", normalized_unit: "INR/quintal", published: 0 });
    expect(db.sqlite.prepare("SELECT market_id, commodity_id, source_key FROM market_commodities ORDER BY source_key").all().map((row) => ({ ...row })))
      .toEqual([
        { market_id: "m-sirsi", commodity_id: "commodity-arecanut", source_key: "agmarknet" },
        { market_id: "m-sirsi", commodity_id: "commodity-arecanut", source_key: "agmarknet_csv" },
      ]);

    const report = await validateCommodityModel(env.DB);
    expect(report).toMatchObject({ ok: true, unresolved_commodity_rows: 0, tss_rows_without_tender_basis: 0, rows_missing_original_variety: 0,
      markets_without_commodity_link: 0 });
    expect(report.tables).toEqual([
      { table: "market_price_observations", base_rows: 3, view_rows: 3 },
      { table: "cooperative_quotes", base_rows: 3, view_rows: 3 },
    ]);
    expect(report.unmapped_variety_labels).toEqual(expect.arrayContaining([
      { source_key: "agmarknet_csv", commodity_code: "arecanut", label: "Mystery", rows: 1 },
      { source_key: "mamcos", commodity_code: "arecanut", label: "RASHI EDI", rows: 1 },
    ]));
    expect(db.sqlite.prepare("SELECT raw_record FROM cooperative_quotes WHERE id = 'ct'").get()?.raw_record).toBe('{"t":1}');
  });

  it("rejects price-basis rewrites on migrated daily rows", () => {
    applyMigrations(db, undefined, "0013_cooperative_sources.sql");
    expect(() => db.sqlite.exec("UPDATE market_price_observations SET price_basis = 'APMC_MIN_MAX' WHERE id = 'o1'")).toThrow("immutable");
    expect(() => db.sqlite.exec("UPDATE market_price_observations SET price_basis = 'COOPERATIVE_AVERAGE' WHERE id = 'o1'")).toThrow();
  });
});

describe("commodity-scoped HTTP reads", () => {
  let db: LocalDatabase;
  let env: Env["Bindings"];
  beforeEach(async () => {
    db = applyMigrations(new LocalDatabase());
    env = { DB: db as unknown as D1Database, INGESTION_TOKEN: "import", ADMIN_TOKEN: "review", MIN_INDEX_MARKETS: "3", COOPERATIVE_FETCH_ATTEMPTS: "1" };
    const records = [["a", "Local"], ["b", "Large"]].map(([id, grade], index) => ({
      id, source_record_id: `src-${id}`, market_id: `market-${index}`, market_name: `Market ${index}`, district: "Shivamogga", state: "Karnataka",
      reporting_date: "2026-10-30", commodity_name: "Arecanut", original_commodity_name: "Arecanut(Betelnut/Supari)",
      variety_name: "Rashi", original_variety_name: "Rashi", minimum_price: 40000, maximum_price: 50000, modal_price: 45000,
      arrival_quantity: null, arrival_unit: null, original_unit: "Rs./Quintal", price_unit: "INR/quintal",
      validation_status: "validated", validation_message: null, raw_payload: "{}", grade,
    }));
    const post = (path: string, body: unknown, token: string) => app.request(`/api/v1${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }, env);
    expect((await post("/admin/import", { source_key: "agmarknet", records }, "import")).status).toBe(201);
    for (const id of ["a", "b"]) expect((await post(`/admin/observations/${id}/review`, { action: "approve" }, "review")).status).toBe(200);
  });
  afterEach(() => db.sqlite.close());
  const read = async (path: string) => {
    const response = await app.request(`/api/v1${path}`, {}, env);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };

  it("defaults daily reads to arecanut and isolates other commodities", async () => {
    expect((await read("/prices")).body).toMatchObject({ count: 2, data: [expect.objectContaining({ price_basis: "APMC_MODAL" }), expect.anything()] });
    expect((await read("/prices?commodity=arecanut")).body).toMatchObject({ count: 2 });
    expect((await read("/prices?commodity=black_pepper")).body).toMatchObject({ count: 0, data: [] });
    expect((await read("/varieties?commodity=coffee")).body).toEqual({ data: [] });
    expect((await read("/markets?commodity=coffee")).body).toEqual({ data: [] });
    expect((await read("/overview?commodity=coffee&variety=Rashi")).body).toMatchObject({ data: { index_status: "no_data" } });
    for (const path of ["/prices", "/varieties", "/markets", "/overview", "/analytics/reference-index", "/analytics/market-comparison", "/price-observations"]) {
      expect((await read(`${path}?commodity=tea`)).status, path).toBe(400);
    }
  });

  it("filters daily prices by exact grade", async () => {
    expect((await read("/prices?grade=Large")).body).toMatchObject({ count: 1, data: [{ grade: "Large" }] });
    expect((await read("/prices?grade=large")).body).toMatchObject({ count: 0 });
  });

  it("records market/commodity coverage on import", () => {
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM market_commodities WHERE commodity_id = 'commodity-arecanut' AND source_key = 'agmarknet'").get()?.n).toBe(2);
  });

  it("returns only published unified observations with their own basis, never combining modal and average", async () => {
    const result = await read("/price-observations?commodity=arecanut");
    expect(result.body).toMatchObject({ commodity: "arecanut", count: 2 });
    const rows = result.body.data as Record<string, unknown>[];
    expect(rows.every((row) => row.price_basis === "APMC_MODAL" && row.average_price === null && row.modal_price === 45000)).toBe(true);
    expect((await read("/price-observations?commodity=arecanut&grade=Local")).body).toMatchObject({ count: 1 });
    expect((await read("/price-observations?commodity=arecanut&price_basis=COOPERATIVE_AVERAGE")).body).toMatchObject({ count: 0 });
    expect((await read("/price-observations?commodity=black_pepper")).body).toMatchObject({ count: 0 });
    expect((await read("/price-observations?price_basis=MODAL")).status).toBe(400);
    expect((await read("/price-observations?from=2026-13-01")).status).toBe(400);
  });

  it("protects the validation report and reports a clean model", async () => {
    expect((await read("/admin/commodities/validation")).status).toBe(401);
    const response = await app.request("/api/v1/admin/commodities/validation", { headers: { Authorization: "Bearer review" } }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, tables: [{ base_rows: 2, view_rows: 2 }, { base_rows: 0, view_rows: 0 }] });
  });
});
