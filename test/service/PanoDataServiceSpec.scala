package service

import models.utils.CommonUtils
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * Pure (no DB, no app boot) unit tests for the label lat/lng estimator (#4765/#4766): the saturating-cotangent
 * distance blend and the exact-bearing destination in `PanoDataService.toLatLng`.
 *
 * The expected values are pinned from the fit's published summary (`data/distance-refit-summary.json` in the
 * label-latlng-estimation repo) and an independent transcription of the blend, so a transcription error in either
 * place fails loudly. A future refit that changes the constants should update these pins from the new summary in the
 * same change.
 */
class PanoDataServiceSpec extends AnyFunSuite with Matchers {

  private val eps = 1e-9

  test("cotangent branch: distance is the per-type height over tan(depression)") {
    // At 45 degrees the cotangent is 1, so the answer is the type's fitted height itself.
    PanoDataService.estimateDistanceFromPanoM("CurbRamp", 45.0) shouldBe (2.783228790539168 +- eps)
    PanoDataService.estimateDistanceFromPanoM("Obstacle", 5.0) shouldBe (21.257839366285314 +- eps)
    PanoDataService.estimateDistanceFromPanoM("NoCurbRamp", 22.5) shouldBe (6.169799172180997 +- eps)
  }

  test("blend handoff: the two branches agree at the blend angle") {
    val atBlend   = PanoDataService.estimateDistanceFromPanoM("SurfaceProblem", 11.25)
    val justBelow = PanoDataService.estimateDistanceFromPanoM("SurfaceProblem", 11.25 - 1e-9)
    atBlend shouldBe (12.563905025558343 +- eps)
    justBelow shouldBe (atBlend +- 1e-6)
  }

  test("near-horizon tail: bounded at the published maximum, and flat above the horizon") {
    // The largest answer the blend can produce for any input is the horizon answer for the tallest fitted height
    // (CurbRamp), pinned as max_answer_m in the fit's summary.
    PanoDataService.estimateDistanceFromPanoM("CurbRamp", 0.0) shouldBe (28.3506789700554 +- eps)
    PanoDataService.estimateDistanceFromPanoM("CurbRamp", -10.0) shouldBe (28.3506789700554 +- eps)
  }

  test("distance decreases monotonically as the depression angle grows") {
    val distances = (-5 to 85).map(d => PanoDataService.estimateDistanceFromPanoM("CurbRamp", d.toDouble))
    distances.zip(distances.tail).foreach { case (nearHorizon, steeper) => steeper should be <= nearHorizon }
  }

  test("label types absent from the fit use the pooled fallback height") {
    PanoDataService.estimateDistanceFromPanoM("Crosswalk", 20.0) shouldBe (7.459717714565474 +- eps)
    PanoDataService.estimateDistanceFromPanoM("Signal", 20.0) shouldBe
      (PanoDataService.estimateDistanceFromPanoM("Crosswalk", 20.0) +- eps)
  }

  test("toLatLng: a label on the pano's center column lands along the camera heading") {
    val (panoLat, panoLng, cameraHeading) = (47.6553, -122.3035, 90.0)
    val (panoWidth, panoHeight)           = (13312, 6656)
    val (panoX, panoY)                    = (panoWidth / 2, 4160) // 62.5% down the pano = 22.5 degrees depression.
    val expectedDistanceM                 = PanoDataService.estimateDistanceFromPanoM("CurbRamp", 22.5)
    val (expectedLat, expectedLng)        =
      CommonUtils.calculateDestination(panoLat, panoLng, expectedDistanceM / 1000.0, cameraHeading)
    val (lat, lng) =
      PanoDataService.toLatLng(panoLat, panoLng, "CurbRamp", panoX, panoY, panoWidth, panoHeight, cameraHeading)
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
    val distanceKm                        = PanoDataService.estimateDistanceFromPanoM("CurbRamp", 22.5) / 1000.0
    val (expectedLat, expectedLng)        =
      CommonUtils.calculateDestination(panoLat, panoLng, distanceKm, cameraHeading - 90.0)
    val (lat, lng) =
      PanoDataService.toLatLng(panoLat, panoLng, "CurbRamp", panoWidth / 4, panoY, panoWidth, panoHeight, cameraHeading)
    lat shouldBe (expectedLat +- eps)
    lng shouldBe (expectedLng +- eps)
  }

  test("toLatLng: a bearing that comes out negative lands where its in-range equivalent does") {
    // Scala's % keeps the sign of its left operand, so a westward camera heading leaves the bearing negative rather
    // than wrapping into [0, 360). The destination formula is periodic, so the two must agree.
    val (panoLat, panoLng)      = (47.6553, -122.3035)
    val (panoWidth, panoHeight) = (13312, 6656)
    val panoY                   = 4160
    val distanceKm              = PanoDataService.estimateDistanceFromPanoM("CurbRamp", 22.5) / 1000.0
    // panoX one eighth across gives 10 - 180 + 45 = -125 degrees, whose in-range equivalent is 235.
    val (expectedLat, expectedLng) = CommonUtils.calculateDestination(panoLat, panoLng, distanceKm, 235.0)
    val (lat, lng)                 =
      PanoDataService.toLatLng(panoLat, panoLng, "CurbRamp", panoWidth / 8, panoY, panoWidth, panoHeight, 10.0)
    lat shouldBe (expectedLat +- eps)
    lng shouldBe (expectedLng +- eps)
  }

  test("toLatLng is independent of panorama resolution (#4765)") {
    // The same scene at two native resolutions: pano coordinates scaled proportionally must give the same lat/lng.
    val lowRes  = PanoDataService.toLatLng(47.6553, -122.3035, "CurbRamp", 1440, 1800, 5760, 2880, 237.5)
    val highRes = PanoDataService.toLatLng(47.6553, -122.3035, "CurbRamp", 3328, 4160, 13312, 6656, 237.5)
    lowRes._1 shouldBe (highRes._1 +- eps)
    lowRes._2 shouldBe (highRes._2 +- eps)
  }
}
