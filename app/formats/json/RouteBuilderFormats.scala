package formats.json

import models.route.RouteWithStats
import play.api.libs.functional.syntax._
import play.api.libs.json.{JsPath, Reads, Writes}

import java.time.OffsetDateTime

object RouteBuilderFormats {
  case class NewRoute(regionId: Int, streets: Seq[NewRouteStreet], name: Option[String])
  case class NewRouteStreet(streetId: Int, reverse: Boolean)

  implicit val newRouteStreetReads: Reads[NewRouteStreet] = (
    (JsPath \ "street_id").read[Int] and
      (JsPath \ "reverse").read[Boolean]
  )(NewRouteStreet.apply _)

  implicit val newRouteReads: Reads[NewRoute] = (
    (JsPath \ "region_id").read[Int] and
      (JsPath \ "streets").read[Seq[NewRouteStreet]] and
      (JsPath \ "name").readNullable[String]
  )(NewRoute.apply _)

  implicit val routeWithStatsWrites: Writes[RouteWithStats] = (
    (JsPath \ "route_id").write[Int] and
      (JsPath \ "region_id").write[Int] and
      (JsPath \ "region_name").write[String] and
      (JsPath \ "name").write[String] and
      (JsPath \ "distance_meters").write[Double] and
      (JsPath \ "street_count").write[Int] and
      (JsPath \ "created_at").write[OffsetDateTime] and
      (JsPath \ "started_count").write[Int] and
      (JsPath \ "completed_count").write[Int] and
      (JsPath \ "encoded_polyline").write[String]
  )(unlift(RouteWithStats.unapply))
}
