-- =============================================================================
-- The canonical authorization layer.
--
-- Every photo read in the application goes through the `visible_photos` view.
-- The rule lives here, in the database, exactly once — so there is one place to
-- audit and one place to fix, and no application query can accidentally express a
-- weaker rule.
--
-- Fail-closed by construction: the view resolves the viewer from a transaction-local
-- setting via `current_setting(..., true)`, which yields NULL when unset. A NULL
-- viewer matches no branch of the predicate, so a query that forgot to establish a
-- viewer returns ZERO rows — never all of them.
-- =============================================================================

-- --- Viewer accessors --------------------------------------------------------
-- STABLE + PARALLEL SAFE so the planner evaluates these once per statement and can
-- still parallelise scans over them.

CREATE OR REPLACE FUNCTION app_viewer_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('app.viewer_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_viewer_batch_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('app.viewer_batch_id', true), '')::uuid
$$;

-- --- The predicate -----------------------------------------------------------

CREATE OR REPLACE VIEW visible_photos AS
SELECT p.*
FROM photos p
WHERE
  -- A viewer must be established. Without this the whole predicate would still
  -- fail closed, but stating it makes the intent explicit and lets the planner
  -- short-circuit the entire scan.
      app_viewer_id() IS NOT NULL

  -- Soft-deleted photos are invisible to everyone, immediately, including their
  -- uploader. Recovery goes through the admin path, not the gallery.
  AND p.deleted_at IS NULL

  -- Still-uploading, processing, or failed photos never appear in the gallery.
  AND p.status = 'ready'

  -- Batch isolation. Even a valid session cannot reach another batch's archive.
  AND p.batch_id = app_viewer_batch_id()

  -- Defence in depth: a suspended or deactivated account sees nothing even if a
  -- session record somehow survived. Non-correlated, so Postgres evaluates it once
  -- per statement as an InitPlan rather than per row.
  AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = app_viewer_id()
          AND u.status = 'active'
          AND u.batch_id = app_viewer_batch_id()
      )

  AND (
        -- Visible to the whole batch.
        p.visibility = 'batch'

        -- The uploader always retains access to their own photo. This is also the
        -- only branch that can match a 'private' photo.
     OR p.uploader_id = app_viewer_id()

        -- Shared with one or more groups the viewer belongs to.
     OR (p.visibility = 'group' AND EXISTS (
           SELECT 1
           FROM photo_acl a
           JOIN group_members gm
             ON gm.group_id = a.principal_id
            AND gm.user_id  = app_viewer_id()
           WHERE a.photo_id = p.id
             AND a.principal_type = 'group'
         ))

        -- Shared with named individuals.
     OR (p.visibility = 'selected' AND EXISTS (
           SELECT 1
           FROM photo_acl a
           WHERE a.photo_id = p.id
             AND a.principal_type = 'user'
             AND a.principal_id = app_viewer_id()
         ))
      );

COMMENT ON VIEW visible_photos IS
  'Canonical photo-authorization boundary. Every member-facing read MUST go through '
  'this view. Querying the photos table directly bypasses access control and is only '
  'permitted in explicitly audited admin paths.';

-- --- Point check -------------------------------------------------------------
-- For "may this viewer fetch these bytes?" on the image-delivery route, where a
-- single yes/no is cheaper than materialising a row.

CREATE OR REPLACE FUNCTION can_view_photo(target uuid) RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT EXISTS (SELECT 1 FROM visible_photos WHERE id = target)
$$;

-- --- Full-text search --------------------------------------------------------
-- A stored generated column keeps the index in sync automatically; there is no way
-- to update a photo's text and forget to reindex it.
--
-- Search runs over `visible_photos`, never over `photos`, so the result set — and
-- therefore every count and every autocomplete suggestion derived from it — is
-- already permission-filtered.

ALTER TABLE photos ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(caption, '')),           'A') ||
    setweight(to_tsvector('english', coalesce(original_filename, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(location_text, '')),     'C') ||
    setweight(to_tsvector('english', coalesce(academic_year, '')),     'D') ||
    setweight(to_tsvector('english', coalesce(semester, '')),          'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS photos_search_idx ON photos USING GIN (search_vector);

-- --- Append-only audit log ---------------------------------------------------
-- The application role may INSERT and SELECT, never UPDATE or DELETE, so a
-- compromised application cannot rewrite its own history. Guarded so the migration
-- still runs on a local database that has no dedicated app role yet.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_user;
    GRANT INSERT, SELECT ON audit_logs TO app_user;
  END IF;
END $$;

-- Belt and braces: block rewrites at the table level, for every non-superuser role.
CREATE OR REPLACE FUNCTION audit_logs_are_append_only() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (attempted %)', TG_OP;
END $$;

DROP TRIGGER IF EXISTS audit_logs_no_mutate ON audit_logs;
CREATE TRIGGER audit_logs_no_mutate
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_append_only();
