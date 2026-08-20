# Playwright runner for the browser smoke suite (test/e2e/, #4504). Built and run by `make test-e2e`.
#
# Why its own image rather than the web container: the official Playwright image already carries Chromium and
# every OS library it needs at PLAYWRIGHT_BROWSERS_PATH=/ms-playwright, and it publishes a multi-arch manifest,
# so Apple Silicon gets a native browser. The web image installs none of Chromium's runtime libs, pins
# `platform: linux/x86_64` (an emulated browser on M-series Macs), caps /dev/shm at 256mb, and would lose any
# browser installed at runtime the next time the container is recreated.
#
# PW_VERSION comes from `make test-e2e`, which reads it out of package.json. The base image tag and the runner
# installed below therefore both derive from the repo's @playwright/test pin and cannot drift apart.
ARG PW_VERSION
FROM mcr.microsoft.com/playwright:v${PW_VERSION}-noble

ARG PW_VERSION

# Installed under our own prefix rather than into the image's global root, because NODE_PATH must name a
# literal directory and the base image's global root has moved between releases. The repo is mounted at /home,
# whose node_modules is the web container's volume — it holds the app's dev tooling but not @playwright/test,
# so NODE_PATH is what lets playwright.config.js and the specs resolve require('@playwright/test').
RUN mkdir -p /opt/pw \
  && cd /opt/pw \
  && npm init -y > /dev/null \
  && npm install --no-fund --no-audit "@playwright/test@${PW_VERSION}"

ENV NODE_PATH=/opt/pw/node_modules
ENV PATH=/opt/pw/node_modules/.bin:${PATH}

WORKDIR /home
