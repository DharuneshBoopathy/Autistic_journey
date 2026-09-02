-- =============================================================================
-- A deleted group must stop granting access.
--
-- Found by the organisation test suite, which deleted a group and then confirmed a
-- member of it could STILL fetch a photo shared with that group.
--
-- The predicate joined `photo_acl` to `group_members` and never looked at the
-- `groups` row itself, so soft-deleting a group left every membership intact and
-- every grant live. The group vanished from the interface while continuing to do its
-- job — the worst shape a hole like this can take, because nothing looks wrong.
--
-- The fix joins `groups` and requires `deleted_at IS NULL`. Deleting a group now
-- narrows access, which is the only acceptable direction for that operation to fail.
-- =============================================================================

CREATE OR REPLACE VIEW visible_photos AS
SELECT p.*
FROM photos p
WHERE
      app_viewer_id() IS NOT NULL
  AND p.deleted_at IS NULL
  AND p.status = 'ready'
  AND p.batch_id = app_viewer_batch_id()

  AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = app_viewer_id()
          AND u.status = 'active'
          AND u.batch_id = app_viewer_batch_id()
      )

  AND (
        p.visibility = 'batch'

     OR p.uploader_id = app_viewer_id()

        -- Shared with a group the viewer belongs to, and which still exists.
     OR (p.visibility = 'group' AND EXISTS (
           SELECT 1
           FROM photo_acl a
           JOIN groups g
             ON g.id = a.principal_id
            AND g.deleted_at IS NULL
            AND g.batch_id = p.batch_id
           JOIN group_members gm
             ON gm.group_id = a.principal_id
            AND gm.user_id  = app_viewer_id()
           WHERE a.photo_id = p.id
             AND a.principal_type = 'group'
         ))

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
