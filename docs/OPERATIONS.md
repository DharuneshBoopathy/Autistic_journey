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

### Running it for nothing

Every path below costs $0 a month. All of them still want a card on file at signup
for identity, which is unavoidable — the distinction worth caring about is whether
the provider *can* bill you. On Oracle's Always Free tier it cannot: the resources
are hard-capped and you have to deliberately upgrade the account before any charge
becomes possible. A free object-storage tier, by contrast, bills you the moment you
exceed it.

**A free virtual machine, running the compose file.**

| | |
|---|---|
| Machine | Oracle Cloud **Always Free** — up to 4 ARM cores and 24 GB RAM, or Google Cloud's `e2-micro`, which is smaller but simpler to get |
| Database | Postgres in the compose file, on the same machine |
| Photos | the machine's disk — Oracle Always Free includes 200 GB of block storage, twenty times R2's free tier |
| TLS | Caddy, in the compose file, with a free Let's Encrypt certificate |
| Domain | yours |

That is the whole system on one machine that nobody charges you for, and it needs
no Cloudflare account at all.

```bash
# On the machine, once:
git clone <this repo> archive && cd archive
cp .env.example .env      # then edit it

docker compose run --rm migrate
ADMIN_PASSWORD='…' docker compose run --rm -e ADMIN_PASSWORD seed \
  --batch "CSE 2021-2025" --start 2021 --end 2025 \
  --email you@example.com --name "Your Name"
docker compose up -d
```

The `.env` needs, at minimum:

```
POSTGRES_PASSWORD=<long random string>
SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
APP_ORIGIN=https://archive.yourdomain.com
ARCHIVE_DOMAIN=archive.yourdomain.com
ARCHIVE_ACME_EMAIL=you@yourdomain.com
STORAGE_ALLOW_LOCAL_IN_PRODUCTION=true
STORAGE_SOFT_QUOTA_BYTES=161061273600   # 150 GB, if the volume is 200 GB
```

Point `ARCHIVE_DOMAIN` at the machine's public address **before** starting, and
open ports 80 and 443 in the provider's firewall as well as the machine's own —
Oracle's images ship with iptables closed, which is the single most common reason
a first deployment appears to hang. Let's Encrypt has to reach port 80 to issue the
certificate.

`STORAGE_ALLOW_LOCAL_IN_PRODUCTION=true` is a deliberate assertion, not a
formality. It says the disk survives the process *and* something copies it off the
machine. The backups above are that something — schedule them the same day you
deploy, not later. A free machine is exactly the kind that gets reclaimed, and 200
GB of photographs with no second copy is a single point of total loss.

**What the free tier actually costs you.** Oracle reclaims Always Free compute from
accounts that sit idle, so an archive nobody visits for weeks can be reaped; keep
the backups running off-machine and that becomes an inconvenience rather than a
disaster. You also administer a server: security updates, disk, the occasional
reboot. That is the real price, and it is paid in attention rather than money.

**The other free shape**, if you would rather not run a machine: a free PaaS web
service plus Neon's free Postgres plus R2's free 10 GB. It does not work as well —
free web tiers sleep after fifteen minutes and take the better part of a minute to
wake, and none of them run a second always-on process, so the worker has nowhere to
live and uploaded photos never gain the thumbnails that make them visible. Free
hosting can serve this app or process its uploads, not both.

### Railway, specifically

Both services build from the same `Dockerfile` in this repository; `railway.json`
carries the web service's defaults.

1. **New Project → Deploy from GitHub repo**, pointed at this repository and the
   branch you want live.
2. **Add a Postgres database** to the project. Railway injects `DATABASE_URL` into
   every service, so nothing has to be copied by hand.
3. **The web service** picks up `railway.json`: Dockerfile build, `node server.js`,
   health check on `/api/health`.
4. **Add a second service from the same repo** for the worker, and override its
   start command:

   ```
   node dist/worker/index.mjs
   ```

   It needs the same variables as the web service. It serves no traffic, so give it
   no domain and no health check.
5. **Variables**, on both services:

   | | |
   |---|---|
   | `SESSION_SECRET` | generated on your machine, not in a chat window |
   | `APP_ORIGIN` | `https://` and your domain — the app refuses to start otherwise |
   | `STORAGE_DERIVATIVES_DRIVER`, `STORAGE_ORIGINALS_DRIVER` | `r2` |
   | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | from Cloudflare |
   | `NODE_ENV` | `production` |

6. **Custom domain** on the web service. Railway issues the certificate; add the
   CNAME it gives you at your registrar. Set `APP_ORIGIN` to that address.
7. **Migrate and seed**, once, from your own machine:

   ```bash
   railway run --service web node dist/db/migrate.mjs
   ADMIN_PASSWORD='…' railway run --service web node dist/db/seed.mjs \
     --batch "CSE 2021-2025" --start 2021 --end 2025 \
     --email you@example.com --name "Your Name"
   ```

Expect roughly $5–10 a month for the three services together. The worker is small
but must stay awake: it is what turns an upload into something visible, and a
sleeping worker means photos that upload successfully and never appear.

### Why not Vercel

Two hard blocks, not preferences:

- **Uploads.** Vercel caps a serverless function's request body at 4.5 MB.
  `/api/upload` reads the whole multipart body server-side, and
  `MAX_UPLOAD_BYTES` is 50 MB, because a modern phone photo is regularly 4–12 MB.
  Most uploads would simply fail. The workaround — presigned direct-to-bucket
  uploads — would let a client write into storage without passing through the
  magic-byte check and the re-encode that neutralises polyglot files, which is a
  security regression, not a deployment detail.
- **The worker.** It is a long-running process, which Vercel does not host. Driving
  it from Vercel Cron instead caps out at once per day on the Hobby plan, so a
  photo uploaded on Monday would appear on Tuesday.

### Why not Render

Render is a good platform; it is this application's shape that does not fit its
free tier. Four things, in descending order of how fatal they are:

- **Free Postgres is deleted after 30 days.** The database is not a cache here —
  it holds every caption, every access-control row and the whole audit log. An
  archive meant to outlast a degree cannot live on a database that expires monthly.
  This one alone settles it.
- **There is no free background worker.** Free instance types cover web services
  and static sites; workers start at the paid tier. Co-locating the worker inside
  the web service would work around that, but see the next point.
- **Free web services sleep after 15 minutes idle** and take the better part of a
  minute to wake. For a gallery someone opens now and then, nearly every visit is a
  cold start — and a co-located worker sleeps with it.
- **No free persistent disk.** Free services have an ephemeral filesystem, so
  photographs would have to go to object storage, which puts a card back in the
  loop for something the free virtual machine above holds on its own 200 GB volume.

Paid, Render works fine and is pleasant to use — but it is three paid instances
for this shape (web, worker, database), which lands around four times Railway for
the same result.

Tiers and prices move. Check them before taking any of this on trust; the
structural points — no free worker, no free disk, an expiring free database — have
held for a long time, and they are the ones that decide it.

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
