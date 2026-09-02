import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/*
 * ID scheme: random UUIDv4 everywhere that is reachable from a URL.
 *
 * Sequential integers would let anyone who obtains one id infer the archive's size
 * and walk neighbouring records. Authorization is still enforced on every read —
 * unguessable ids are defence in depth, never the control itself. The timeline sorts
 * on (taken_at, id), so the id's lack of time-ordering costs nothing.
 */

// --- Enums -------------------------------------------------------------------

export const userRole = pgEnum('user_role', ['member', 'moderator', 'admin']);
export const userStatus = pgEnum('user_status', ['pending', 'active', 'suspended', 'deactivated']);
export const photoStatus = pgEnum('photo_status', ['uploading', 'processing', 'ready', 'failed']);

/**
 * Photo visibility. The default is the most restrictive value on purpose: a row that
 * somehow reaches the table without an explicit choice is private, not batch-wide.
 */
export const visibility = pgEnum('visibility', ['batch', 'group', 'selected', 'private']);

export const derivativeKind = pgEnum('derivative_kind', ['thumb', 'preview']);
export const aclPrincipal = pgEnum('acl_principal', ['user', 'group']);
export const jobState = pgEnum('job_state', ['queued', 'running', 'succeeded', 'failed']);
export const campusZone = pgEnum('campus_zone', ['campus', 'hostel', 'off_campus', 'unknown']);
export const groupRole = pgEnum('group_role', ['owner', 'admin', 'member']);

// --- Batches -----------------------------------------------------------------

export const batches = pgTable('batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  startYear: integer('start_year').notNull(),
  endYear: integer('end_year').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Users -------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'restrict' }),

    // Stored already lower-cased and trimmed; see normalizeEmail() at the boundary.
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),

    role: userRole('role').notNull().default('member'),
    status: userStatus('status').notNull().default('pending'),

    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),

    // Brute-force controls. `lockedUntil` is checked before any password comparison.
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    index('users_batch_status_idx').on(t.batchId, t.status),
  ],
);

// --- Invites -----------------------------------------------------------------

/**
 * Invite codes are stored only as a SHA-256 hash. A database dump therefore does not
 * yield usable codes, and the plaintext exists exactly once — in the response to the
 * admin who created it.
 */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codeHash: text('code_hash').notNull(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),

    // Optionally bind an invite to one address, so a leaked code is useless elsewhere.
    email: text('email'),
    roleGranted: userRole('role_granted').notNull().default('member'),

    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    maxUses: integer('max_uses').notNull().default(1),
    useCount: integer('use_count').notNull().default(0),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invites_code_hash_key').on(t.codeHash), index('invites_batch_idx').on(t.batchId)],
);

// --- Sessions ----------------------------------------------------------------

