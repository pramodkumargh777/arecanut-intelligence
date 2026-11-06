-- Multi-commodity domain model. Additive and non-destructive:
-- existing observation rows are never rewritten except to attach the cooperative tender basis to TSS rows
-- through a newly added column; original source labels, prices, units and raw payloads are untouched.

-- ---------------------------------------------------------------------------
-- Units and price-basis taxonomy
-- ---------------------------------------------------------------------------
CREATE TABLE units (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('mass', 'count')),
  base_unit TEXT NOT NULL,
  factor_to_base REAL NOT NULL CHECK (factor_to_base > 0)
);
INSERT INTO units (code, label, dimension, base_unit, factor_to_base) VALUES
  ('kg', 'kilogram', 'mass', 'kg', 1),
  ('quintal', 'quintal (100 kg)', 'mass', 'kg', 100),
  ('tonne', 'tonne (1000 kg)', 'mass', 'kg', 1000),
  ('nut', 'nut', 'count', 'nut', 1),
  ('thousand_nuts', '1000 nuts', 'count', 'nut', 1000);

CREATE TABLE unit_aliases (
  source_label TEXT PRIMARY KEY,
  unit_code TEXT NOT NULL REFERENCES units(code),
  currency TEXT NOT NULL DEFAULT 'INR',
  mapping_status TEXT NOT NULL CHECK (mapping_status IN ('unverified', 'verified')),
  evidence TEXT NOT NULL
);
INSERT INTO unit_aliases (source_label, unit_code, mapping_status, evidence) VALUES
  ('Rs./Quintal', 'quintal', 'verified', 'Unit label returned by the data.gov.in AGMARKNET daily resource'),
  ('INR/quintal', 'quintal', 'verified', 'Platform normalized price unit');

