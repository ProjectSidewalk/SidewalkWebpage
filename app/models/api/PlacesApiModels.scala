/**
 * Models for the Project Sidewalk Places API (#5311): one record per place.
 */
package models.api

import models.utils.LatLngBBox
import models.utils.MyPostgresProfile.api._
import org.locationtech.jts.geom.Point
import play.api.libs.json.{JsObject, Json, Writes}

import java.time.OffsetDateTime

/**
 * One place: a destination people need to reach (a school, a clinic, a bus stop, ...), as a point.
 *
 * @param placeId                Project Sidewalk's identifier for the place; stable across refreshes
 * @param category               The place's category: one of the ids `/v3/api/accessScoreConfig` lists as
 *                               `place_categories` (`school`, `health`, `library`, `grocery`, `transit`, `park`,
 *                               `community`, `government`)
 * @param name                   The place's name, or `null` when its source has none
 * @param source                 `osm` for a place from OpenStreetMap, `city` for one the city supplied
 * @param osmType                The OpenStreetMap object type (`node`, `way`, `relation`), or `null` for a city place
 * @param osmId                  The OpenStreetMap object id, or `null` for a city place
 * @param regionId               Region ID containing the place, or `null` just outside every region
 * @param regionName             Name of that region, or `null`
 * @param nearestStreetEdgeId    The nearest street within 250 m, or `null`
 * @param nearestStreetDistanceM Geodesic meters from the place to that street, or `null`
 * @param fetchedAt              When the place was last fetched from its source
 * @param geometry               The place's Point geometry
 */
case class PlaceForApi(
    placeId: Int,
    category: String,
    name: Option[String],
    source: String,
    osmType: Option[String],
    osmId: Option[Long],
    regionId: Option[Int],
    regionName: Option[String],
    nearestStreetEdgeId: Option[Int],
    nearestStreetDistanceM: Option[Double],
    fetchedAt: OffsetDateTime,
    geometry: Point
) extends StreamingApiType {

  /** The object's page on openstreetmap.org, where a wrong or missing place is fixed for everyone. */
  def osmUrl: Option[String] = for {
    t  <- osmType
    id <- osmId
  } yield s"https://www.openstreetmap.org/$t/$id"

  override def toJson: JsObject = Json.obj(
    "type"       -> "Feature",
    "geometry"   -> geometry,
    "properties" -> PlaceForApi.toJson(this)
  )

  override def toCsvRow: String = PlaceForApi.toCsvRow(this)
}

object PlaceForApi extends ApiFields[PlaceForApi] {
  import ApiFields.field

  override val fields: Seq[ApiField[PlaceForApi]] = Seq(
    field("place_id")(_.placeId),
    field("category")(_.category),
    field("name")(_.name),
    field("source")(_.source),
    field("osm_type")(_.osmType),
    field("osm_id")(_.osmId),
    field("osm_url")(_.osmUrl),
    field("region_id")(_.regionId),
    field("region_name")(_.regionName),
    field("nearest_street_edge_id")(_.nearestStreetEdgeId),
    field("nearest_street_distance_m")(_.nearestStreetDistanceM),
    field("fetched_at")(_.fetchedAt.toString)
  )

  override val csvOnlyFields: Seq[ApiField[PlaceForApi]] = Seq(
    field("lat")(_.geometry.getY),
    field("lng")(_.geometry.getX)
  )

  implicit val placeWrites: Writes[PlaceForApi] = (place: PlaceForApi) => place.toJson
}

/**
 * Filter criteria for the Places API (v3).
 *
 * @param bbox       Optional bounding box to filter places by location
 * @param regionId   Optional region ID: places whose point lies in that region
 * @param regionName Optional region name, used only when regionId is absent
 * @param categories Optional category ids to keep; every category by default
 */
case class PlaceFiltersForApi(
    bbox: Option[LatLngBBox] = None,
    regionId: Option[Int] = None,
    regionName: Option[String] = None,
    categories: Option[Seq[String]] = None
)
