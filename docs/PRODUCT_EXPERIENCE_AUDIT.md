# ANI product experience audit

## Findings and proposed changes

The existing application already provides reviewed, source-specific quotations,
historical analysis, comparisons and specialist tools. Its main friction is
discovery: the navigation gives almost every feature equal prominence, while
the first screen shows cooperative quotations but not official market prices.
The source selector also hides the official feed when it has no published
varieties, making its availability difficult to understand. A partial failure
on the home screen can appear to be a source with no prices.

1. Make the everyday jobs prominent: latest rates, explore prices, price
   trends, compare markets and market intelligence. Keep the existing overview,
   historical, forecasting, decision, workspace and review routes available
   under a secondary navigation disclosure; do not remove their capabilities.
2. Show a small, explicitly dated selection of verified official market
   quotations alongside the existing cooperative reports. Keep modal prices
   separate from cooperative averages, preserve exact variety, grade, source
   and unit, and link to the full explorer. Show errors and empty states
   independently for each feed.
3. Keep all supported sources selectable even when no prices are published.
   The existing source-specific screens explain their own empty states and
   price methodology rather than substituting or blending data.
4. Make market comparisons honest when reporting dates differ: reserve
   ranking and visual comparisons for the existing same-date chart; present
   the latest-per-market list as quotations rather than a cross-date ranking.
5. Prioritize prices ahead of optional actions on the home screen, retain
   Kannada and English labels, and check keyboard and mobile navigation.

## Feature placement

- **Latest rates and price explorer:** primary, for daily price discovery.
- **Price analytics and comparisons:** primary, for historical movement and
  same-date comparisons; source-specific methods and existing charts remain.
- **Market intelligence and supply/weather:** primary entry and secondary
  detail respectively, for users needing context beyond prices.
- **Sell or wait and assistant:** useful follow-on actions, retained on the
  home screen and in navigation without displacing current rates.
- **Market overview, monthly trends and historical analytics:** retained as
  deeper analysis; their underlying data and methods remain unchanged.
- **Forecasts, evaluation, decision tools, workspace and data quality:**
  retained as advanced tools, not removed or presented as everyday prices.

## Boundaries

No source prices are averaged across providers. Official modal quotations and
cooperative reported averages are distinct, and assumed units remain labelled.
Reporting dates describe the observations, not the currentness of the entire
market. This increment does not change ingestion, schemas or deployment.

The focused interface regressions run with `npm run test:frontend` and are
also included in the root `npm test` command.

The home sections link to the corresponding feed in the price explorer.
Cooperative source details distinguish the latest retrieval from the number
awaiting review and the observations published for the selected window.
When official market reporting dates differ, the latest-quotation list is
ordered by market, not price; the separate same-date chart remains ranked.
