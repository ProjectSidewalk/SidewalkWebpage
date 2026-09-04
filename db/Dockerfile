FROM postgis/postgis:16-3.5

ENV DEBIAN_FRONTEND=noninteractive

# Upgrade postgresql-16 by itself rather than running a blanket `apt-get upgrade` (#5176). The blanket upgrade pulled
# ~50 packages from deb.debian.org that this image never uses, so a transient mirror skew there — an index served by
# one CDN backend and pool contents by another — failed the build, and with it every CI job that needs the database.
# This single package comes from apt.postgresql.org instead, and it is the only thing the upgrade was buying: the base
# image holds postgresql-16 at the release it was generated against, and republishing its tag does not move that.
RUN apt-get -o Acquire::Retries=3 update && \
  apt-get install -y --only-upgrade postgresql-16 && \
  apt-get install -y postgresql-16-pgrouting gdal-bin && \
  # Drop the cached .deb files and package lists, which would otherwise ship inside the image.
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

WORKDIR /opt
