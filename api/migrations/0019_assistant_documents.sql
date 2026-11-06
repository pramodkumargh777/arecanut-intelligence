-- ANI AI Intelligence Assistant: document corpus, hybrid retrieval index, interaction audit and request limits.
-- Purely additive. No existing table is altered.

-- One row per ingested source document (CPCRI publication, DASD report, government notification, research paper).
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN
    ('cpcri_publication', 'dasd_report', 'government_notification', 'agricultural_research')),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'kn', 'hi', 'ml', 'mixed')),
  source_url TEXT NOT NULL,
  -- Date printed on or attached to the publication; NULL when the source does not state one.
  publication_date TEXT,
  -- What the date above means: 'stated' (on the document), 'page_metadata' (web page), or NULL.
  publication_date_basis TEXT CHECK (publication_date_basis IS NULL OR publication_date_basis IN ('stated', 'page_metadata')),
  mime_type TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  page_count INTEGER,
  reuse_note TEXT,
  -- Optional link to an R2 evidence object (archive_objects.id) when the original file is archived.
  archive_object_id TEXT,
  fetched_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  ingestion_job_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  UNIQUE (source_url, content_sha256)
);
CREATE INDEX idx_documents_type ON documents(document_type, status);

CREATE TABLE document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  chunk_index INTEGER NOT NULL,
  page_from INTEGER,
  page_to INTEGER,
  heading TEXT,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 6000),
  text_sha256 TEXT NOT NULL CHECK (length(text_sha256) = 64),
  language TEXT NOT NULL DEFAULT 'en',
  -- Dense embedding (optional). Stored int8-quantised, L2-normalised, base64-encoded to keep D1 reads small.
  embedding_model TEXT,
  embedding_dim INTEGER,
  embedding_q8 TEXT,
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX idx_document_chunks_document ON document_chunks(document_id, chunk_index);
CREATE INDEX idx_document_chunks_embedding ON document_chunks(embedding_model) WHERE embedding_q8 IS NOT NULL;

-- Keyword index. Derived data: rebuild with POST /admin/documents/reindex. D1 cannot export databases that contain
-- virtual tables, so backups drop this table first and recreate it afterwards (docs/DATA_RETENTION_AND_BACKUP.md).
CREATE VIRTUAL TABLE document_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  title,
  heading,
  text,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Assistant audit trail. The question is kept (bounded) for quality review; the client is stored only as a salted hash.
CREATE TABLE assistant_interactions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  language TEXT NOT NULL,
  question TEXT NOT NULL CHECK (length(question) <= 1000),
  intents TEXT NOT NULL,
  tools TEXT NOT NULL,
  tool_statuses TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  llm_status TEXT NOT NULL,
  grounding_status TEXT NOT NULL,
  injection_flags TEXT NOT NULL DEFAULT '[]',
  duration_ms INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX idx_assistant_interactions_created ON assistant_interactions(created_at);

-- Fixed-window request counters (Workers have no shared memory; D1 provides the shared counter).
CREATE TABLE assistant_rate_limits (
  client_hash TEXT NOT NULL,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (client_hash, window_start)
);
