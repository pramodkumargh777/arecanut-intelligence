-- Monthly arrival totals from the daily arrival reports (docs/DAILY_ARRIVALS.md), so the season pattern on the Sell or
-- wait page reads a few hundred rows instead of re-adding every stored day (about 2 million row reads) on each visit.
-- Additive only. A derived cache: every row follows from market_arrival_days_current with the /supply/arrivals
-- precedence (KRAMA wins a date; AGMARKNET date-wise rows fill other dates; a market-day with a daily file import is
-- left out). Each daily import refreshes the months it touches; a new market alias refreshes that market's months.
--
-- scope 'state' holds one row per month for the whole state (market ''); scope 'market' one row per market and month.
-- reporting_days counts distinct report dates, so a month can be judged complete or partial.
--
-- Rollback: DROP TABLE arrival_month_totals;
CREATE TABLE arrival_month_totals (
  state TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('state', 'market')),
  market TEXT NOT NULL,
  district TEXT,
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  quantity_tonnes REAL,
  reporting_days INTEGER NOT NULL CHECK (reporting_days >= 0),
  records INTEGER NOT NULL CHECK (records >= 0),
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (state, scope, market, month)
);

-- The first fill, over every stored date (the same statement the API runs per month; see monthTotalStatements).
WITH cur AS (SELECT * FROM market_arrival_days_current WHERE commodity_code = 'arecanut' AND state = 'Karnataka'),
  krama_dates AS (SELECT DISTINCT observation_date FROM cur WHERE source_key = 'krama_arrivals'),
  picked AS (SELECT c.* FROM cur c WHERE (c.source_key = 'krama_arrivals' OR c.observation_date NOT IN (SELECT observation_date FROM krama_dates))
    AND NOT EXISTS (SELECT 1 FROM market_arrivals a WHERE a.measure = 'arrival' AND a.commodity_code = c.commodity_code AND a.state = c.state
      AND lower(a.market) = lower(c.market) AND a.observation_date = c.observation_date))
INSERT INTO arrival_month_totals (state, scope, market, district, month, quantity_tonnes, reporting_days, records, refreshed_at)
SELECT 'Karnataka', 'market', market, MAX(district), substr(observation_date, 1, 7), ROUND(SUM(quantity_tonnes), 3), COUNT(DISTINCT observation_date),
  COUNT(*), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM picked GROUP BY market, substr(observation_date, 1, 7)
UNION ALL
SELECT 'Karnataka', 'state', '', NULL, substr(observation_date, 1, 7), ROUND(SUM(quantity_tonnes), 3), COUNT(DISTINCT observation_date),
  COUNT(*), strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM picked GROUP BY substr(observation_date, 1, 7);
