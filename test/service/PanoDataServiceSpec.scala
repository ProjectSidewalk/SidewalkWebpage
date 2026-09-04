package service

import models.label.POV
import models.pano.PanoSource
import models.utils.CommonUtils
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) unit tests for the label lat/lng estimator (#4765/#4766): the saturating-cotangent
 * distance blend and the exact-bearing destination in `PanoDataService.toLatLng`.
 *
 * Every expected value below is pinned from the research, not from running this implementation and recording what it
 * said. Two published summaries in the label-latlng-estimation repo are the source: `final_coefficients` in
 * `data/modern-truth-summary.json` (the camera height and `max_answer_m`) and `provisional_coefficients` +
 * `meta.dist_cap_m` in `data/distance-refit-summary.json` (the blend angle and the distance cap). Distances at
 * specific depressions come from an independent transcription of the blend against those constants, so a
 * transcription error on either side fails loudly here.
 *
 * A refit that changes the constants must re-pin these from the new summary in the same change — and the jsdom
 * suite's fixture with them (test/js/exploreLabelLatLngEstimate.test.js).
 */
class PanoDataServiceSpec extends AnyFunSuite with Matchers {

  private val eps = 1e-9

  test("cotangent branch: distance is the camera height over tan(depression)") {
    // At 45 degrees the cotangent is 1, so the answer is the fitted camera height itself.
    PanoDataService.estimateDistanceFromPanoM(45.0) shouldBe (2.341219672825709 +- eps)
    PanoDataService.estimateDistanceFromPanoM(15.0) shouldBe (8.737550770665331 +- eps)
    PanoDataService.estimateDistanceFromPanoM(30.0) shouldBe (4.055111425013912 +- eps)
    PanoDataService.estimateDistanceFromPanoM(60.0) shouldBe (1.351703808337971 +- eps)
  }

  test("blend handoff: the two branches agree at the blend angle") {
    val atBlend   = PanoDataService.estimateDistanceFromPanoM(11.25)
    val justBelow = PanoDataService.estimateDistanceFromPanoM(11.25 - 1e-9)
    atBlend shouldBe (11.770106120938644 +- eps)
    justBelow shouldBe (atBlend +- 1e-6)
  }

  test("near-horizon tail: linear down to the horizon, then flat above it") {
    PanoDataService.estimateDistanceFromPanoM(5.0) shouldBe (18.480192309211834 +- eps)
    PanoDataService.estimateDistanceFromPanoM(2.0) shouldBe (21.701033679582963 +- eps)
    // The largest answer the blend can produce for any input, pinned as max_answer_m in the fit's summary.
    PanoDataService.estimateDistanceFromPanoM(0.0) shouldBe (23.848261259830384 +- eps)
    PanoDataService.estimateDistanceFromPanoM(-10.0) shouldBe (23.848261259830384 +- eps)
  }

  test("distance decreases monotonically as the depression angle grows") {
    val distances = (-5 to 85).map(d => PanoDataService.estimateDistanceFromPanoM(d.toDouble))
    distances.zip(distances.tail).foreach { case (nearHorizon, steeper) => steeper should be <= nearHorizon }
  }

  test("toLatLng: a label on the pano's center column lands along the camera heading") {
    val (panoLat, panoLng, cameraHeading) = (47.6553, -122.3035, 90.0)
    val (panoWidth, panoHeight)           = (13312, 6656)
    val (panoX, panoY)                    = (panoWidth / 2, 4160) // 62.5% down the pano = 22.5 degrees depression.
    val expectedDistanceM                 = PanoDataService.estimateDistanceFromPanoM(22.5)
    val (expectedLat, expectedLng)        =
      CommonUtils.calculateDestination(panoLat, panoLng, expectedDistanceM / 1000.0, cameraHeading)
    val (lat, lng) =
      PanoDataService.toLatLng(panoLat, panoLng, panoX, panoY, panoWidth, panoHeight, cameraHeading)
    lat shouldBe (expectedLat +- eps)
    lng shouldBe (expectedLng +- eps)
  }

  test("toLatLng: an off-center label bears away from the camera heading by its share of the pano's width") {
    // The pano's left edge looks 180 degrees behind the camera and each fraction of the width is that fraction of a
    // full turn clockwise from it, so a quarter of the way across is 90 degrees counter-clockwise of the camera
    // heading. Stated from the projection rather than read back out of calculatePovFromPanoXY, so a flipped sign or a
    // dropped half-turn in that mapping fails here.
    val (panoLat, panoLng, cameraHeading) = (47.6553, -122.3035, 237.5)
    val (panoWidth, panoHeight)           = (13312, 6656)
    val panoY                             = 4160 // 62.5% down the pano = 22.5 degrees depression.
    val distanceKm                        = PanoDataService.estimateDistanceFromPanoM(22.5) / 1000.0
    val (expectedLat, expectedLng)        =
      CommonUtils.calculateDestination(panoLat, panoLng, distanceKm, cameraHeading - 90.0)
    val (lat, lng) =
      PanoDataService.toLatLng(panoLat, panoLng, panoWidth / 4, panoY, panoWidth, panoHeight, cameraHeading)
    lat shouldBe (expectedLat +- eps)
    lng shouldBe (expectedLng +- eps)
  }

  test("toLatLng: a bearing that comes out negative lands where its in-range equivalent does") {
    // Scala's % keeps the sign of its left operand, so a westward camera heading leaves the bearing negative rather
    // than wrapping into [0, 360). The destination formula is periodic, so the two must agree.
    val (panoLat, panoLng)      = (47.6553, -122.3035)
    val (panoWidth, panoHeight) = (13312, 6656)
    val panoY                   = 4160
    val distanceKm              = PanoDataService.estimateDistanceFromPanoM(22.5) / 1000.0
    // panoX one eighth across gives 10 - 180 + 45 = -125 degrees, whose in-range equivalent is 235.
    val (expectedLat, expectedLng) = CommonUtils.calculateDestination(panoLat, panoLng, distanceKm, 235.0)
    val (lat, lng)                 =
      PanoDataService.toLatLng(panoLat, panoLng, panoWidth / 8, panoY, panoWidth, panoHeight, 10.0)
    lat shouldBe (expectedLat +- eps)
    lng shouldBe (expectedLng +- eps)
  }

  test("toLatLng is independent of panorama resolution (#4765)") {
    // The same scene at two native resolutions: pano coordinates scaled proportionally must give the same lat/lng.
    val lowRes  = PanoDataService.toLatLng(47.6553, -122.3035, 1440, 1800, 5760, 2880, 237.5)
    val highRes = PanoDataService.toLatLng(47.6553, -122.3035, 3328, 4160, 13312, 6656, 237.5)
    lowRes._1 shouldBe (highRes._1 +- eps)
    lowRes._2 shouldBe (highRes._2 +- eps)
  }

  // Forward projection (calculatePovIfCentered + calculatePanoXYFromPov), the record-consistency math for #4842.
  // Every expected value is pinned from sidewalk-panorama-tools' pov_replay.py — the NumPy port whose fidelity the
  // era-replay study measured at 100% of 438k labels — not from running this implementation. Two fixtures are real
  // production records: Teaneck label 14955's stored record reproducing its stored pano (5217, 4972), and Chicago
  // label 65640's REPAIRED record reproducing its truth (6453, 4688) (off-target-markers report §5-6).

  test("a click at the canvas center is the viewport itself") {
    val pov = PanoDataService.calculatePovIfCentered(POV(123.4, -17.25, 1.0), 360.0, 240.0, 720, 480, PanoSource.Gsv)
    pov.heading shouldBe (123.4 +- eps)
    pov.pitch shouldBe (-17.25 +- eps)
    PanoDataService.calculatePanoXYFromPov(pov, 100.0, 16384, 8192) shouldBe ((9257, 4881))
  }

  test("a real record reproduces its stored pano_x/pano_y (Teaneck 14955)") {
    val pov = PanoDataService.calculatePovIfCentered(POV(298.25, -35.0, 1.0), 451.0, 142.0, 720, 480, PanoSource.Gsv)
    pov.heading shouldBe (312.7293509714128 +- 1e-6) // -47.27065 wrapped into [0, 360)
    pov.pitch shouldBe (-19.252086018069306 +- 1e-6)
    PanoDataService.calculatePanoXYFromPov(pov, 18.107881546020508, 16384, 8192) shouldBe ((5217, 4972))
  }

  test("a repaired record lands on the label's truth coordinate (Chicago 65640)") {
    val pov =
      PanoDataService.calculatePovIfCentered(POV(155.9336, -15.0063, 3.0), 81.0, 195.0, 720, 480, PanoSource.Gsv)
    PanoDataService.calculatePanoXYFromPov(pov, 183.0481719970703, 16384, 8192) shouldBe ((6453, 4688))
  }

  // The frame contract (#5085): only the frame's aspect ratio enters the projection, so a uniformly scaled frame
  // is the same frame, and a frame of a different shape is not (docs/label-latlng-estimation.md, "The frame contract").
  test("the same click fractions in a 720x480 and a 1440x960 frame give one direction") {
    val boxed  = PanoDataService.calculatePovIfCentered(POV(298.25, -35.0, 1.0), 451.0, 142.0, 720, 480, PanoSource.Gsv)
    val scaled =
      PanoDataService.calculatePovIfCentered(POV(298.25, -35.0, 1.0), 902.0, 284.0, 1440, 960, PanoSource.Gsv)
    scaled.heading shouldBe (boxed.heading +- eps)
    scaled.pitch shouldBe (boxed.pitch +- eps)
  }

  test("an off-center click read against a 720x405 frame is a different direction than against 720x480") {
    val boxed = PanoDataService.calculatePovIfCentered(POV(298.25, -35.0, 1.0), 451.0, 142.0, 720, 480, PanoSource.Gsv)
    val wide  = PanoDataService.calculatePovIfCentered(POV(298.25, -35.0, 1.0), 451.0, 142.0, 720, 405, PanoSource.Gsv)
    // The vertical origin moved by 37.5 px, about 5.4 deg of pitch at zoom 1; the heading shifts under a degree, only
    // through the viewport's own tilt.
    wide.heading shouldBe (boxed.heading +- 1.5)
    math.abs(wide.pitch - boxed.pitch) should be > 2.0
  }

  // GSV's vertical-fov clamp (#5083), the same model as util.pano.renderedHFov; test/js/panoProjection.test.js pins
  // the JS half against the same numbers, and test/js/gsvFovContract.test.js pins the JS half against the recording.
  test("renderedHFov is the zoom curve at 3:2 on every source and at any aspect off GSV") {
    for (zoom <- Seq(1.0, 2.0, 3.0)) {
      PanoDataService.renderedHFov(zoom, 1.5, PanoSource.Gsv) shouldBe (PanoDataService.getFov(zoom) +- eps)
      PanoDataService.renderedHFov(zoom, 2.0, PanoSource.Mapillary) shouldBe (PanoDataService.getFov(zoom) +- eps)
    }
  }

  test("renderedHFov follows GSV's clamped vertical field on wide and tall viewports") {
    // 2:1 at zoom 3 implies a 14.05 deg vertical field, under the 14.97 floor: the floor pins and hFov widens to ~29.4.
    PanoDataService.renderedHFov(3.0, 2.0, PanoSource.Gsv) shouldBe (29.44 +- 0.01)
    // 3:4 at zoom 1 implies 106 deg vertically, over the 89.84 ceiling: hFov narrows to ~73.6.
    PanoDataService.renderedHFov(1.0, 0.75, PanoSource.Gsv) shouldBe (73.58 +- 0.01)
    PanoDataService.GSV_VFOV_CLAMP_DEG shouldBe ((14.97, 89.84))
  }

  test("a wide-frame click on GSV is replayed with the clamped fov, not the curve") {
    val clamped = PanoDataService.calculatePovIfCentered(POV(100.0, -10.0, 3.0), 700.0, 200.0, 720, 360, PanoSource.Gsv)
    val curve   =
      PanoDataService.calculatePovIfCentered(POV(100.0, -10.0, 3.0), 700.0, 200.0, 720, 360, PanoSource.Mapillary)
    math.abs(clamped.heading - curve.heading) should be > 0.5 // ~29.4 vs 27.7 deg across 720 px, read 340 px off center.
  }

  test("pano x wraps at the seam instead of going out of range") {
    // A corner click on a viewport just west of north, camera looking almost due north: x must wrap into range.
    val pov = PanoDataService.calculatePovIfCentered(POV(359.5, -10.0, 2.0), 700.0, 460.0, 720, 480, PanoSource.Gsv)
    pov.heading shouldBe (26.307176630462052 +- 1e-6)
    pov.pitch shouldBe (-24.403575993903466 +- 1e-6)
    val (panoX, panoY) = PanoDataService.calculatePanoXYFromPov(pov, 0.25, 13312, 6656)
    (panoX, panoY) shouldBe ((7620, 4230))
    panoX should (be >= 0 and be < 13312)
  }

  test("the forward projection round-trips through calculatePovFromPanoXY") {
    // Project a click to pano pixels, invert with the existing inverse: the label direction must come back
    // (to within the half-pixel the integer pano coordinate quantizes away).
    val pov = PanoDataService.calculatePovIfCentered(POV(210.0, -22.0, 2.0), 500.0, 300.0, 720, 480, PanoSource.Gsv)
    val (px, py)     = PanoDataService.calculatePanoXYFromPov(pov, 47.5, 16384, 8192)
    val roundTripped = PanoDataService.calculatePovFromPanoXY(px, py, 16384, 8192, 47.5)
    roundTripped.heading shouldBe (pov.heading +- 0.05)
    roundTripped.pitch shouldBe (pov.pitch +- 0.05)
  }
}
