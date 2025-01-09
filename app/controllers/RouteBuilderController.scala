package controllers

import javax.inject.{Inject, Singleton}
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.{CookieAuthenticator, SessionAuthenticator}
import models.user.SidewalkUserWithRole
import play.api.libs.json._
//import controllers.headers.ProvidesHeader
import formats.json.RouteBuilderFormats.NewRoute
//import models.route.{Route, RouteStreet, RouteStreetTable, RouteTable}
//import models.user.{SidewalkUserWithRole, WebpageActivity, WebpageActivityTable}
import play.api.i18n.MessagesApi

import scala.concurrent.Future
import play.api.mvc.BodyParsers

import java.sql.Timestamp
import java.time.Instant

@Singleton
class RouteBuilderController @Inject() (val messagesApi: MessagesApi, val env: Environment[SidewalkUserWithRole, CookieAuthenticator])
  extends Silhouette[SidewalkUserWithRole, CookieAuthenticator] {

//  def saveRoute = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
//    val submission = request.body.validate[NewRoute]
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//      },
//      submission => {
//        val userIdStr: String = request.identity.map(_.userId).getOrElse(anonymousUser.userId)
//
//        // Save new route in the database. The order of the streets should be preserved when saving to db.
//        val routeId: Int = RouteTable.insert(Route(0, userIdStr, submission.regionId, "temp", public = false, deleted = false))
//        val newRouteStreets: Seq[RouteStreet] = submission.streets.map(street => RouteStreet(0, routeId, street.streetId, street.reverse))
//        RouteStreetTable.insertMultiple(newRouteStreets)
//
//        Future.successful(Ok(Json.obj("route_id" -> routeId)))
//      }
//    )
//  }
}
