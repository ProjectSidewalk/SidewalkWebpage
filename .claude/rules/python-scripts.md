---
paths:
  - "scripts/**"
  - "test/python/**"
  - "requirements*.txt"
---

# Python utilities

Full details: `scripts/README.md` and `test/python/README.md`.

- **Two interpreters, and which one a script uses is a constraint.** `python3` is 3.8, the version the deployed app
  shells out to for `label_clustering.py`, so that script and `requirements.txt` must stay 3.8-installable. Everything
  offline runs as `python3.13` with `requirements-offline-tools.txt`. Never add a library to `requirements.txt` that
  has dropped 3.8.
- `label_clustering.py` runs in-band: `ClusterService.runMultiUserClustering` resolves it against the app root and
  `scripts/` is bundled into the staged package via `Universal / mappings` in `build.sbt`. Moving or renaming it
  means updating both.
- Keep I/O in thin wrappers and `main`; pure logic is importable and unit-tested under `test/python/`. Coverage is
  gated at 100% (`make test-python` runs both interpreter halves; a new test file runs in both by default).
