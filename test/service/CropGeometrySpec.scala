package service

import models.utils.ImageUtils
import org.scalatest.Assertion
import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsLookupResult, JsValue, Json}
import service.CropGeometry.CropBox

import java.awt.image.BufferedImage
import java.io.File
import java.nio.file.Files
import javax.imageio.ImageIO

/**
 * Pins the crop geometry port to its Python reference (#4865).
 *
 * `CropGeometry`/`CropSizingRule` are a port of sidewalk-panorama-tools `CropRunner.py`, and a wrong port does not
 * fail — it produces a plausible picture. So the registration is by test: the cases panorama-tools pins in its own
 * suite, ported verbatim, and the golden fixtures under `test/resources/crops/` that the Python wrote (see the README
 * there for provenance). The mechanics fixtures compare pixel for pixel; the sizing fixtures compare to 1e-6, and are
 * regenerated with the rule.
 *
 * Pure: no application, no database.
 */
class CropGeometrySpec extends PlaySpec {

  private val fixtures = new File("test/resources/crops")
  private val pano     = new File(fixtures, "synthetic-pano.png")

  private def fixture(name: String): JsValue = Json.parse(Files.readAllBytes(new File(fixtures, name).toPath))

  private def box(json: JsLookupResult): CropBox = CropBox(
    (json \ "left").as[Int],
    (json \ "top").as[Int],
    (json \ "width").as[Int],
    (json \ "height").as[Int],
    (json \ "shifted").as[Boolean]
  )

  /** Pixel-for-pixel equality on RGB, ignoring how each side stores its raster. */
  private def assertSamePixels(actual: BufferedImage, expected: BufferedImage, clue: String): Assertion = {
    withClue(s"$clue: dimensions ") {
      (actual.getWidth, actual.getHeight) mustBe (expected.getWidth, expected.getHeight)
    }
    val mismatches = for {
      y <- 0 until expected.getHeight
      x <- 0 until expected.getWidth
      if (actual.getRGB(x, y) & 0xffffff) != (expected.getRGB(x, y) & 0xffffff)
    } yield (x, y)
    withClue(s"$clue: first differing pixels ${mismatches.take(5)}, ${mismatches.size} in all ") {
      mismatches mustBe empty
    }
  }

  "CropSizingRule.predictCropSize" should {
    "be the published regression at the height it was calibrated on" in {
      // At pano_height == 6656 the normalisation is the identity, so these are the pre-v2 values, pinned upstream.
      CropSizingRule.predictCropSize(3328, 6656) mustBe 248.32906718298392 +- 1e-9
      CropSizingRule.predictCropSize(2000, 6656) mustBe 107.29426765313778 +- 1e-9
      CropSizingRule.predictCropSize(0, 6656) mustBe 54.649733399851385 +- 1e-9
      CropSizingRule.predictCropSize(6000, 6656) mustBe 1500.0 +- 1e-9
    }

    "ask for the same fraction of the pano at the same relative position, whatever the resolution" in {
      // Normalisation bounds the reference offset for every pano, so the window is a fixed fraction of the height.
      for (h <- Seq(2048, 4000, 6656, 8192, 16384)) {
        withClue(s"h=$h ") {
          CropSizingRule.predictCropSize(h / 2.0, h) mustBe (248.32906718298392 * h / 6656.0) +- 1e-6
        }
      }
    }
  }

  "CropSizingRule.windowWidth" should {
    "be an angle independent of resolution" in {
      // Ten degrees below the horizon subtends the same angle whatever the pixel count, so the window must too.
      for (h <- Seq(2048, 4000, 6656, 8192, 16384)) {
        val y   = h / 2.0 + 10.0 / 180.0 * h
        val deg = CropSizingRule.windowWidth(y, 2 * h, h) / (2 * h) * 360.0
        withClue(s"h=$h ") { deg mustBe 25.0 +- 0.05 }
      }
    }

    "scale the regression and clamp it as an angle" in {
      val h    = 8192
      val w    = 2 * h
      val near = h / 2.0 + 40.0 / 180.0 * h
      val mid  = h / 2.0 + 10.0 / 180.0 * h
      CropSizingRule.windowWidth(mid, w, h) mustBe (CropSizingRule.predictCropSize(mid, h) * CropSizingRule.Scale) +-
        1e-6
      CropSizingRule.windowWidth(near, w, h) / w * 360.0 mustBe CropSizingRule.MaxFovDeg +- 1e-9
      CropSizingRule.windowWidth(0, w, h) / w * 360.0 mustBe CropSizingRule.MinFovDeg +- 1e-9
    }

    "be an azimuthal span: the clamped angle as a fraction of the width, not of the height" in {
      // On a 2:1 pano the two conversions agree, which is what let a height-based one look right; on any other
      // aspect they differ by the aspect's departure from 2, and a width is horizontal (panorama-tools #106).
      val (w, h) = (4096, 4096)
      CropSizingRule.windowWidth(0, w, h) mustBe (CropSizingRule.MinFovDeg / 360.0 * w) +- 1e-9
      CropSizingRule.windowWidth(0, 2 * h, h) mustBe 2 * CropSizingRule.windowWidth(0, w, h) +- 1e-9
    }

    "match every row of the sizing fixture the Python reference wrote" in {
      val sizing = fixture("sizing-v2.json")
      (sizing \ "crop_rule_version").as[String] mustBe CropSizingRule.Version
      (sizing \ "crop_size_scale").as[Double] mustBe CropSizingRule.Scale
      (sizing \ "crop_min_fov_deg").as[Double] mustBe CropSizingRule.MinFovDeg
      (sizing \ "crop_max_fov_deg").as[Double] mustBe CropSizingRule.MaxFovDeg
      (sizing \ "crop_aspect_w_over_h").as[Double] mustBe CropGeometry.AspectWidthOverHeight
      (sizing \ "crop_max_stored_width").as[Int] mustBe CropGeometry.MaxStoredWidth

      val rows = (sizing \ "rows").as[Seq[JsValue]]
      rows must not be empty
      rows.foreach { row =>
        val h      = (row \ "pano_height").as[Int]
        val w      = (row \ "pano_width").as[Int]
        val y      = (row \ "pano_y").as[Double]
        val x      = (row \ "pano_x").as[Double]
        val window = CropSizingRule.windowWidth(y, w, h)
        withClue(s"pano ${w}x$h, label ($x, $y): ") {
          CropSizingRule.predictCropSize(y, h) mustBe (row \ "predict_crop_size").as[Double] +- 1e-6
          window mustBe (row \ "window_width").as[Double] +- 1e-6
          CropGeometry.computeCropBox(x, y, window, w, h) mustBe box(row \ "box")
        }
      }
    }
  }

