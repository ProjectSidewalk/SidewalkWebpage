FROM postgis/postgis:16-3.5

ENV DEBIAN_FRONTEND=noninteractive

# The only thing this image adds to the base is the scoped Postgres upgrade below, and it reads nothing from Debian:
# `apt-get update` fetches only the PostgreSQL (pgdg) source list. Bullseye is past end-of-life, so Debian's indexes
# can expire (#5232), vanish from deb.debian.org, or 404 behind its Fastly edges (#5195), and none of that can break
# a build that never asks for them. `--no-install-recommends` keeps apt from reaching for a Debian-pool package that
# a pgdg package merely recommends.
#
# The base image lists apt.postgresql.org, which dropped bullseye at end-of-life, so the source is pointed at
# apt-archive.postgresql.org, where bullseye is frozen at its last builds (#5626). The grep fails the build here,
# instead of at a later 404, if a rebuilt base image ever words that line differently. Leaving the bullseye image for
# good is part of #3955.
#
# The upgrade names its two packages instead of running a blanket upgrade (#5176): they are all the base image
# actually holds back, pinned to the release docker-postgis generated it against, and republishing its tag does not
# move them. PostGIS is not on that list because pgdg carries no bullseye build past the 3.5.2 the base ships, so
# naming it would be a no-op that could later split it from its own -scripts package.
#
# Nothing else is installed, on purpose. PostGIS raster support links the libgdal28 the base image already ships,
# so gdal-bin is not needed (#5196): it is only the GDAL command-line tools, which nothing here calls, and it
# hard-depends on python3-gdal, which would drag a Python 3.9 stack out of debian-security. pgrouting is not
# needed either (#5197): no code calls a `pgr_*` function and no database this repo builds enables the extension.
#
# Retries go in apt.conf.d rather than in a `-o` flag, which would apply to a single invocation, so that they cover
# the package downloads and not just the index fetch.
RUN echo 'Acquire::Retries "3";' > /etc/apt/apt.conf.d/80-retries && \
  sed -i 's#https\?://apt\.postgresql\.org#https://apt-archive.postgresql.org#' /etc/apt/sources.list.d/pgdg.list && \
  grep -q 'apt-archive\.postgresql\.org' /etc/apt/sources.list.d/pgdg.list && \
  apt-get update -o Dir::Etc::sourcelist=sources.list.d/pgdg.list -o Dir::Etc::sourceparts=- \
    -o APT::Get::List-Cleanup=0 && \
  apt-get install -y --no-install-recommends --only-upgrade postgresql-16 postgresql-client-16 && \
  # Drop the cached .deb files and package lists, which would otherwise ship inside the image.
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

WORKDIR /opt
