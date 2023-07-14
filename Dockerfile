FROM openjdk:8-jdk-buster

RUN apt-get update && apt-get upgrade -y

RUN curl -sL https://deb.nodesource.com/setup_14.x | bash -

# Workaround because of bug in sbt from Debian.
# See https://github.com/sbt/sbt/issues/6614
RUN wget https://scala.jfrog.io/artifactory/debian/sbt-1.8.0.deb && \
  apt-get install ./sbt-1.8.0.deb

RUN apt-get update && apt-get upgrade -y

RUN apt-get install -y \
    unzip \
    python-dev \
    python-pip \
    python-numpy \
    python-pandas \
    python3-dev \
    python3-pip \
    libgeos-dev \
    libblas-dev \
    liblapack-dev \
    gfortran \
    nodejs && \
  apt-get autoremove && \
  apt-get clean


WORKDIR /opt

COPY package.json ./
COPY requirements.txt ./
COPY python3_requirements.txt ./

# Python3 dependencies
RUN python3 -m pip install --upgrade pip
RUN python3 -m pip install -r python3_requirements.txt
RUN python3 -m pip install --upgrade setuptools

# Python2 dependencies
RUN python2 -m pip install --upgrade pip
RUN python2 -m pip install --upgrade setuptools
RUN python2 -m pip install -r requirements.txt

RUN npm install
