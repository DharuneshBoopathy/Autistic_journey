# Operations

Everything needed to run the archive, in the order you need it.

---

## Backups

### What is worth backing up, and what is not

| | Backed up | Why |
|---|---|---|
| **Database** | Yes | Captions, albums, groups, every access-control row, every session, and the audit log. It is the archive's memory; the photos without it are a pile of unlabelled files nobody is allowed to open. |
| **Originals** | Yes | The only irreplaceable bytes. |
| **Derivatives** (thumbnails, previews) | **No** | Regenerated from the originals by `npm run worker:drain`. Copying them would roughly triple the transfer to protect data a CPU can rebuild. |

A database dump is more sensitive than the photographs. It contains every password
hash and the whole audit log, so it is written `0600` and should be encrypted before
it leaves the machine.

### Taking a backup

```bash
# Database — daily.
BACKUP_AGE_RECIPIENT=age1... DATABASE_URL=postgres://... npm run backup:db

# Originals — after any significant upload, and weekly regardless.
DATABASE_URL=postgres://... npm run backup:originals -- --to /mnt/backup/originals
```

Encryption is opt-in and picked in this order:

- `BACKUP_AGE_RECIPIENT` — an age **public** key. Preferred: the server can write
  backups it cannot itself read, so stealing the machine does not hand over its own
  history. Keep the private key somewhere the server has never seen.
- `BACKUP_PASSPHRASE` — symmetric, via gpg. Simpler, but the key that opens every
  past backup is sitting in the environment that made them.
- Neither: the dump is written in the clear and the script says so loudly. Only
  reasonable when the destination is itself encrypted storage.

`BACKUP_KEEP` (default 14) controls how many dumps are retained. Each dump gets a
`.sha256` beside it, checked before any restore.

The originals backup is incremental — a file already present at the right size is
left alone — so the second run over 100k photos is cheap and an interrupted run can
simply be repeated. It writes `manifest.json` describing the whole directory, which
is what the restore reads. Anything the database references but storage does not
have is reported as `MISSING` and the run exits non-zero: silent loss is exactly
what a backup exists to surface.

The destination is a plain directory rather than another provider, deliberately. It
composes with whatever you already trust to hold a directory — rclone to a second
bucket, an external disk — instead of this repository growing a driver for each.

### Restoring

```bash
# Database, into a database you have deliberately named.
TARGET_DATABASE_URL=postgres://... BACKUP_AGE_IDENTITY=/path/to/key.txt \
  ./scripts/restore-db.sh /mnt/backup/db/autistic-journey-….dump.age --force

# Originals. Only ever adds; anything already in storage is left alone.
DATABASE_URL=postgres://... npm run restore:originals -- --from /mnt/backup/originals --dry-run
DATABASE_URL=postgres://... npm run restore:originals -- --from /mnt/backup/originals

# Rebuild the derivatives that were deliberately not backed up.
DATABASE_URL=postgres://... npm run worker:drain
```

`restore-db.sh` takes `TARGET_DATABASE_URL`, not `DATABASE_URL`, on purpose: the
common disaster is not a restore that fails but one that succeeds, into production,
on the wrong day. It refuses a database that already has tables unless `--force`.

`restore-originals` verifies every file against the digest in the manifest before
uploading it. A corrupted backup fails there rather than quietly replacing a good
original with a bad one.

### Proving it works

```bash
DATABASE_URL=postgres://... npm run backup:drill
```

A backup nobody has restored is a hypothesis. The drill takes a fresh dump, restores
it into a scratch database, checks the row counts match table by table, and then runs
the **full authorization suite against the restored copy** — because a restore that
brings back the rows but not the `visible_photos` view, its grants, or the
append-only audit trigger would look like a success and be a catastrophe.

It never writes to the live database and drops its scratch database afterwards. On
managed Postgres, where the role often cannot `CREATE DATABASE`, provision an empty
database and pass it as `DRILL_DATABASE_URL`.

Run it on a schedule, not just the day you set backups up.

### Suggested schedule

| When | What |
|---|---|
| Daily | `npm run backup:db`, off-machine |
| Weekly | `npm run backup:originals` |
| Monthly | `npm run backup:drill` |
| Before any migration | `npm run backup:db` |

