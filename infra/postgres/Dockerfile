# PostgreSQL 18 with pgBackRest for WAL archiving and base backups (TDD §11.4).
FROM postgres:18
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /var/log/pgbackrest /var/spool/pgbackrest /tmp/pgbackrest \
 && chown -R postgres:postgres /var/log/pgbackrest /var/spool/pgbackrest /tmp/pgbackrest
COPY pgbackrest.conf /etc/pgbackrest/pgbackrest.conf
COPY postgresql.conf /etc/postgresql/postgresql.conf
COPY --chmod=755 backup-loop.sh /usr/local/bin/backup-loop.sh
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
