FROM eclipse-temurin:8u402-b06-jdk-focal

RUN apt-get update && apt-get upgrade -y

RUN curl -sL https://deb.nodesource.com/setup_20.x | bash -

# Workaround because of bug in sbt from Debian. See https://github.com/sbt/sbt/issues/6614.
RUN wget https://scala.jfrog.io/artifactory/debian/sbt-1.8.0.deb && \
    apt-get install ./sbt-1.8.0.deb -y

RUN rm sbt-1.8.0.deb

RUN apt-get update && apt-get upgrade -y

RUN apt-get install -y \
    unzip \
    python3-dev \
    python3-pip \
    nodejs && \
  apt-get autoremove && \
  apt-get clean

WORKDIR /home

COPY package.json ./
COPY requirements.txt ./

# Python3 dependencies.
RUN python3 -m pip install --upgrade pip
RUN python3 -m pip install -r requirements.txt
RUN python3 -m pip install --upgrade setuptools

RUN npm install
