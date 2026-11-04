FROM eclipse-temurin:21-jdk-noble

RUN curl -fsSL https://deb.nodesource.com/setup_26.x | bash -

# Add repository for sbt.
RUN echo "deb https://repo.scala-sbt.org/scalasbt/debian all main" | tee /etc/apt/sources.list.d/sbt.list
RUN echo "deb https://repo.scala-sbt.org/scalasbt/debian /" | tee /etc/apt/sources.list.d/sbt_old.list
RUN curl -sL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x2EE0EA64E40A89B84B2DF73499E82A75642AC823" | gpg --no-default-keyring --keyring gnupg-ring:/etc/apt/trusted.gpg.d/scalasbt-release.gpg --import
RUN chmod 644 /etc/apt/trusted.gpg.d/scalasbt-release.gpg

RUN apt-get update && apt-get upgrade -y

# The `sbt` package is only the launcher, so pin it to the version the build itself declares — unpinned, each
# rebuild silently grabs whatever sbt shipped most recently (#5268).
COPY project/build.properties /tmp/build.properties

RUN apt-get install -y \
    unzip \
    python3-dev \
    python3-pip \
    nodejs \
    "sbt=$(sed -n 's/^sbt\.version=//p' /tmp/build.properties)" && \
  rm /tmp/build.properties && \
  apt-get autoremove && \
  apt-get clean

WORKDIR /home

COPY package.json package-lock.json ./
COPY requirements.txt ./
COPY requirements-dev.txt ./
COPY requirements-offline-tools.txt ./

# One interpreter: noble's `python3` is 3.12, the same minor as the `python3.12` prod's Rocky 9 provides, so the app's
# in-band label_clustering.py and the offline tooling share it (#4396). ClusterService calls it as /usr/bin/python3.12,
# a path both OSes have. Ubuntu marks its Python as externally managed, which makes pip refuse to install into it;
# the image is the environment, so that guard is dropped rather than worked around on every install. Ubuntu's pip
# stays as it is: pip can't upgrade a copy of itself that dpkg installed.
RUN rm -f "$(python3 -c 'import sysconfig; print(sysconfig.get_path("stdlib"))')/EXTERNALLY-MANAGED" && \
  python3 -m pip install --no-cache-dir -r requirements-offline-tools.txt -r requirements-dev.txt

# Not `npm install`: the image must not drift from the tree CI resolved (#5152). Copied last so editing the script
# doesn't invalidate the layers above. The stamp is what stops the first `make dev` after a build reinstalling the
# identical tree.
COPY tools/dev/npm-sync.sh ./tools/dev/
RUN npm ci && bash tools/dev/npm-sync.sh --write-stamp
