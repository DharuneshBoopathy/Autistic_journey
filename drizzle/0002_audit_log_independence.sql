-- =============================================================================
-- Decouple the audit log from the users table.
--
-- Found by the end-to-end suite: deleting a user raised
--   "audit_logs is append-only (attempted UPDATE)"
--
-- `audit_logs.actor_id` carried ON DELETE SET NULL, so removing a user made
-- Postgres try to rewrite that user's audit rows — which the append-only trigger
-- correctly refused. The two rules were in direct conflict, and the effect was that
-- no account with any recorded activity could ever be deleted.
--
-- The append-only rule is the one worth keeping. An audit log records what happened
-- at a point in time; it is a historical fact, not a view over current state, and it
-- should not change because a row elsewhere was removed. So the foreign key goes.
--
-- The cost is that `actor_id` may now reference a user who no longer exists. That is
-- acceptable and expected for an audit trail — and to keep entries readable after
-- the fact, the actor's email and display name are captured into `metadata` at write
-- time, so a purged account still leaves an intelligible record.
-- =============================================================================

ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actor_id_users_id_fk";

COMMENT ON COLUMN audit_logs.actor_id IS
  'The acting user at the time of the event. Intentionally NOT a foreign key: audit '
  'rows are immutable historical facts and must survive deletion of the account. May '
  'reference a user that no longer exists; see metadata for a captured identity.';
