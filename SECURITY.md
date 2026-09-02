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
| CSP, HSTS, frame-ancestors none, nosniff, noindex on every route | `next.config.ts` |
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
