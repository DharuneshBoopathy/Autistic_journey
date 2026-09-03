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
