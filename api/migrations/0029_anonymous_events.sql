CREATE TABLE IF NOT EXISTS anonymous_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, event_name TEXT NOT NULL, page_path TEXT, page_type TEXT,
 variety_key TEXT, channel TEXT, anonymous_id TEXT, utm_source TEXT, utm_medium TEXT,
 utm_campaign TEXT, utm_content TEXT, utm_term TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_anon_event_name_date ON anonymous_events(event_name,created_at);
CREATE INDEX IF NOT EXISTS idx_anon_event_date ON anonymous_events(created_at);
