/**
 * Models for the street gradient (slope) fields of the Project Sidewalk API (#5223).
 *
 * The statistics ride on `/v3/api/accessScoreStreets` for every street; a street's elevation profile is served one
 * street at a time by `/v3/api/streetGradientProfile`, since it is the one part too heavy for a city-wide payload.
 */
package models.api

import models.street.{DemSource, StreetGradient, StreetGradientStats}
import play.api.libs.json.{JsNull, JsObject, JsValue, Json}

/** The slope fields, declared once so the city-wide payload and the per-street profile name them identically. */
object StreetGradientApiFields {
  import ApiFields.field

  /**
   * A street's slope statistics, read off an optional row so an unsampled street serializes as nulls.
   *
   * `meters_over_8pct` is the length over the 1:12 ramp limit, 8.33%: it is named for the round figure, like the
   * column behind it. `grade_quality` is what tells a reader why the grades are null (`structure`, `no_data`).
   */
  val statFields: Seq[ApiField[Option[StreetGradientStats]]] = Seq[ApiField[Option[StreetGradientStats]]](
    field("mean_grade")(_.flatMap(_.meanGrade)),
    field("max_grade")(_.flatMap(_.maxGrade)),
    field("net_grade")(_.flatMap(_.netGrade)),
    field("total_climb_meters")(_.flatMap(_.climbM)),
    field("total_descent_meters")(_.flatMap(_.descentM)),
    field("meters_over_5pct")(_.flatMap(_.metersOver5pctGrade)),
    field("meters_over_8pct")(_.flatMap(_.metersOver8pctGrade)),
    field("grade_confidence")(_.map(_.confidence.toString)),
    field("grade_quality")(_.map(_.quality.toString)),
    field("dem_source")(_.map(_.demSource))
  )
}

/**
 * An elevation model's credit, for the v3 API.
 *
 * @param source      The registered (or name-only) source being credited.
 * @param streetCount How many of the city's streets were sampled from it, where that is known.
 */
case class DemSourceForApi(source: DemSource, streetCount: Option[Int] = None) {
  def toJson: JsObject = Json.obj(
    "dem_source" -> source.name,
    "title"      -> source.title,
    "credit"     -> source.credit,
    "licence"    -> source.licence,
    "url"        -> source.url
  ) ++ streetCount.map(n => Json.obj("street_count" -> n)).getOrElse(Json.obj())
}

/**
 * What a client needs to read and credit the slope fields, published under `gradient` on `/v3/api/accessScoreConfig`
 * so no client re-declares a limit, a class break, or a credit line.
 *
 * @param sources The elevation models this city's streets were sampled from, most streets first; empty in a city
 *                that has not been sampled.
 */
case class StreetGradientConfigForApi(sources: Seq[DemSourceForApi]) {
  def toJson: JsObject = Json.obj(
    "walking_surface_limit" -> StreetGradientStats.WalkingSurfaceLimit,
    "ramp_limit"            -> StreetGradientStats.RampLimit,
    "map_class_breaks"      -> StreetGradientStats.MapClassBreaks,
    "sources"               -> sources.map(_.toJson)
  )
}

/**
 * One street's slope statistics and elevation profile, for the v3 API.
 *
 * @param gradient     The street's `street_gradient` row.
 * @param lengthMeters The street's geodesic length, which the profile's spacing is derived from.
 * @param stale        Whether the street's geometry has changed since it was sampled. The row then describes the line
 *                     the street used to follow, and `spacing_meters` (today's length over yesterday's sample count)
 *                     is only approximate, so the response says so instead of passing the numbers off as current.
 */
case class StreetGradientProfileForApi(gradient: StreetGradient, lengthMeters: Double, stale: Boolean = false) {

  /**
   * The profile as meters at a stated spacing, or None where the row has no profile (a structure, a coarse-model row,
   * a street with no data). A single-sample profile has no spacing to state, so it is left out as well.
   */
  private def profileJson: Option[JsObject] = gradient.profileCm.filter(_.size >= 2).map { cm =>
    Json.obj(
      "spacing_meters"    -> lengthMeters / (cm.size - 1),
      "elevations_meters" -> cm.map(_ / 100.0)
    )
  }

  def toJson: JsObject = {
    val stats = gradient.stats
    Json.obj("street_edge_id" -> stats.streetEdgeId, "length_meters" -> lengthMeters) ++
      JsObject(StreetGradientApiFields.statFields.map(f => f.name -> f.value(Some(stats)))) ++
      Json.obj(
        "elev_start_meters"     -> stats.elevStartM,
        "elev_end_meters"       -> stats.elevEndM,
        "dem_resolution_meters" -> stats.demResolutionM,
        "sampled_at"            -> gradient.sampledAt,
        "stale"                 -> stale,
        "profile"               -> profileJson.getOrElse[JsValue](JsNull),
        "attribution"           -> DemSourceForApi(DemSource.forName(stats.demSource)).toJson
      )
  }
}
