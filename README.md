# The Autistic Journey / Gallery

A private, collaborative photo archive for one college batch — 1st Year through
Final Year. Batch members only.

> **Status: feature-complete for one batch, not yet operated in anger.** Schema,
> authorization, auth, upload, storage, visibility control, organisation,
> deletion/recovery, the admin surface and every screen are built and verified
> against a real Postgres and a real browser. What has *not* happened is a
> production deployment, a restore-from-backup drill, or any run at the photo
> counts the brief describes. Do not put irreplaceable photographs in this until
> backups are wired and tested.

## What it is

A Google-Photos-shaped archive — chronological timeline, albums, groups, events,
search — with access control as the first-class concern rather than an afterthought.

- **Private by default.** A photo with no explicit visibility is private, not
  batch-wide.
- **Four visibility states**, chosen per photo by its uploader: batch, group,
  selected individuals, or private.
- **View ≠ download.** Members view what they are permitted to see; only admins can
  download originals, and every such download is audited.
- **No AI features.** No facial recognition, auto-tagging, AI search or generated
  descriptions. This is deliberate and permanent.

Read [SECURITY.md](SECURITY.md) before contributing. It documents what is enforced
and, deliberately, what is *not* — including which anti-copying measures are
deterrents rather than controls.

## The screens

| | |
|---|---|
| `/gallery` | Chronological timeline, grouped by day, with permission-aware search and facets. Selection drives bulk visibility changes, album filing and deletion. |
| Photo viewer | Full-size preview with a detail panel: caption, visibility, and the group/person picker. What is editable is decided by the server, not by the page. |
| `/albums` | Albums as covers; an album is a grouping, never a grant, so counts are per-viewer. |
| `/groups` | Named sets of batch members, used as sharing targets. Membership changes take effect on the next request. |
| `/events` | Fests, trips, farewells. Anyone can add one; deleting is admin-only, because it detaches every photo filed under it. |
| `/upload` | Drag-and-drop with a four-at-a-time queue, per-file status and retry-only-failed. |
| `/trash` | Everything you deleted that is still inside the recovery window, with the days remaining. |
| `/admin` | Storage headroom, archive and queue counts, the approval queue, members, invites, processing failures, download grants and the audit log. |

Every one of these reads through the same SQL predicate as the API. There is no
second copy of the access rule in the browser: hiding a control is presentation,
and the server refuses the write regardless.

Tagging is the one write open to any member who can *see* a photo rather than only
its uploader — `tagPhoto` checks the photo against `visible_photos` for itself, so a
tag cannot be used to probe whether an id names a real photo. Tag suggestions come
from tags already on photos the viewer can see, never the whole tag table.

Every screen is laid out for a phone as well as a desk: below 860px the navigation
takes its own row, list rows put their content on a full line with the controls
beneath, and the timeline's filters collapse behind one control so the photos are
not pushed off the screen.

## Architecture

| | |
|---|---|
| Framework | Next.js (App Router), server-side authorization |
| Database | PostgreSQL + Drizzle |
| Derivatives (thumbnails, previews) | Cloudflare R2 — private bucket, hot path |
| Originals | Google Drive — cold, admin-download only |
| Processing | `sharp`, in a worker fed by a Postgres-backed job queue |
| Search | Postgres full-text, over the permission-filtered view |

The storage split exists because members never download originals — only admins
do. That makes originals genuinely cold, so they can live on cheap, slow storage
while the gallery serves small, regenerable derivatives from fast storage.

### Cost, honestly

Derivatives run ~130 KB per photo (20 KB thumbnail + 110 KB preview):

| Photos | Hot storage | R2 cost |
|---|---|---|
| 10,000 | 1.3 GB | free tier |
| 50,000 | 6.5 GB | free tier |
| 100,000 | 13 GB | ~$0.05/month |

Originals at ~4 MB average reach ~400 GB by 100k photos, which is why they go to
existing Drive storage rather than object storage.

**No free service will hold 400+ GB of private photos.** The most generous free
object-storage tiers top out around 25 GB. Anything advertising unlimited free
storage is either violating its terms of service or will not survive. Budget a few
dollars a month past ~50,000 photos.

### During development

Put both originals and derivatives on **Cloudflare R2's free tier** — 10 GB, zero
egress, roughly 2,500 photos at 4 MB each. Set `STORAGE_DERIVATIVES_DRIVER=r2` and
`STORAGE_ORIGINALS_DRIVER=r2`.

`STORAGE_SOFT_QUOTA_BYTES` (default 9 GB) refuses uploads just below the tier limit
with a clear message, rather than letting the provider fail with something that
looks transient. When the archive outgrows the free tier, move only the originals —
they are the bulk, and members never download them:
`STORAGE_ORIGINALS_DRIVER=gdrive`. No code changes; the adapters isolate it.

## Getting started

Requires Node 20+ and a PostgreSQL 16+ database.

```bash
npm install
cp .env.example .env.local     # then fill it in
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # SESSION_SECRET

npm run db:migrate
npm run dev
```

### Commands

| Command | |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` / `npm run typecheck` | Static checks |
| `npm test` | Unit tests |
| `./scripts/test-authz.sh` | **Authorization suite** — requires `DATABASE_URL` |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run worker` | Image-processing worker (long-running) |
| `npm run worker:drain` | Process the queue once and exit |
| `npm run worker:sweep` | Run housekeeping once (prune, purge) and exit |
| `npm run test:e2e` | Browser suite (Playwright) |

### Running it properly

The app and the worker are separate processes. Uploads are accepted by the app but
derivatives are rendered by the worker, so a photo stays in `processing` — and stays
invisible — until a worker runs:

```bash
npm run dev       # terminal 1
npm run worker    # terminal 2
```

### The authorization suite

The access-control rule lives in SQL, so it is tested in SQL — against the actual
view the application queries, not a mock of it:

```bash
DATABASE_URL=postgresql://... ./scripts/test-authz.sh
```

It asserts the full visibility matrix, batch isolation, forged batch ids, suspended
and pending accounts, soft-deleted and still-processing photos, permission-aware
counts, and the fail-closed cases. It runs in CI. **If you change anything about
visibility, this suite is the thing that must still pass.**

`e2e/photos.spec.ts` is its companion at the HTTP layer: it uploads real images,
processes them, and then tries to fetch the bytes as the wrong person. A gallery
that hides a photo from the grid but still serves it to anyone holding the URL has
protected nothing, so that path is tested directly.

## Contributing

- Never query the `photos` table directly in a member-facing path. Use
  `visible_photos` via `withViewer()`.
- Never put a secret in a `NEXT_PUBLIC_` variable — that prefix inlines it into
  the client bundle.
- Never build SQL by string concatenation.
- Add an audit log entry for any action that changes access, visibility, or
  account state.

## Credits

The visual language derives from the MIT-licensed
[portfolio-itom](https://github.com/ITomPoland/portfolio-itom) by Tomasz Szmajda.
Presentation patterns only — none of that project's assets, imagery or branding
are used here. See [NOTICE](NOTICE).
