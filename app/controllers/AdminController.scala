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
import models.region.{RegionCompletionTable, RegionTable}
import models.street.{StreetEdge, StreetEdgeTable}
import models.user.{User, WebpageActivityTable}
import models.daos.UserDAOImpl
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

  // List of user IDs for researchers that have worked on Project Sidewalk. Used to filter or mark as a researcher.
  // Jon, Kotaro, Mikey, Soheil, Manaswi, Teja, Aditya, Chirag, Sage, Anthony, Ryan H, Ladan, Ji Hyuk Bae, Maria Furman,
  // Zadorozhnyy, Alexander Zhang, Zachary Lawrence, test5, Manaswi again, test4, test6, test7, test8, test_0830
  val researcherIds: List[String] = List("49787727-e427-4835-a153-9af6a83d1ed1", "25b85b51-574b-436e-a9c4-339eef879e78",
    "9efaca05-53bb-492e-83ab-2b47219ee863", "5473abc6-38fc-4807-a515-e44cdfb92ca2", "0c6cb637-05b7-4759-afb2-b0a25b615597",
    "9c828571-eb9d-4723-9e8d-2c00289a6f6a", "6acde11f-d9a2-4415-b73e-137f28eaa4ab", "0082be2e-c664-4c05-9881-447924880e2e",
    "ae8fc440-b465-4a45-ab49-1964a7f1dcee", "c4ba8834-4722-4ee1-8f71-4e3fe9af38eb", "41804389-8f0e-46b1-882c-477e060dbe95",
    "d8862038-e4dd-48a4-a6d0-69042d9e247a", "43bd82ab-bc7d-4be7-a637-99c92f566ba5", "0bfed786-ce24-43f9-9c58-084ae82ad175",
    "b65c0864-7c3a-4ba7-953b-50743a2634f6", "b6049113-7e7a-4421-a966-887266200d72", "395abc5a-14ea-443c-92f8-85e87fa002be",
    "a6611125-51d0-41d1-9868-befcf523e131", "1dc2f78e-f722-4450-b14e-b21b232ecdef", "ee570f03-7bca-471e-a0dc-e7924dac95a4",
    "23fce322-9f64-4e95-90fc-7141f755b2a1", "c846ef76-39c1-4a53-841c-6588edaac09b", "74b56671-c9b0-4052-956e-02083cbb5091",
    "fe724938-797a-48af-84e9-66b6b86b6245")

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
      val labels = LabelTable.selectLocationsAndSeveritiesOfLabels
      val features: List[JsObject] = labels.map { label =>
        val point = geojson.Point(geojson.LatLng(label.lat.toDouble, label.lng.toDouble))
        val properties = Json.obj(
          "audit_task_id" -> label.auditTaskId,
          "label_id" -> label.labelId,
          "gsv_panorama_id" -> label.gsvPanoramaId,
          "label_type" -> label.labelType,
          "severity" -> label.severity
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
    RegionCompletionTable.initializeRegionCompletionTable()

    val neighborhoods = RegionCompletionTable.selectAllNamedNeighborhoodCompletions
    val completionRates: List[JsObject] = for (neighborhood <- neighborhoods) yield {
      Json.obj("region_id" -> neighborhood.regionId,
        "total_distance_m" -> neighborhood.totalDistance,
        "completed_distance_m" -> neighborhood.auditedDistance,
        "rate" -> (neighborhood.auditedDistance / neighborhood.totalDistance),
        "name" -> neighborhood.name
      )
    }

    Future.successful(Ok(JsArray(completionRates)))
  }

  /**
    * Gets count of completed missions for each anonymous user (diff users have diff ip addresses)
    *
    * @return
    */
  def getAllAnonUserCompletedMissionCounts = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val counts: List[(Option[String], Int)] = UserDAOImpl.getAnonUserCompletedMissionCounts
      val jsonArray = Json.arr(counts.map(x => {
        Json.obj("ip_address" -> x._1, "count" -> x._2, "is_researcher" -> false)
      }))
      Future.successful(Ok(jsonArray))
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
    * Gets count of completed missions for each anonymous user (diff users have diff ip addresses)
    *
    * @return
    */
  def getAllUserSignInCounts = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val counts: List[(String, Int)] = WebpageActivityTable.selectAllSignInCounts
      val jsonArray = Json.arr(counts.map(x => {
        Json.obj("user_id" -> x._1, "count" -> x._2, "is_researcher" -> researcherIds.contains(x._1))
      }))
      Future.successful(Ok(jsonArray))
    } else {
      Future.successful(Redirect("/"))
    }
  }


  /**
    * Returns DC coverage percentage by Date
    *
    * @return
    */
  def getCompletionRateByDate = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val streets: Seq[(String, Float)] = StreetEdgeTable.streetDistanceCompletionRateByDate(1)
      val json = Json.arr(streets.map(x => {
        Json.obj(
          "date" -> x._1, "completion" -> x._2
        )
      }))

      Future.successful(Ok(json))
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
        Json.obj("username" -> x.username, "label" -> x.label, "level" -> x.level, "distance_m" -> x.distance_m,
          "distance_ft" -> x.distance_ft, "distance_mi" -> x.distance_mi)
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

  def getAllPanoIds() = UserAwareAction.async { implicit request =>

    val labels = LabelTable.selectLocationsOfLabels
    val features: List[JsObject] = labels.map { label =>

      val properties = Json.obj(
        "gsv_panorama_id" -> label.gsvPanoramaId
      )
      Json.obj("properties" -> properties)
    }
    val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
    Future.successful(Ok(featureCollection))

  }

  /**
    * USER CENTRIC ANALYTICS
    */

  def getAllRegisteredUserLabelCounts = UserAwareAction.async { implicit request =>
    val labelCounts = LabelTable.getLabelCountsPerRegisteredUser
    val json = Json.arr(labelCounts.map(x => Json.obj(
      "user_id" -> x._1, "count" -> x._2, "is_researcher" -> researcherIds.contains(x._1)
    )))
    Future.successful(Ok(json))
  }

  def getAllAnonUserLabelCounts = UserAwareAction.async { implicit request =>
    val labelCounts = LabelTable.getLabelCountsPerAnonUser
    val json = Json.arr(labelCounts.map(x => Json.obj(
      "ip_address" -> x._1, "count" -> x._2, "is_researcher" -> false
    )))
    Future.successful(Ok(json))
  }
}