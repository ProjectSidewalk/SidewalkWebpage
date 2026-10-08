package service

import models.label.LabelPointTable
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers

/**
 * The pure marker and upload-shape rules in the `CropService` companion (#2660, #5085): where a label lands on a
 * crop or a Street View still given the frame it was placed in, and which uploads `POST /saveImage` will decode.
 */
class CropMarkerSpec extends AnyFunSuite with Matchers {
  private val (boxedW, boxedH) = (LabelPointTable.canvasWidth, LabelPointTable.canvasHeight)

  test("exploreFrameMarker is the click as a fraction of the label's own frame") {
    val boxed = CropService.exploreFrameMarker(180, 360, boxedW, boxedH)
    (boxed.x, boxed.y) shouldBe ((0.25, 0.75))
    // The same canvas_y is a different fraction of a 16:9 frame.
    val wide = CropService.exploreFrameMarker(180, 360, 720, 405)
    wide.x shouldBe 0.25
    wide.y shouldBe (360.0 / 405) +- 1e-12
  }

  test("stillMarker is the identity for the boxed frame the still reproduces") {
    val m = CropService.stillMarker(180, 360, boxedW, boxedH)
    (m.x, m.y) shouldBe ((0.25, 0.75))
  }

  test("stillMarker centres a 16:9 frame vertically in the 3:2 still, as the JS card helper does") {
    // A point a quarter of the way down a 720x405 frame: the still shares the frame's width and horizontal fov and
    // shows more sky and ground around it, so the point moves toward the still's centre, by the ratio of the aspects.
    val stillAspect = boxedW.toDouble / boxedH
    val m           = CropService.stillMarker(180, 101, 720, 405)
    m.x shouldBe 0.25
    m.y shouldBe (0.5 - (0.5 - 101.0 / 405) * (stillAspect / (720.0 / 405))) +- 1e-12
    m.y should be > (101.0 / 405)
    m.y should be < 0.5
  }

  test("stillMarker clamps a point a tall frame pushes off the still") {
    // A portrait frame's top edge lands above the still.
    CropService.stillMarker(100, 0, 400, 800).y shouldBe 0.0
  }

  test("exploreSnapshotSize is 1440 wide at the frame's aspect") {
    CropService.exploreSnapshotSize(boxedW, boxedH) shouldBe ((1440, 960))
    CropService.exploreSnapshotSize(720, 405) shouldBe ((1440, 810))
    CropService.exploreSnapshotSize(1920, 1080) shouldBe ((1440, 810))
  }

  test("acceptsSnapshot takes the shapes a labeling frame can have and refuses the rest") {
    CropService.acceptsSnapshot(1440, 960) shouldBe true
    CropService.acceptsSnapshot(1440, 810) shouldBe true
    CropService.acceptsSnapshot(720, 1280) shouldBe true // A portrait window, at the edge of the band.
    CropService.acceptsSnapshot(1, 300) shouldBe false   // Would become a 1440x432,000 raster.
    CropService.acceptsSnapshot(300, 1) shouldBe false
    CropService.acceptsSnapshot(0, 100) shouldBe false
    CropService.acceptsSnapshot(6000, 4000) shouldBe false // A real snapshot is capped at 1440 wide.
  }
}
