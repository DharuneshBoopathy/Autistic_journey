# Security

This archive holds private photographs of real people. The stated priority order
for the project is:

> PRIVACY → SECURITY → DATA SAFETY → ACCESS CONTROL → PERFORMANCE → ORGANIZATION → UI

This document records what is actually enforced, and — just as importantly — what
is not. It makes no claim that cannot be pointed at in code.

## The authorization boundary

Every member-facing photo read goes through one SQL view, `visible_photos`
(`drizzle/0001_authorization.sql`). The rule exists exactly once.

It is **fail-closed by construction**. The view resolves the viewer from a
transaction-local setting via `current_setting('app.viewer_id', true)`, which
returns `NULL` when unset. Every branch of the predicate compares against that
value, so a query that forgets to establish a viewer returns **zero rows** — never
all of them. `withViewer()` in `src/db/index.ts` is the only supported way to
establish one, and it scopes the setting to the transaction so it cannot leak onto
the next request sharing a pooled connection.

A photo is visible when *all* of the following hold:

- it is not soft-deleted,
- its status is `ready`,
- it belongs to the viewer's batch,
- the viewer's account is `active`,

*and* at least one of: it is batch-visible; the viewer uploaded it; it is shared
with a group the viewer belongs to; or the viewer is named on it individually.

`private` photos match only via the uploader branch.

Because search, filters, counts and autocomplete all run over this view rather
than the `photos` table, a restricted photo cannot leak through a result count or
a suggestion — it is not in the result set to be counted.

Querying `photos` directly bypasses access control. That is legitimate only in
explicitly audited admin paths, and the view carries a `COMMENT` saying so.

Verified by `tests/authorization.sql`, which runs in CI against a real Postgres
and asserts the full visibility matrix, batch isolation, forged-batch-id attempts,
suspended and pending accounts, and the fail-closed cases.

## Other controls

| Control | Where |
|---|---|
| Argon2id password hashing | `@node-rs/argon2` |
| Opaque server-side sessions; only the token hash is stored | `sessions` table |
| Immediate revocation (suspension ends access now, not at token expiry) | session lookup |
| Registration gated by single-use expiring invite codes **and** admin approval | `invites`, `users.status` |
| Invite codes stored as SHA-256 — a database dump yields no usable codes | `invites.code_hash` |
| Append-only audit log; UPDATE/DELETE blocked by trigger and revoked from the app role | `audit_logs` |
| Parameterised queries everywhere; no string-built SQL | Drizzle + postgres.js |
| Storage keys generated server-side, never derived from user filenames | upload pipeline |
| HSTS, frame-ancestors none, nosniff, noindex on every route | `next.config.ts` |
| CSP with a per-request nonce (static headers cannot carry one) | `src/middleware.ts` |
| IP addresses hashed rather than stored raw | `sessions.ip_hash` |
| Secrets validated at boot; nothing secret is `NEXT_PUBLIC_` | `src/lib/env.ts` |

Private photo responses are served `private, no-store`. This deliberately inverts
the reference portfolio's rule, which cached images for a year in a shared cache —
correct for a public site, disastrous for this one.

## What is *not* security

Stated plainly, because the brief forbids fake security claims:

- **Right-click blocking and drag prevention are deterrents, not controls.**
  Anyone who can see a photo can screenshot it, use developer tools, or photograph
  their screen. These measures raise friction for casual copying and nothing more.
- **There is no such thing as screenshot prevention in a web browser.** This
  project does not implement it and will not claim it.
- **"View but not download" is enforced on the server** — originals are never sent
  to a normal member, and previews are served at reduced resolution — but a
  determined viewer can always keep a copy of what was displayed to them. The
  control is real; its limit is honest.
- **Metadata is only as private as the pipeline makes it.** GPS EXIF is stripped
  on ingest, but captions and tags are user-supplied and visible to everyone
  permitted to see the photo.

## Uploads

`src/lib/images.ts` is the only place untrusted bytes are inspected, and the most
exposed surface in the archive.

- **Format is decided by magic bytes, never by the extension or the declared
  Content-Type** — both are attacker-controlled. SVG is rejected outright: it is a
  document that can carry script, not a photograph.
- **Nothing is written anywhere until validation passes.** Because validation
  precedes storage, there is no window in which unvalidated bytes sit in the
  archive, and therefore no quarantine area to sweep.
- **A pixel ceiling (100 MP) stops decompression bombs** — a few kilobytes of PNG
  can otherwise describe an image that expands to gigabytes in the decoder.
- **Derivatives are re-encoded from decoded pixels**, which is what actually
  neutralises a polyglot: script smuggled into an original's trailing bytes does
  not survive being decoded and written back out as WebP. Members only ever
  receive derivatives.
- **All metadata is stripped from derivatives** — GPS, camera serial numbers,
  owner names. EXIF orientation is applied first, then discarded, so photos are
  not left sideways. Only the capture timestamp is lifted into the database; GPS
  is deliberately never extracted, so the archive cannot become a location log.
- **Storage keys are built from server-generated UUIDs**, never from the uploaded
  filename, which makes path traversal structurally impossible rather than
  something a sanitiser has to catch. The local driver additionally refuses any
  key that resolves outside its root.
