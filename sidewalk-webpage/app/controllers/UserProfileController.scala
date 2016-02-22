package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{ Environment, LogoutEvent, Silhouette }
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import controllers.headers.ProvidesHeader
import formats.json.UserFormats._
import forms._
import models.audit.{InteractionWithLabel, AuditTaskInteraction, AuditTaskInteractionTable, AuditTaskTable}
import models.label.LabelTable
import models.user.User
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

  def previousAudit = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val username: String = user.username
        Future.successful(Ok(views.html.previousAudit(s"Project Sidewalk - $username", Some(user))))
      case None => Future.successful(Redirect("/"))
    }
  }

  /**
   * Get a list of edges that are audited by users.
    *
    * @return
   */
  def getAuditedStreets = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
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
      case None => Future.successful(Ok(Json.obj(
        "error" -> "0",
        "message" -> "We could not find your username in our system :("
      )))
    }
  }

  def getAllAuditedStreets = UserAwareAction.async { implicit request =>
    val streets = AuditTaskTable.auditedStreets
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
    * Get a list of all labels
    * @return
    */
  def getAllLabels = UserAwareAction.async { implicit request =>
    val labels = LabelTable.submittedLabels
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
  }


  /**
   * Get user interaction records
    *
    * @return
   */
  def getAuditTaskInteractions = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        AuditTaskTable.lastAuditTask(user.userId) match {
          case Some(auditTask) =>
            val interactionsWithLabels: List[InteractionWithLabel] = AuditTaskInteractionTable.auditInteractionsWithLabels(auditTask.auditTaskId)
            val features: List[JsObject] = interactionsWithLabels.filter(_.lat.isDefined).sortBy(_.timestamp.getTime).map { interaction =>
              val point = geojson.Point(geojson.LatLng(interaction.lat.get.toDouble, interaction.lng.get.toDouble))
              val properties = if (interaction.labelType.isEmpty) {
                Json.obj(
                  "heading" -> interaction.heading.get.toDouble,
                  "timestamp" -> interaction.timestamp.getTime
                )
              } else {
                Json.obj(
                  "heading" -> interaction.heading.get.toDouble,
                  "timestamp" -> interaction.timestamp.getTime,
                  "label" -> Json.obj(
                    "label_type" -> interaction.labelType,
                    "coordinates" -> Seq(interaction.labelLng, interaction.labelLat)
                  )
                )
              }
              Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
            }
            val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)


            Future.successful(Ok(featureCollection))
          case None => Future.successful(Ok(Json.obj(
            "error" -> "0",
            "message" -> "There are no existing audit records."
          )))
        }
      case None => Future.successful(Ok(Json.obj(
        "error" -> "0",
        "message" -> "We could not find your username."
      )))
    }
  }

  /**
    *
    * @return
    */
  def getAuditCounts = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val auditCounts = AuditTaskTable.auditCounts(user.userId)
        val json = Json.arr(auditCounts.map(x => Json.obj(
          "date" -> x.date, "count" -> x.count
        )))
        Future.successful(Ok(json))
      case None => Future.successful(Ok(Json.obj(
        "error" -> "0",
        "message" -> "We could not find your username."
      )))
    }
  }

  def getAllAuditCounts = UserAwareAction.async { implicit request =>
    val auditCounts = AuditTaskTable.auditCounts
    val json = Json.arr(auditCounts.map(x => Json.obj(
      "date" -> x.date, "count" -> x.count
    )))
    Future.successful(Ok(json))
  }

  def getAllLabelCounts = UserAwareAction.async { implicit request =>
    val labelCounts = LabelTable.labelCounts
    val json = Json.arr(labelCounts.map(x => Json.obj(
      "date" -> x.date, "count" -> x.count
    )))
    Future.successful(Ok(json))
  }
}
