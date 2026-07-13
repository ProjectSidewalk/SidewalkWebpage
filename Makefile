.PHONY: dev docker-up docker-up-db docker-run docker-stop ssh stage-import test-python lint-evolutions lint-locales scalafmt scalafmt-fix

db ?= sidewalk
dir ?= ./
args ?=

# ANSI colors for the `lint` summary (interpreted by printf's backslash-escape handling).
GREEN := \033[0;32m
RED   := \033[0;31m
BOLD  := \033[1m
RESET := \033[0m
# dir= as stylelint sees it: passed through if it already names a .css file/glob, else treated as a directory and
# recursed (stylelint only accepts file paths/globs; see lint-stylelint).
css-glob = $(if $(filter %.css,$(dir)),$(dir),$(dir)/**/*.css)

dev: | docker-up-db docker-run

eslint: | lint-eslint

htmlhint: | lint-htmlhint

stylelint: | lint-stylelint

eslint-fix: | lint-fix-eslint

stylelint-fix: | lint-fix-stylelint

# Runs all four frontend linters, streaming each one's output, then prints a green ✓ / red ✗ line per linter and a
# colored final summary so pass/fail is legible at a glance. Every linter runs even if an earlier one fails (so you see
# every problem in one pass), and the target still exits non-zero if any failed.
lint:
	@fail=0; \
	for t in lint-eslint lint-htmlhint lint-stylelint lint-locales; do \
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
	@docker compose run --rm --service-ports --name projectsidewalk-web web /bin/bash

ssh:
	@docker exec -it projectsidewalk-$${target} /bin/bash

import-users:
	@docker exec -it projectsidewalk-db sh -c "/opt/scripts/import-users.sh"

import-dump:
	@docker exec -it projectsidewalk-db sh -c "/opt/scripts/import-dump.sh $(db)"

create-new-schema:
	@docker exec -it projectsidewalk-db sh -c "/opt/scripts/create-new-schema.sh $(name)"

fill-new-schema:
	@docker exec -it projectsidewalk-db sh -c "/opt/scripts/fill-new-schema.sh"

hide-streets-without-imagery:
	@docker exec -it projectsidewalk-db sh -c "/opt/scripts/hide-streets-without-imagery.sh"

import-street-imagery:
	@docker exec -it projectsidewalk-db sh -c "/opt/scripts/import-street-imagery.sh"

# Run the Python utility test suite (test/python/) inside the running web container. Pass extra pytest flags via args=,
# e.g. `make test-python args="-k bbox -v"`.
test-python:
	@docker exec -it projectsidewalk-web sh -c "cd /home && python3 -m pytest test/python $(args)"

reveal-or-hide-neighborhoods:
	@docker exec -it projectsidewalk-db sh -c "/opt/scripts/reveal-or-hide-neighborhoods.sh"

# Static checks on the Play evolution files (conf/evolutions/default/*.sql). Runs on the host (just bash + grep), so no
# container is needed. Also wired into CI as the blocking `evolutions-lint` job.
lint-evolutions:
	@bash db/scripts/lint-evolutions.sh

# Cross-locale key-parity check for public/locales/ (i18next-aware: plural-suffix + override-only handling that the
# eslint-plugin-i18n-json rules can't do). Pure-node, no node_modules, but run in the web container so node is present,
# matching the other lint targets. Also a blocking step in CI's frontend job.
lint-locales:
	@echo "Checking locale parity...";
	@docker exec projectsidewalk-web bash -lc "cd /home && node tools/check-locale-parity.mjs"
	@echo "Finished checking locale parity";

# Scala formatting (.scalafmt.conf), the backend counterpart to the eslint/stylelint targets above. Runs in the web
# container via the sbt thin client (`--client`) so it shares the running `sbt ~ run`'s server instead of colliding
# with it over build locks. `scalafmt` checks (matches the blocking CI gate); `scalafmt-fix` reformats in place.
scalafmt:
	@echo "Checking Scala formatting..."; docker exec -it projectsidewalk-web bash -lc "cd /home && sbt --client scalafmtCheckAll"

scalafmt-fix:
	@echo "Formatting Scala..."; docker exec -it projectsidewalk-web bash -lc "cd /home && sbt --client scalafmtAll"

# The JS/CSS/HTML linters live in the web container's node_modules (there's no host-side npm install), so — like the
# scalafmt targets above — these run in the container via `docker exec` and can therefore be invoked from the host.
# `-e FORCE_COLOR=1` (not `docker exec -t`) restores the linters' colorized output: chalk auto-disables color when
# stdout isn't a TTY, and forcing it this way keeps the targets working when piped/redirected, unlike a `-t` TTY.
lint-htmlhint:
	@echo "Running HTMLHint...";
	@if [ "$(dir)" = "./" ]; then \
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/htmlhint/bin/htmlhint $(args) ./app/views"; \
	else \
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/htmlhint/bin/htmlhint $(args) $(dir)"; \
	fi
	@echo "Finished Running HTMLHint";

lint-eslint:
	@echo "Running eslint...";
	@if [ "$(dir)" = "./" ]; then \
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/eslint/bin/eslint.js $(args) public/js/ public/locales/"; \
	else \
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/eslint/bin/eslint.js $(args) $(dir)"; \
	fi
	@echo "Finished Running eslint";

# Unlike eslint, stylelint doesn't recurse into a bare directory, so a dir= that isn't already a .css file/glob gets
# /**/*.css appended (css-glob, defined at the top). Globs are single-quoted so stylelint's globber expands the `**`,
# not the container shell (where bare `**` means `*`).
lint-stylelint:
	@echo "Running stylelint...";
	@if [ "$(dir)" = "./" ]; then \
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/.bin/stylelint $(args) 'public/**/*.css'"; \
	else \
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/.bin/stylelint $(args) '$(css-glob)'"; \
	fi
	@echo "Finished Running stylelint";

lint-fix-eslint:
	@echo "Running eslint...";
	@if [ "$(dir)" = "./" ]; then \
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/eslint/bin/eslint.js --fix $(args) public/js/ public/locales/"; \
	else \
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/eslint/bin/eslint.js --fix $(args) $(dir)"; \
	fi
	@echo "Finished Running eslint";

# Runs --fix twice: stylelint applies fixers in a single pass, so when the brace-newline fixers insert newlines the
# indentation fixer has already computed against the old positions and leaves the new lines mis-indented — a second
# pass corrects them. The first pass is silenced (output + exit code discarded); only the second pass's output and
# exit status surface, so the target looks like a single run.
lint-fix-stylelint:
	@echo "Running stylelint...";
	@if [ "$(dir)" = "./" ]; then \
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/.bin/stylelint --fix $(args) 'public/**/*.css' > /dev/null 2>&1; ./node_modules/.bin/stylelint --fix $(args) 'public/**/*.css'"; \
	else \
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/.bin/stylelint --fix $(args) '$(css-glob)' > /dev/null 2>&1; ./node_modules/.bin/stylelint --fix $(args) '$(css-glob)'"; \
	fi
	@echo "Finished Running stylelint";