- **Visibility defaults to `private`** when omitted or unrecognised. A photo never
  becomes batch-visible by accident.

Originals are stored byte-exact. The brief asks for originals to be *preserved*
and for polyglots to be *neutralised*, which pull in opposite directions — so the
two live on different paths: originals are kept untouched but unreachable
(members cannot download them; admin downloads are forced to
`Content-Disposition: attachment` with `nosniff`), and re-encoded derivatives are
the only bytes a browser ever renders.

Verified by `e2e/photos.spec.ts`, which uploads real images and then tries to
fetch them as the wrong person, and by `src/lib/images.test.ts`, which builds
actual polyglot and decompression-bomb files.

## Administration

Admin power is real but bounded.

- **It does not reach across batches.** Every admin query is scoped to the
  administrator's own `batch_id`, so an id from another batch resolves to nothing.
- **It cannot lock out the last administrator.** Suspending or demoting yourself is
  refused. That is a support call, not a security control.
- **There is deliberately no "browse every photo" listing.** Moderation acts on a
  photo someone reported, or an id an admin already holds. A general-purpose window
  onto every private photo in the archive would make the visibility model advisory,
  and no operational need requires it.
- **Admin routes answer 404, not 403**, to members. Probing should not reveal that
  the routes exist, let alone that the caller merely lacks the rank.
- Every approval, suspension, role change, invite, moderation action and original
  download is written to the append-only audit log, with the actor's address
  captured into the row so entries stay readable after an account is removed.

## Downloads

The default is unchanged: members receive derivatives, originals are admin-only.

`download_grants` is the documented exception — an admin can give **one member** a
**single-use**, **expiring** right to **one original**, with a stated reason. It
exists so that "someone needs the full-resolution file of one photo" does not get
solved by promoting them to admin, which is what happens in products that have no
mechanism for it.

The grant is consumed by a single atomic `UPDATE ... RETURNING`, not a SELECT
followed by an UPDATE: two concurrent requests must not both observe an unused grant
and both download. It is consumed before the bytes stream, so a failed transfer
costs the grant — re-issuing one is a message to an admin, whereas a grant that
survives its use is not single-use at all.

Admins do **not** mint grants for themselves; their role already authorises the
download. Requiring it would make the table a log of ceremony rather than a record
of exceptions.

## Storage quota

Free storage tiers do not degrade gracefully — once exhausted, writes fail with
something that reads like a transient fault, and the obvious response (retry) makes
it worse. `STORAGE_SOFT_QUOTA_BYTES` (default 9 GB, just under Cloudflare R2's 10 GB
free tier) refuses uploads *before* the provider does, with `507 Insufficient
Storage` and a sentence saying what happened.

It is a soft limit by design: it stops new uploads and never blocks reads, deletions
or anything else needed to free space. Usage is cached briefly to keep a bulk upload
from re-summing the archive hundreds of times — but a cached result that would
*refuse* an upload is always re-read first, because being briefly wrong in the
permissive direction costs a few megabytes against a deliberately low ceiling, while
being wrong in the blocking direction closes the archive to everyone. The purge sweep
invalidates the cache when it frees space.

## Server Actions are public endpoints

Every export of a `'use server'` module is compiled into a callable RPC endpoint
with a stable id, reachable by anyone who can reach the app. An exported helper
is therefore a public HTTP entry point, whatever its name suggests.

This bit us during development: `src/app/(auth)/actions.ts` re-exported
`revokeAllSessions(userId)` for convenience, which published "terminate every
session belonging to any user id you name" — with no session check of its own.
It was caught by the end-to-end suite, which noticed logout had silently broken.

The rules, now enforced by `src/lib/server-actions.test.ts`:

- Every export of a `'use server'` file must be an `async function` declared in
  that same file. No re-exports, no exported constants, no default export.
- An action must establish the caller's identity itself via `getSessionUser()`.
  It must never accept a user id as an argument — that is the caller naming whose
  account to act on, which is broken access control by construction.
- Server-side helpers live in `src/lib/` and are imported from there.

The guard is verified against the original bug: re-introducing the re-export
fails the suite.

## Known accepted findings

`npm audit` reports 4 moderate advisories, all one transitive dependency
(`esbuild` ≤0.24.2, via `@esbuild-kit/*` → `drizzle-kit`). The advisory concerns
esbuild's **development server** permitting cross-origin requests. `drizzle-kit`
is a command-line tool used to generate migrations; no esbuild dev server is ever
started, and the package is not part of the production runtime. Remediating it
would require downgrading `drizzle-kit` by thirteen minor versions. CI fails on
high and critical advisories, and reports moderates without blocking.

Upgraded away from at scaffold time, because both were directly relevant:
`drizzle-orm` <0.45.2 (SQL injection via unescaped identifiers) and `sharp`
<0.35.0 (libvips CVEs — `sharp` processes untrusted uploads, making it the single
most exposed dependency in the project).

## Reporting

Report suspected vulnerabilities privately to the repository owner. Please do not
open a public issue containing details of an access-control flaw.
