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

### Known-bug notes

Two genuine bugs found during the review are **deferred** to issue #4342 (so the refactor stays behavior-preserving):
the first Mapillary endpoint uses a 25 km bbox instead of 25 m, and `write_output` has a no-op `print`. The tests do
**not** assert the buggy behavior, but `test_create_bounding_box_is_ordered_and_radius_scales` documents that the
bounding-box radius is in kilometers, which is what makes the unit mismatch a bug. When #4342 is fixed, no test here
should need to change.

## How to run

The scripts' runtime dependencies (`pandas`, `scipy`, `shapely`, `geopy`, ...) are installed in the **web** Docker
container from `requirements.txt`, and `pytest` from `requirements-dev.txt`. From the repo root:

```bash
make test-python
```

That runs `pytest` inside the running `projectsidewalk-web` container. To run directly:

```bash
docker exec -it projectsidewalk-web sh -c "cd /home && python3 -m pytest test/python"
```

Or on the host, if you have the deps installed locally:

```bash
pip install -r requirements.txt -r requirements-dev.txt
pytest
```

Config lives in [`pyproject.toml`](../../pyproject.toml) (`[tool.pytest.ini_options]` + `[tool.coverage.*]`): it scopes
collection to `test/python/` and puts `scripts/` on `sys.path` so the tests can `import label_clustering` /
`import check_streets_for_imagery` directly.

## Coverage

Every run measures **line + branch** coverage of `scripts/` (`pytest-cov`) and **fails under 100%** (`--cov-fail-under`
in `pyproject.toml`). The scripts are small and the logic is now pure, so full correctness coverage is the bar — a new
uncovered branch fails the suite. The HTTP/file I/O in `main` is exercised by mocking the network (`monkeypatch` of the
`_get_json`/`fetch_labels`/`post_results` wrappers) and using `tmp_path`, so no real network or DB is touched. The two
narrow exclusions are documented where they sit: the `if __name__ == '__main__'` entrypoint guards (never run under
pytest) and one provably-unreachable loop-exit branch in `check_streets` (`# pragma: no branch`, justified inline).

If you add logic, add a test — keep new code pure where possible (or hide I/O behind a thin wrapper and mock it) so the
100% gate stays meaningful rather than something to lower.

## CI status

Run by the **advisory** `python-tests` job in `.github/workflows/ci.yml` (`continue-on-error: true`) — it reports
failures but does not block PRs yet, matching how the DB-backed API tests were introduced. Ramp to blocking once the
suite is proven stable.
