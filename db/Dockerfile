FROM postgis/postgis:16-3.4

ENV DEBIAN_FRONTEND=noninteractive

# Pin to prevent major version upgrades for postgresql and postgis.
RUN echo "Package: postgresql*\nPin: version 16.*\nPin-Priority: 1001" > /etc/apt/preferences.d/postgresql && \
    echo "Package: postgis*\nPin: version 3.4.*\nPin-Priority: 1001" >> /etc/apt/preferences.d/postgr

RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y postgresql-16-pgrouting gdal-bin && \
    # Remove cached .deb files and package lists to reduce image size.
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /opt