  "CropGeometry.computeCropBox" should {
    // The cases panorama-tools pins for its own compute_crop_box, ported verbatim.
    "centre an interior label in a 3:2 window" in {
      CropGeometry.computeCropBox(300, 128, 248.33, 512, 256) mustBe CropBox(176, 46, 248, 165, shifted = false)
    }

    "wrap x at the seam rather than stopping at the edge" in {
      CropGeometry.computeCropBox(0, 128, 248.33, 512, 256) mustBe CropBox(
        Math.floorMod(-124, 512),
        46,
        248,
        165,
        shifted = false
      )
    }

    "shift y to stay inside, since the poles are not adjacent" in {
      CropGeometry.computeCropBox(300, 8, 248.33, 512, 256) mustBe CropBox(176, 0, 248, 165, shifted = true)
      CropGeometry.computeCropBox(300, 250, 200.0, 512, 256).top mustBe 256 - 133
      CropGeometry.computeCropBox(300, 250, 200.0, 512, 256).shifted mustBe true
    }

    "cap the window at the pano, on the axis that binds" in {
      // On a 2:1 pano the binding term is height * 1.5, not the width: a 512-wide window would need 341 rows of 256.
      val landscape = CropGeometry.computeCropBox(300, 250, 1500, 512, 256)
      (landscape.width, landscape.height, landscape.top) mustBe (384, 256, 0)
      // On a portrait pano the width term binds; without it the second seam segment would read past the far edge.
      val portrait = CropGeometry.computeCropBox(100, 300, 400, 200, 600)
      portrait.width mustBe 200
      portrait.left must (be >= 0 and be < 200)
      portrait.top must (be >= 0 and be <= 600 - portrait.height)
    }

    "round half to even, as the reference's Python round() does" in {
      // width = round(503.21) = 503, so left = round(x - 251.5): the ties must go to even, never up.
      for ((x, rawLeft) <- Seq((100.0, -152), (100.5, -151), (101.0, -150), (250.25, -1))) {
        val result = CropGeometry.computeCropBox(x, 512, 503.21, 2048, 1024)
        withClue(s"x=$x ") {
          (result.width, result.height) mustBe (503, 335)
          result.left mustBe Math.floorMod(rawLeft, 2048)
        }
      }
    }
  }

