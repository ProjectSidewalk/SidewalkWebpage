package models.utils

import org.scalatestplus.play.PlaySpec
import play.api.libs.json.Json

import scala.io.Source
import scala.util.Using

/**
 * Unit tests for the Mapillary pano-ranking config (#4411). No DI or DB.
 *
 * The point of `conf/mapillary-pano-scoring.json` is that one file feeds two consumers that must agree — the viewer
 * (through the `data-mapillary-pano-scoring` stamp in `main.scala.html`) and `score_pano` in
 * `scripts/check_streets_for_imagery.py`, which reads the same file off disk. These pin the parts that would break
 * that quietly: the file being unreachable on the classpath, growing a key the loader drops on the floor, or shipping
 * its `_comment` to every page.
 */
class MapillaryPanoScoringSpec extends PlaySpec {

  private val fileKeys: Set[String] =
    Using.resource(Source.fromInputStream(getClass.getResourceAsStream("/mapillary-pano-scoring.json"), "UTF-8"))(
      source => Json.parse(source.mkString).as[Map[String, play.api.libs.json.JsValue]].keySet
    )

  "MapillaryPanoScoring" should {
    "load every scoring parameter from the packaged resource" in {
      val params = MapillaryPanoScoring.params
      params.distanceWeight must be > 0.0
      params.resolutionWeight must be > 0.0
      params.recencyWeight must be > 0.0
      params.sequenceWeight must be > 0.0
      params.distanceDecayMeters must be > 0.0
      params.maxImageWidthPx must be > 0.0
      params.recencyDecayYears must be > 0.0
    }

    "weight the four terms so a score lands in [0, 1]" in {
      val params        = MapillaryPanoScoring.params
      val total: Double =
        params.distanceWeight + params.resolutionWeight + params.recencyWeight + params.sequenceWeight
      total mustBe 1.0 +- 1e-9
    }

    "carry every parameter the file defines, so a new key can't be silently dropped" in {
      val stamped: Set[String] =
        Json.parse(MapillaryPanoScoring.json).as[Map[String, play.api.libs.json.JsValue]].keySet
      // `_`-prefixed keys are the file's own documentation and are meant to stay out of the page.
      stamped mustBe fileKeys.filterNot(_.startsWith("_"))
    }

    "keep the file's comment out of what every page carries" in {
      MapillaryPanoScoring.json must not include "_comment"
    }
  }
}
