package formats.json

import play.api.libs.json.{JsPath, Reads}
import play.api.libs.functional.syntax._

object RouteBuilderFormats {
  case class NewRoute(regionId: Int, streetIds: Seq[Int])

  implicit val newRouteReads: Reads[NewRoute] = (
    (JsPath \ "region_id").read[Int] and
      (JsPath \ "street_ids").read[Seq[Int]]
    )(NewRoute.apply _)
}
