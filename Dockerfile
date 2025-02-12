FROM eclipse-temurin:17-jdk-focal

RUN apt-get update && apt-get upgrade -y

RUN curl -sL https://deb.nodesource.com/setup_23.x | bash -

# Add repository for sbt.
RUN echo "deb https://repo.scala-sbt.org/scalasbt/debian all main" | tee /etc/apt/sources.list.d/sbt.list
RUN echo "deb https://repo.scala-sbt.org/scalasbt/debian /" | tee /etc/apt/sources.list.d/sbt_old.list
RUN curl -sL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x2EE0EA64E40A89B84B2DF73499E82A75642AC823" | gpg --no-default-keyring --keyring gnupg-ring:/etc/apt/trusted.gpg.d/scalasbt-release.gpg --import
RUN chmod 644 /etc/apt/trusted.gpg.d/scalasbt-release.gpg

RUN apt-get update && apt-get upgrade -y

RUN apt-get install -y \
    unzip \
    python3-dev \
    python3-pip \
    nodejs \
    sbt && \
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
