FROM eclipse-temurin:17-jdk-focal

RUN apt-get update && apt-get upgrade -y

RUN curl -sL https://deb.nodesource.com/setup_24.x | bash -

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

COPY package.json package-lock.json ./
COPY requirements.txt ./
COPY requirements-dev.txt ./
COPY requirements-offline-tools.txt ./

# Two interpreters, matching prod (makelab1: the app runs on Rocky's system 3.8, user accounts have 3.13). `python3`
# is the base image's 3.8 and is what the app shells out to, so it gets requirements.txt plus pytest. Add nothing else
# here: 3.8 is EOL (#4396) and current releases have dropped it.
RUN python3 -m pip install --no-cache-dir --upgrade pip
RUN python3 -m pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt
RUN python3 -m pip install --no-cache-dir --upgrade setuptools

# `python3.13` is where offline tooling lives: its dependencies (requirements-offline-tools.txt) need >= 3.11. The
# interpreter is a prebuilt python-build-standalone CPython fetched by uv, since no PPA carries 3.13 for focal. Both
# versions are pinned so every build produces the same pair; docs/upgrading-libraries.md records them.
#
# It installs to /opt because root's home is mode 700, which would leave python3.13 unusable by anyone else
# (`docker exec -u ...`, or a future USER line). Dropping EXTERNALLY-MANAGED makes plain `pip install` work as it
# would on a system interpreter; `-f` because that marker is a python-build-standalone detail, not a contract.
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python
RUN curl -LsSf https://astral.sh/uv/0.12.5/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh && \
  uv python install 3.13.15 && \
  ln -s "$(uv python find 3.13.15)" /usr/local/bin/python3.13 && \
  rm -f "$(python3.13 -c 'import sysconfig; print(sysconfig.get_path("stdlib"))')/EXTERNALLY-MANAGED" && \
  python3.13 -m ensurepip && \
  python3.13 -m pip install --no-cache-dir --upgrade pip && \
  uv cache clean
RUN python3.13 -m pip install --no-cache-dir -r requirements-offline-tools.txt -r requirements-dev.txt

# Not `npm install`: the image must not drift from the tree CI resolved (#5152).
RUN npm ci
