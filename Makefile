.PHONY: dev docker-up docker-up-db docker-run docker-stop ssh qa-worktree qa-worktree-stop worktree-remove \
        test-e2e test-e2e-host \
        test-python test-python-app test-python-tools \
        import-users import-dump create-new-schema fill-new-schema hide-streets-without-imagery \
        import-street-imagery reveal-or-hide-neighborhoods \
        lint lint-fix lint-evolutions lint-locales lint-css-layout lint-asset-paths scalafmt scalafmt-fix \
        eslint htmlhint stylelint eslint-fix stylelint-fix \
        lint-eslint lint-htmlhint lint-stylelint lint-fix-eslint lint-fix-stylelint

# Container names — the only two lines to change if your containers are named differently.
web-container ?= projectsidewalk-web
db-container  ?= projectsidewalk-db

db ?= sidewalk
dir ?= ./
args ?=
wt ?=
clean ?=
force ?=

# `clean=1` (or true/yes) expands to the qa-worktree-stop --clean flag; anything else (incl. empty) expands to nothing.
qa-stop-clean-flag = $(if $(filter 1 true yes,$(clean)),--clean,)
# Same idiom for worktree-remove's `force=1`.
worktree-force-flag = $(if $(filter 1 true yes,$(force)),--force,)

# Resolve which copy of qa-worktree.sh to run, then exec it with the args in $(1). The main repo is mounted at the
# container's /home, so /home/tools/qa-worktree.sh is the script as it exists on whatever branch the MAIN checkout
# happens to be on — which may predate the script entirely (#4628). Prefer the worktree's own copy so the branch being
# QA'd supplies its own tooling, and fall back to the main repo's for worktrees branched before the script existed.
# Held in a variable rather than written inline in a recipe: make condenses a variable's backslash-continuations into
# single spaces at parse time, so the container's shell receives one flat line — no reliance on how a given make version
# passes continuations and leading tabs through to the shell (macOS still ships make 3.81, WSL/Linux run 4.x).
qa-worktree-exec = script="/home/.claude/worktrees/$(wt)/tools/qa-worktree.sh"; \
  [ -f "$$script" ] || script=/home/tools/qa-worktree.sh; \
  [ -f "$$script" ] || { echo "error: no tools/qa-worktree.sh in worktree $(wt) or in the main checkout"; exit 1; }; \
  exec bash "$$script" $(1)
# Every wt= target fails fast on a missing name rather than passing an empty one along.
worktree-require-wt = @[ -n "$(wt)" ] || { echo "usage: make $@ wt=<name>   (a dir under .claude/worktrees/)"; exit 2; }

