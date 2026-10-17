# imresamu/postgis is the PostGIS Docker maintainers' multi-arch build of the same Dockerfiles. The official
# postgis/postgis images are published for linux/amd64 only, so the official tag cannot be built natively on Apple
# silicon (#5789). Same Debian 13 (trixie) base, same packages; keep the suffix so a bookworm/alpine variant is never
# picked up by accident.
FROM imresamu/postgis:18-3.6-trixie

# Debian 13 with Postgres, PostGIS, GEOS and PROJ from Postgres's own package server; rebuild to update.
# Nothing else is installed: gdal-bin (#5196) and pgrouting (#5197) aren't used.
WORKDIR /opt
