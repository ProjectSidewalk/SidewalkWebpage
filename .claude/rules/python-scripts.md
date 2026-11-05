---
paths:
  - "scripts/**"
  - "tools/**/*.py"
  - "test/python/**"
  - "requirements*.txt"
---

# Python utilities

Full details: `tools/README.md` (which folder a script belongs in), `tools/city/README.md`, `scripts/README.md`
and `test/python/README.md`.

- **One interpreter, Python 3.12.** The web container's `python3` and prod's `/usr/bin/python3.12` are the same
  minor (#4396). A library the app's `label_clustering.py` needs goes in `requirements.txt`, which the deploy installs
  on the server; one only the offline tools need goes in `requirements-offline-tools.txt`, which layers on it and is
  installed only in the container.
- `label_clustering.py` runs in-band: `ClusterService.runMultiUserClustering` resolves it against the app root and
  `scripts/` is bundled into the staged package via `Universal / mappings` in `build.sbt`. Nothing else goes in
  `scripts/`.
- Keep I/O in thin wrappers and `main`; pure logic is importable and unit-tested under `test/python/`. Coverage is
  gated at 100% over `scripts/` and `tools/` alike (`make test-python`). Exempt: `tools/one-off/`, `tools/experiments/`
  and the route lint, listed in `pyproject.toml`.
- `onboard_city.py` (new-city street/region build) and `check_streets_for_imagery.py` (imagery scan + `--sample`
  preflight) are the onboarding pair; `tools/city/setup_new_city.py` orchestrates them with the db scripts. Runbook:
  `docs/onboarding-a-city.md`.
- `osm_lineage.py` matches streets to the OSM ways they lie on (#5741); `onboard_city.py` calls it on a build and
  `backfill_osm_lineage.py` on a live city.
- `overpass.py` is how both fetchers talk to the public Overpass server (identity, tiled requests, 30 s-and-doubling
  retries, exit 75 for "stop and resume later"). Stdlib + `requests` on purpose, so it has no geo dependency; anything
  needing shapely stays in the scripts that already import it (the tiling is in `backfill_osm_lineage.py`).
- `street_gradient.py` fills the `street_gradient` table from a bare-earth elevation model (`docs/street-gradient.md`).
