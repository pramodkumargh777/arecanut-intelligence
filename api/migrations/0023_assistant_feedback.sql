-- Readers' thumbs up / down on assistant answers. One rating per answer; a later rating replaces the earlier one.
-- Only the rating is stored: no question text, and the client is identified by the same salted hash as the audit log.
CREATE TABLE assistant_feedback (
  interaction_id TEXT PRIMARY KEY REFERENCES assistant_interactions(id),
  rating INTEGER NOT NULL CHECK (rating IN (-1, 1)),
  client_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_assistant_feedback_created ON assistant_feedback(created_at);
