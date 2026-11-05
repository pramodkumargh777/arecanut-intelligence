-- 0013 declared every raw cooperative snapshot fully immutable, which also blocked the verified R2 offload
-- introduced in 0015. 0015 already enforces the replacement invariants:
--   cooperative_snapshot_no_rewrite      - an inline snapshot can never be changed to different content;
--   cooperative_snapshot_offload_guard   - it can be cleared only when a stored R2 copy with the same SHA-256 exists.
-- Dropping the blanket trigger therefore keeps evidence immutable while allowing the guarded offload.
DROP TRIGGER IF EXISTS cooperative_snapshot_immutable;
