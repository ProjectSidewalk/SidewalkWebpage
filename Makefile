.PHONY: dev docker-up docker-up-db docker-run docker-stop ssh qa-worktree qa-worktree-stop test-e2e \
        test-python test-python-app test-python-tools \
        import-users import-dump create-new-schema fill-new-schema hide-streets-without-imagery \
        import-street-imagery reveal-or-hide-neighborhoods \
        lint lint-fix lint-evolutions lint-locales scalafmt scalafmt-fix \
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

# `clean=1` (or true/yes) expands to the qa-worktree-stop --clean flag; anything else (incl. empty) expands to nothing.
qa-stop-clean-flag = $(if $(filter 1 true yes,$(clean)),--clean,)

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
# Both qa-worktree targets fail fast on a missing wt= rather than passing an empty name into the container.
qa-worktree-require-wt = @[ -n "$(wt)" ] || { echo "usage: make $@ wt=<name>   (a dir under .claude/worktrees/)"; exit 2; }

# ANSI colors for the `lint` summary.
GREEN := \033[0;32m
RED   := \033[0;31m
BOLD  := \033[1m
RESET := \033[0m
# stylelint only accepts file paths/globs, so a dir= that isn't already a .css file/glob gets /**/*.css appended.
css-glob = $(if $(filter %.css,$(dir)),$(dir),$(dir)/**/*.css)

dev: | docker-up-db docker-run

eslint: | lint-eslint

htmlhint: | lint-htmlhint

stylelint: | lint-stylelint

eslint-fix: | lint-fix-eslint

stylelint-fix: | lint-fix-stylelint

# Runs every linter (four frontend + evolutions) even if an earlier one fails, so all problems surface in one pass,
# then prints a ✓/✗ per linter and a colored summary. Exits non-zero if any failed.
lint:
	@fail=0; \
	for t in lint-eslint lint-htmlhint lint-stylelint lint-locales lint-evolutions; do \
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

docker-stop:
	@docker compose stop
	@docker compose rm -f

docker-run:
	@docker compose run --rm --service-ports --name $(web-container) web /bin/bash

# Usage: make ssh target=web|db.
ssh:
	@docker exec -it $($(target)-container) /bin/bash

# Run an uncommitted git worktree's app on :9000 for QA (not the main repo). See tools/qa-worktree.sh and CLAUDE.md
# "Running a worktree's app for QA". e.g. `make qa-worktree wt=remove-admin-classic`.
qa-worktree:
	$(qa-worktree-require-wt)
	@docker exec -it $(web-container) bash -c '$(call qa-worktree-exec,$(wt))'

# Tear down a qa-worktree session: stop its `~ run` and grunt watch. Add `clean=1` to also drop the node_modules
# symlink. e.g. `make qa-worktree-stop wt=remove-admin-classic` or `make qa-worktree-stop wt=... clean=1`.
qa-worktree-stop:
	$(qa-worktree-require-wt)
	@docker exec $(web-container) bash -c '$(call qa-worktree-exec,$(wt) --stop $(qa-stop-clean-flag))'

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

# Browser smoke tests (test/e2e/) HOST-side against an already-running app at localhost:9000 (override with
# BASE_URL=). Unlike the other targets this doesn't docker exec — Playwright drives a host browser. One-time
# setup: `npm install && npx playwright install chromium`. Extra flags via args=, e.g. args="-g labelMap --headed".
test-e2e:
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
