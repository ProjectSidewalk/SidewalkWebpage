FROM postgis/postgis:18-3.6

# The base image is Debian 13 (trixie) with Postgres, PostGIS, GEOS and PROJ from Postgres's own package server, so it
# gets updates by rebuilding; nothing needs installing on top (#3955). gdal-bin (#5196) and pgrouting (#5197) aren't
# used.
WORKDIR /opt
