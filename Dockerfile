FROM openjdk:8-jdk-stretch

RUN curl -sL https://deb.nodesource.com/setup_10.x | bash - && \
  apt-get install -y nodejs

RUN echo "deb https://dl.bintray.com/sbt/debian /" | tee -a /etc/apt/sources.list.d/sbt.list && \
  apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 2EE0EA64E40A89B84B2DF73499E82A75642AC823 && \
  apt-get update

RUN apt-get install -y \
    unzip \
    python-dev \
    python-pip \
    libblas-dev \
    liblapack-dev \
    gfortran \
    python-numpy \
    python-pandas \
    sbt && \
  apt-get autoremove && \
  apt-get clean

WORKDIR /opt

COPY package.json ./
COPY requirements.txt ./

RUN pip install --upgrade setuptools && \
  pip install -r requirements.txt

RUN npm install
