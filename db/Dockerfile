FROM postgis/postgis:16-3.5

ENV DEBIAN_FRONTEND=noninteractive

# The only thing this image adds to the base is the scoped Postgres upgrade below, and every package file it fetches
# comes from apt.postgresql.org; deb.debian.org is touched only for repository indexes (#5195). That matters because
# the Debian pool sits behind Fastly edges that intermittently 404 a file their own freshly-fetched index advertises,
# and a build that pulls no package files from there cannot lose that lottery. Retrying only re-rolls it, since apt
# retries against the same edge.
#
# `--no-install-recommends` is what keeps that true. Recommends are installed by default and a pgdg package can
# recommend one that lives in the Debian pool, so without the flag any package added here could quietly reopen the
# failure class.
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
  apt-get update && \
  apt-get install -y --no-install-recommends --only-upgrade postgresql-16 postgresql-client-16 && \
  # Drop the cached .deb files and package lists, which would otherwise ship inside the image.
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

WORKDIR /opt
