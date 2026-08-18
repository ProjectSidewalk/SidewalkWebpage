# Python utility tests

Unit tests for the two standalone Python scripts in [`scripts/`](../../scripts) — `label_clustering.py` and
`check_streets_for_imagery.py`. This is the **first** Python test layer for Project Sidewalk. See
[`docs/testing-and-ci.md`](../../docs/testing-and-ci.md) for where it fits in the overall testing plan.

## What is covered

The scripts were refactored (issues #4340, #4341) so their decision logic lives in small, **pure, importable**
functions, with network and file I/O isolated in thin wrappers and `main`. The tests target those pure functions — no
network, no live Google/Mapillary or app calls.

- `test_label_clustering.py` — the distance metric (`custom_dist`), coordinate cleaning (`clean_label_data`), per-type
  clustering (`cluster`), global cluster-id offsetting (`offset_and_combine`), and JSON assembly (`build_output_json`).
- `test_check_streets_for_imagery.py` — bounding-box math (`create_bounding_box`), vertex interpolation
  (`redistribute_vertices`), the GSV/Mapillary response parsers (`gsv_has_imagery`, `mapillary_has_imagery`), the
  imagery-decision thresholds (`imagery_verdict`, `street_has_no_imagery`), and the CSV writer (`write_output`).
- `test_verify_latlng_backfill.py` — the one-off checker in [`tools/`](../../tools), which is stdlib-only.

### Resilience coverage

`check_streets`'s scan is resilient (retry/backoff, fail-soft per-street, checkpoint-based resume), concurrent
(thread pool + token-bucket QPS cap), and captures imagery age. The tests exercise those paths without a network:
`make_fetch` retry/giveup (with an injected no-op `sleep`), the `RateLimiter` burst/throttle behavior (with an injected
clock + sleep), capture-date parsing/standardization (`standardize_capture_date`, `gsv_capture_date`, `summarize_dates`),
`process_street` outcomes incl. captured date range (no-imagery / has-imagery / failed on request or API error), the
checkpoint + summary persistence, and `main` end-to-end through the thread pool (happy, resume, fail-soft, interrupt,
and the `street_imagery_summary.csv` output) by `monkeypatch`-ing the fetch and using `tmp_path`. The two earlier bugs (#4342 —
bbox radius unit, no-op `print`) are now fixed, and `test_create_bounding_box_is_ordered_and_radius_scales` still pins
that the bounding-box radius is in kilometers.

## How to run

```bash
make test-python
```

That runs `pytest` inside the running `projectsidewalk-web` container — **twice**, once per interpreter the image
carries, because the two scripts run on different ones (#4396). `label_clustering.py` is shelled out to by the app, so
it is tested on the same `python3` (3.8) the deployed server uses; `check_streets_for_imagery.py`'s libraries need
≥ 3.11, so it is tested on `python3.13`. `make test-python-app` and `make test-python-tools` run one half each, and
both take `args=` for extra pytest flags.

The dependencies are preinstalled in the container: `requirements.txt` (the app's in-band deps: `pandas`, `scipy`, ...)
into 3.8, `requirements-offline-tools.txt` (`shapely`, `geopy`, ...) into 3.13, and `requirements-dev.txt` (pytest)
into both. To run a half directly, or on the host:

```bash
docker exec -it -e COVERAGE_OMIT=scripts/label_clustering.py projectsidewalk-web \
  sh -c "cd /home && python3.13 -m pytest test/python/test_check_streets_for_imagery.py"

pip install -r requirements-offline-tools.txt -r requirements-dev.txt
COVERAGE_OMIT=scripts/label_clustering.py pytest test/python/test_check_streets_for_imagery.py
```

Coverage is always on and always gated, so there are no `--cov` flags to pass; `COVERAGE_OMIT` is the one thing a
direct invocation needs, and omitting it fails the run rather than skipping the gate. See [Coverage](#coverage).

Config lives in [`pyproject.toml`](../../pyproject.toml) (`[tool.pytest.ini_options]` + `[tool.coverage.*]`): it scopes
collection to `test/python/` and puts `scripts/` and `tools/` on `sys.path` so the tests can `import label_clustering` /
`import check_streets_for_imagery` directly.

**Adding a test file:** nothing to register — each half runs the whole directory *minus* the single file the other
interpreter owns (`--ignore`, in the [`Makefile`](../../Makefile)'s `pytest-args-*` and the `python-tests` matrix in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)), so a new file runs in **both** halves. If it can only
work on one — it imports something the other interpreter can't — add an `--ignore` for it to the other half. Until you
do, that half fails on import, which is the intended way to find out.

## Coverage

Every run measures **line + branch** coverage (`pytest-cov`) and **fails under 100%** (`--cov-fail-under` in
`pyproject.toml`). The scripts are small and the logic is now pure, so full correctness coverage is the bar — a new
uncovered branch fails the suite. The HTTP/file I/O in `main` is exercised by mocking the network (`monkeypatch` of the
`_get_json`/`fetch_labels`/`post_results` wrappers) and using `tmp_path`, so no real network or DB is touched. The two
narrow exclusions are documented where they sit: the `if __name__ == '__main__'` entrypoint guards (never run under
pytest) and one provably-unreachable loop-exit branch in `check_streets` (`# pragma: no branch`, justified inline).

The gate has two arms, and the interpreter split makes keeping both slightly fiddly. Scoping is a bare `--cov` in
`addopts` plus `source = ["scripts"]`: `source` is what makes coverage report a file it never saw imported as 0%, so a
script that shows up with no tests at all fails the gate instead of going unmeasured — the arm a plain `include` would
drop. The catch is that it applies to the script the running interpreter *cannot* import too, so each half sets
**`COVERAGE_OMIT`** to that one file (`cov-omit-*` in the [`Makefile`](../../Makefile), `coverage-omit` in the CI
matrix). Leave it unset and nothing is omitted, so a hand-run fails the gate loudly rather than quietly measuring less
than it looks like it did. (`tools/` is outside `source` entirely: those are one-off utilities, not held to 100%.)

If you add logic, add a test — keep new code pure where possible (or hide I/O behind a thin wrapper and mock it) so the
100% gate stays meaningful rather than something to lower.

## CI status

Run by the **advisory** `python-tests` job in `.github/workflows/ci.yml` (`continue-on-error: true`) — it reports
failures but does not block PRs yet, matching how the DB-backed API tests were introduced. Ramp to blocking once the
suite is proven stable. It is a two-leg matrix mirroring `make test-python`: `Python tests (in-band script)` on 3.8 and
`Python tests (offline tooling)` on 3.13, with `fail-fast: false` so one half failing still reports the other.
