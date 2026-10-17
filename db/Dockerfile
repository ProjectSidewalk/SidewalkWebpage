# The official multi-arch postgres image plus PostGIS from Postgres's own package server (PGDG). The postgis/postgis
# images are published for linux/amd64 only, so they cannot be built natively on Apple silicon (#5789), and the
# third-party multi-arch mirrors have gone stale; postgres:<major>-trixie is published for amd64 and arm64 and this
# is the same pattern the image used before 2025-05 (postgres:16 + apt). PG_MAJOR comes from the base image.
FROM postgres:18-trixie

# Debian 13 with Postgres from the base image and PostGIS, GEOS and PROJ from PGDG; rebuild to update.
# Nothing else is installed: gdal-bin (#5196) and pgrouting (#5197) aren't used.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    postgresql-$PG_MAJOR-postgis-3 \
    postgresql-$PG_MAJOR-postgis-3-scripts \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
