.PHONY: dev docker-up docker-up-db docker-run docker-stop ssh stage-import

db ?= sidewalk

dir ?= .

args ?= 

dev: | docker-up-db docker-run

eslint: | lint-eslint

htmlhint: | lint-htmlhint

stylelint: | lint-stylelint

lint: | lint-eslint lint-htmlhint lint-stylelint 

fixlint: | fixlint-eslint fixlint-stylelint

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
	@./node_modules/htmlhint/bin/htmlhint $(args) $(dir)

lint-eslint: 
	@./node_modules/eslint/bin/eslint.js $(args) $(dir)

lint-stylelint:
	@./node_modules/stylelint/bin/stylelint.js $(args) $(dir)

fixlint-eslint: 
	@./node_modules/eslint/bin/eslint.js --fix $(dir)

fixlint-stylelint:
	@./node_modules/stylelint/bin/stylelint.js --fix $(dir)
