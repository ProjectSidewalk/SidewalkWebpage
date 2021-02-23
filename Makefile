.PHONY: dev docker-up docker-up-db docker-run docker-stop ssh stage-import

db ?= sidewalk

dir ?= .

dev: | docker-up-db docker-run

eslint: | lint-eslint

htmlhint: | lint-htmlhint

lint: | lint-eslint lint-htmlhint

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
	@./node_modules/htmlhint/bin/htmlhint $(dir)

lint-eslint: 
	@./node_modules/eslint/bin/eslint.js $(dir)
