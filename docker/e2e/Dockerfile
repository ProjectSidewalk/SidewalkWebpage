# Playwright runner for the browser smoke suite (test/e2e/, #4504). Built and run by `make test-e2e`.
#
# Why its own image rather than the web container: the official Playwright image already carries Chromium and
# every OS library it needs at PLAYWRIGHT_BROWSERS_PATH=/ms-playwright, and it publishes a multi-arch manifest,
# so Apple Silicon gets a native browser. The web image installs none of Chromium's runtime libs, caps /dev/shm at
# 256mb, and would lose any browser installed at runtime the next time the container is recreated.
#
# PW_VERSION and AXE_VERSION come from `make test-e2e`, which reads them out of package.json. The base image tag and
# the runner installed below therefore both derive from the repo's own pins and cannot drift apart.
ARG PW_VERSION
FROM mcr.microsoft.com/playwright:v${PW_VERSION}-noble

ARG PW_VERSION
ARG AXE_VERSION

# Installed under our own prefix rather than into the image's global root, because NODE_PATH must name a
# literal directory and the base image's global root has moved between releases. NODE_PATH is what lets
# playwright.config.js and the specs, which live in the mounted repo at /home, resolve require('@playwright/test').
# It is a fallback, though — Node reaches it only after the node_modules walk comes up empty, and the repo's own
# node_modules does carry @playwright/test. `make test-e2e` masks that directory with a tmpfs for exactly this
# reason; see the note on the target. The npm cache is dropped so it doesn't ride along in the layer.
#
# @axe-core/playwright (the accessibility gate, #5060) is installed here for the same reason: the tmpfs mask hides the
# repo's copy from the specs too, so anything a spec requires has to live under NODE_PATH.
RUN mkdir -p /opt/pw \
  && cd /opt/pw \
  && npm init -y > /dev/null \
  && npm install --no-fund --no-audit "@playwright/test@${PW_VERSION}" "@axe-core/playwright@${AXE_VERSION}" \
  && npm cache clean --force

ENV NODE_PATH=/opt/pw/node_modules
ENV PATH=/opt/pw/node_modules/.bin:${PATH}

WORKDIR /home
