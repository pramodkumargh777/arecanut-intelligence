-- AGMARKNET variety-wise daily history (data.gov.in resource 35985678-0d79-46b4-9ed6-6f13308a1d24).
-- Additive only: a separate source key, so the current-daily feed ('agmarknet') and its rows are untouched.
-- Imports go through POST /admin/agmarknet-history/import (src/agmarknet-history.ts), which never inserts a
-- market/date/variety/grade that another source already holds. See docs/AGMARKNET_HISTORY.md.
INSERT OR IGNORE INTO data_sources (id, source_key, name, source_type) VALUES
  ('source-agmarknet-history', 'agmarknet_history', 'AGMARKNET daily history / data.gov.in', 'official_api');

-- Same exact-label commodity mapping as the other AGMARKNET sources.
INSERT OR IGNORE INTO commodity_aliases (id, commodity_id, source_key, source_name, mapping_status, evidence) VALUES
  ('ca-agmarknet-history-arecanut', 'commodity-arecanut', 'agmarknet_history', 'Arecanut(Betelnut/Supari)', 'verified',
   'AGMARKNET variety-wise daily history commodity value');