/**
 * Server-side opaque sessions. The cookie carries a random token; only its hash is
 * stored, so a leaked database cannot be replayed as a live session. Chosen over
 * self-contained JWTs specifically because revocation must be immediate — an admin
 * suspending a member has to end their access now, not at token expiry.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),

    // IPs are hashed, not stored raw: enough to spot session hijacking, without
    // building a location log of the batch's members.
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

// --- Events / Albums / Groups / Tags -----------------------------------------

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    academicYear: text('academic_year'),
    startsOn: timestamp('starts_on', { withTimezone: true }),
    endsOn: timestamp('ends_on', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('events_batch_idx').on(t.batchId, t.startsOn)],
);

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('groups_batch_idx').on(t.batchId)],
);

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: groupRole('role').notNull().default('member'),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    // Load-bearing: the authorization predicate resolves "which groups is the viewer
    // in" on every single photo read. This index is what keeps that cheap.
    index('group_members_user_idx').on(t.userId, t.groupId),
  ],
);

export const albums = pgTable(
  'albums',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    visibility: visibility('visibility').notNull().default('private'),
    coverPhotoId: uuid('cover_photo_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('albums_batch_idx').on(t.batchId)],
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tags_batch_name_key').on(t.batchId, t.name)],
);

// --- Upload batches ----------------------------------------------------------

export const uploadBatches = pgTable(
  'upload_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    note: text('note'),
    total: integer('total').notNull().default(0),
    succeeded: integer('succeeded').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('upload_batches_user_idx').on(t.userId, t.createdAt)],
);

// --- Photos ------------------------------------------------------------------

export const photos = pgTable(
  'photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'restrict' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    uploadBatchId: uuid('upload_batch_id').references(() => uploadBatches.id, { onDelete: 'set null' }),

    status: photoStatus('status').notNull().default('uploading'),
    visibility: visibility('visibility').notNull().default('private'),

    // Storage references. Keys are opaque and generated server-side — never derived
    // from a user-supplied filename, which is what makes path traversal impossible.
    originalKey: text('original_key'),
    originalDriver: text('original_driver'),
    originalBytes: bigint('original_bytes', { mode: 'number' }),
    sha256: text('sha256'),

    mime: text('mime'),
    width: integer('width'),
    height: integer('height'),

    // Original client filename, kept for display and search only. Never used to build
    // a storage path.
    originalFilename: text('original_filename'),

    takenAt: timestamp('taken_at', { withTimezone: true }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),

    academicYear: text('academic_year'),
    semester: text('semester'),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    locationText: text('location_text'),
    campusZone: campusZone('campus_zone').notNull().default('unknown'),
    caption: text('caption'),

    // Per-photo override. Even when true, delivery is still authorization-checked and
    // audited; this only widens who *may* request an original.
    downloadAllowed: boolean('download_allowed').notNull().default(false),

    processingError: text('processing_error'),

    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /*
     * The timeline index. Every gallery page is a keyset scan of
     * (batch_id, taken_at DESC, id DESC) over live, ready rows — the partial WHERE
     * keeps soft-deleted and still-processing rows out of the index entirely, which
     * matters at 100k+ photos.
     */
    index('photos_timeline_idx')
      .on(t.batchId, t.takenAt.desc(), t.id.desc())
      .where(sql`deleted_at IS NULL AND status = 'ready'`),

    index('photos_uploader_idx').on(t.uploaderId, t.takenAt.desc()),
    index('photos_event_idx').on(t.eventId).where(sql`event_id IS NOT NULL`),
    index('photos_sha256_idx').on(t.batchId, t.sha256).where(sql`sha256 IS NOT NULL`),

    // Admin views: find stuck/failed work and pending purges.
    index('photos_status_idx').on(t.status).where(sql`status <> 'ready'`),
    index('photos_purge_idx').on(t.purgeAfter).where(sql`deleted_at IS NOT NULL`),
  ],
);

export const photoDerivatives = pgTable(
  'photo_derivatives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    kind: derivativeKind('kind').notNull(),
    storageKey: text('storage_key').notNull(),
    driver: text('driver').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('photo_derivatives_photo_kind_key').on(t.photoId, t.kind)],
);

/**
 * Per-photo access grants, for the `group` and `selected` visibility states.
 * `principalId` points at either users.id or groups.id depending on `principalType`;
 * it is deliberately not a foreign key, because it targets two different tables.
 */
export const photoAcl = pgTable(
  'photo_acl',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    principalType: aclPrincipal('principal_type').notNull(),
    principalId: uuid('principal_id').notNull(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('photo_acl_unique').on(t.photoId, t.principalType, t.principalId),
    // Load-bearing: this is the lookup direction the authorization predicate uses.
    index('photo_acl_principal_idx').on(t.principalType, t.principalId, t.photoId),
  ],
);

export const albumPhotos = pgTable(
  'album_photos',
  {
    albumId: uuid('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.albumId, t.photoId] }),
    index('album_photos_order_idx').on(t.albumId, t.position),
  ],
);

export const photoTags = pgTable(
  'photo_tags',
  {
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.photoId, t.tagId] }), index('photo_tags_tag_idx').on(t.tagId)],
);

// --- Processing queue --------------------------------------------------------

/**
 * A Postgres-backed job queue. Deliberately not Redis/SQS: at this scale the volume
 * is low, and keeping jobs in the same transactional store as the photo row means a
 * job can never reference a photo that was rolled back.
 */
export const processingJobs = pgTable(
  'processing_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    state: jobState('state').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lastError: text('last_error'),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('processing_jobs_claim_idx').on(t.runAfter).where(sql`state = 'queued'`),
    index('processing_jobs_photo_idx').on(t.photoId),
  ],
);

// --- Audit log ---------------------------------------------------------------

/**
 * Append-only. The migration revokes UPDATE and DELETE on this table from the
 * application role, so a compromised app cannot rewrite its own tracks.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_created_idx').on(t.createdAt.desc()),
    index('audit_logs_actor_idx').on(t.actorId, t.createdAt.desc()),
    index('audit_logs_target_idx').on(t.targetType, t.targetId),
  ],
);

// --- Download grants ---------------------------------------------------------

/**
 * An explicit, expiring, single-use permission to fetch an original. Every admin
 * download mints one of these, so "who took a copy of what, and when" is answerable.
 */
export const downloadGrants = pgTable(
  'download_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('download_grants_user_idx').on(t.userId, t.photoId)],
);

// --- Rate limiting -----------------------------------------------------------

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
});