### What is still not covered

- **Off-machine copying.** These scripts write to a directory. Getting that
  directory somewhere else — another provider, another building — is yours to
  arrange, and it is the half that survives a fire.
- **Point-in-time recovery.** Daily dumps mean up to a day of loss. If that matters,
  use a managed Postgres with PITR and treat these dumps as the second line.

---

## Deployment

Two processes and a database:

| | |
|---|---|
| **web** | `node server.js` — Next's standalone output |
| **worker** | `node dist/worker/index.mjs` — generates derivatives, purges expired photos, prunes sessions |
| **Postgres 16+** | Managed is the better default: it gives point-in-time recovery, which the dumps above cannot |

Both processes come from the same image. They share every dependency, so building
them separately would duplicate a hundred megabytes to save nothing.

### Before anything else

**HTTPS is not optional.** Session cookies use the `__Host-` prefix, which browsers
only accept over HTTPS, and `env.ts` refuses to start with a plain-http
`APP_ORIGIN` in production. Terminate TLS at a reverse proxy or a platform that
does it for you.

Generate the session secret on the machine that will hold it, never in a chat
window or a CI log:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Rotating `SESSION_SECRET` signs everyone out. That is the emergency lever if you
believe sessions have been stolen.

### Storage

Both drivers default to Cloudflare R2's free tier — 10 GB, zero egress, roughly
2,500 photos at 4 MB each. **The bucket must not have public access enabled.** Every
byte is served through an authorization-checked route; a public URL would be a way
around it.

`STORAGE_SOFT_QUOTA_BYTES` (default 9 GB) refuses uploads just below the tier limit
with an explanation, rather than letting the provider fail with something that looks
transient. The admin overview shows the headroom.

### First run

```bash
docker compose run --rm migrate
ADMIN_PASSWORD='…' docker compose run --rm -e ADMIN_PASSWORD seed \
  --batch "CSE 2021-2025" --start 2021 --end 2025 \
  --email you@example.com --name "Your Name"
docker compose up -d
```

Registration requires an invite and invites require an admin, so the first account
cannot come through the normal path — `seed` creates it from the command line, by
whoever controls the server. There is deliberately no "first user becomes admin"
rule: that is a well-known way to lose an archive to whoever finds it first.

`ADMIN_PASSWORD` is read from the environment so it never reaches shell history or
the process list.

Then sign in, issue an invite from **Admin → Invites**, and share the code. Each
registration still waits for approval.

### Migrations

Applied by an operator, as a job — never by a container starting up. Two instances
rolling out at once would otherwise race each other through the same migration.

```bash
docker compose run --rm migrate          # or: node dist/db/migrate.mjs
```

Take a database backup first. Always.

### Health

`GET /api/health` returns `{"status":"ok"}` or a 503, and deliberately nothing else
— no version, no hostname, no migration state. It is reachable without a session,
so anything it disclosed would be free reconnaissance.

It checks the database, because an instance that cannot reach Postgres can serve
that page and nothing else. Configuration is validated at startup by
`src/instrumentation.ts`, so a misconfigured instance exits instead of coming up
and answering every request with a 500 — which is what a rolling deploy needs in
order to stop and keep the previous version.

### Scheduling the housekeeping

The worker prunes sessions, requeues stalled jobs and runs the purge sweep on its
own, roughly every minute when idle. The backups are yours to schedule:

```cron
17 3 * * *  cd /srv/archive && ./scripts/backup-db.sh /mnt/backup/db
23 4 * * 0  cd /srv/archive && npm run backup:originals -- --to /mnt/backup/originals
41 5 1 * *  cd /srv/archive && npm run backup:drill
```

### Scaling

Several workers may run at once — jobs are claimed with `FOR UPDATE SKIP LOCKED`,
so no two take the same photo. Several web instances are fine too; sessions live in
Postgres, not in memory.

The timeline pages by keyset on `(taken_at, id)` against a matching partial index,
so page 500 costs the same as page 1. That is a design property, not a measured
one: this has not been run at the photo counts the brief describes.
