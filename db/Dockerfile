FROM postgis/postgis:16-3.5

ENV DEBIAN_FRONTEND=noninteractive

# Upgrade the pgdg Postgres packages by themselves rather than running a blanket `apt-get upgrade` (#5176). The blanket
# upgrade pulled ~50 packages from deb.debian.org that this image never uses, so a transient mirror skew there — an
# index served by one CDN backend and pool contents by another — failed the build, and with it every CI job that needs
# the database. These two are all it was buying: the base image holds them at the release docker-postgis generated it
# against, and republishing its tag does not move that. PostGIS stays off the list on purpose — pgdg carries no
# bullseye build past the 3.5.2 the base ships, so naming it would be a no-op that could later split it from its own
# -scripts package. Retries go in apt.conf.d rather than in a `-o` flag, which would apply to one invocation, because
# the transient failures land on the package downloads rather than on the index fetch.
RUN echo 'Acquire::Retries "3";' > /etc/apt/apt.conf.d/80-retries && \
  apt-get update && \
  apt-get install -y --only-upgrade postgresql-16 postgresql-client-16 && \
  apt-get install -y postgresql-16-pgrouting gdal-bin && \
  # Drop the cached .deb files and package lists, which would otherwise ship inside the image.
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

WORKDIR /opt
