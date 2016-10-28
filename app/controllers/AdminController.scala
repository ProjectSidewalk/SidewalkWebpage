package controllers

import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, LogoutEvent, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import controllers.headers.ProvidesHeader
import formats.json.TaskFormats._
import models.audit.{AuditTaskInteraction, AuditTaskInteractionTable, AuditTaskTable, InteractionWithLabel}
import models.daos.slick.DBTableDefinitions.UserTable
import models.label.LabelTable.LabelMetadata
import models.label.{LabelPointTable, LabelTable}
import models.mission.MissionTable
import models.region.RegionTable
import models.street.{StreetEdge, StreetEdgeTable}
import models.user.User
import org.geotools.geometry.jts.JTS
import org.geotools.referencing.CRS
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}
import play.extras.geojson

import scala.concurrent.Future

/**
  * Todo. This controller is written quickly and not well thought out. Someone could polish the controller together with the model code that was written kind of ad-hoc.
  * @param env
  */
class AdminController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  // Helper methods
  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.roles.getOrElse(Seq()).contains("Administrator")) true else false
    case _ => false
  }

  // Pages
  def index = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      Future.successful(Ok(views.html.admin.index("Project Sidewalk", request.identity)))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def userProfile(username: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      UserTable.find(username) match {
        case Some(user) => Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity, Some(user))))
        case _ => Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity)))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def task(taskId: Int) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      AuditTaskTable.find(taskId) match {
        case Some(task) => Future.successful(Ok(views.html.admin.task("Project Sidewalk", request.identity, task)))
        case _ => Future.successful(Redirect("/"))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  // JSON APIs

  /**
    * Get a list of all labels
    *
    * @return
    */
  def getAllLabels = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val labels = LabelTable.selectLocationsOfLabels
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
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
    * Returns audit coverage of each neighborhood
    *
    * @return
    */
  def getNeighborhoodCompletionRate = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {

      // http://docs.geotools.org/latest/tutorials/geometry/geometrycrs.html
      val CRSEpsg4326 = CRS.decode("epsg:4326")
      val CRSEpsg26918 = CRS.decode("epsg:26918")
      val transform = CRS.findMathTransform(CRSEpsg4326, CRSEpsg26918)


      val neighborhoods = RegionTable.selectAllNamedNeighborhoods
      val completionRates: List[JsObject] = for (neighborhood <- neighborhoods) yield {
        val streets: List[StreetEdge] = StreetEdgeTable.selectStreetsByARegionId(neighborhood.regionId)
        val auditedStreets: List[StreetEdge] = StreetEdgeTable.selectAuditedStreetsByARegionId(neighborhood.regionId)

        val completedDistance = auditedStreets.map(s => JTS.transform(s.geom, transform).getLength).sum
        val totalDistance = streets.map(s => JTS.transform(s.geom, transform).getLength).sum
        Json.obj("region_id" -> neighborhood.regionId,
          "total_distance_m" -> totalDistance,
          "completed_distance_m" -> completedDistance,
          "name" -> neighborhood.name
        )
      }

      Future.successful(Ok(JsArray(completionRates)))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def getLabelsCollectedByAUser(username: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      UserTable.find(username) match {
        case Some(user) =>
          val labels = LabelTable.selectLocationsOfLabelsByUserId(UUID.fromString(user.userId))
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
        case _ => Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity)))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def getStreetsAuditedByAUser(username: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      UserTable.find(username) match {
        case Some(user) =>
          val streets = AuditTaskTable.selectStreetsAuditedByAUser(UUID.fromString(user.userId))
          val features: List[JsObject] = streets.map { edge =>
            val coordinates: Array[Coordinate] = edge.geom.getCoordinates
            val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList // Map it to an immutable list
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
        case _ => Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity)))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
    * This method returns the onboarding interaction data
    *
    * @return
    */
  def getOnboardingTaskInteractions = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val onboardingTransitions = AuditTaskInteractionTable.selectAuditTaskInteractionsOfAnActionType("Onboarding_Transition")
      val jsonObjectList = onboardingTransitions.map(x => Json.toJson(x))

      Future.successful(Ok(JsArray(jsonObjectList)))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
    * This method returns the tasks and labels submitted by the given user.
    *
    * @param username Username
    * @return
    */
  def getSubmittedTasksWithLabels(username: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      UserTable.find(username) match {
        case Some(user) =>
          val tasksWithLabels = AuditTaskTable.selectTasksWithLabels(UUID.fromString(user.userId)).map(x => Json.toJson(x))
          Future.successful(Ok(JsArray(tasksWithLabels)))
        case _ => Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity)))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def getMissionsCompletedByUsers = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val missionsCompleted = MissionTable.selectMissionsCompletedByUsers.map(x =>
        Json.obj("usrename" -> x.username, "label" -> x.label, "level" -> x.level, "distance_m" -> x.distance_m, "distance_ft" -> x.distance_ft, "distance_mi" -> x.distance_mi)
      )
      Future.successful(Ok(JsArray(missionsCompleted)))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def completedTasks = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {

      Future.successful(Ok(JsArray()))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
    * Get records of audit task interactions of a user
    *
    * @param username
    * @return
    */
  def getAuditTaskInteractionsOfAUser(username: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      UserTable.find(username) match {
        case Some(user) =>
          val interactions = AuditTaskInteractionTable.selectAuditTaskInteractionsOfAUser(UUID.fromString(user.userId)).map(interaction => Json.toJson(interaction))
          Future.successful(Ok(JsArray(interactions)))
        case _ => Future.successful(Ok(Json.obj("error" -> "no user found")))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def auditTaskInteractions(taskId: Int) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      AuditTaskTable.find(taskId) match {
        case Some(user) =>
          val interactions = AuditTaskInteractionTable.selectAuditTaskInteractions(taskId).map(x => Json.toJson(x))
          Future.successful(Ok(JsArray(interactions)))
        case _ => Future.successful(Ok(Json.obj("error" -> "no user found")))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def getAnAuditTaskPath(taskId: Int) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      AuditTaskTable.find(taskId) match {
        case Some(task) =>
          // Select interactions and format it into a geojson
          val interactionsWithLabels: List[InteractionWithLabel] = AuditTaskInteractionTable.selectAuditInteractionsWithLabels(task.auditTaskId)
          val featureCollection: JsObject = AuditTaskInteractionTable.auditTaskInteractionsToGeoJSON(interactionsWithLabels)
          Future.successful(Ok(featureCollection))
        case _ => Future.successful(Ok(Json.obj("error" -> "no user found")))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def getLabelData(labelId: Int) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      LabelPointTable.find(labelId) match {
        case Some(labelPointObj) =>
          val labelMetadata = LabelTable.getLabelMetadata(labelId)
          val labelMetadataJson: JsObject = LabelTable.labelMetadataToJson(labelMetadata)
          Future.successful(Ok(labelMetadataJson))
        case _ => Future.successful(Ok(Json.obj("error" -> "no such label")))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }
}