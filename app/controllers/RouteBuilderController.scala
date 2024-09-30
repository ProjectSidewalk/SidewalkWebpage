package controllers

import javax.inject.Inject
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import play.api.libs.json._
import play.api.mvc.BodyParsers
import play.api.libs.json.{JsObject, JsValue, Json, JsError}
import play.extras.geojson
import controllers.headers.ProvidesHeader
import formats.json.RouteBuilderFormats.NewRoute
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.route.{Route, RouteStreet, RouteStreetTable, RouteTable}
import models.street.StreetEdgeTable
import models.user.{User, WebpageActivity, WebpageActivityTable}

import scala.concurrent.Future
import java.sql.Timestamp
import java.time.Instant

/**
 * Holds the HTTP requests associated with managing neighborhoods.
 *
 * @param env The Silhouette environment.
 */
class RouteBuilderController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  def backendRoute(street_edge_id: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val streets = StreetEdgeTable.getStreetGeomById(street_edge_id)
        Future.successful(Ok(Json.obj("street" -> streets)))
      case None =>
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> "User not logged in")))
    }
  }

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
        val newRouteStreets: Seq[RouteStreet] = submission.streets.map(street => RouteStreet(0, routeId, street.streetId, street.reverse))
        RouteStreetTable.saveMultiple(newRouteStreets)

        Future.successful(Ok(Json.obj("route_id" -> routeId)))
      }
    )
  }
}
