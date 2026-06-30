.PHONY: dev docker-up docker-up-db docker-run docker-stop ssh stage-import test-python lint-evolutions scalafmt scalafmt-fix

db ?= sidewalk
dir ?= ./
args ?=
html-ignore ?= **/bootstrap/**

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
	@docker-compose up -d

docker-up-db:
	@docker-compose up -d db

docker-stop:
	@docker-compose stop
	@docker-compose rm -f

docker-run:
	@docker-compose run --rm --service-ports --name projectsidewalk-web web /bin/bash

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

lint-htmlhint:
	@echo "Running HTMLHint...";
	@if [ "$(dir)" = "./" ]; then \
		./node_modules/htmlhint/bin/htmlhint $(args) --ignore $(html-ignore) ./app/views; \
	else \
		./node_modules/htmlhint/bin/htmlhint $(args) --ignore $(html-ignore) $(dir); \
	fi
	@echo "Finished Running HTMLHint";

lint-eslint:
	@echo "Running eslint..."; ./node_modules/eslint/bin/eslint.js $(args) $(dir); echo "Finished Running eslint"

lint-stylelint:
	@echo "Running stylelint..."; ./node_modules/stylelint/bin/stylelint.js $(args) $(dir); echo "Finished Running stylelint"

lint-fix-eslint:
	@echo "Running eslint..."; ./node_modules/eslint/bin/eslint.js --fix $(args) $(dir); echo "Finished Running eslint"

lint-fix-stylelint:
	@echo "Running stylelint..."; ./node_modules/stylelint/bin/stylelint.js --fix $(args) $(dir); echo "Finished Running stylelint"
