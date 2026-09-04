# GSV FOV probe (issue #5083)

Measures which field of view Google Street View's JS renderer (`google.maps.StreetViewPanorama`, WebGL) holds
fixed when the viewport aspect ratio changes: a **horizontal FOV spanning the container width** (the
assumption baked into `public/js/common/pano-viewer/src/panoUtilities.js` — `f = (canvasWidth/2)/tan(fov/2)`),
a **pinned vertical FOV** (how Mapillary and Infra3d behave, bridged via `vFovToHFov()`, #4852), a pinned
diagonal, or none of these (e.g. clamping). Every production surface is 3:2, where the hypotheses coincide;
the Immersive Explore work (#5085) renders at arbitrary aspects, which is what forces the question.

The verdict is pinned by `test/js/gsvFovContract.test.js` against the recorded fixture
`test/js/fixtures/gsvFovMeasurements.json`; this directory is the harness that produces that fixture and the
committed experiment report (under `recorded/`).

## Verdict (2026-09-01 sweep, Maps 3.66.2d)

**`width-pinned-vfov-clamped`.** The renderer spans `zoomToFov(zoom)` across the container **width** — the
assumption `panoUtilities.js` already encodes — *except* that the implied vertical FOV is clamped to a
**[14.97°, 89.84°]** window. When a bound binds, vFov pins at the bound and hFov follows from the aspect
instead of from the curve. The clamp is silent: `getZoom()` still reads back the requested zoom.

```
vUnclamped = 2·atan(tan(hFov_curve/2) / aspect)
vFov       = clamp(vUnclamped, 14.97°, 89.84°)
hFov       = vUnclamped inside the window ? hFov_curve : 2·atan(tan(vFov/2) · aspect)
```

### Where the clamp bites

A bound binds at `aspect = tan(hFov_3:2 / 2) / tan(bound / 2)`, so with the measured 3:2 control hFovs:

| zoom | measured hFov at 3:2 | floor binds at aspect ≥ | ceiling binds at aspect ≤ |
|---|---|---|---|
| 1 | 89.88° | 7.59 | 1.00 |
| 2 | 53.06° | 3.80 | 0.50 |
| 3 | 28.03° | **1.90** | 0.25 |

The zoom-3 floor is the one to plan around: **1.90:1 is barely wider than 16:9**, so an ordinary widescreen
viewport at Explore's tightest zoom is already at the edge of the clamp, and a 21:9 one is well inside it.
The ceiling only bites at square-or-taller (zoom 1) and portrait (zooms 2–3). Every production surface today
is 3:2, where nothing binds and every hypothesis coincides — this only matters for #5085's arbitrary aspects.
`analyze.mjs` recomputes this table into `results.json` (`bindingAspects`) and the contract fixture, and
`test/js/gsvFovContract.test.js` pins it.

### Limitations

- **The bounds are only ever observed on the vertical axis, so "vFov clamp" is a modelling choice, not a
  measurement.** vFov sits on both bounds across the sweep. hFov never does: its minimum anywhere is 27.98°,
  far above the 14.97° floor, and its maximum is 89.90° — inside the cell-to-cell spread of the 89.84°
  ceiling, because the zoom-1 curve value (89.75°) and the ceiling coincide by construction of the container
  set. So no configuration ever asks the renderer for a horizontal FOV meaningfully outside the window, and
  an "either-axis cap at ~89.85° with an either-axis floor at ~14.97°" fits the data exactly as well as a
  vertical-only clamp. Separating them needs configurations that push hFov past a bound: a zoom-0 (or sub-1)
  run for the ceiling, and nothing zooms 1–3 can produce for the floor. The two models predict the same thing
  at every aspect and zoom Explore can reach, so this does not change the operative contract for #5085.
- **Zoom 0 was never measured** (see the zoom bullet under Method).
- **The bounds are constants across zoom, pano, size, and DPR in this data**, which is what the extreme
  containers were added to test — but "constant" here means "agrees to ~0.1° across the 12 cells that bind
  each bound", not "proven to be a hard-coded renderer constant".

## How to reproduce

Preconditions: the dev app running on `http://localhost:9000` (`BASE_URL` overrides), host Node with
`npm install` done, Playwright Chromium installed (`npx playwright install chromium`). A real Google Maps API
key is required; `record.mjs` uses `GOOGLE_MAPS_API_KEY` if set, else scrapes the key from the served app page
(so a working dev app is sufficient). The key is only ever embedded in the in-memory probe page — no run
artifact contains it.

```bash
node tools/gsv-fov-probe/record.mjs             # full sweep -> runs/<timestamp>/
node tools/gsv-fov-probe/analyze.mjs --latest   # -> results.json + report.md in the run dir

# The full re-record: analyze, refresh the committed record, and regenerate the contract fixture.
node tools/gsv-fov-probe/analyze.mjs --latest --emit-fixture --copy-recorded
```

Useful scoped runs: `--control-only` (method gate), `--panos tutorial` (deterministic local-tile scene),
`--zooms 1 --loads 1` (smoke), `--maps-version quarterly` (stability check), `--configs a,b`, `--headed`.
`analyze.mjs` also takes `--step N` (warp sampling stride) and `--no-cache`. Its per-pair fit cache is keyed
by the estimator's content hash and by each capture file's size + mtime, so an estimator edit or a
`--resume`-rewritten capture misses the cache rather than being served the previous attempt's fit.

Raw screenshots live under `runs/` (gitignored — captures of live imagery stay local). The committable
summary is copied to `recorded/<the run's date>/` by `analyze.mjs --copy-recorded`: `results.json`,
`report.md`, and `manifest-extract.json` — per-load h0 selection, console errors, aggregate settle statistics
and the resolved pano metadata. The full `manifest.json` is not committed (~11 MB of per-capture POV
readbacks that are only interpretable alongside the screenshots, which stay local); it is gitignored and
lives with the raw run in the archive. A run on a non-default Maps channel lands in a subdirectory named for
the channel, so a same-day stability run cannot overwrite the primary record. The raw runs behind
`recorded/2026-09-01/` (8.3 GB, 8,448 screenshots, both Maps channels) are archived long-term on
**makelab2** at
`~jonfroehlich/sidewalk-archives/gsv-fov-probe-2026-09-01/`; its `ARCHIVE-README.md` + `SHA256SUMS`
cover integrity verification and offline re-analysis (`analyze.mjs <run-dir>` needs no network or key).

### When to re-record

Nothing in CI watches Google's renderer. `test/js/gsvFovContract.test.js` is a blocking CI gate — it fails
the build when `panoUtilities.js` stops agreeing with the recorded measurements — but what it gates is *our*
code against a frozen fixture, never Google shipping a different projection. The signal for that is a product
one: **Explore's label markers drifting away from their features at non-3:2 viewport shapes** (3:2 is where
every hypothesis coincides, so a renderer change is invisible at production's current aspect). Re-record when
that shows up, when a Maps release notes anything about the Street View renderer or FOV, and before any work
that leans on these numbers at a new aspect. A re-record is the reproduce block above, end to end; the diff
to review is `recorded/<date>/results.json` (verdict, clamp window, binding aspects) and the regenerated
fixture.

## Method

For each configuration (pano × container × zoom), the recorder captures **symmetric heading pairs**
`h0 ∓ Δ/2` at pitch 0 and the analyzer fits the rendered pinhole focal length `f` (px) per pair by warping
one shot onto the other under the exact yaw homography `K·R·K⁻¹` parameterized by `f`, maximizing NCC over
the central 50% region (`estimator.cjs`; a plain patch-shift estimator seeds the fit, and the seed-vs-fit
agreement is gated — see gate 3). Then

```
hFov = 2·atan(W/2f)   vFov = 2·atan(H/2f)   dFov = 2·atan(√((W/2)²+(H/2)²)/f)
```

and the experiment asks which of the three is invariant across aspects.

Protocol details, all recorded in each run's `manifest.json`:

- **Containers**: `720×480` (3:2 control) · `854×480` (16:9, matched height) · `1120×480` (21:9) ·
  `720×405` (16:9, matched width) · `480×853` (portrait) · `480×480` · `1440×960` (3:2 at 2× size —
  separates aspect-pinning from pixel-count clamping) · `720×480 @ deviceScaleFactor 2` (CSS-px vs
  backing-store pinning; analysis divides fitted f by DSF).
- **Scenes**: the local-tile `tutorial` pano (deterministic control — repo-pinned tiles, rendered through the
  same `registerPanoProvider` + WebGL path as live imagery, low-res so its zoom-3 σ is larger) plus live
  panos resolved at record time from fixed coordinates (resolved pano id, imagery date, and tile worldSize —
  the generation proxy — go into the manifest).
- **Zooms** 1–3, which is what Explore clamps to. Zoom 0 is excluded on that basis plus a weaker one: the
  126.5° that `panoUtilities.js` uses there (vs the documented 180°) hints that the renderer is not a plain
  pinhole at extreme wide angles. That 126.5° was never measured here — it is the intercept of the linear
  branch in `panoUtilities.js`, from the undated "From experiments" table in that file's header, the same
  table this experiment found 0.35° off at zoom 3.
- **Δ** ∈ {1°, 2°, 4°}, plus 8° at zoom 1 (model gate below). One **pitch pair** (Δpitch = 2°) per h0 at
  zoom 2 measures the vertical focal length (anisotropy check).
- **h0 selection**: 8 candidate headings scored by central-region Laplacian variance at zoom 1; keep the 4
  best-textured, mutually ≥30° apart and ≥20° from the tile seam (centerHeading + 180°).
- **Settled captures**: after each POV set, screenshots repeat until two consecutive captures are
  byte-identical (min 3 shots, min 600 ms, 10 s timeout, iteration count logged) — both shots of every pair
  are terminal-state renders, so pan tweening, tile arrival, and LOD sharpening cannot contaminate a pair.
- **Fresh page + fresh `StreetViewPanorama` per (pano, container, load)** — never in-place resizing.
- **Renderer assertion**: each load hard-fails unless a container-filling `<canvas>` is mounted. The Maps
  API's non-WebGL tile fallback renders through a *different* documented FOV curve (`180/2^zoom`), so a
  silent fallback would poison the verdict.
- **Readbacks, not requests**: the fitted model uses post-set `getPov()`/`getZoom()` values, and the analyzer
  reports any zoom readback that differs from the request (clamp/quantization detection).
- **Two independent page loads** per configuration; estimates are clustered by (load, h0) for the bootstrap.
- **Maps API version**: the probe boots the same inline loader as `app/views/common/main.scala.html` with
  `v=weekly` (what production floats on); `google.maps.version` is recorded per run. A control + one extreme
  aspect are re-run under `v=quarterly` as a stability check.

## Statistics

Per cell (pano × container × zoom): median f over ~24 pair estimates, MAD-σ, outliers dropped outside
max(5·MAD, 0.1% of the cell's median f) — the absolute floor keeps an ultra-repeatable cell from rejecting
good pairs on its own precision (amendment 5). Rejections are reported split by cause (NCC validity floor vs
MAD). A cell dropping >20% of its pairs is marked unreliable and excluded from **every** gate and from the
verdict. 95% CI by cluster bootstrap (resampling (load, h0) clusters, 10k resamples, seeded/deterministic).
Per-pano results are never pooled: the decision rule must hold for every pano individually.

## Pre-registered gates and decision rule

Committed before the first analyzed sweep; thresholds live in `analyze.mjs` and are not tuned against data.

1. **Estimator validation** (`test/js/gsvFovProbeEstimator.test.js`): the fitter must recover known focal
   lengths from synthetically rendered pinhole pairs to <0.2% — on yaw pairs, pitch pairs, and off-center
   regions — before any live measurement is trusted.
2. **Method gate**: at the 3:2 control on live panos, measured hFov must reproduce `zoomToFov(zoom)` =
   {89.75°, 53°, 27.68°} for zoom {1, 2, 3} within max(1.5°, 3σ). Failing this invalidates the method (or the
   curve), and no verdict is issued until resolved.
3. **Model gate**: within each cell, per-Δ median f must agree to 0.5% (1°–8° at zoom 1), the pitch-pair
   vertical f must match the yaw f to 1%, and the patch-shift seed must agree with the warp fit to 3% at the
   median (the same bracket gate 1 holds it to synthetically). Failure ⇒ the renderer is not the assumed
   pinhole; escalate to "fit the actual projection" instead of an ill-posed h-vs-v verdict.
4. **Verdict rule**: for every pano, zoom, and non-3:2 aspect, compute dh = hFov − hFov(3:2 control), dv and
   ddiag likewise. A hypothesis (horizontal-, vertical-, diagonal-, long-axis-, or short-axis-pinned) is
   **supported** iff its FOV deviation satisfies |d| ≤ max(0.5°, 3σ) for *every* pano, zoom, and aspect; the
   verdict is the hypothesis iff exactly one is supported. The hypotheses are far apart (table below), so
   anything else is **indeterminate** → check for a clamp signature (invariance up to a kink, then plateau);
   if present, the deliverable becomes the measured hFov(zoom, aspect) table + clamp boundary as the
   empirical contract.

   *Amendment 5 (2026-09-03, after code review of the analyzed sweep — issue #5083):* four analysis changes,
   all made after the verdict was reached; none moves it, and no method, model, or verdict threshold changed.
   (a) The 5·MAD outlier window gained an absolute floor of **0.1% of the cell's median f**. Several pitch
   cells are repeatable to σ_f ≈ 0.01 px, where 5·MAD is a ±0.05 px acceptance window and legitimate pairs
   fall outside it — those cells were being marked unreliable by their own precision rather than by any bad
   measurement, and that (not the NCC floor) is what pushed half the pitch cells over the 20% drop threshold.
   (b) The anisotropy check now excludes unreliable cells, as every other gate and the verdict already did;
   it had been running over all 40 pitch cells, including the 18 the run had disowned. Vertical f matches
   horizontal f to ≤ 0.10% over the 22 cells the gate now rests on (≤ 0.12% over all 40). (c) The patch-shift
   seed's agreement with the warp fit is now recorded per pair and gated at the median (3%, the bracket gate
   1 holds the estimator to synthetically) — previously the seed was computed and discarded, and the README
   claimed a cross-check the analyzer never performed. (d) Per-cell rejections are reported split by cause
   (NCC validity floor vs MAD) and a per-pair NCC histogram goes into `results.json`, so amendment 4's
   pair-level claims are checkable from the committed artifacts — which is how its pair count was found to be
   wrong (40 NCC-floor rejections, not 4) and corrected above. With the MAD floor in place the two causes
   separate cleanly: **40 NCC rejections, all in pitch cells; 34 MAD rejections, all in yaw cells**, and no
   yaw cell is unreliable.

   *Amendment 4 (2026-09-01, after the full analyzed sweep):* a pair-level validity floor `MIN_PAIR_NCC = 0.8`
   was added ahead of the MAD outlier filter. Observed pair NCC is sharply bimodal — ≥ 0.90 on every credible
   fit, ≤ 0.40 when the rotated sliver held featureless sky/road, with nothing at all in between (40 of 3,520
   pairs fall below the floor, every one of them a pitch pair; the per-pair histogram in `results.json` is
   the evidence) — and a 4-pair pitch cell with 2 garbage pairs defeats the MAD filter (the median lands
   between clusters, so nothing is rejected, and the cell's "vertical f" is a meaningless midpoint). The
   floor is a measurement-validity criterion (did the warp correlate at all?), blind to the fitted f's value
   and direction, so it cannot steer the verdict. Gate thresholds unchanged. Separately, the **model gate is
   reported as exceeded, not patched**: square-480x480 at zoom 1 shows a per-Δ spread of 0.50–0.62% vs the
   0.5% threshold on 2 of 4 panos. The signature — only the Δ=1° medians read ~0.4% low, identically on all
   four panos, with Δ=2/4/8 agreeing to ~0.15% — is sub-pixel estimator bias at the design's smallest image
   displacement (f ≈ 240 px ⇒ ~4 px per degree), bounded at ≤ 0.25° of FOV at 90°, far below the 6°–50°
   hypothesis separations. The threshold was not loosened; the exceedance and its diagnosis are carried in
   the report.

   *Amendment 3 (2026-09-01, after the full sweep, before any threshold change):* the `seattle-downtown`
   coordinates resolved to a user-contributed photosphere (`sources: ['outdoor']` does not exclude
   third-party imagery) whose tiles render black in the probe, so every fit for that scene ran on black
   frames — NCC undefined, f pinned at the optimizer bounds — and dragged all three gates to FAIL. This is
   a scene-acquisition failure, not a measurement outcome: the fix is `sources: ['google', 'outdoor']`
   (official imagery only) in the probe's `getPanorama` call, plus purging and re-recording that one scene.
   No thresholds, hypotheses, or decision rules changed; the other three scenes' data is untouched.

   *Amendment 2 (2026-08-31, after the first partial sweep — tutorial pano complete, live panos only at
   control + 16:9):* the partial data showed a **composite** contract none of the named hypotheses fits:
   width-pinned to <0.03° across every landscape aspect, size, and DPR — but portrait-480x853 at zoom 1
   rendered vFov ≈ 89.8° (unclamped prediction: 121°) and wide219h-1120x480 at zoom 3 rendered
   vFov ≈ 14.95° (unclamped prediction: 12.1°), both with zoom readbacks still reporting the requested
   value. The classifier gains `width-pinned-vfov-clamped` (accepted only when every non-h-invariant cell is
   exactly a binding case and binding cells agree on the bound values), and two discriminator containers
   were added — `xportrait-360x1000` and `xwide-2400x480` — chosen so the bounds bind at zooms the milder
   containers cannot reach, pinning whether each bound is zoom-dependent. Thresholds unchanged; added
   before the confirmatory live-pano data at any portrait/21:9 aspect existed.

   *Amendment 1 (2026-08-31, before the confirmatory live-pano sweep):* the original rule named only
   horizontal / vertical / diagonal pinning. A mechanical shakedown on the tutorial pano (zoom 1 only)
   showed hFov held at 21:9 **and** vFov held at portrait — i.e., the FOV appears pinned to whichever
   container axis is *longer*, which none of the original three hypotheses names. **Long-axis-pinned** and
   its mirror short-axis-pinned were added to the classifier at that point, before any live-pano data was
   analyzed. The landscape + portrait + square container set separates long-axis-pinned from
   horizontal-pinned (they coincide on landscape-only data); thresholds were not changed.

### Predicted separation between the two main hypotheses

hFov each hypothesis predicts, using the 3:2-calibrated curve (`zoomToFov`) as the shared anchor. Measurement
σ is expected well under 0.5°, so these are 10σ–100σ separations.

| container | aspect | zoom | hFov if h-pinned | hFov if v-pinned | separation |
|---|---|---|---|---|---|
| wide169h-854x480 | 1.779 | 1 | 89.8° | 99.5° | 9.7° |
| wide169h-854x480 | 1.779 | 2 | 53.0° | 61.2° | 8.2° |
| wide169h-854x480 | 1.779 | 3 | 27.7° | 32.6° | 4.9° |
| wide219h-1120x480 | 2.333 | 1 | 89.8° | 114.3° | 24.6° |
| wide219h-1120x480 | 2.333 | 2 | 53.0° | 75.6° | 22.6° |
| wide219h-1120x480 | 2.333 | 3 | 27.7° | 41.9° | 14.3° |
| wide169w-720x405 | 1.778 | 1 | 89.8° | 99.4° | 9.7° |
| wide169w-720x405 | 1.778 | 2 | 53.0° | 61.2° | 8.2° |
| wide169w-720x405 | 1.778 | 3 | 27.7° | 32.6° | 4.9° |
| portrait-480x853 | 0.563 | 1 | 89.8° | 41.0° | −48.8° |
| portrait-480x853 | 0.563 | 2 | 53.0° | 21.2° | −31.8° |
| portrait-480x853 | 0.563 | 3 | 27.7° | 10.6° | −17.1° |
| square-480x480 | 1.000 | 1 | 89.8° | 67.1° | −22.6° |
| square-480x480 | 1.000 | 2 | 53.0° | 36.8° | −16.2° |
| square-480x480 | 1.000 | 3 | 27.7° | 18.7° | −9.0° |

## Side questions the same data answers

- The empirical WebGL curve (53° at zoom 2) vs GSV's documented `180/2^zoom` (45°) — the method gate measures
  the curve directly.
- Whether FOV is pinned in CSS px or backing-store px (the DSF-2 config).
- Whether behavior depends on canvas size at fixed aspect (the 2× config).
- Optionally, a `--disable-webgl` phase-2 run can measure the 2D tile fallback's curve, which
  `centeredPovToCanvasCoord2d` assumes to be `180/2^zoom`.

## Files

- `probe.html` — bare page: production's Maps bootstrap (placeholders substituted at serve time), a
  `StreetViewPanorama` with GsvViewer's exact options, the tutorial `registerPanoProvider`, and
  `window.__probe = {init, setPov, getState}`. Served by `record.mjs` on the dev app's origin via a
  Playwright route (tutorial tiles resolve; the key sees the app's own referer); never linked from the app.
- `record.mjs` — the sweep driver (Playwright library API; not part of any test suite or CI).
- `estimator.cjs` — pure-computation focal fit + statistics; unit-tested in `test/js/`.
- `analyze.mjs` — fits all pairs, applies gates + decision rule, writes `results.json` / `report.md`.
- `runs/` (gitignored) — raw captures + manifests. `recorded/<run date>/` (committed) — numbers-only
  summaries: `results.json`, `report.md`, `manifest-extract.json`, and a per-channel subdirectory for any
  non-`weekly` stability run. `NOTES.md` there, where present, is hand-written and says so.