# ANSI colors for the `lint` summary.
GREEN := \033[0;32m
RED   := \033[0;31m
BOLD  := \033[1m
RESET := \033[0m
# stylelint only accepts file paths/globs, so a dir= that isn't already a .css file/glob gets /**/*.css appended.
css-glob = $(if $(filter %.css,$(dir)),$(dir),$(dir)/**/*.css)

# The browser smoke suite's runner image (docker/e2e/Dockerfile), tagged from the tool versions read out of
# package.json — the base image bundles the matching Chromium, so deriving both from one pin is what keeps the
# runner and the browser from drifting apart when Dependabot bumps it. The sed expression is plain BRE for macOS.
# Simply-expanded so the subprocess runs once per make invocation rather than once per expansion.
pw-version := $(shell sed -n 's/.*"@playwright\/test"[^0-9]*\([0-9][0-9.]*\)".*/\1/p' package.json)
# @axe-core/playwright drives the accessibility gate (a11y.spec.js, #5060) and is installed into the image for the
# same reason the runner is — the repo's node_modules is masked at run time. Read from the same one pin, and folded
# into the image tag below so a bump rebuilds the image instead of silently reusing the old axe.
axe-version := $(shell sed -n 's/.*"@axe-core\/playwright"[^0-9]*\([0-9][0-9.]*\)".*/\1/p' package.json)
e2e-image   = projectsidewalk/e2e
e2e-tag      = $(pw-version)-axe$(axe-version)
# The main repo is the container's /home, so a worktree's specs are just a different working directory.
e2e-workdir = $(if $(wt),/home/.claude/worktrees/$(wt),/home)
# Playwright writes test-results/ into the bind-mounted repo, and the base image has no USER — so without this the
# reports, traces, and the setup project's saved storageState all land root-owned, and neither a plain `rm -rf` nor
# host-side `make worktree-remove` can clear them. HOME goes to /tmp because the invoking uid has no passwd entry.
#
# WHICH uid that is depends on the daemon. Rootless Docker runs the engine inside a user namespace where container
# uid 0 IS the invoking host user, so the runner has to be container-root to write files the host user owns —
# passing our host uid there lands us at an unmapped subuid that can't even delete Playwright's own output dir
# (`EACCES: permission denied, rmdir '/home/test-results'`). A rootful daemon maps uids straight through, so there
# the host uid is exactly right and container-root would be real root. `docker info` naming the answer beats
# guessing; when docker is unreachable it falls through to the rootful form, which is what the failure message from
# the running-container check below is about anyway. Unhandled third case: a rootful daemon with `userns-remap`
# configured, where the right uid is neither — nobody on the team runs one, and it needs the offset from
# /etc/subuid to compute.
#
# Recursively expanded, so the `docker info` round trip is paid inside the test-e2e recipe rather than every time
# make parses this file — targets that never touch docker (lint-evolutions, worktree-remove) would otherwise wait
# out the client's connect timeout whenever the daemon is down, with 2>/dev/null hiding why.
docker-rootless = $(shell docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -c rootless)
e2e-uid    = $(if $(filter 0,$(docker-rootless)),$(shell id -u),0)
e2e-user   = $(e2e-uid):$(if $(filter 0,$(docker-rootless)),$(shell id -g),0)
# Playwright wipes its output directory at the start of every run, so one left root-owned — by a run that predates
# --user, or by any root container — stops the non-root runner with EACCES before a single test starts. Repair it
# in place instead of sending the developer to sudo. Held in a variable, not written inline in the recipe, because
# make condenses a variable's backslash-continuations to spaces at parse time and the container's shell would
# otherwise receive them literally inside the single-quoted script (same reason as qa-worktree-exec).
e2e-fix-artifact-owner = cd $(e2e-workdir) 2>/dev/null || exit 0; \
  for d in test-results playwright-report; do \
    [ -d "$$d" ] || continue; \
    [ "$$(stat -c %u "$$d")" = "$(e2e-uid)" ] && continue; \
    echo "==> repairing ownership of $$d, left root-owned by an earlier run"; \
    chown -R $(e2e-user) "$$d"; \
  done

dev: | docker-up-db docker-run

eslint: | lint-eslint

htmlhint: | lint-htmlhint

stylelint: | lint-stylelint

eslint-fix: | lint-fix-eslint

stylelint-fix: | lint-fix-stylelint

# Runs every linter (the frontend set + evolutions) even if an earlier one fails, so all problems surface in one pass,
# then prints a ✓/✗ per linter and a colored summary. Exits non-zero if any failed.
lint:
	@fail=0; \
	for t in lint-eslint lint-htmlhint lint-stylelint lint-locales lint-css-layout lint-asset-paths lint-evolutions; do \
		if $(MAKE) --no-print-directory $$t; then \
			printf "$(GREEN)✓ %s passed$(RESET)\n" "$$t"; \
		else \
			printf "$(RED)✗ %s FAILED$(RESET)\n" "$$t"; \
			fail=1; \
		fi; \
	done; \
	echo ""; \
	if [ $$fail -eq 0 ]; then \
		printf "$(GREEN)$(BOLD)✓ All lint checks passed$(RESET)\n"; \
	else \
		printf "$(RED)$(BOLD)✗ Some lint checks FAILED$(RESET)\n"; \
	fi; \
	exit $$fail

lint-fix:
	@make lint-fix-eslint; make lint-fix-stylelint

docker-up:
	@docker compose up -d

docker-up-db:
	@docker compose up -d db

# `rm -v` drops the removed containers' anonymous volumes only.
docker-stop:
	@docker compose stop
	@docker compose rm -fv

docker-run:
	@docker compose run --rm --service-ports --name $(web-container) web /bin/bash

# Usage: make ssh target=web|db.
ssh:
	@docker exec -it $($(target)-container) /bin/bash

# Run an uncommitted git worktree's app on :9000 for QA (not the main repo). See tools/qa-worktree.sh and CLAUDE.md
# "Running a worktree's app for QA". e.g. `make qa-worktree wt=remove-admin-classic`.
qa-worktree:
	$(worktree-require-wt)
	@docker exec -it $(web-container) bash -c '$(call qa-worktree-exec,$(wt))'

# Tear down a qa-worktree session: stop its `~ run` and grunt watch. Add `clean=1` to also drop the node_modules
# symlink. e.g. `make qa-worktree-stop wt=remove-admin-classic` or `make qa-worktree-stop wt=... clean=1`.
qa-worktree-stop:
	$(worktree-require-wt)
	@docker exec $(web-container) bash -c '$(call qa-worktree-exec,$(wt) --stop $(qa-stop-clean-flag))'

# Tear a worktree down for good: its QA session, its directory, its git registration, and its branch once that branch is
# in develop. Host-side (git can't reach a worktree from inside the container — see tools/worktree-remove.sh). Add
# `force=1` to discard uncommitted work in it. e.g. `make worktree-remove wt=remove-admin-classic`.
worktree-remove:
	$(worktree-require-wt)
	@bash tools/worktree-remove.sh $(wt) --container $(web-container) $(worktree-force-flag)

import-users:
	@docker exec -it $(db-container) sh -c "/opt/scripts/import-users.sh"

import-dump:
	@docker exec -it $(db-container) sh -c "/opt/scripts/import-dump.sh $(db)"

create-new-schema:
	@docker exec -it $(db-container) sh -c "/opt/scripts/create-new-schema.sh $(name)"

fill-new-schema:
	@docker exec -it $(db-container) sh -c "/opt/scripts/fill-new-schema.sh"

hide-streets-without-imagery:
	@docker exec -it $(db-container) sh -c "/opt/scripts/hide-streets-without-imagery.sh"

import-street-imagery:
	@docker exec -it $(db-container) sh -c "/opt/scripts/import-street-imagery.sh"

# Python utility tests (test/python/) in the web container; extra pytest flags via args=, e.g. args="-k bbox -v".
# Split by interpreter because the scripts are: label_clustering.py runs in-band on prod's `python3` (3.8), while the
# offline tooling needs >= 3.11. Each half runs the whole directory minus the one file the other owns, so a new test
# file runs in both by default instead of silently in neither. COVERAGE_OMIT is explained in pyproject.toml.
pytest-args-app   = test/python --ignore=test/python/test_check_streets_for_imagery.py
pytest-args-tools = test/python --ignore=test/python/test_label_clustering.py
cov-omit-app      = -e COVERAGE_OMIT=scripts/check_streets_for_imagery.py
cov-omit-tools    = -e COVERAGE_OMIT=scripts/label_clustering.py

# Both halves run even when the first fails, matching CI's `fail-fast: false`; prerequisites would stop at the first.
test-python:
	@$(MAKE) --no-print-directory test-python-app || fail=1; \
	$(MAKE) --no-print-directory test-python-tools || fail=1; \
	exit $${fail:-0}

test-python-app:
	@docker exec -it $(cov-omit-app) $(web-container) sh -c "cd /home && python3 -m pytest $(pytest-args-app) $(args)"

test-python-tools:
	@docker exec -it $(cov-omit-tools) $(web-container) sh -c "cd /home && python3.13 -m pytest $(pytest-args-tools) $(args)"

# Browser smoke tests (test/e2e/) against an already-running app at localhost:9000. Like every other tooling target
# this runs in a container, so it behaves the same on Linux, WSL2, and macOS (Intel and Apple Silicon) with no host
# Node, browser, or `playwright install` — the official Playwright base image ships Chromium plus its OS deps and is
# multi-arch. Two flags place the runner: `--network container:` puts it in the web container's network
# namespace, so the app answers at localhost:9000 — the only host conf/application.local.conf's
# play.filters.hosts.allowed permits, and the same URL CI uses; `--volumes-from` gives it the web container's
# mounts, so /home is the repo and worktree paths resolve unchanged. Two more make it behave: see the notes on
# `--tmpfs` below and on e2e-user above. Scope with args=, e.g.
# args="-g labelMap --no-deps". Without wt= it runs the MAIN checkout's specs even when invoked from a worktree
# (the container sees one filesystem); pass wt=<name> for that worktree's, as with qa-worktree. For --headed/--ui,
# see test-e2e-host. The image build is a cached no-op after the first run, and re-runs itself on a version bump —
# it's only verbose when the tag is missing, since that first build downloads the base image.
#
# `--tmpfs /home/node_modules` is load-bearing, not tidiness: NODE_PATH is consulted only after the node_modules
# walk fails, so the repo's own node_modules — which carries @playwright/test, a devDependency installed into the
# web image — would resolve the specs to a second copy of the module while the CLI keeps the image's. Playwright
# then aborts with "did not expect test() to be called here ... two different versions of @playwright/test". An
# empty dir at that path is what makes resolution fall through to the runner we installed. It covers worktrees
# too, whose node_modules is a symlink to this one.
test-e2e:
	@docker inspect -f '{{.State.Running}}' $(web-container) 2>/dev/null | grep -q true \
	  || { echo "error: $(web-container) is not running — start it with 'make docker-up', and make sure the app is up on :9000"; exit 2; }
	@[ -n "$(pw-version)" ] \
	  || { echo "error: no @playwright/test version found in package.json — is it still listed as a devDependency?"; exit 2; }
	@[ -n "$(axe-version)" ] \
	  || { echo "error: no @axe-core/playwright version found in package.json — is it still listed as a devDependency?"; exit 2; }
	@[ -z "$(wt)" ] || docker exec $(web-container) test -d $(e2e-workdir) \
	  || { echo "error: no worktree at $(e2e-workdir) (from wt=$(wt))"; exit 2; }
	@docker exec $(web-container) sh -c '$(e2e-fix-artifact-owner)'
	@if docker image inspect $(e2e-image):$(e2e-tag) > /dev/null 2>&1; then \
	  docker build --quiet --build-arg PW_VERSION=$(pw-version) --build-arg AXE_VERSION=$(axe-version) -t $(e2e-image):$(e2e-tag) docker/e2e > /dev/null; \
	else \
	  echo "==> building the Playwright runner image (first run for $(e2e-tag): downloads ~2GB)"; \
	  docker build --build-arg PW_VERSION=$(pw-version) --build-arg AXE_VERSION=$(axe-version) -t $(e2e-image):$(e2e-tag) docker/e2e; \
	fi
	@docker run --rm --init --ipc=host \
	  --network container:$(web-container) --volumes-from $(web-container) --tmpfs /home/node_modules \
	  --user $(e2e-user) -e HOME=/tmp -e FORCE_COLOR=1 -e BASE_URL \
	  -w $(e2e-workdir) $(e2e-image):$(e2e-tag) playwright test $(args)

# Host-side run of the same suite, for `--headed`, `--ui`, and `show-trace` — those need a display the container
# doesn't have. Needs a host toolchain the containerized path does not: Node 23, `npm install` at the repo root
# (the container's node_modules is a Docker volume, invisible from the host), and `npx playwright install chromium`,
# plus `sudo npx playwright install-deps` on Linux/WSL. See test/e2e/README.md.
test-e2e-host:
	@command -v npx > /dev/null \
	  || { echo "error: no host Node — this target needs one (see test/e2e/README.md); 'make test-e2e' needs none"; exit 2; }
	@[ -d node_modules/@playwright/test ] \
	  || { echo "error: @playwright/test isn't installed on the host — run 'npm install && npx playwright install chromium'"; exit 2; }
	@npx playwright test $(args)

reveal-or-hide-neighborhoods:
	@docker exec -it $(db-container) sh -c "/opt/scripts/reveal-or-hide-neighborhoods.sh"

# Static checks on conf/evolutions/default/*.sql. Host-side bash, no container needed. Also a blocking CI job.
lint-evolutions:
	@bash db/scripts/lint-evolutions.sh

# Cross-locale key parity for public/locales/ (i18next plural/override handling that the eslint-plugin-i18n-json rules
# can't do). Pure node, run in the web container so node is present. Also a blocking CI step.
lint-locales:
	@echo "Checking locale parity...";
	@docker exec $(web-container) bash -lc "cd /home && node tools/check-locale-parity.mjs"
	@echo "Finished checking locale parity";

# Layout of public/css/ (#5030): a page's stylesheet is linked only by that page, page class prefixes stay in the
# page's own files, and every linked stylesheet exists. Pure node, run in the web container so node is present. Also a
# blocking CI step.
lint-css-layout:
	@echo "Checking CSS layout...";
	@docker exec $(web-container) bash -lc "cd /home && node tools/check-css-layout.mjs"
	@echo "Finished checking CSS layout";

# Asset URLs in public/js/ (#4893): no hardcoded '/assets/' outside the allowlist, and every util.assetPath()
# argument checkable — a literal one naming a real file in a fingerprinted family, an interpolated one opening with a
# literal family directory. Pure node, run in the web container so node is present. Also a blocking CI step.
lint-asset-paths:
	@echo "Checking asset paths...";
	@docker exec $(web-container) bash -lc "cd /home && node tools/check-asset-paths.mjs"
	@echo "Finished checking asset paths";

# Scala formatting (.scalafmt.conf). The sbt thin client (`--client`) shares the running `sbt ~ run`'s server instead
# of colliding with it over build locks. `scalafmt` checks (the blocking CI gate); `scalafmt-fix` reformats in place.
scalafmt:
	@echo "Checking Scala formatting..."; docker exec -it $(web-container) bash -lc "cd /home && sbt --client scalafmtCheckAll"

scalafmt-fix:
	@echo "Formatting Scala..."; docker exec -it $(web-container) bash -lc "cd /home && sbt --client scalafmtAll"

# The JS/CSS/HTML linters run in the web container, where their node_modules live (no host-side npm install).
# `-e FORCE_COLOR=1` (not `docker exec -t`) restores colorized output while keeping the targets pipeable.
lint-htmlhint:
	@echo "Running HTMLHint...";
	@if [ "$(dir)" = "./" ]; then \
		docker exec -e FORCE_COLOR=1 $(web-container) bash -lc "cd /home && ./node_modules/htmlhint/bin/htmlhint $(args) ./app/views"; \
	else \
		docker exec -e FORCE_COLOR=1 $(web-container) bash -lc "cd /home && ./node_modules/htmlhint/bin/htmlhint $(args) $(dir)"; \
	fi
	@echo "Finished Running HTMLHint";

lint-eslint:
	@echo "Running eslint...";
	@if [ "$(dir)" = "./" ]; then \
		docker exec -e FORCE_COLOR=1 $(web-container) bash -lc "cd /home && ./node_modules/eslint/bin/eslint.js $(args) public/js/ public/locales/ test/e2e/ playwright.config.js"; \
	else \
		docker exec -e FORCE_COLOR=1 $(web-container) bash -lc "cd /home && ./node_modules/eslint/bin/eslint.js $(args) $(dir)"; \
	fi
	@echo "Finished Running eslint";

# Globs are single-quoted so stylelint's globber expands the `**`, not the container shell (where bare `**` means `*`).
lint-stylelint:
	@echo "Running stylelint...";
	@if [ "$(dir)" = "./" ]; then \
		docker exec -e FORCE_COLOR=1 $(web-container) bash -lc "cd /home && ./node_modules/.bin/stylelint $(args) 'public/**/*.css'"; \
	else \
		docker exec -e FORCE_COLOR=1 $(web-container) bash -lc "cd /home && ./node_modules/.bin/stylelint $(args) '$(css-glob)'"; \
	fi
	@echo "Finished Running stylelint";

lint-fix-eslint:
	@echo "Running eslint...";
	@if [ "$(dir)" = "./" ]; then \
		docker exec -e FORCE_COLOR=1 $(web-container) bash -lc "cd /home && ./node_modules/eslint/bin/eslint.js --fix $(args) public/js/ public/locales/ test/e2e/ playwright.config.js"; \
	else \
		docker exec -e FORCE_COLOR=1 $(web-container) bash -lc "cd /home && ./node_modules/eslint/bin/eslint.js --fix $(args) $(dir)"; \
	fi
	@echo "Finished Running eslint";

# --fix runs twice: the brace-newline fixers insert lines after indentation is computed, leaving mis-indents that the
# second pass corrects. The first pass is silenced, so it reads as a single run.
lint-fix-stylelint:
	@echo "Running stylelint...";
	@if [ "$(dir)" = "./" ]; then \
		docker exec -e FORCE_COLOR=1 $(web-container) bash -lc "cd /home && ./node_modules/.bin/stylelint --fix $(args) 'public/**/*.css' > /dev/null 2>&1; ./node_modules/.bin/stylelint --fix $(args) 'public/**/*.css'"; \
	else \
		docker exec -e FORCE_COLOR=1 $(web-container) bash -lc "cd /home && ./node_modules/.bin/stylelint --fix $(args) '$(css-glob)' > /dev/null 2>&1; ./node_modules/.bin/stylelint --fix $(args) '$(css-glob)'"; \
	fi
	@echo "Finished Running stylelint";
