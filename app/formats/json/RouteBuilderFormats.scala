package formats.json

import play.api.libs.functional.syntax._
import play.api.libs.json.{JsPath, Reads}

object RouteBuilderFormats {
  case class NewRoute(regionId: Int, streets: Seq[NewRouteStreet])
  case class NewRouteStreet(streetId: Int, reverse: Boolean)

  implicit val newRouteStreetReads: Reads[NewRouteStreet] = (
    (JsPath \ "street_id").read[Int] and
      (JsPath \ "reverse").read[Boolean]
    )(NewRouteStreet.apply _)

  implicit val newRouteReads: Reads[NewRoute] = (
    (JsPath \ "region_id").read[Int] and
      (JsPath \ "streets").read[Seq[NewRouteStreet]]
    )(NewRoute.apply _)
}
