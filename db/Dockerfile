FROM postgres:16.1-bullseye

ENV DEBIAN_FRONTEND=noninteractive

# Prevent PostgreSQL 17 installation
RUN echo "Package: postgresql*\nPin: version 17.*\nPin-Priority: -1" > /etc/apt/preferences.d/postgresql

RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y postgresql-16-pgrouting gdal-bin postgis

WORKDIR /opt
