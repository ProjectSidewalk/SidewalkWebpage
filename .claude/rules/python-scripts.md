---
paths:
  - "scripts/**"
  - "tools/**"
  - "test/python/**"
  - "requirements*.txt"
---

# Python utilities

Full details: `tools/README.md` (which folder a script belongs in), `tools/city/README.md`, `scripts/README.md`
and `test/python/README.md`.

- **Two interpreters, and which one a script uses is a constraint.** `python3` is 3.8, the version the deployed app
  shells out to for `label_clustering.py`, so that script and `requirements.txt` must stay 3.8-installable. Everything
  offline runs as `python3.13` with `requirements-offline-tools.txt`. Never add a library to `requirements.txt` that
  has dropped 3.8.
- `label_clustering.py` runs in-band: `ClusterService.runMultiUserClustering` resolves it against the app root and
  `scripts/` is bundled into the staged package via `Universal / mappings` in `build.sbt`. Nothing else goes in
  `scripts/`.
- Keep I/O in thin wrappers and `main`; pure logic is importable and unit-tested under `test/python/`. Coverage is
  gated at 100% over `scripts/` and `tools/` alike (`make test-python` runs both interpreter halves; a new test file
  runs in both by default). Exempt: `tools/one-off/`, `tools/experiments/` and the route lint, listed in `pyproject.toml`.
- `onboard_city.py` (new-city street/region build) and `check_streets_for_imagery.py` (imagery scan + `--sample`
  preflight) are the onboarding pair; `tools/city/setup_new_city.py` orchestrates them with the db scripts. Runbook:
  `docs/onboarding-a-city.md`. Their test files are 3.13-only, so the 3.8 half `--ignore`s them (Makefile + CI matrix
  must agree).
- `street_gradient.py` fills the `street_gradient` table from a bare-earth elevation model (`docs/street-gradient.md`).
  Also 3.13-only (rasterio), so it takes the same `--ignore` plus the 3.8 half's third `COVERAGE_OMIT3` slot.
