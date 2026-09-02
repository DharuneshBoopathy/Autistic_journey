# The Autistic Journey / Gallery

A private, collaborative photo archive for one college batch — 1st Year through
Final Year. Batch members only.

> **Status: in development.** The security core (schema, authorization predicate,
> its test suite) is built and verified. Auth, upload, gallery and admin are in
> progress. Do not put real photographs in this yet.

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
| `npm run worker` | Image-processing worker |

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
