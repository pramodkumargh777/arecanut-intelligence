ALTER TABLE trade_records ADD COLUMN direction TEXT NOT NULL DEFAULT 'Import' CHECK(direction IN ('Import','Export'));