CREATE TABLE price_bases (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
INSERT INTO price_bases (code, label, description, sort_order) VALUES
  ('APMC_MODAL', 'APMC modal price', 'Most frequently traded price reported by a regulated APMC market for the day, with reported minimum and maximum.', 1),
  ('APMC_MIN_MAX', 'APMC minimum/maximum range', 'APMC-reported price range where no modal price is published.', 2),
  ('COOPERATIVE_AVERAGE', 'Cooperative reported average', 'Average rate published by a marketing cooperative branch. Not an APMC modal price.', 3),
  ('COOPERATIVE_TENDER_AVERAGE', 'Cooperative tender average', 'Average of cooperative tender/auction session rates. Not an APMC modal price.', 4),
  ('AUCTION_LOT_PRICE', 'Auction lot price', 'Price realised for an individual auction lot.', 5),
  ('BUYER_QUOTATION', 'Buyer quotation', 'Price offered by a trader or processor; not a completed transaction.', 6),
  ('FARMER_TRANSACTION', 'Farmer transaction', 'Price reported by a farmer for a completed sale.', 7);

-- ---------------------------------------------------------------------------
-- Commodity master and commodity-specific configuration
-- ---------------------------------------------------------------------------
ALTER TABLE commodities ADD COLUMN code TEXT;
ALTER TABLE commodities ADD COLUMN display_name TEXT;
ALTER TABLE commodities ADD COLUMN category TEXT;
ALTER TABLE commodities ADD COLUMN status TEXT NOT NULL DEFAULT 'configured' CHECK (status IN ('production', 'configured'));
ALTER TABLE commodities ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100;

UPDATE commodities SET code = 'arecanut', display_name = 'Arecanut', category = 'plantation_crop', status = 'production', sort_order = 1
WHERE id = 'commodity-arecanut';
INSERT INTO commodities (id, canonical_name, code, display_name, category, status, sort_order) VALUES
  ('commodity-black-pepper', 'Black Pepper', 'black_pepper', 'Black pepper', 'spice', 'configured', 2),
  ('commodity-coffee', 'Coffee', 'coffee', 'Coffee', 'plantation_crop', 'configured', 3),
  ('commodity-cardamom', 'Cardamom', 'cardamom', 'Cardamom', 'spice', 'configured', 4),
  ('commodity-coconut-copra', 'Coconut/Copra', 'coconut_copra', 'Coconut / copra', 'plantation_crop', 'configured', 5),
  ('commodity-cocoa', 'Cocoa', 'cocoa', 'Cocoa', 'plantation_crop', 'configured', 6),
  ('commodity-natural-rubber', 'Natural Rubber', 'natural_rubber', 'Natural rubber', 'plantation_crop', 'configured', 7);
CREATE UNIQUE INDEX idx_commodities_code ON commodities(code);

CREATE TABLE commodity_configs (
  commodity_id TEXT PRIMARY KEY REFERENCES commodities(id),
  default_unit_code TEXT NOT NULL REFERENCES units(code),
  currency TEXT NOT NULL DEFAULT 'INR',
  grading_system TEXT NOT NULL,
  agmarknet_commodity_code TEXT,
  config_status TEXT NOT NULL CHECK (config_status IN ('verified', 'reference_unverified')),
  notes TEXT NOT NULL
);
INSERT INTO commodity_configs (commodity_id, default_unit_code, grading_system, agmarknet_commodity_code, config_status, notes) VALUES
  ('commodity-arecanut', 'quintal', 'AGMARKNET variety label with AGMARKNET grade (Local/Large/Medium/FAQ)', '118', 'verified',
   'Production commodity. Variety and grade labels are the exact labels observed in AGMARKNET daily and monthly data.'),
  ('commodity-black-pepper', 'quintal', 'Commercial garbling/size grades (e.g. MG-1, TGEB) and physical-quality classes', NULL, 'reference_unverified',
   'Reference configuration only. TUMCOS black pepper rows are archived with an unconfirmed unit and are not published.'),
  ('commodity-coffee', 'kg', 'Species (Arabica/Robusta), processing type (plantation/parchment/cherry) and screen grade', NULL, 'reference_unverified',
   'Reference configuration only. No integrated coffee price source.'),
  ('commodity-cardamom', 'kg', 'Type (small/large) and size/colour grades for small cardamom', NULL, 'reference_unverified',
   'Reference configuration only. No integrated cardamom price source.'),
  ('commodity-coconut-copra', 'quintal', 'Product form (coconut, milling copra, ball copra); coconut is commonly traded by count', NULL, 'reference_unverified',
   'Reference configuration only. Coconut and copra forms use different units and must not be compared directly.'),
  ('commodity-cocoa', 'kg', 'Bean form (dry/wet)', NULL, 'reference_unverified',
   'Reference configuration only. No integrated cocoa price source.'),
  ('commodity-natural-rubber', 'kg', 'Sheet and block grades (RSS, ISNR) and latex', NULL, 'reference_unverified',
   'Reference configuration only. No integrated natural rubber price source.');

CREATE TABLE commodity_capabilities (
  commodity_id TEXT NOT NULL REFERENCES commodities(id),
  capability TEXT NOT NULL CHECK (capability IN (
    'daily_prices', 'analytics', 'market_comparison', 'monthly_history', 'forecast',
    'cooperative_mamcos', 'cooperative_tss', 'cooperative_tumcos',
    'production', 'trade', 'weather', 'quality', 'calculators', 'intelligence')),
  status TEXT NOT NULL CHECK (status IN ('available', 'unpublished')),
  note TEXT,
  PRIMARY KEY (commodity_id, capability)
);
-- Capabilities not listed are not integrated for that commodity.
INSERT INTO commodity_capabilities (commodity_id, capability, status, note)
SELECT 'commodity-arecanut', column1, 'available', NULL FROM (VALUES
  ('daily_prices'), ('analytics'), ('market_comparison'), ('monthly_history'), ('forecast'),
  ('cooperative_mamcos'), ('cooperative_tss'), ('cooperative_tumcos'), ('production'), ('trade'),
  ('weather'), ('quality'), ('calculators'), ('intelligence'));
INSERT INTO commodity_capabilities (commodity_id, capability, status, note) VALUES
  ('commodity-black-pepper', 'cooperative_tumcos', 'unpublished',
   'TUMCOS black pepper rows are archived for review; the price unit conflicts on the source page so nothing is published.');

-- ---------------------------------------------------------------------------
-- Varieties and grades (commodity-scoped)
-- ---------------------------------------------------------------------------
ALTER TABLE varieties ADD COLUMN code TEXT;
ALTER TABLE varieties ADD COLUMN classification_type TEXT NOT NULL DEFAULT 'variety';
ALTER TABLE varieties ADD COLUMN unit_code TEXT;
ALTER TABLE varieties ADD COLUMN evidence TEXT;
ALTER TABLE varieties ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100;

-- Arecanut: exact AGMARKNET labels (daily resource), then labels seen only in the AGMARKNET monthly report.
INSERT OR IGNORE INTO varieties (id, commodity_id, canonical_name, mapping_status, code, classification_type, evidence, sort_order)
-- VALUES columns: label, code, mapping status, evidence, sort order.
SELECT 'variety-arecanut-' || column2, 'commodity-arecanut', column1, column3, column2, 'market_classification', column4, column5
FROM (VALUES
  ('Rashi', 'rashi', 'verified', 'AGMARKNET daily and monthly label', 1),
  ('Chali', 'chali', 'verified', 'AGMARKNET daily and monthly label', 2),
  ('Bette', 'bette', 'verified', 'AGMARKNET daily and monthly label', 3),
  ('Hosa Chali', 'hosa_chali', 'verified', 'AGMARKNET daily and monthly label', 4),
  ('Hale Chali', 'hale_chali', 'verified', 'AGMARKNET daily and monthly label', 5),
  ('Kempugotu', 'kempugotu', 'verified', 'AGMARKNET daily and monthly label', 6),
  ('Bilegotu', 'bilegotu', 'verified', 'AGMARKNET daily and monthly label', 7),
  ('Gorabalu', 'gorabalu', 'verified', 'AGMARKNET daily and monthly label', 8),
  ('Sippegotu', 'sippegotu', 'verified', 'AGMARKNET daily and monthly label', 9),
  ('Tattibettee', 'tattibettee', 'verified', 'AGMARKNET daily and monthly label', 10),
  ('Cqca', 'cqca', 'verified', 'AGMARKNET daily and monthly label', 11),
  ('EDI', 'edi', 'verified', 'AGMARKNET daily and monthly label', 12),
  ('Hannadike', 'hannadike', 'verified', 'AGMARKNET daily and monthly label', 13),
  ('Chippu', 'chippu', 'verified', 'AGMARKNET daily and monthly label', 14),
  ('Churu', 'churu', 'verified', 'AGMARKNET daily and monthly label', 15),
  ('Factory', 'factory', 'verified', 'AGMARKNET daily and monthly label', 16),
  ('Raw', 'raw', 'verified', 'AGMARKNET daily and monthly label', 17),
  ('Arecanut-Husk', 'arecanut_husk', 'verified', 'AGMARKNET daily and monthly label', 18),
  ('New Variety', 'new_variety', 'verified', 'AGMARKNET daily and monthly label', 19),
  ('Old Variety', 'old_variety', 'verified', 'AGMARKNET daily and monthly label', 20),
  ('Other', 'other', 'verified', 'AGMARKNET daily and monthly label', 21),
  ('Saraku', 'saraku', 'unverified', 'AGMARKNET monthly report label only', 30),
  ('Kole', 'kole', 'unverified', 'AGMARKNET monthly report label only', 31),
  ('Pudi', 'pudi', 'unverified', 'AGMARKNET monthly report label only', 32),
  ('Podi', 'podi', 'unverified', 'AGMARKNET monthly report label only', 33),
  ('Pylone', 'pylone', 'unverified', 'AGMARKNET monthly report label only', 34),
  ('Red', 'red', 'unverified', 'AGMARKNET monthly report label only', 35),
  ('Ripe', 'ripe', 'unverified', 'AGMARKNET monthly report label only', 36),
  ('Supari', 'supari', 'unverified', 'AGMARKNET monthly report label only', 37)
);
-- Give any pre-existing variety rows (none expected) a code so the unique index can be created.
UPDATE varieties SET code = lower(replace(replace(canonical_name, ' ', '_'), '-', '_')) WHERE code IS NULL;

-- Reference classifications for configured (non-production) commodities. Unverified until a source is integrated.
INSERT INTO varieties (id, commodity_id, canonical_name, mapping_status, code, classification_type, unit_code, evidence, sort_order) VALUES
  ('variety-coffee-arabica', 'commodity-coffee', 'Arabica', 'unverified', 'arabica', 'species', NULL, 'Reference classification; not observed in an integrated source', 1),
  ('variety-coffee-robusta', 'commodity-coffee', 'Robusta', 'unverified', 'robusta', 'species', NULL, 'Reference classification; not observed in an integrated source', 2),
  ('variety-cardamom-small', 'commodity-cardamom', 'Small cardamom', 'unverified', 'small', 'type', NULL, 'Reference classification; not observed in an integrated source', 1),
  ('variety-cardamom-large', 'commodity-cardamom', 'Large cardamom', 'unverified', 'large', 'type', NULL, 'Reference classification; not observed in an integrated source', 2),
  ('variety-coconut-copra-coconut', 'commodity-coconut-copra', 'Coconut (dehusked)', 'unverified', 'coconut', 'product_form', 'thousand_nuts', 'Reference classification; not observed in an integrated source', 1),
  ('variety-coconut-copra-milling-copra', 'commodity-coconut-copra', 'Milling copra', 'unverified', 'milling_copra', 'product_form', 'quintal', 'Reference classification; not observed in an integrated source', 2),
  ('variety-coconut-copra-ball-copra', 'commodity-coconut-copra', 'Ball copra', 'unverified', 'ball_copra', 'product_form', 'quintal', 'Reference classification; not observed in an integrated source', 3),
  ('variety-cocoa-dry-beans', 'commodity-cocoa', 'Dry beans', 'unverified', 'dry_beans', 'product_form', NULL, 'Reference classification; not observed in an integrated source', 1),
  ('variety-cocoa-wet-beans', 'commodity-cocoa', 'Wet beans', 'unverified', 'wet_beans', 'product_form', NULL, 'Reference classification; not observed in an integrated source', 2);
CREATE UNIQUE INDEX idx_varieties_commodity_code ON varieties(commodity_id, code);

CREATE TABLE grades (
  id TEXT PRIMARY KEY,
  commodity_id TEXT NOT NULL REFERENCES commodities(id),
  variety_id TEXT REFERENCES varieties(id),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  grade_type TEXT NOT NULL,
  mapping_status TEXT NOT NULL CHECK (mapping_status IN ('unverified', 'verified')),
  evidence TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  UNIQUE (commodity_id, code)
);
INSERT INTO grades (id, commodity_id, variety_id, code, label, grade_type, mapping_status, evidence, sort_order) VALUES
  ('grade-arecanut-local', 'commodity-arecanut', NULL, 'local', 'Local', 'agmarknet_grade', 'verified', 'AGMARKNET daily resource grade field', 1),
  ('grade-arecanut-large', 'commodity-arecanut', NULL, 'large', 'Large', 'agmarknet_grade', 'verified', 'AGMARKNET daily resource grade field', 2),
  ('grade-arecanut-medium', 'commodity-arecanut', NULL, 'medium', 'Medium', 'agmarknet_grade', 'verified', 'AGMARKNET daily resource grade field', 3),
  ('grade-arecanut-faq', 'commodity-arecanut', NULL, 'faq', 'FAQ', 'agmarknet_grade', 'verified', 'AGMARKNET daily resource grade field', 4),
  ('grade-black-pepper-mg1', 'commodity-black-pepper', NULL, 'mg1', 'MG-1 (Malabar Garbled grade 1)', 'commercial_grade', 'unverified', 'Reference classification; not observed in an integrated source', 1),
  ('grade-black-pepper-tgeb', 'commodity-black-pepper', NULL, 'tgeb', 'TGEB (Tellicherry Garbled Extra Bold)', 'commercial_grade', 'unverified', 'Reference classification; not observed in an integrated source', 2),
  ('grade-black-pepper-tgseb', 'commodity-black-pepper', NULL, 'tgseb', 'TGSEB (Tellicherry Garbled Special Extra Bold)', 'commercial_grade', 'unverified', 'Reference classification; not observed in an integrated source', 3),
  ('grade-black-pepper-garbled', 'commodity-black-pepper', NULL, 'garbled', 'Garbled', 'physical_quality', 'unverified', 'Reference classification; not observed in an integrated source', 4),
  ('grade-black-pepper-ungarbled', 'commodity-black-pepper', NULL, 'ungarbled', 'Ungarbled', 'physical_quality', 'unverified', 'Reference classification; not observed in an integrated source', 5),
  ('grade-black-pepper-light', 'commodity-black-pepper', NULL, 'light', 'Light pepper', 'physical_quality', 'unverified', 'Reference classification; not observed in an integrated source', 6),
  ('grade-coffee-arabica-plantation', 'commodity-coffee', 'variety-coffee-arabica', 'arabica_plantation', 'Arabica plantation (washed parchment)', 'processing_type', 'unverified', 'Reference classification; not observed in an integrated source', 1),
  ('grade-coffee-arabica-cherry', 'commodity-coffee', 'variety-coffee-arabica', 'arabica_cherry', 'Arabica cherry', 'processing_type', 'unverified', 'Reference classification; not observed in an integrated source', 2),
  ('grade-coffee-robusta-parchment', 'commodity-coffee', 'variety-coffee-robusta', 'robusta_parchment', 'Robusta parchment', 'processing_type', 'unverified', 'Reference classification; not observed in an integrated source', 3),
  ('grade-coffee-robusta-cherry', 'commodity-coffee', 'variety-coffee-robusta', 'robusta_cherry', 'Robusta cherry', 'processing_type', 'unverified', 'Reference classification; not observed in an integrated source', 4),
  ('grade-coffee-aa', 'commodity-coffee', NULL, 'aa', 'AA', 'screen_grade', 'unverified', 'Reference classification; not observed in an integrated source', 5),
  ('grade-coffee-a', 'commodity-coffee', NULL, 'a', 'A', 'screen_grade', 'unverified', 'Reference classification; not observed in an integrated source', 6),
  ('grade-coffee-pb', 'commodity-coffee', NULL, 'pb', 'PB (peaberry)', 'screen_grade', 'unverified', 'Reference classification; not observed in an integrated source', 7),
  ('grade-cardamom-ageb', 'commodity-cardamom', 'variety-cardamom-small', 'ageb', 'AGEB (Alleppey Green Extra Bold)', 'size_colour_grade', 'unverified', 'Reference classification; not observed in an integrated source', 1),
  ('grade-cardamom-agb', 'commodity-cardamom', 'variety-cardamom-small', 'agb', 'AGB (Alleppey Green Bold)', 'size_colour_grade', 'unverified', 'Reference classification; not observed in an integrated source', 2),
  ('grade-cardamom-ags', 'commodity-cardamom', 'variety-cardamom-small', 'ags', 'AGS (Alleppey Green Superior)', 'size_colour_grade', 'unverified', 'Reference classification; not observed in an integrated source', 3),
  ('grade-natural-rubber-rss4', 'commodity-natural-rubber', NULL, 'rss4', 'RSS-4', 'sheet_grade', 'unverified', 'Reference classification; not observed in an integrated source', 1),
  ('grade-natural-rubber-rss5', 'commodity-natural-rubber', NULL, 'rss5', 'RSS-5', 'sheet_grade', 'unverified', 'Reference classification; not observed in an integrated source', 2),
  ('grade-natural-rubber-isnr20', 'commodity-natural-rubber', NULL, 'isnr20', 'ISNR 20', 'block_grade', 'unverified', 'Reference classification; not observed in an integrated source', 3),
  ('grade-natural-rubber-latex60', 'commodity-natural-rubber', NULL, 'latex60', 'Latex (60% DRC)', 'latex', 'unverified', 'Reference classification; not observed in an integrated source', 4);

CREATE TABLE grade_mappings (
  id TEXT PRIMARY KEY,
  commodity_id TEXT NOT NULL REFERENCES commodities(id),
  source_key TEXT NOT NULL,
  source_label TEXT NOT NULL,
  grade_id TEXT NOT NULL REFERENCES grades(id),
  mapping_status TEXT NOT NULL CHECK (mapping_status IN ('unverified', 'verified')),
  UNIQUE (commodity_id, source_key, source_label)
);
INSERT INTO grade_mappings (id, commodity_id, source_key, source_label, grade_id, mapping_status)
SELECT 'gm-' || s.source_key || '-' || g.code, g.commodity_id, s.source_key, g.label, g.id, 'verified'
FROM grades g CROSS JOIN (SELECT 'agmarknet' AS source_key UNION ALL SELECT 'agmarknet_csv') s
WHERE g.commodity_id = 'commodity-arecanut';

-- ---------------------------------------------------------------------------
-- Source aliases (commodity-scoped so identical labels never cross commodities)
-- ---------------------------------------------------------------------------
CREATE TABLE commodity_aliases (
  id TEXT PRIMARY KEY,
  commodity_id TEXT NOT NULL REFERENCES commodities(id),
  source_key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  mapping_status TEXT NOT NULL CHECK (mapping_status IN ('unverified', 'verified')),
  evidence TEXT NOT NULL,
  UNIQUE (source_key, source_name)
);
INSERT INTO commodity_aliases (id, commodity_id, source_key, source_name, mapping_status, evidence) VALUES
  ('ca-agmarknet-arecanut', 'commodity-arecanut', 'agmarknet', 'Arecanut(Betelnut/Supari)', 'verified', 'data.gov.in daily resource commodity value'),
  ('ca-agmarknet-csv-arecanut', 'commodity-arecanut', 'agmarknet_csv', 'Arecanut(Betelnut/Supari)', 'verified', 'AGMARKNET CSV export commodity value'),
  ('ca-agmarknet-monthly-arecanut', 'commodity-arecanut', 'agmarknet_monthly', '118', 'verified', 'AGMARKNET monthly report commodity code'),
  ('ca-tumcos-arecanut', 'commodity-arecanut', 'tumcos', 'Arecanut', 'verified', 'TUMCOS market-rate category label'),
  ('ca-tumcos-black-pepper', 'commodity-black-pepper', 'tumcos', 'Black Pepper', 'verified', 'TUMCOS market-rate category label');

CREATE TABLE variety_aliases_v2 (
  id TEXT PRIMARY KEY,
  commodity_id TEXT NOT NULL REFERENCES commodities(id),
  variety_id TEXT NOT NULL REFERENCES varieties(id),
  source_key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  mapping_status TEXT NOT NULL DEFAULT 'unverified' CHECK (mapping_status IN ('unverified', 'verified')),
  evidence TEXT,
  UNIQUE (commodity_id, source_key, source_name)
);
INSERT INTO variety_aliases_v2 (id, commodity_id, variety_id, source_key, source_name, mapping_status, evidence)
SELECT a.id, v.commodity_id, a.variety_id, a.source_key, a.source_name, a.mapping_status, 'Migrated from variety_aliases'
FROM variety_aliases a JOIN varieties v ON v.id = a.variety_id;
DROP TABLE variety_aliases;
ALTER TABLE variety_aliases_v2 RENAME TO variety_aliases;

-- Exact AGMARKNET labels map to themselves.
INSERT OR IGNORE INTO variety_aliases (id, commodity_id, variety_id, source_key, source_name, mapping_status, evidence)
SELECT 'va-' || s.source_key || '-' || v.code, v.commodity_id, v.id, s.source_key, v.canonical_name, 'verified', 'Exact AGMARKNET label'
FROM varieties v CROSS JOIN (SELECT 'agmarknet' AS source_key UNION ALL SELECT 'agmarknet_csv') s
WHERE v.commodity_id = 'commodity-arecanut' AND v.mapping_status = 'verified';
INSERT OR IGNORE INTO variety_aliases (id, commodity_id, variety_id, source_key, source_name, mapping_status, evidence)
SELECT 'va-agmarknet_monthly-' || v.code, v.commodity_id, v.id, 'agmarknet_monthly', v.canonical_name, 'verified', 'Exact AGMARKNET monthly report label'
FROM varieties v WHERE v.commodity_id = 'commodity-arecanut';
-- Cooperative labels that equal an AGMARKNET label case-insensitively. Unverified: the cooperative may define the
-- classification differently. Compound or unknown labels (e.g. RASHI EDI, HASA, MURI) are intentionally unmapped.
INSERT OR IGNORE INTO variety_aliases (id, commodity_id, variety_id, source_key, source_name, mapping_status, evidence)
SELECT 'va-' || m.column1 || '-' || v.code, v.commodity_id, v.id, m.column1, m.column2, 'unverified',
  'Case-insensitive label match; cooperative definition not confirmed'
-- VALUES columns: source key, source label, variety code.
FROM (VALUES ('tss', 'RASHI', 'rashi'), ('tss', 'CHALI', 'chali'), ('tss', 'BETTE', 'bette'), ('tss', 'KOLE', 'kole'), ('mamcos', 'BETTE', 'bette'), ('mamcos', 'CHALI', 'chali'), ('mamcos', 'GORABALU', 'gorabalu')) m
JOIN varieties v ON v.commodity_id = 'commodity-arecanut' AND v.code = m.column3;

-- ---------------------------------------------------------------------------
-- Markets and market/commodity coverage
-- ---------------------------------------------------------------------------
ALTER TABLE markets ADD COLUMN market_type TEXT NOT NULL DEFAULT 'apmc'
  CHECK (market_type IN ('apmc', 'cooperative_branch', 'private_auction', 'other'));

CREATE TABLE market_commodities (
  market_id TEXT NOT NULL REFERENCES markets(id),
  commodity_id TEXT NOT NULL REFERENCES commodities(id),
  source_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'observed' CHECK (status IN ('observed', 'configured')),
  first_recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (market_id, commodity_id, source_key)
);
INSERT OR IGNORE INTO market_commodities (market_id, commodity_id, source_key, status)
SELECT DISTINCT o.market_id, c.id, s.source_key, 'observed'
FROM market_price_observations o
JOIN data_sources s ON s.id = o.source_id
JOIN commodities c ON c.canonical_name = o.commodity_name;

-- ---------------------------------------------------------------------------
-- Price basis on existing observation tables (separate tables keep their own allowed bases)
-- ---------------------------------------------------------------------------
ALTER TABLE market_price_observations ADD COLUMN price_basis TEXT NOT NULL DEFAULT 'APMC_MODAL'
  CHECK (price_basis IN ('APMC_MODAL', 'APMC_MIN_MAX'));
ALTER TABLE cooperative_quotes ADD COLUMN price_basis TEXT NOT NULL DEFAULT 'COOPERATIVE_AVERAGE'
  CHECK (price_basis IN ('COOPERATIVE_AVERAGE', 'COOPERATIVE_TENDER_AVERAGE'));
UPDATE cooperative_quotes SET price_basis = 'COOPERATIVE_TENDER_AVERAGE' WHERE source_key = 'tss';

CREATE TRIGGER observation_price_basis_immutable
BEFORE UPDATE OF price_basis ON market_price_observations
WHEN NEW.price_basis != OLD.price_basis
BEGIN
  SELECT RAISE(ABORT, 'Price basis is immutable; ingest a corrected record instead');
END;

CREATE TRIGGER cooperative_price_basis_immutable
BEFORE UPDATE OF price_basis ON cooperative_quotes
WHEN NEW.price_basis != OLD.price_basis
BEGIN
  SELECT RAISE(ABORT, 'Price basis is immutable; ingest a corrected record instead');
END;

CREATE TRIGGER cooperative_price_basis_source_insert
BEFORE INSERT ON cooperative_quotes
WHEN (NEW.source_key = 'tss' AND NEW.price_basis != 'COOPERATIVE_TENDER_AVERAGE')
  OR (NEW.source_key != 'tss' AND NEW.price_basis != 'COOPERATIVE_AVERAGE')
BEGIN
  SELECT RAISE(ABORT, 'Cooperative price basis does not match the source');
END;

-- ---------------------------------------------------------------------------
-- Unified, read-only price observation view. Each row keeps its source table, original labels and price basis;
-- APMC modal and cooperative averages stay in separate columns and are never coalesced.
-- ---------------------------------------------------------------------------
CREATE VIEW price_observations AS
SELECT
  'market_price_observations' AS source_table,
  o.id AS observation_id,
  s.source_key,
  c.id AS commodity_id,
  c.code AS commodity_code,
  o.original_commodity_name AS original_commodity_label,
  o.market_id,
  m.name AS market_label,
  m.market_type AS market_kind,
  m.district,
  m.state,
  va.variety_id,
  o.variety_name AS variety_label,
  o.original_variety_name AS original_variety_label,
  va.mapping_status AS variety_mapping_status,
  gm.grade_id,
  o.grade AS grade_label,
  o.price_basis,
  o.original_unit,
  o.price_unit AS normalized_unit,
  o.reporting_date AS observation_date,
  o.minimum_price,
  o.maximum_price,
  o.modal_price,
  NULL AS average_price,
  o.arrival_quantity AS quantity,
  o.arrival_unit AS quantity_unit,
  o.validation_status,
  CASE WHEN o.validation_status = 'verified' AND m.mapping_status = 'verified' THEN 1 ELSE 0 END AS published,
  o.source_record_id,
  NULL AS source_url
FROM market_price_observations o
JOIN data_sources s ON s.id = o.source_id
JOIN markets m ON m.id = o.market_id
LEFT JOIN commodities c ON c.canonical_name = o.commodity_name
LEFT JOIN variety_aliases va ON va.commodity_id = c.id AND va.source_key = s.source_key AND va.source_name = o.original_variety_name
LEFT JOIN grade_mappings gm ON gm.commodity_id = c.id AND gm.source_key = s.source_key AND gm.source_label = o.grade
UNION ALL
SELECT
  'cooperative_quotes',
  q.id,
  q.source_key,
  c.id,
  c.code,
  q.commodity,
  NULL,
  q.branch,
  'cooperative_branch',
  NULL,
  NULL,
  va.variety_id,
  q.variety,
  q.variety,
  va.mapping_status,
  NULL,
  NULL,
  q.price_basis,
  COALESCE(q.source_unit_label, q.price_unit),
  CASE WHEN q.unit_status = 'source_confirmed' AND q.price_unit = 'INR/quintal' THEN 'INR/quintal' ELSE NULL END,
  q.reporting_date,
  q.minimum_price,
  q.maximum_price,
  NULL,
  q.average_price,
  q.reported_weight,
  CASE WHEN q.reported_weight IS NULL THEN NULL ELSE 'unconfirmed' END,
  q.status,
  CASE WHEN q.status = 'verified' THEN 1 ELSE 0 END,
  q.source_record_id,
  q.source_url
FROM cooperative_quotes q
LEFT JOIN commodities c ON c.code = q.commodity
LEFT JOIN variety_aliases va ON va.commodity_id = c.id AND va.source_key = q.source_key AND va.source_name = q.variety;
