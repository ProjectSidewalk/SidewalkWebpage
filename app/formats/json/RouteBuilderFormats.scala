package formats.json

import models.route.RouteWithStats
import play.api.libs.functional.syntax.*
import play.api.libs.json.*

object RouteBuilderFormats {
  private given jsonConfig: JsonConfiguration = JsonConfiguration(JsonNaming.SnakeCase)

  /**
   * A route to save. It carries no region: a route may run through several (#3488), and the one it is filed under —
   * where it starts — is read off its first street by the server.
   */
  case class NewRoute(streets: Seq[NewRouteStreet], name: Option[String], description: Option[String])
  case class NewRouteStreet(streetId: Int, reverse: Boolean)

  /**
   * A partial update to a saved route: any subset of the name, the public description, and the full street list.
   * An empty-string description clears it.
   */
  case class RouteUpdate(name: Option[String], description: Option[String], streets: Option[Seq[NewRouteStreet]])

  given newRouteStreetReads: Reads[NewRouteStreet] = Json.reads[NewRouteStreet]

  // A zero-street route can't be explored: its mission has no distance, so opening its share link 500s Explore.
  // It's also invisible in listings (they inner-join route_street), so its owner couldn't delete it either.
  given newRouteReads: Reads[NewRoute] = (
    (JsPath \ "streets").read[Seq[NewRouteStreet]](using Reads.minLength[Seq[NewRouteStreet]](1)) and
      (JsPath \ "name").readNullable[String] and
      (JsPath \ "description").readNullable[String]
  )(NewRoute.apply)

  given routeUpdateReads: Reads[RouteUpdate] = Json.reads[RouteUpdate]

  given routeWithStatsWrites: Writes[RouteWithStats] = Json.writes[RouteWithStats]
}
