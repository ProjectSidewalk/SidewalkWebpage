.PHONY: dev docker-up docker-up-db docker-run docker-stop ssh stage-import test-python lint-evolutions scalafmt scalafmt-fix

db ?= sidewalk
dir ?= ./
args ?=
html-ignore ?= **/bootstrap/**
# dir= as stylelint sees it: passed through if it already names a .css file/glob, else treated as a directory and
# recursed (stylelint only accepts file paths/globs; see lint-stylelint).
css-glob = $(if $(filter %.css,$(dir)),$(dir),$(dir)/**/*.css)

dev: | docker-up-db docker-run

eslint: | lint-eslint

htmlhint: | lint-htmlhint

stylelint: | lint-stylelint

eslint-fix: | lint-fix-eslint

stylelint-fix: | lint-fix-stylelint

lint:
	@make lint-eslint; make lint-htmlhint; make lint-stylelint

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
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/htmlhint/bin/htmlhint $(args) --ignore $(html-ignore) ./app/views"; \
	else \
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/htmlhint/bin/htmlhint $(args) --ignore $(html-ignore) $(dir)"; \
	fi
	@echo "Finished Running HTMLHint";

lint-eslint:
	@echo "Running eslint...";
	@if [ "$(dir)" = "./" ]; then \
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/eslint/bin/eslint.js $(args) public/js/"; \
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
		docker exec -e FORCE_COLOR=1 projectsidewalk-web bash -lc "cd /home && ./node_modules/eslint/bin/eslint.js --fix $(args) public/js/"; \
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
