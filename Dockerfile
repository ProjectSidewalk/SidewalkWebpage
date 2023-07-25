FROM openjdk:8-jdk-buster

RUN apt-get update && apt-get upgrade -y

RUN curl -sL https://deb.nodesource.com/setup_14.x | bash -

# Workaround because of bug in sbt from Debian.
# See https://github.com/sbt/sbt/issues/6614
RUN wget https://scala.jfrog.io/artifactory/debian/sbt-1.8.0.deb && \
  apt-get install ./sbt-1.8.0.deb

RUN apt-get install -y \
    unzip \
    python-dev \
    python-pip \
    libblas-dev \
    liblapack-dev \
    gfortran \
    python-numpy \
    python-pandas \
    python3-pip \
    cmake \
    nodejs && \
  apt-get autoremove && \
  apt-get clean

RUN pip install --upgrade pip
RUN pip install --upgrade setuptools
RUN pip3 install --upgrade pip

WORKDIR /opt

COPY package.json ./
COPY requirements.txt ./

RUN pip install -r requirements.txt
RUN pip3 install -r scripts/requirements.txt

RUN npm install
