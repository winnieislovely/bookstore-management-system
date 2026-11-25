# Restore from backup

Use when the database is lost or corrupted, or to recover to a point in time before a mistake
(TDD §11.4; RTO 4 hours, RPO 15 minutes). The POS keeps selling offline for up to 72 hours while
you work; do not revoke devices.

Two people should be present: one runs the commands, one checks each step. Note every time and
command in the incident log.

## 0. Decide the target

- **Latest**: recover everything up to the newest archived WAL (database lost).
- **Point in time**: choose a time just before the mistake, in UTC, e.g. `2026-11-02 03:14:00+00`.

## 1. Stop writers

```bash
cd /opt/bookstore
docker compose -f infra/docker-compose.yml stop caddy api worker backup
```

## 2. Check what backups exist

```bash
docker compose -f infra/docker-compose.yml run --rm --user postgres --entrypoint pgbackrest backup --stanza=bookstore info
```

Confirm the last full/diff backup and the WAL range cover your target.

## 3. Restore

Every `run` below needs **`--no-deps`**: the `backup` service depends on `postgres`, and without it
Compose starts PostgreSQL again while its data directory is being moved and restored.

```bash
docker compose -f infra/docker-compose.yml stop postgres
# Keep the damaged data directory until the restore is verified.
docker compose -f infra/docker-compose.yml run --rm --no-deps --user root --entrypoint bash backup -c \
  'mv /var/lib/postgresql/18/docker /var/lib/postgresql/18/docker.broken-$(date +%s); mkdir -p /var/lib/postgresql/18/docker; chown postgres:postgres /var/lib/postgresql/18/docker; chmod 700 /var/lib/postgresql/18/docker'
# Check PostgreSQL is still stopped (State: exited) before restoring:
docker compose -f infra/docker-compose.yml ps -a postgres
# Latest:
docker compose -f infra/docker-compose.yml run --rm --no-deps --user postgres --entrypoint pgbackrest backup --stanza=bookstore restore
# Or point in time:
docker compose -f infra/docker-compose.yml run --rm --no-deps --user postgres --entrypoint pgbackrest backup --stanza=bookstore \
  --type=time "--target=2026-11-02 03:14:00+00" --target-action=promote restore
```

A warning `unknown group 'root' in backup manifest mapped to current group` is harmless.

## 4. Start and verify

```bash
docker compose -f infra/docker-compose.yml up -d postgres
docker compose -f infra/docker-compose.yml exec postgres psql -U bookstore -c "select max(sold_at) from sales.sale"
```

- The last sale time matches the target.
- Start the stack: `docker compose -f infra/docker-compose.yml up -d` (migrate runs first).
- In the staff app open **Cài đặt → Sao lưu & dữ liệu**: database OK, WAL archiving resumes
  within a few minutes. Request a manual backup and wait for it to succeed.
- The nightly `integrity.check` job (02:30) must log no drift; check `docker compose -f infra/docker-compose.yml logs worker` the next morning.
- POS devices reconnect and upload their outbox; review the sync exceptions in **Cài đặt → Quầy & máy bán hàng**.

Drill on 25 Nov 2026 (local copy of the production stack): point-in-time restore to a chosen
second kept the record made before it and dropped the one made after; the stack started on the
new timeline and the next manual backup succeeded. Steps 1–4 took about five minutes on a
4 MB database.

## 5. New server (disaster)

1. Provision the VPS from `infra/cloud-init` (Ubuntu LTS, Docker, firewall 80/443/SSH).
2. Copy `/etc/bookstore/.env` from the password manager (the backup cipher passphrase is there).
3. `git clone` the repository at the released tag, `docker compose -f infra/docker-compose.yml build`.
4. Start only `postgres` and `backup`, then follow steps 2–4 above.
5. Repoint DNS of `SITE_DOMAIN` to the new server; Caddy obtains certificates on first request.

## Weekly logical copy

The weekly `pg_dump` in `DUMP_HOST_DIR` is a last resort (no point-in-time recovery):

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_CIPHER_PASS -in bookstore-YYYYMMDD.dump.enc \
  | pg_restore -d bookstore --clean --if-exists
```
