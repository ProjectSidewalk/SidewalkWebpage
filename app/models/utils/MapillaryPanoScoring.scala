package models.utils

import play.api.libs.json.{JsError, JsSuccess, Json, Reads}

import java.io.InputStream
import scala.io.Source
import scala.util.Using

/**
 * The weights and decay scales used to rank candidate Mapillary panoramas at a location.
 *
 * @param distanceWeight      Weight on how close a pano is to the target point.
 * @param resolutionWeight    Weight on pano width.
 * @param recencyWeight       Weight on how recently the pano was captured.
 * @param sequenceWeight      Weight on staying within the pano sequence we are already viewing.
 * @param distanceDecayMeters Scale of the exponential distance decay, in meters.
 * @param maxImageWidthPx     Pano width that earns a full resolution score; wider panos are capped at it.
 * @param recencyDecayYears   Scale of the exponential age decay, in years.
 */
case class MapillaryPanoScoringParams(
    distanceWeight: Double,
    resolutionWeight: Double,
    recencyWeight: Double,
    sequenceWeight: Double,
    distanceDecayMeters: Double,
    maxImageWidthPx: Double,
    recencyDecayYears: Double
)

/**
 * Loads `conf/mapillary-pano-scoring.json`, the single source of truth for Mapillary pano ranking (#4411).
 *
 * Mapillary is the only imagery provider whose candidates we rank ourselves, and two consumers have to agree on the
 * numbers: `MapillaryViewer.#scorePano` picks the pano Explore and Validate display, while `score_pano` in
 * `scripts/check_streets_for_imagery.py` picks the pano whose capture date we record for a street. If they disagreed,
 * we would report a street as freshly imaged and then never show the imagery that said so. The Python script reads the
 * file straight off disk; the browser gets it from the `data-mapillary-pano-scoring` stamp that `main.scala.html` puts
 * on every page.
 *
 * Parsing into [[MapillaryPanoScoringParams]] rather than passing the file through verbatim means a typo'd or missing
 * key fails here — loudly, with the key named — instead of surfacing as an `undefined` weight and a silently wrong
 * ranking in the browser. It also drops the file's `_comment` block, so the explanation stays with the numbers without
 * being shipped to every page.
 */
object MapillaryPanoScoring {
  private val ResourcePath: String = "/mapillary-pano-scoring.json"

  implicit private val paramsReads: Reads[MapillaryPanoScoringParams] = Json.reads[MapillaryPanoScoringParams]

  /** The parsed scoring parameters. Throws if the resource is missing or does not match the expected shape. */
  lazy val params: MapillaryPanoScoringParams = {
    val stream: InputStream = Option(getClass.getResourceAsStream(ResourcePath))
      .getOrElse(throw new IllegalStateException(s"$ResourcePath is missing from the classpath"))
    val raw: String = Using.resource(stream)(Source.fromInputStream(_, "UTF-8").mkString)
    Json.parse(raw).validate[MapillaryPanoScoringParams] match {
      case JsSuccess(parsed, _) => parsed
      case JsError(errors)      => throw new IllegalStateException(s"$ResourcePath is malformed: $errors")
    }
  }

  /** Compact JSON of [[params]], for stamping into a page so the pano viewer can read it back. */
  lazy val json: String = Json.stringify(Json.toJson(params)(Json.writes[MapillaryPanoScoringParams]))
}
