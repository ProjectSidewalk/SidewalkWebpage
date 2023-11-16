package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import play.api.libs.json._
import controllers.headers.ProvidesHeader
import formats.json.RouteBuilderFormats.NewRoute
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.route.{Route, RouteStreet, RouteStreetTable, RouteTable}
import models.user.{User, WebpageActivity, WebpageActivityTable}
import scala.concurrent.Future
import play.api.mvc.BodyParsers
import java.sql.Timestamp
import java.time.Instant

/**
 * Holds the HTTP requests associated with managing neighborhoods.
 *
 * @param env The Silhouette environment.
 */
class RouteBuilderController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  val anonymousUser: DBUser = UserTable.find("anonymous").get

  def saveRoute = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    val submission = request.body.validate[NewRoute]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        val userIdStr: String = request.identity.map(_.userId.toString).getOrElse(anonymousUser.userId)

        // Save new route in the database. The order of the streets should be preserved when saving to db.
        val routeId: Int = RouteTable.save(Route(0, userIdStr, submission.regionId, "temp", public = false, deleted = false))
        val newRouteStreets: Seq[RouteStreet] = submission.streetIds.map(streetId => RouteStreet(0, routeId, streetId))
        RouteStreetTable.saveMultiple(newRouteStreets)

        Future.successful(Ok(Json.obj("route_id" -> routeId)))
      }
    )
  }
}
