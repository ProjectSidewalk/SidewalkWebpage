FROM node:10.10.0

RUN apt-get update && apt-get upgrade -y

RUN echo "deb http://ppa.launchpad.net/webupd8team/java/ubuntu xenial main" | tee /etc/apt/sources.list.d/webupd8team-java.list && \
  echo "deb-src http://ppa.launchpad.net/webupd8team/java/ubuntu xenial main" | tee -a /etc/apt/sources.list.d/webupd8team-java.list && \
  apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys EEA14886 && \
  echo "deb https://dl.bintray.com/sbt/debian /" | tee -a /etc/apt/sources.list.d/sbt.list && \
  apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 2EE0EA64E40A89B84B2DF73499E82A75642AC823 && \
  apt-get install -y apt-transport-https

RUN apt-get update && \
  echo "oracle-java8-installer shared/accepted-oracle-license-v1-1 select true" | debconf-set-selections && \
  echo "oracle-java8-installer shared/accepted-oracle-license-v1-1 seen true" | debconf-set-selections && \
  apt-get install -y \
    oracle-java8-installer \
    unzip \
    sbt && \
  apt-get autoremove && \
  apt-get clean

WORKDIR /usr/share
RUN wget http://downloads.typesafe.com/typesafe-activator/1.3.2/typesafe-activator-1.3.2-minimal.zip && \
  unzip typesafe-activator-1.3.2-minimal.zip && \
  mv activator-1.3.2-minimal activator

WORKDIR /usr/share/activator
ENV PATH="/usr/share/activator:${PATH}"
RUN /bin/bash -c "source ~/.bashrc" && \
  chmod a+x activator

WORKDIR /opt
COPY package.json ./
RUN npm install
