FROM postgis/postgis:16-3.5

ENV DEBIAN_FRONTEND=noninteractive

# This image only upgrades Postgres to its last bullseye release. Bullseye (the base image's Debian version) is past
# end-of-life, so:
# - Postgres's main package server dropped it; we point at their archive server instead (#5626). The grep stops the
#   build here if that swap didn't happen. Moving to a newer base image is #3955.
# - We download only Postgres's package list, never Debian's, whose old servers keep breaking builds (#5195, #5232).
#   `--no-install-recommends` keeps apt from wanting any Debian package either.
#
# Only these two packages are upgraded (#5176); the base image already has the newest bullseye PostGIS. Nothing else
# is installed: gdal-bin (#5196) and pgrouting (#5197) aren't used. Retries are set in a config file so they also
# cover the package downloads, not just the list download.
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
