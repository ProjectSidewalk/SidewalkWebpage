.PHONY: dev docker-up docker-up-db docker-run docker-stop ssh stage-import

db ?= sidewalk

dir ?= .

args ?= 

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

import-dump:
	@docker exec -it projectsidewalk-db sh -c "/opt/import-dump.sh $(db)"

lint-htmlhint:
	@echo "Running HTMLHint..."; ./node_modules/htmlhint/bin/htmlhint $(args) $(dir); echo "Finished Running HTMLHint"

lint-eslint: 
	@echo "Running eslint..."; ./node_modules/eslint/bin/eslint.js $(args) $(dir); echo "Finished Running eslint"

lint-stylelint:
	@echo "Running stylelint..."; ./node_modules/stylelint/bin/stylelint.js $(args) $(dir); echo "Finished Running stylelint"

lint-fix-eslint: 
	@echo "Running eslint..."; ./node_modules/eslint/bin/eslint.js --fix $(dir); echo "Finished Running eslint"

lint-fix-stylelint:
	@echo "Running stylelint..."; ./node_modules/stylelint/bin/stylelint.js --fix $(dir); echo "Finished Running stylelint"
