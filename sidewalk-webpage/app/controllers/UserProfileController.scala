package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{ Environment, LogoutEvent, Silhouette }
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import controllers.headers.ProvidesHeader
import formats.json.UserFormats._
import forms._
import models.User
import models.audit.{AuditTaskInteraction, AuditTaskInteractionTable, AuditTaskTable}
import models.label.LabelTable
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{BodyParsers, Result, RequestHeader}
import play.extras.geojson

import scala.concurrent.Future


/**
 * The basic application controller.
 *
 * @param env The Silhouette environment.
 */
class UserProfileController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader  {

  def userProfile(username: String) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val username: String = user.username
        Future.successful(Ok(views.html.userProfile(s"Project Sidewalk - $username", Some(user))))
      case None => Future.successful(Redirect("/"))
    }
  }

  /**
   * Get a list of edges that are submitted by users.
   * @return
   */
  def getAuditedStreets = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => {
        val streets = AuditTaskTable.auditedStreets(user.userId)
        val features: List[JsObject] = streets.map { edge =>
          val coordinates: Array[Coordinate] = edge.geom.getCoordinates
          val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList  // Map it to an immutable list
        val linestring: geojson.LineString[geojson.LatLng] = geojson.LineString(latlngs)
          val properties = Json.obj(
            "street_edge_id" -> edge.streetEdgeId,
            "source" -> edge.source,
            "target" -> edge.target,
            "way_type" -> edge.wayType
          )
          Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
        }

        val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
        Future.successful(Ok(featureCollection))
      }
      case None => Future.successful(Ok(Json.obj(
        "error" -> "0",
        "message" -> "We could not find your username in our system :("
      )))
    }
  }

  /**
   * Get a list of labels submitted by the user
   * @return
   */
  def getSubmittedLabels = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val labels = LabelTable.submittedLabels(user.userId)
        val features: List[JsObject] = labels.map { label =>
          val point = geojson.Point(geojson.LatLng(label.lat.toDouble, label.lng.toDouble))
          val properties = Json.obj(
            "audit_task_id" -> label.auditTaskId,
            "label_id" -> label.labelId,
            "gsv_panorama_id" -> label.gsvPanoramaId,
            "label_type" -> label.labelType
          )
          Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
        }
        val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
        Future.successful(Ok(featureCollection))
      case None =>  Future.successful(Ok(Json.obj(
        "error" -> "0",
        "message" -> "Your user id could not be found."
      )))
    }
  }

  /**
   *
   *
   *     {
      "type": "Feature",
      "properties": {
        "heading": 135,
        "label": {
          "label_type": "CurbRamp",
          "coordinates": [
            -77.041545510292,
            38.909600262495
          ]
        }
      },
      "geometry": {
        "type": "Point",
        "coordinates": [
          -77.041676938534,
          38.909637830799
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "heading": 90
      },
      "geometry": {
        "type": "Point",
        "coordinates": [
          -77.041676938534,
          38.909637830799
        ]
      }
    },

   * @return
   */
  def getAuditTaskInteractions = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) => {
        AuditTaskTable.lastAuditTask(user.userId) match {
          case Some(auditTask) =>
            val interactions: List[AuditTaskInteraction] = AuditTaskInteractionTable.auditInteractions(auditTask.auditTaskId)

            // Get rid of Options: http://stackoverflow.com/questions/10104558/how-to-filter-nones-out-of-listoption

            val features: List[JsObject] = interactions.filter(_.lat != None).map { interaction =>
              val point = geojson.Point(geojson.LatLng(interaction.lat.get.toDouble, interaction.lng.get.toDouble))
              val properties = Json.obj(
                "heading" -> interaction.heading.get.toDouble,
                "timestamp" -> interaction.timestamp.getTime
              )
              Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
            }
            val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
            Future.successful(Ok(featureCollection))
          case None => Future.successful(Ok(Json.obj(
            "error" -> "0",
            "message" -> "There are no existing audit records."
          )))
        }
      }
      case None => Future.successful(Ok(Json.obj(
        "error" -> "0",
        "message" -> "We could not find your username."
      )))
    }
  }
}
