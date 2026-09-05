# Crop geometry golden fixtures

Reference outputs for `service.CropGeometry` / `service.CropSizingRule` (the Scala port of
[sidewalk-panorama-tools](https://github.com/ProjectSidewalk/sidewalk-panorama-tools) `CropRunner.py`), read by
`test/service/CropGeometrySpec.scala`. They were written by the Python reference itself, so the spec checks the port
against the original by test rather than by inspection; nothing at runtime or in the suite depends on panorama-tools.

| File | What | Lifetime |
|---|---|---|
| `synthetic-pano.png` | 1024×512 RGB pano; pixel `(x, y)` = `(x·255/1023, y·255/511, (7x + 13y) mod 256)`, so every pixel is distinct and a shift or seam error changes bytes | permanent |
| `mechanics.json` + `expected/<case>.png` | Hand-chosen windows: interior, seam wrap near both edges, pole shift at both edges, size cap, half-to-even rounding — the box the reference computed and the pixels it cut | permanent (topology, not the rule) |
| `sizing-v2.json` + `expected/sizing_e2e.png` | The sizing rule over a grid of label heights and pano resolutions (plus the values panorama-tools pins in its own suite), and one window cut end to end | versioned with the rule — regenerate when `CropSizingRule.Version` changes |

Windows on the synthetic pano are at most 512 px wide, so the reference never downscales and the pixel comparison is
exact; the 1440-px storage cap is asserted separately by dimensions, since the two sides' resamplers differ.

## Provenance

- Repository: `ProjectSidewalk/sidewalk-panorama-tools`, commit `fef9bca57e99a0525dc7eb3ce72fbcec22eb8cc6`
  (2026-09-03, "Merge pull request #98"). Sizing rule v2 per `CROP_RULE_VERSION`.
- `CropRunner.py` SHA-256 at that commit: `56784771c410f1ccadcbcc5ca13954e725e3a0d580005d583036db7eaef8d89b`.
- Environment: Python 3.8, Pillow 10.4.0 (the `projectsidewalk-web` container). `downloaders/__init__.py` was replaced
  by an empty file in the working copy so `CropRunner`'s `from downloaders.common import atomic_output_path` resolves
  without the download stack; no crop function is affected.
- Command, from this directory:

  ```
  PYTHONPATH=/path/to/sidewalk-panorama-tools python3 generate_fixtures.py
  ```

`generate_fixtures.py` calls `compute_crop_box`, `extract_crop`, `crop_window_width` and `predict_crop_size` directly
and saves PNG; `make_single_crop` is not used because it writes JPEG.