  "CropGeometry.labelPositionInCrop" should {
    "land where the reference's label_position_in_crop lands, for every mechanics fixture" in {
      // The seam cases are what make this more than `x - left`, and the pole cases are what make it more than
      // "the centre": a shifted window has the label off-centre by exactly the shift.
      val cases = fixture("mechanics.json").as[Seq[JsValue]]
      cases.foreach { c =>
        val name     = (c \ "case").as[String]
        val expected = (c \ "label_in_crop").as[Seq[Double]]
        val (x, y)   = CropGeometry.labelPositionInCrop(
          (c \ "pano_x").as[Double],
          (c \ "pano_y").as[Double],
          box(c \ "box"),
          (c \ "pano_width").as[Int]
        )
        withClue(s"$name: ") {
          x mustBe expected(0) +- 1e-9
          y mustBe expected(1) +- 1e-9
        }
      }
    }

    "find the planted pixel in the cut window, at the horizon, at both poles and across the seam" in {
      // Registration measured rather than captioned (panorama-tools #78): the synthetic pano's pixels are all
      // distinct, so the pixel the cut window holds at the computed position must be the pano's pixel at the label.
      val whole = ImageIO.read(pano)
      ImageUtils.withReader(pano) { (reader, w, h) =>
        for ((x, y) <- Seq((512, 256), (10, 256), (1020, 300), (700, 20), (200, 500), (0, 256), (1023, 511))) {
          val boxHere  = CropGeometry.computeCropBox(x.toDouble, y.toDouble, 300, w, h)
          val (cx, cy) = CropGeometry.labelPositionInCrop(x.toDouble, y.toDouble, boxHere, w)
          val cut      = CropService.cutWindow(reader, boxHere, w)
          withClue(s"label ($x, $y) in box $boxHere at ($cx, $cy): ") {
            cx must (be >= 0.0 and be < boxHere.width.toDouble)
            cy must (be >= 0.0 and be < boxHere.height.toDouble)
            (cut.getRGB(cx.toInt, cy.toInt) & 0xffffff) mustBe (whole.getRGB(x % w, y) & 0xffffff)
          }
        }
      }
    }

    "put the label at the centre of an unshifted window and off-centre of a shifted one, as fractions" in {
      val interior = CropGeometry.computeCropBox(512, 256, 300, 1024, 512)
      interior.shifted mustBe false
      val (fx, fy) = CropGeometry.labelFractionInCrop(512, 256, interior, 1024)
      fx mustBe 0.5 +- 0.01
      fy mustBe 0.5 +- 0.01

      val top = CropGeometry.computeCropBox(700, 20, 300, 1024, 512)
      top.shifted mustBe true
      val (tx, ty) = CropGeometry.labelFractionInCrop(700, 20, top, 1024)
      tx mustBe 0.5 +- 0.01
      ty mustBe (20.0 / top.height) +- 1e-9
    }
  }

  "CropGeometry.segments" should {
    "read one run for an interior window and two, in crop order, across the seam" in {
      CropGeometry.segments(CropBox(100, 0, 50, 33, shifted = false), 1024) mustBe
        Seq(CropGeometry.Segment(100, 50, 0))
      CropGeometry.segments(CropBox(1000, 0, 50, 33, shifted = false), 1024) mustBe
        Seq(CropGeometry.Segment(1000, 24, 0), CropGeometry.Segment(0, 26, 24))
    }
  }

  "the region-reading cut" should {
    "reproduce the reference's pixels for every mechanics fixture, and equal a full decode" in {
      val cases = fixture("mechanics.json").as[Seq[JsValue]]
      cases must not be empty
      val whole = ImageIO.read(pano)
      ImageUtils.withReader(pano) { (reader, w, h) =>
        (w, h) mustBe (1024, 512)
        cases.foreach { c =>
          val name     = (c \ "case").as[String]
          val expected = box(c \ "box")
          val computed = CropGeometry.computeCropBox(
            (c \ "pano_x").as[Double],
            (c \ "pano_y").as[Double],
            (c \ "requested_width").as[Double],
            w,
            h
          )
          withClue(s"$name: box ") { computed mustBe expected }

          val cut = CropService.cutWindow(reader, computed, w)
          assertSamePixels(cut, ImageIO.read(new File(fixtures, s"expected/$name.png")), s"$name vs reference")

          // The window read through the reader must be the same pixels a full decode would hand back, run by run.
          val reference = new BufferedImage(computed.width, computed.height, BufferedImage.TYPE_INT_RGB)
          val g         = reference.createGraphics()
          CropGeometry.segments(computed, w).foreach { s =>
            val _ = g.drawImage(whole.getSubimage(s.srcX, computed.top, s.width, computed.height), s.dstX, 0, null)
          }
          g.dispose()
          assertSamePixels(cut, reference, s"$name vs full decode")
        }
      }
    }

    "cut the sizing rule's window end to end as the reference did" in {
      val e2e = fixture("sizing-v2.json") \ "e2e"
      ImageUtils.withReader(pano) { (reader, w, h) =>
        val y      = (e2e \ "pano_y").as[Double]
        val window = CropSizingRule.windowWidth(y, w, h)
        window mustBe (e2e \ "window_width").as[Double] +- 1e-6
        val computed = CropGeometry.computeCropBox((e2e \ "pano_x").as[Double], y, window, w, h)
        computed mustBe box(e2e \ "box")
        assertSamePixels(
          CropService.cutWindow(reader, computed, w),
          ImageIO.read(new File(fixtures, "expected/sizing_e2e.png")),
          "sizing_e2e"
        )
      }
    }
  }

  "CropService.storedCrop" should {
    "cap a wide window at the stored width, keeping the aspect, and leave a narrow one alone" in {
      val wide   = new BufferedImage(3000, 2000, BufferedImage.TYPE_INT_RGB)
      val stored = CropService.storedCrop(wide)
      (stored.getWidth, stored.getHeight) mustBe (1440, 960)

      val narrow       = new BufferedImage(600, 400, BufferedImage.TYPE_INT_RGB)
      val storedNarrow = CropService.storedCrop(narrow)
      (storedNarrow.getWidth, storedNarrow.getHeight) mustBe (600, 400)
    }
  }
}
