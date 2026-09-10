package models.utils

import play.api.libs.json.{JsError, JsSuccess, Json, Reads, Writes}

import java.io.InputStream
import scala.io.Source
import scala.util.Using

/**
 * The provider-specific half of the pano ranking: what each provider's fleet can be expected to deliver.
 *
 * @param maxImageWidthPx     Pano width that earns a full resolution score; wider panos are capped at it.
 * @param unknownDateAgeYears Age to score a pano whose capture date won't parse as, if the provider has any. Without
 *                            it the age is `NaN`, which loses every comparison, so a box of undated panos would read
 *                            as a street with no imagery at all.
 */
case class PanoScoringProvider(maxImageWidthPx: Double, unknownDateAgeYears: Option[Double])

/**
 * The weights and decay scales used to rank candidate panoramas at a location.
 *
 * @param distanceWeight      Weight on how close a pano is to the target point.
 * @param resolutionWeight    Weight on pano width.
 * @param recencyWeight       Weight on how recently the pano was captured.
 * @param sequenceWeight      Weight on staying within the pano sequence we are already viewing.
 * @param distanceDecayMeters Scale of the exponential distance decay, in meters.
 * @param recencyDecayYears   Scale of the exponential age decay, in years.
 * @param providers           Per-provider parameters, keyed by lowercase provider name.
 */
case class PanoScoringParams(
    distanceWeight: Double,
    resolutionWeight: Double,
    recencyWeight: Double,
    sequenceWeight: Double,
    distanceDecayMeters: Double,
    recencyDecayYears: Double,
    providers: Map[String, PanoScoringProvider]
)

/**
 * Loads `conf/pano-scoring.json`, the single source of truth for pano ranking (#4411).
 *
 * Mapillary and Panoramax both answer a location query with every picture in a box and leave the choice to us, and
 * three consumers have to agree on how that choice is made: `MapillaryViewer.#scorePano` and
 * `PanoramaxViewer.#scorePano` pick the pano Explore displays, while `score_pano` in
 * `scripts/check_streets_for_imagery.py` picks the pano whose capture date we record for a street. If they disagreed,
 * we would report a street as freshly imaged and then never show the imagery that said so. The Python script reads the
 * file straight off disk; the browser gets it from the `data-pano-scoring` stamp that `main.scala.html` puts on every
 * page.
 *
 * Parsing into [[PanoScoringParams]] rather than passing the file through verbatim means a typo'd or missing key
 * fails here — loudly, with the key named — instead of surfacing as an `undefined` weight and a silently wrong ranking
 * in the browser. It also drops the file's `_comment` block, so the explanation stays with the numbers without being
 * shipped to every page.
 */
object PanoScoring {
  private val ResourcePath: String = "/pano-scoring.json"

  implicit private val providerReads: Reads[PanoScoringProvider]   = Json.reads[PanoScoringProvider]
  implicit private val paramsReads: Reads[PanoScoringParams]       = Json.reads[PanoScoringParams]
  implicit private val providerWrites: Writes[PanoScoringProvider] = Json.writes[PanoScoringProvider]
  implicit private val paramsWrites: Writes[PanoScoringParams]     = Json.writes[PanoScoringParams]

  /** The parsed scoring parameters. Throws if the resource is missing or does not match the expected shape. */
  lazy val params: PanoScoringParams = {
    val stream: InputStream = Option(getClass.getResourceAsStream(ResourcePath))
      .getOrElse(throw new IllegalStateException(s"$ResourcePath is missing from the classpath"))
    val raw: String = Using.resource(stream)(Source.fromInputStream(_, "UTF-8").mkString)
    Json.parse(raw).validate[PanoScoringParams] match {
      case JsSuccess(parsed, _) => parsed
      case JsError(errors)      => throw new IllegalStateException(s"$ResourcePath is malformed: $errors")
    }
  }

  /** Compact JSON of [[params]], for stamping into a page so the pano viewers can read it back. */
  lazy val json: String = Json.stringify(Json.toJson(params))
}
