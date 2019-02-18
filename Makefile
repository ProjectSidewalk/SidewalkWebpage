.PHONY: dev docker-up docker-up-db docker-run docker-stop ssh stage-import

dev: | docker-up-db docker-run

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
	@docker exec -it projectsidewalk-db /opt/import-dump.sh
