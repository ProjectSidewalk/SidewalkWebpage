# `tools/`

Everything a person or CI runs. A script lives where its caller is:

| Folder | Who runs it | What's there |
| --- | --- | --- |
| [`lint/`](lint) | CI (`make lint`) | The `check-*.mjs` gates, the route-reachability lint, our ESLint rules and the JSDoc type-check configs |
| [`dev/`](dev) | A developer working on the dev env | Worktree QA, the sbt runner, `npm-sync.sh` |
| [`city/`](city/README.md) | A developer setting up or updating a city's data | Onboarding, imagery scans, street gradients, GA and Maps key setup |
| [`validation_queue/`](validation_queue) | A developer changing the queue policy | The exports and analyzer behind `docs/validation-queue.md` |
| [`one-off/`](one-off) | A person, deliberately, against a database | Scripts we don't maintain (below) |

What the running app itself shells out to is in [`scripts/`](../scripts/README.md); what runs inside the DB
container is in [`db/scripts/`](../db/scripts/README.md); a script whose only output is a committed fixture sits
beside that fixture under `test/`.

## `one-off/`

Cheap to add, cheap to ignore. Coverage and lint skip this folder, and nothing keeps a script here working.

- A script goes in only if it **writes to a database**. A read-only script comes along only when a write script's
  header says to run it first. Checks, EXPLAINs and one-time comparisons stay in the ignored `scratchpad/`, and
  outputs never come in.
- Name it `<issue>-<what-it-does>.<ext>`, kebab-case, the same key as the branch.
- The header says which evolution or release it was written against. A rerun starts by checking that.

The SQL playbooks run by hand against the dev DB, or on every city through
`sidewalk-server-tools/run-query-in-every-city.sh`, which sets the `search_path` and passes the city name:

```bash
docker exec -i projectsidewalk-db psql "dbname=sidewalk options=--search_path=sidewalk_chicago,public" \
  -U sidewalk_chicago -v city=chicago -v apply=0 -f - < tools/one-off/3067-merge-duplicate-streets.sql
```

`4181-remove-streets.sql` and `4190-remove-validations.sql` take their inputs by edit: set the id list and
`search_path` at the top, then run inside their `BEGIN; ... COMMIT;` and read the preview before committing.
