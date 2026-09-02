\set ON_ERROR_STOP on
\pset pager off
\set QUIET on

/*
 * Everything below runs inside a transaction that is ALWAYS rolled back.
 *
 * This suite needs a known-empty archive, but it shares a database with the
 * end-to-end suite, whose seeded accounts it would otherwise destroy — running the
 * two in either order used to break the second. Rolling back makes this suite
 * side-effect free: it can run before, after, or between anything else.
 *
 * ON_ERROR_STOP plus RAISE EXCEPTION in expect() means a failing assertion aborts
 * the transaction, so a failure cleans up just as thoroughly as a pass.
 */
BEGIN;

TRUNCATE audit_logs, photo_acl, photo_tags, album_photos, photo_derivatives,
         processing_jobs, download_grants, photos, group_members, groups,
         albums, tags, events, upload_batches, invites, sessions, users, batches
  RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------- fixtures ---
INSERT INTO batches (id, name, start_year, end_year) VALUES
  ('11111111-1111-1111-1111-111111111111', 'CSE 2021-2025', 2021, 2025),
  ('22222222-2222-2222-2222-222222222222', 'ECE 2021-2025', 2021, 2025);

INSERT INTO users (id, batch_id, email, password_hash, display_name, status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'alice@x', 'x', 'Alice', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'bob@x',   'x', 'Bob',   'active'),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'carol@x', 'x', 'Carol', 'active'),
  ('dddddddd-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'dave@x',  'x', 'Dave',  'active'),
  ('eeeeeeee-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'eve@x',   'x', 'Eve',   'active'),
  ('ffffffff-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'frank@x', 'x', 'Frank', 'suspended'),
  ('99999999-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'gwen@x',  'x', 'Gwen',  'pending');

-- Alice and Bob share a group. Carol and Dave do not.
INSERT INTO groups (id, batch_id, name, owner_id) VALUES
  ('67676767-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Hostel Block A', 'aaaaaaaa-0000-0000-0000-000000000001');
INSERT INTO group_members (group_id, user_id) VALUES
  ('67676767-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('67676767-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002');

-- Alice uploads one photo of each visibility, plus a deleted and a processing one.
INSERT INTO photos (id, batch_id, uploader_id, status, visibility, caption, deleted_at) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'ready',      'batch',    'P_batch',      NULL),
  ('00000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'ready',      'group',    'P_group',      NULL),
  ('00000000-0000-0000-0000-0000000000c3', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'ready',      'selected', 'P_selected',   NULL),
  ('00000000-0000-0000-0000-0000000000d4', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'ready',      'private',  'P_private',    NULL),
  ('00000000-0000-0000-0000-0000000000e5', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'ready',      'batch',    'P_deleted',    now()),
  ('00000000-0000-0000-0000-0000000000f6', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'processing', 'batch',    'P_processing', NULL);

-- Eve's own batch has a batch-wide photo, to prove batch isolation cuts both ways.
INSERT INTO photos (id, batch_id, uploader_id, status, visibility, caption) VALUES
  ('00000000-0000-0000-0000-0000000000a7', '22222222-2222-2222-2222-222222222222', 'eeeeeeee-0000-0000-0000-000000000005', 'ready', 'batch', 'P_otherbatch');

-- P_group is shared with the group; P_selected is shared with Carol only.
INSERT INTO photo_acl (photo_id, principal_type, principal_id) VALUES
  ('00000000-0000-0000-0000-0000000000a2', 'group', '67676767-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000c3', 'user',  'cccccccc-0000-0000-0000-000000000003');

-- ------------------------------------------------------------------ harness ---
CREATE OR REPLACE FUNCTION as_viewer(viewer text, batch text) RETURNS void
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.viewer_id',       coalesce(viewer, ''), true);
  PERFORM set_config('app.viewer_batch_id', coalesce(batch,  ''), true);
END $$;

CREATE OR REPLACE FUNCTION visible_as(viewer text, batch text) RETURNS text
  LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  PERFORM as_viewer(viewer, batch);
  SELECT coalesce(string_agg(caption, ',' ORDER BY caption), '(none)')
    INTO result FROM visible_photos;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION can_see(viewer text, batch text, target uuid) RETURNS text
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM as_viewer(viewer, batch);
  RETURN can_view_photo(target)::text;
END $$;

CREATE OR REPLACE FUNCTION expect(label text, got text, want text) RETURNS text
  LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM want THEN
    RETURN format('  PASS   %-34s %s', label, got);
  END IF;
  RAISE EXCEPTION E'FAIL   %\n         expected: %\n         actual:   %', label, want, got;
END $$;

\set QUIET off
\echo ''
\echo '=== Visibility matrix ==='
SELECT expect('alice (uploader)',   visible_as('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111'), 'P_batch,P_group,P_private,P_selected');
SELECT expect('bob (in group)',     visible_as('bbbbbbbb-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111'), 'P_batch,P_group');
SELECT expect('carol (selected)',   visible_as('cccccccc-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111'), 'P_batch,P_selected');
SELECT expect('dave (batch only)',  visible_as('dddddddd-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111'), 'P_batch');
SELECT expect('eve (own batch)',    visible_as('eeeeeeee-0000-0000-0000-000000000005','22222222-2222-2222-2222-222222222222'), 'P_otherbatch');

\echo ''
\echo '=== Excluded states (deleted / processing never appear above) ==='
SELECT expect('frank (suspended)',  visible_as('ffffffff-0000-0000-0000-000000000006','11111111-1111-1111-1111-111111111111'), '(none)');
SELECT expect('gwen (pending)',     visible_as('99999999-0000-0000-0000-000000000007','11111111-1111-1111-1111-111111111111'), '(none)');

\echo ''
\echo '=== Fail-closed ==='
SELECT expect('no viewer set',      visible_as(NULL, NULL), '(none)');
SELECT expect('viewer, no batch',   visible_as('aaaaaaaa-0000-0000-0000-000000000001', NULL), '(none)');
SELECT expect('empty-string viewer',visible_as('', ''), '(none)');
SELECT expect('unknown viewer uuid',visible_as('00000000-0000-0000-0000-0000000000ff','11111111-1111-1111-1111-111111111111'), '(none)');

\echo ''
\echo '=== Batch isolation / forged batch id ==='
SELECT expect('eve reaching batch 1', visible_as('eeeeeeee-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111'), '(none)');
SELECT expect('alice forging batch 2',visible_as('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222'), '(none)');

\echo ''
\echo '=== Point check: can_view_photo() (image byte delivery) ==='
SELECT expect('dave  -> P_private',  can_see('dddddddd-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000d4'), 'false');
SELECT expect('carol -> P_selected', can_see('cccccccc-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000c3'), 'true');
SELECT expect('dave  -> P_selected', can_see('dddddddd-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000c3'), 'false');
SELECT expect('bob   -> P_group',    can_see('bbbbbbbb-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a2'), 'true');
SELECT expect('carol -> P_group',    can_see('cccccccc-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000a2'), 'false');
SELECT expect('alice -> P_deleted',  can_see('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-0000000000e5'), 'false');
SELECT expect('no viewer -> P_batch',can_see(NULL, NULL,'00000000-0000-0000-0000-0000000000b1'), 'false');

\echo ''
\echo '=== Counts do not leak (COUNT over the view, not the table) ==='
SELECT expect('dave sees 1 of 6',    (SELECT visible_as('dddddddd-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111') IS NOT NULL)::text || (SELECT count(*)::text FROM visible_photos), 'true1');
SELECT expect('alice sees 4 of 6',   (SELECT visible_as('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111') IS NOT NULL)::text || (SELECT count(*)::text FROM visible_photos), 'true4');

\echo ''
\echo '=== A deleted group stops granting access ==='
-- Regression: the predicate once joined photo_acl straight to group_members without
-- looking at the groups row, so soft-deleting a group left every grant live while
-- the group vanished from the interface.
UPDATE groups SET deleted_at = now()
 WHERE id = '67676767-0000-0000-0000-000000000001';

SELECT expect('bob after group deleted',
  visible_as('bbbbbbbb-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111'),
  'P_batch');
SELECT expect('alice keeps her own photo',
  visible_as('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111'),
  'P_batch,P_group,P_private,P_selected');

UPDATE groups SET deleted_at = NULL
 WHERE id = '67676767-0000-0000-0000-000000000001';

SELECT expect('bob regains access when restored',
  visible_as('bbbbbbbb-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111'),
  'P_batch,P_group');

\echo ''
\echo '=== Audit log is append-only ==='
INSERT INTO audit_logs (action) VALUES ('test.event');
DO $$
BEGIN
  BEGIN
    UPDATE audit_logs SET action = 'tampered';
    RAISE EXCEPTION 'FAIL   audit_logs UPDATE was allowed';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM LIKE '%append-only%' THEN RAISE NOTICE '  PASS   UPDATE on audit_logs rejected';
    ELSE RAISE; END IF;
  END;
  BEGIN
    DELETE FROM audit_logs;
    RAISE EXCEPTION 'FAIL   audit_logs DELETE was allowed';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM LIKE '%append-only%' THEN RAISE NOTICE '  PASS   DELETE on audit_logs rejected';
    ELSE RAISE; END IF;
  END;
END $$;

\echo ''
\echo 'All authorization assertions passed.'
\echo ''

ROLLBACK;
