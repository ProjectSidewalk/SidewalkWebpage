FROM postgres:16.1-bullseye

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y postgresql-16-pgrouting gdal-bin postgis

WORKDIR /opt
