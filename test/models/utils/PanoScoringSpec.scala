package models.utils

import org.scalatestplus.play.PlaySpec
import play.api.libs.json.{JsObject, JsValue, Json}

import scala.io.Source
import scala.util.Using

/**
 * Unit tests for the pano-ranking config (#4411). No DI or DB.
 *
 * The point of `conf/pano-scoring.json` is that one file feeds three consumers that must agree — the Mapillary and
 * Panoramax viewers (through the `data-pano-scoring` stamp in `main.scala.html`) and `score_pano` in
 * `scripts/check_streets_for_imagery.py`, which reads the same file off disk. These pin the parts that would break
 * that quietly: the file being unreachable on the classpath, growing a key the loader drops on the floor, losing a
 * provider, or shipping its `_comment` to every page.
 */
class PanoScoringSpec extends PlaySpec {

  private val file: JsObject =
    Using.resource(Source.fromInputStream(getClass.getResourceAsStream("/pano-scoring.json"), "UTF-8"))(source =>
      Json.parse(source.mkString).as[JsObject]
    )

  private def keysOf(json: JsValue): Set[String] = json.as[Map[String, JsValue]].keySet

  "PanoScoring" should {
    "load the values the viewers' own comments quote" in {
      // Pinned rather than merely positive: the decay curves in MapillaryViewer.#scorePano and
      // PanoramaxViewer.#scorePano ("10m -> 0.37", "3yr -> 0.55") are only right for these numbers, and
      // test_pano_scoring_config_matches_the_values_the_viewers_document asserts the same set on the Python side.
      val params = PanoScoring.params
      params.distanceWeight mustBe 0.45
      params.resolutionWeight mustBe 0.25
      params.recencyWeight mustBe 0.25
      params.sequenceWeight mustBe 0.05
      params.distanceDecayMeters mustBe 10.0
      params.recencyDecayYears mustBe 5.0
    }

    "weight the four terms so a score lands in [0, 1]" in {
      val params        = PanoScoring.params
      val total: Double =
        params.distanceWeight + params.resolutionWeight + params.recencyWeight + params.sequenceWeight
      total mustBe 1.0 +- 1e-9
    }

    "give every provider that ranks its own candidates a resolution cap" in {
      // A provider missing from the file is a viewer that reads `undefined` for its cap and scores every pano NaN.
      PanoScoring.params.providers.keySet mustBe Set("mapillary", "panoramax")
      PanoScoring.params.providers("mapillary").maxImageWidthPx mustBe 16384.0
      PanoScoring.params.providers("panoramax").maxImageWidthPx mustBe 12288.0
      PanoScoring.params.providers("panoramax").unknownDateAgeYears mustBe Some(3.0)
    }

    "carry every parameter the file defines, so a new key can't be silently dropped" in {
      val stamped: JsObject = Json.parse(PanoScoring.json).as[JsObject]
      // `_`-prefixed keys are the file's own documentation and are meant to stay out of the page.
      keysOf(stamped) mustBe keysOf(file).filterNot(_.startsWith("_"))
      keysOf(stamped("providers")) mustBe keysOf(file("providers"))
      keysOf(stamped("providers")).foreach { provider =>
        keysOf(stamped("providers")(provider)) mustBe keysOf(file("providers")(provider))
      }
    }

    "keep the file's comment out of what every page carries" in {
      PanoScoring.json must not include "_comment"
    }
  }
}
