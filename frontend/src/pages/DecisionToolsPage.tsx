import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { toCsv } from "../services/csv";
import type { Calculation, CalculationInputs, PriceReference } from "../services/intelligence";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { formatTimestampIST } from "../../../shared/dates";

type NumericKey = Exclude<keyof CalculationInputs, "name" | "price">;
const fields: { key: NumericKey; label: string; min: number; max?: number; step?: string; section: string }[] = [
  { key: "quantity_quintals", label: "Saleable quantity (quintals; 1 quintal = 100 kg)", min: 0.0001, section: "Net realization" },
  { key: "commission_percent", label: "Selling commission (%)", min: 0, max: 99, section: "Net realization" },
  { key: "transport_cost", label: "Total transport cost (INR)", min: 0, section: "Net realization" },
  { key: "other_selling_cost", label: "Other selling costs, total (INR)", min: 0, section: "Net realization" },
  { key: "area_hectares", label: "Farm area (hectares)", min: 0.0001, section: "Farm profitability" },
  { key: "production_cost", label: "Production cost for this harvest, excluding selling costs (INR)", min: 0, section: "Farm profitability" },
  { key: "byproduct_income", label: "By-product income for this harvest (INR)", min: 0, section: "Farm profitability" },
  { key: "hold_days", label: "Holding period (days)", min: 1, max: 3650, step: "1", section: "Hold scenario" },
  { key: "annual_finance_percent", label: "Annual opportunity / finance rate (%)", min: 0, max: 100, section: "Hold scenario" },
  { key: "storage_cost", label: "Additional total storage / insurance cost (INR)", min: 0, section: "Hold scenario" },
  { key: "weight_loss_percent", label: "Expected saleable weight loss (%)", min: 0, max: 99, section: "Hold scenario" },
  { key: "scenario_price", label: "Your future-price scenario (INR/quintal; not a forecast)", min: 0.01, section: "Hold scenario" },
];
const emptyValues = (): Record<NumericKey, string> => Object.fromEntries(fields.map((field) => [field.key, ""])) as Record<NumericKey, string>;
const money = (value: number) => value.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
export function DecisionToolsPage() {
  const [values, setValues] = useState(emptyValues), [name, setName] = useState("");
  const [selection, setSelection] = useState(""), [manualPrice, setManualPrice] = useState("");
  const [token, setToken] = useState(""), [unlocked, setUnlocked] = useState(false);
  const [result, setResult] = useState<Calculation | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const client = useQueryClient();
  const prices = useQuery({ queryKey: ["decision-prices"], queryFn: api.decisionPrices, refetchInterval: 60_000 });
  const saved = useQuery({ queryKey: ["saved-calculations", token], queryFn: () => api.savedCalculations(token), enabled: unlocked });
  const options = [
    ...(prices.data?.cooperative.map((row) => ({ key: `cooperative:${row.id}`,
      reference: { kind: "cooperative", id: row.id } satisfies PriceReference,
      label: `${row.source_key.toUpperCase()} · ${row.branch} · ${row.variety} · ${row.reporting_date} · ${money(row.average_price)} / qtl${row.unit_status === "assumed" ? " — unit by operator assumption" : ""}` })) ?? []),
    ...(prices.data?.monthly.map((row) => ({ key: `monthly:${row.refresh_run_id}:${row.variety_name}`,
      reference: { kind: "monthly", month: row.reporting_month, variety: row.variety_name, refresh_run_id: row.refresh_run_id } satisfies PriceReference,
      label: `AGMARKNET monthly · ${row.variety_name} · ${row.reporting_month} · ${money(row.weighted_price)} / qtl — state aggregate` })) ?? []),
  ];
  const calculate = useMutation({ mutationFn: api.calculate, onSuccess: setResult, onError: (error) => { setError(error); setResult(null); } });
  const save = useMutation({
    mutationFn: (inputs: CalculationInputs) => api.saveCalculation(inputs, token),
    onSuccess: async (value) => { setResult(value); await client.invalidateQueries({ queryKey: ["saved-calculations"] }); },
    onError: setError,
  });
  const busy = calculate.isPending || save.isPending;
  function changed() { setResult(null); setError(null); calculate.reset(); save.reset(); }
  function buildInputs(): CalculationInputs {
    const reference = selection === "manual" ? { kind: "manual" as const, value: Number(manualPrice) } : options.find((option) => option.key === selection)?.reference;
    if (!reference || (selection === "manual" && !manualPrice)) throw new Error("Select an available source price or enter your own price.");
    if (fields.some((field) => !values[field.key].trim())) throw new Error("Enter every cost and scenario input; use 0 only when the cost genuinely does not apply.");
    const numeric = Object.fromEntries(fields.map((field) => [field.key, Number(values[field.key])])) as Record<NumericKey, number>;
    if (Object.values(numeric).some((value) => !Number.isFinite(value))) throw new Error("Inputs must be finite numbers.");
    return { ...numeric, name, price: reference };
  }
  function load(calculation: Calculation) {
    setName(calculation.inputs.name);
    setValues(Object.fromEntries(fields.map((field) => [field.key, String(calculation.inputs[field.key])])) as Record<NumericKey, string>);
    const ref = calculation.inputs.price;
    setSelection(ref.kind === "cooperative" ? `cooperative:${ref.id}` : ref.kind === "monthly" ? `monthly:${ref.refresh_run_id}:${ref.variety}` : "manual");
    setManualPrice(ref.kind === "manual" ? String(ref.value) : "");
    setResult(calculation); setError(null); save.reset(); calculate.reset();
  }
  function exportResult(value: Calculation) {
    const rows: (string | number | null)[][] = [["section", "field", "value"],
      ["metadata", "name", value.inputs.name], ["metadata", "formula_version", value.formula_version],
      ["metadata", "saved_at", value.created_at ?? null],
      ["price_snapshot", "price_unit", "INR/quintal"],
      ...Object.entries(value.price).map(([key, val]) => ["price_snapshot", key, val]),
      ...fields.map((field) => ["user_inputs", field.key, value.inputs[field.key]]),
      ...Object.entries(value.results).map(([key, val]) => ["results", key, val]),
    ];
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "ani-decision-scenario.csv"; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="page-stack">
    <section className="page-heading"><div><div className="eyebrow">PRACTICAL DECISION TOOLS</div><h1>Realization & farm profitability</h1><p>Your quantities and costs, a traceable source price, and explicit hold scenarios. No predictive recommendation.</p></div></section>
    <div className="data-disclosure">No costs or yields are prefilled. Match your exact product grade and reporting date. Published prices are indicative, not a buyer's executable offer. Monthly state averages are not local daily quotations; TSS units remain assumed.</div>
    {prices.isLoading ? <LoadingState /> : prices.error ? <ErrorState error={prices.error} onRetry={() => void prices.refetch()} /> : <form className="page-stack" onSubmit={(event) => {
      event.preventDefault(); setError(null); try { calculate.mutate(buildInputs()); } catch (error) { setError(error instanceof Error ? error : new Error("Invalid inputs.")); }
    }}>
      <section className="panel"><div className="panel-heading"><div><h2>Price reference and scenario</h2><p>All sale prices are INR/quintal. Enter actual costs for the same harvest and currency.</p></div></div><div className="calculator-grid">
        <label className="filter-control"><span>Scenario name</span><input required maxLength={120} value={name} disabled={busy} onChange={(event) => { changed(); setName(event.target.value); }} /></label>
        <label className="filter-control calculator-wide"><span>Source price</span><select required value={selection} disabled={busy} onChange={(event) => { changed(); setSelection(event.target.value); }}>
          <option value="">Select a price — no automatic substitution</option>
          {selection && selection !== "manual" && !options.some((option) => option.key === selection) && <option value={selection}>Saved price no longer current — choose another before recalculating</option>}
          {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}<option value="manual">My own price — user-entered, not sourced</option>
        </select></label>
        {selection === "manual" && <label className="filter-control"><span>Your price (INR/quintal)</span><input type="number" step="any" min="0.01" max="100000000" required value={manualPrice} disabled={busy} onChange={(event) => { changed(); setManualPrice(event.target.value); }} /></label>}
      </div></section>
      {["Net realization", "Farm profitability", "Hold scenario"].map((section) => <section className="panel" key={section}><div className="panel-heading"><div><h2>{section}</h2><p>{section === "Farm profitability" ? "Use total costs and area attributable to the supplied saleable harvest. Do not double-count selling costs." : section === "Hold scenario" ? "Future price, shrinkage and carrying rate are your assumptions. Selling fees/transport are held unchanged. No probability is assigned." : "Commission applies to gross proceeds; transport and other selling costs are total INR, not per-quintal amounts."}</p></div></div>
        <div className="calculator-grid">{fields.filter((field) => field.section === section).map((field) => <label className="filter-control" key={field.key}><span>{field.label}</span><input type="number" required step={field.step ?? "any"} min={field.min} max={field.max ?? (field.key === "quantity_quintals" || field.key === "area_hectares" ? 1e7 : field.key === "scenario_price" ? 1e8 : 1e12)} value={values[field.key]} disabled={busy} onChange={(event) => { changed(); setValues((current) => ({ ...current, [field.key]: event.target.value })); }} /></label>)}</div>
      </section>)}
      <button className="button-primary" disabled={busy}>{calculate.isPending ? "Calculating..." : "Calculate actual-input scenario"}</button>
    </form>}
    {error && <ErrorState error={error} />}
    {result && <section className="panel" aria-label="Calculation results"><div className="panel-heading"><div><h2>{result.inputs.name} · Results</h2><p>{result.created_at ? `Saved snapshot: ${formatTimestampIST(result.created_at)}. Retained independently of later source corrections.` : "Calculated but not stored. Save with reviewer access below."} · {result.formula_version}</p></div><button className="button-secondary" onClick={() => exportResult(result)}>Export scenario CSV</button></div>
      <div className="monthly-details">
        <p><strong>Price: {money(result.price.value)} / quintal · {result.price.source} · {result.price.unit_status.replace(/_/g, " ")}</strong></p>
        <p>{result.price.branch} · {result.price.variety} · Market reporting period: {result.price.reporting_period ?? "User entered; no reporting date"} · Platform fetched: {result.price.fetched_at ? formatTimestampIST(result.price.fetched_at) : "Not sourced"} · {result.price.price_type.replace(/_/g, " ")} {result.price.source_url && <a href={result.price.source_url} target="_blank" rel="noreferrer">Source evidence</a>}</p>
        {result.price.state && <p>Source reporting state: {result.price.state}</p>}
        {result.price.price_type === "monthly_weighted_modal" && result.price.reference_id && <p><a href={api.monthlySnapshotUrl(result.price.reference_id)} target="_blank" rel="noreferrer">Download the archived report used for this calculation</a> (unchanged by later source refreshes).</p>}
        {result.price.unit_status === "assumed" && <p role="note">INR/quintal is an operator assumption for this source. All monetary results inherit it.</p>}
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Decision calculation outputs"><table><caption>Scenario arithmetic, not forecasts or personalized investment advice</caption><thead><tr><th>Measure</th><th className="numeric">Value</th></tr></thead><tbody>
          {([
            ["Gross realization", result.results.gross_realization], ["Selling costs", result.results.selling_costs],
            ["Net realization now", result.results.net_realization], ["Net per quintal", result.results.net_per_quintal],
            ["Farm profit", result.results.farm_profit], ["Profit per hectare", result.results.profit_per_hectare],
            ["Farm break-even sale price / quintal", result.results.farm_break_even_price],
            ["Hold finance / opportunity cost", result.results.finance_cost], ["Hold net realization at your scenario price", result.results.hold_net_realization],
            ["Hold advantage vs selling now", result.results.hold_advantage], ["Hold break-even price / remaining quintal", result.results.break_even_hold_price],
          ] as [string, number][]).map(([label, value]) => <tr key={label}><td>{label}</td><td className="numeric">{money(value)}</td></tr>)}
          <tr><td>Return on production cost</td><td className="numeric">{result.results.roi_percent === null ? "Unavailable: production cost is zero" : `${result.results.roi_percent.toFixed(2)}%`}</td></tr>
          <tr><td>Saleable quantity after holding</td><td className="numeric">{result.results.remaining_quintals.toFixed(4)} quintals</td></tr>
          <tr><td>Required increase to hold break-even</td><td className="numeric">{result.results.break_even_increase_percent.toFixed(2)}%</td></tr>
        </tbody></table></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Hold scenarios"><table><caption>Deterministic hold scenarios — no probabilities or predicted outcomes</caption><thead><tr><th>Scenario</th><th>Future price / quintal</th><th>Hold net proceeds</th><th>Advantage vs sell now</th></tr></thead><tbody>
          <tr><td>Price unchanged from reference</td><td>{money(result.price.value)}</td><td>{money(result.results.hold_unchanged_net_realization)}</td><td>{money(result.results.hold_unchanged_advantage)}</td></tr>
          <tr><td>Your entered future-price scenario</td><td>{money(result.inputs.scenario_price)}</td><td>{money(result.results.hold_net_realization)}</td><td>{money(result.results.hold_advantage)}</td></tr>
          <tr><td>Break-even hold price</td><td>{money(result.results.break_even_hold_price)}</td><td>{money(result.results.net_realization)}</td><td>{money(0)}</td></tr>
        </tbody></table></div>
        <p>Net now = quantity × price × (1 − commission %) − transport − other selling costs. Farm profit = net now + by-product income − production cost. Holding finance = max(net now, 0) × annual rate × days / 365. Hold net uses the remaining weight and your future price, minus selling, storage and finance costs.</p>
        <p>Hold break-even is the future price that matches today's net proceeds after those costs. It is not a predicted price or a sell/hold recommendation. No taxes, grade changes, inflation, reinvestment or unentered expenses are inferred. Input 0 explicitly when applicable.</p>
        {result.results.net_realization < 0 && <p role="alert">Immediate net proceeds are negative. Opportunity cost is floored at zero; financing of losses is not modelled.</p>}
      </div>
    </section>}
    <section className="panel"><div className="panel-heading"><div><h2>Private saved scenarios</h2><p>Stored in the API database with immutable price and result snapshots. Shared reviewer-token access is not individual-account isolation. Latest 100 saved scenarios are listed.</p></div></div><div className="monthly-details">
      {!unlocked ? <form className="monthly-refresh" onSubmit={(event) => { event.preventDefault(); setUnlocked(true); }}><label className="filter-control"><span>Scenario storage reviewer token</span><input type="password" autoComplete="off" value={token} required onChange={(event) => setToken(event.target.value)} /></label><button className="button-secondary">Unlock saved scenarios</button></form> : <>
        <div className="monthly-refresh"><button className="button-secondary" disabled={busy} onClick={() => { client.removeQueries({ queryKey: ["saved-calculations"] }); setToken(""); setUnlocked(false); setResult(null); setValues(emptyValues()); setName(""); setSelection(""); setManualPrice(""); setError(null); save.reset(); }}>Lock and clear private inputs</button>
          <button className="button-primary" disabled={busy || !result || Boolean(result.id) || !saved.isSuccess} onClick={() => { if (result) { setError(null); save.mutate(result.inputs); } }}>Save calculated scenario</button></div>
        {saved.isLoading ? <LoadingState /> : saved.error ? <ErrorState error={saved.error} onRetry={() => void saved.refetch()} /> : !saved.data?.data.length ? <EmptyState title="No saved scenarios">No example costs or fictitious farm inputs are stored.</EmptyState> : <ul>{saved.data.data.map((value) => <li key={value.id}><button className="text-button" disabled={busy} onClick={() => load(value)}>{value.inputs.name} · {value.created_at ? formatTimestampIST(value.created_at) : ""}</button></li>)}</ul>}
      </>}
    </div></section>
  </div>;
}
