/**
  * Created by manaswi on 5/10/17.
  */


package controllers

import java.sql.Timestamp
import java.util.{Calendar, Date, TimeZone, UUID}
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import models.audit.AuditTaskTable
import models.region._
import models.route.{RouteStreet, RouteStreetTable}
import models.user.User
import play.api.libs.json._
import play.extras.geojson

import scala.util.control.Breaks._
import scala.concurrent.Future

/**
  * Street controller
  */
class RouteController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {


  /**
    * This returns a list of all the streets for a route
    * @return
    */
  def getStreetsOnARoute(routeId: Int) = UserAwareAction.async { implicit request =>

    val routeStreets = RouteStreetTable.getRouteStreets(routeId)
    val newTasks = AuditTaskTable.selectTasksOnARoute(routeId, routeStreets)
    implicit val rStreetWrites = Json.writes[RouteStreet]

    var rStreetsJsonObj: JsObject = Json.obj()

    var rList = routeStreets
    for (newTask <- newTasks) {
      val edgeId = newTask.edgeId
      val edgeIdString = edgeId.toString

      // TODO: Could be optimized to reduce the number of loops
      breakable {
        for (routeStreet <- routeStreets) {
          val streetId = routeStreet.current_street_edge_id

          if (edgeId == streetId) {
            val nextStreetId = routeStreet.next_street_edge_id
            val isStartEdge = routeStreet.isStartEdge
            val isEndEdge = routeStreet.isEndEdge
            val length = routeStreet.length

            val streetJson = edgeIdString -> Json.obj("task" -> newTask.toJSON, "next" -> nextStreetId,
              "length_mi" -> length, "isStartEdge" -> isStartEdge, "isEndEdge" -> isEndEdge)

            val newJson = rStreetsJsonObj.as[JsObject] + streetJson
            rStreetsJsonObj = newJson
            break
          }
        }
      }
    }

    Future.successful(Ok(rStreetsJsonObj))
  }
}
