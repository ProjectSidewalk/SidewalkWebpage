# The official multi-arch postgres image with Postgres and PostGIS from Postgres's own package server (PGDG). The
# postgis/postgis images are published for linux/amd64 only, so they cannot be built natively on Apple silicon (#5789),
# and the third-party multi-arch mirrors have gone stale; postgres:<major>-trixie is published for amd64 and arm64 and
# this is the same pattern the image used until 2025-05-27 (postgres:16 + apt). PG_MAJOR comes from the base image.
FROM postgres:18-trixie

# Prod's PostGIS minor; bump it when prod moves.
ARG POSTGIS_MINOR=3.6

# Server from PGDG too: its PostGIS can need a newer Postgres than the base image has (#5970). The archive keeps the
# pinned minor installable after PGDG's main list drops it; any other version fails the build.
# Nothing else is installed: gdal-bin (#5196) and pgrouting (#5197) aren't used.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && echo "deb [ signed-by=/usr/local/share/keyrings/postgres.gpg.asc ] https://apt-archive.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg-archive main" \
    > /etc/apt/sources.list.d/pgdg-archive.list \
  && printf 'Package: postgresql-*-postgis-3*\nPin: version %s.*\nPin-Priority: 1001\n\nPackage: postgresql-*-postgis-3*\nPin: version *\nPin-Priority: -1\n' "$POSTGIS_MINOR" \
    > /etc/apt/preferences.d/postgis \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    postgresql-$PG_MAJOR \
    postgresql-$PG_MAJOR-postgis-3 \
    postgresql-$PG_MAJOR-postgis-3-scripts \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
