package controllers

import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, LogoutEvent, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import controllers.headers.ProvidesHeader
import formats.json.UserFormats._
import formats.json.TaskFormats._
import forms._
import models.audit.{AuditTaskInteraction, AuditTaskInteractionTable, AuditTaskTable, InteractionWithLabel}
import models.label.LabelTable
import models.mission.MissionTable
import models.user.User
import play.api.libs.json.{JsArray, JsObject, Json}
import play.api.mvc.{BodyParsers, RequestHeader, Result}
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
        val streets = AuditTaskTable.selectStreetsAuditedByAUser(user.userId)
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
    val streets = AuditTaskTable.selectStreetsAudited
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
    *
    * @return
    */
  def getSubmittedTasks = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val tasks = AuditTaskTable.selectCompletedTasks(user.userId).map(t => Json.toJson(t))
        Future.successful(Ok(JsArray(tasks)))
      case None =>  Future.successful(Ok(Json.obj(
        "error" -> "0",
        "message" -> "Your user id could not be found."
      )))
    }
  }

  /**
    *
    * @return
    */
  def getSubmittedTasksWithLabels = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val tasksWithLabels = AuditTaskTable.selectTasksWithLabels(user.userId).map(x => Json.toJson(x))
        Future.successful(Ok(JsArray(tasksWithLabels)))
      case None =>  Future.successful(Ok(Json.obj(
        "error" -> "0",
        "message" -> "Your user id could not be found."
      )))
    }
  }

  /**
   * Get a list of labels submitted by the user
   * @return
   */
  def getSubmittedLabels(regionId: Option[Int]) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val labels = regionId match {
          case Some(rid) => LabelTable.selectLocationsOfLabelsByUserIdAndRegionId(user.userId, rid)
          case None => LabelTable.selectLocationsOfLabelsByUserId(user.userId)
        }

        // val labels = LabelTable.selectLocationsOfLabelsByUserId(user.userId)
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

  def getLabelsInRegion(regionId: Int) = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val labels = LabelTable.selectLocationsOfLabelsByUserId(user.userId)
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


  def getInteractions = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val interactions = AuditTaskInteractionTable.selectAuditTaskInteractionsOfAUser(user.userId).map(x => Json.toJson(x))
        Future.successful(Ok(JsArray(interactions)))
      case None =>
        Future.successful(Ok(Json.obj(
          "error" -> "0",
          "message" -> "We could not find your username."
        )))
    }
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
            val interactionsWithLabels: List[InteractionWithLabel] = AuditTaskInteractionTable.selectAuditInteractionsWithLabels(auditTask.auditTaskId)
            val featureCollection = AuditTaskInteractionTable.auditTaskInteractionsToGeoJSON(interactionsWithLabels)
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
        val auditCounts = AuditTaskTable.selectAuditCountsPerDayByUserId(user.userId)
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
    val labelCounts = LabelTable.selectLabelCountsPerDay
    val json = Json.arr(labelCounts.map(x => Json.obj(
      "date" -> x.date, "count" -> x.count
    )))
    Future.successful(Ok(json))
  }

  def getAllUserCompletedMissionCounts = UserAwareAction.async { implicit request =>
    val missionCounts = MissionTable.selectMissionCountsPerUser
    val json = Json.arr(missionCounts.map(x => Json.obj(
      "user_id" -> x._1, "count" -> x._2
    )))
    Future.successful(Ok(json))
  }
}
