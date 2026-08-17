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
COPY requirements-dev.txt ./
COPY requirements-offline-tools.txt ./

# The image carries two Python interpreters, matching prod (makelab1: Rocky's system 3.8 runs the app, user accounts
# get 3.13). `python3` is the base image's 3.8 and is the one the app shells out to, so it gets requirements.txt — the
# in-band label_clustering.py deps — plus pytest for that script's tests. Nothing else should be added here: 3.8 is EOL
# (#4396) and every library worth having has dropped it.
RUN python3 -m pip install --upgrade pip
RUN python3 -m pip install -r requirements.txt -r requirements-dev.txt
RUN python3 -m pip install --upgrade setuptools

# `python3.13` is where offline tooling lives, because its dependencies (requirements-offline-tools.txt) need >= 3.10.
# The interpreter is a prebuilt python-build-standalone CPython fetched by uv: no PPA carries 3.13 for focal, and uv
# resolves the right build per architecture. Its EXTERNALLY-MANAGED marker is removed so plain
# `python3.13 -m pip install` works, as it would on a normal system interpreter.
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh && \
  uv python install 3.13 && \
  ln -s "$(uv python find 3.13)" /usr/local/bin/python3.13 && \
  rm "$(python3.13 -c 'import sysconfig; print(sysconfig.get_path("stdlib"))')/EXTERNALLY-MANAGED" && \
  python3.13 -m ensurepip && \
  python3.13 -m pip install --upgrade pip
RUN python3.13 -m pip install -r requirements-offline-tools.txt -r requirements-dev.txt

RUN npm install
