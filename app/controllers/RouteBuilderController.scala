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
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress
        request.identity match {
          case Some(user) =>
            WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "SaveRoute", timestamp))
          case None =>
            WebpageActivityTable.save(WebpageActivity(0, anonymousUser.userId.toString, ipAddress, "SaveRoute", timestamp))
        }
        val newRouteId: Int = RouteTable.save(Route(0, request.identity.get.userId.toString, submission.regionId, "test route", public = false, deleted = false))
        RouteStreetTable.save(RouteStreet(0, newRouteId, submission.streetIds.head, firstStreet = true))
        submission.streetIds.drop(1).map(s => RouteStreetTable.save(RouteStreet(0, newRouteId, s, firstStreet = false)))
        Future.successful(Ok(Json.obj()))
      }
    )
  }
}
