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
    "1dc2f78e-f722-4450-b14e-b21b232ecdef", "23fce322-9f64-4e95-90fc-7141f755b2a1", "c846ef76-39c1-4a53-841c-6588edaac09b",
    "74b56671-c9b0-4052-956e-02083cbb5091", "fe724938-797a-48af-84e9-66b6b86b6245")

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
    val json = Json.arr(missionCounts.map(x =>
      Json.obj("user_id" -> x._1, "count" -> x._2, "is_researcher" -> researcherIds.contains(x._1))
    ))
    Future.successful(Ok(json))
  }
}
