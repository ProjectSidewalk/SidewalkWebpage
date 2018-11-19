package controllers

import java.util.UUID

import javax.inject.Inject
import java.net.URLDecoder

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import controllers.headers.ProvidesHeader
import formats.json.TaskFormats._
import formats.json.UserRoleSubmissionFormats._
import models.attribute.{GlobalAttribute, GlobalAttributeTable}
import models.audit._
import models.daos.slickdaos.DBTableDefinitions.UserTable
import models.label._
import models.mission.MissionTable
import models.region.RegionCompletionTable
import models.street.StreetEdgeTable
import models.user.{RoleTable, User, UserRoleTable, WebpageActivityTable}
import play.api.libs.json.{JsArray, JsError, JsObject, Json}
import play.extras.geojson
import play.api.mvc.BodyParsers

import scala.concurrent.ExecutionContext.Implicits.global
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
      if (user.role.getOrElse("") == "Administrator" || user.role.getOrElse("") == "Owner") true else false
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
      UserTable.find(username).map {
        case Some(user) => Ok(views.html.admin.user("Project Sidewalk", request.identity, Some(user)))
        case _ => Ok(views.html.admin.user("Project Sidewalk", request.identity))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def task(taskId: Int) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      AuditTaskTable.find(taskId).map {
        case Some(t) => Ok(views.html.admin.task("Project Sidewalk", request.identity, t))
        case _ => Redirect("/")
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
      val labelFutures: Future[Seq[LabelLocationWithSeverity]] = LabelTable.selectLocationsAndSeveritiesOfLabels
      val features: Future[Seq[JsObject]] = labelFutures.map { labels =>
        labels.map { label =>
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
      }
      features.map { fs => Ok(Json.obj("type" -> "FeatureCollection", "features" -> fs))}
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
    * Get a list of all global attributes
    *
    * @return
    */
  def getAllAttributes = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val attributesFuture: Future[Seq[GlobalAttribute]] = GlobalAttributeTable.getAllGlobalAttributes
      val features: Future[Seq[JsObject]] = attributesFuture.flatMap { attributes =>
        val attributeFutures = attributes.map { attribute =>
          val point = geojson.Point(geojson.LatLng(attribute.lat.toDouble, attribute.lng.toDouble))
          LabelTypeTable.labelTypeIdToLabelType(attribute.labelTypeId).map { labelType =>
            val properties = Json.obj(
              "attribute_id" -> attribute.globalAttributeId,
              "label_type" -> labelType,
              "severity" -> attribute.severity
            )
            Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
          }
        }
        Future.sequence(attributeFutures)
      }
      features.map { f => Ok(Json.obj("type" -> "FeatureCollection", "features" -> f)) }
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

    RegionCompletionTable.selectAllNamedNeighborhoodCompletions.map { neighborhoods =>
      val completionRates: List[JsObject] = for (neighborhood <- neighborhoods) yield {
        Json.obj("region_id" -> neighborhood.regionId,
          "total_distance_m" -> neighborhood.totalDistance,
          "completed_distance_m" -> neighborhood.auditedDistance,
          "rate" -> (neighborhood.auditedDistance / neighborhood.totalDistance),
          "name" -> neighborhood.name
        )
      }
      Ok(JsArray(completionRates))
    }
  }

  /**
    * Gets count of completed missions for each user.
    *
    * @return
    */
  def getAllUserCompletedMissionCounts = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      MissionTable.selectMissionCountsPerUser.map { missionCounts =>
        val jsonArray = Json.arr(missionCounts.map(x => {
          Json.obj("user_id" -> x._1, "role" -> x._2, "count" -> x._3)
        }))
        Ok(jsonArray)
      }
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
      WebpageActivityTable.selectAllSignInCounts.map { counts =>
        val jsonArray = Json.arr(counts.map(x => { Json.obj("user_id" -> x._1, "role" -> x._2, "count" -> x._3) }))
        Ok(jsonArray)
      }
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
      StreetEdgeTable.streetDistanceCompletionRateByDate(1).map { streets =>
        val json = Json.arr(streets.map(x => {
          Json.obj(
            "date" -> x._1, "completion" -> x._2
          )
        }))

        Ok(json)
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
    * Returns label counts by label type, for each region
    * @return
    */
  def getRegionNegativeLabelCounts() = UserAwareAction.async { implicit request =>

    RegionCompletionTable.selectAllNamedNeighborhoodCompletions.flatMap { neighborhoods =>
      val features = neighborhoods.map { neighborhood =>
        LabelTable.selectNegativeLabelCountsByRegionId(neighborhood.regionId).map { labelResults =>
          Json.obj(
            "region_id" -> neighborhood.regionId,
            "labels" -> Json.toJson(labelResults.toMap)
          )
        }
      }
      Future.sequence(features)
    }.map { features =>
      val jsonObjectList = features.map(Json.toJson(_))
      Ok(JsArray(jsonObjectList))
    }
  }

  def getLabelsCollectedByAUser(username: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      UserTable.find(username).flatMap {
        case Some(user) =>
          LabelTable.selectLocationsOfLabelsByUserId(UUID.fromString(user.userId)).map { labels =>
            val features = labels.map { label =>
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
            Ok(featureCollection)
          }
        case _ => Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity)))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def getStreetsAuditedByAUser(username: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      UserTable.find(username).flatMap {
        case Some(user) =>
          val streetsFuture = AuditTaskTable.selectStreetsAuditedByAUser(UUID.fromString(user.userId))
          val features: Future[Seq[JsObject]] = streetsFuture.map { streets =>
            streets.map { edge =>
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
          }
          features map { f => Ok(Json.obj("type" -> "FeatureCollection", "features" -> f)) }
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
      val transitionsFuture = AuditTaskInteractionTable.selectAuditTaskInteractionsOfAnActionType("Onboarding_Transition")
      transitionsFuture map { transitions => Ok(JsArray(transitions.map(x => Json.toJson(x)))) }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  /**
    * Get all auditing times
    *
    * @return
    */
  def getAuditTimes() = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val auditTimesFuture: Future[Seq[UserAuditTime]] = AuditTaskInteractionTable.selectAllAuditTimes()
      auditTimesFuture.map { auditTimes =>
        Ok(JsArray(
          auditTimes.map { auditTime =>
            Json.obj("user_id" -> auditTime.userId, "role" -> auditTime.role, "time" -> auditTime.duration)
          }
        ))
      }
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
      UserTable.find(username).flatMap {
        case Some(user) =>
          val tasksWithLabelsFuture = AuditTaskTable.selectTasksWithLabels(UUID.fromString(user.userId))
          tasksWithLabelsFuture map { tasksWithLabels => Ok(JsArray(tasksWithLabels.map(x => Json.toJson(x)))) }
        case _ => Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity)))
      }
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
      UserTable.find(username).flatMap {
        case Some(user) =>
          val interactionsFuture = AuditTaskInteractionTable.selectAuditTaskInteractionsOfAUser(UUID.fromString(user.userId))
          interactionsFuture map { interactions => Ok(JsArray(interactions.map(x => Json.toJson(x)))) }
        case _ => Future.successful(Ok(Json.obj("error" -> "no user found")))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def getAnAuditTaskPath(taskId: Int) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val auditTaskFuture: Future[Option[AuditTask]] = AuditTaskTable.find(taskId)
      auditTaskFuture flatMap {
        case Some(task) =>
          // Select interactions and format it into a geojson
          AuditTaskInteractionTable.selectAuditInteractionsWithLabels(task.auditTaskId) map { interactions =>
            Ok(AuditTaskInteractionTable.auditTaskInteractionsToGeoJSON(interactions))
          }
        case _ => Future.successful(Ok(Json.obj("error" -> "no user found")))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def getLabelData(labelId: Int) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val labelPointFuture: Future[Option[LabelPoint]] = LabelPointTable.find(labelId)
      labelPointFuture flatMap {
        case Some(labelPointObj) =>
          LabelTable.retrieveSingleLabelMetadata(labelId).map { label => Ok(LabelTable.labelMetadataToJson(label)) }
        case _ => Future.successful(Ok(Json.obj("error" -> "no such label")))
      }
    } else {
      Future.successful(Redirect("/"))
    }
  }

  def getAllPanoIds() = UserAwareAction.async { implicit request =>
    LabelTable.selectLocationsOfLabels map { labels =>
      Ok(Json.obj(
        "type" -> "FeatureCollection",
        "features" -> labels.map { label =>
          Json.obj("properties" -> Json.obj("gsv_panorama_id" -> label.gsvPanoramaId))
        }
      ))
    }
  }

  /**
    * USER CENTRIC ANALYTICS
    */

  def getAllUserLabelCounts = UserAwareAction.async { implicit request =>
    LabelTable.getLabelCountsPerUser.map { labelCounts =>
      Ok(Json.arr(labelCounts.map(x => Json.obj("user_id" -> x._1, "role" -> x._2, "count" -> x._3))))
    }
  }

  /**
    * If no argument is provided, returns all webpage activity records. O/w, returns all records with matching activity
    * If the activity provided doesn't exist, returns 400 (Bad Request).
    *
    * @param activity
    */
  def getWebpageActivities(activity: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)){
      WebpageActivityTable.findKeyVal(activity, Array()).map { webpageActivities =>
        val activities = WebpageActivityTable.webpageActivityListToJson(webpageActivities)
        if(activities.length == 0){
          BadRequest(Json.obj("status" -> "Error", "message" -> "Invalid activity name"))
        } else {
          Ok(Json.arr(activities))
        }
      }
    }else{
      Future.successful(Redirect("/"))
    }
  }

  /** Returns all records in the webpage_interactions table as a JSON array. */
  def getAllWebpageActivities = UserAwareAction.async{implicit request =>
    if (isAdmin(request.identity)){
      WebpageActivityTable.getAllActivities.map { webpageActivities =>
        Ok(Json.arr(WebpageActivityTable.webpageActivityListToJson(webpageActivities)))
      }
    }else{
      Future.successful(Redirect("/"))
    }
  }

  /**
    * Returns all records in webpage_activity table with activity field containing both activity and all keyValPairs.
    *
    * @param activity
    * @param keyValPairs
    * @return
    */
  def getWebpageActivitiesKeyVal(activity: String, keyValPairs: String) = UserAwareAction.async{ implicit request =>
    if (isAdmin(request.identity)){
      val keyVals: Array[String] = keyValPairs.split("/").map(URLDecoder.decode(_, "UTF-8"))
      WebpageActivityTable.findKeyVal(activity, keyVals).flatMap { webpageActivities =>
        val activities = WebpageActivityTable.webpageActivityListToJson(webpageActivities)
        Future.successful(Ok(Json.arr(activities)))
      }
    }else{
      Future.successful(Redirect("/"))
    }
  }

  /** Returns number of records in webpage_activity table containing the specified activity. */
  def getNumWebpageActivities(activity: String) =   UserAwareAction.async{implicit request =>
    if (isAdmin(request.identity)){
      WebpageActivityTable.findKeyVal(activity, Array()).flatMap { webpageActivities =>
        val activities = WebpageActivityTable.webpageActivityListToJson(webpageActivities)
        Future.successful(Ok(activities.length + ""))
      }
    }else{
      Future.successful(Redirect("/"))
    }
  }

  /** Returns number of records in webpage_activity table containing the specified activity and other keyValPairs. */
  def getNumWebpageActivitiesKeyVal(activity: String, keyValPairs: String) = UserAwareAction.async{ implicit request =>
    if (isAdmin(request.identity)){
      val keyVals: Array[String] = keyValPairs.split("/").map(URLDecoder.decode(_, "UTF-8")).map(URLDecoder.decode(_, "UTF-8"))
      WebpageActivityTable.findKeyVal(activity, keyVals).flatMap { webpageActivities =>
        val activities = WebpageActivityTable.webpageActivityListToJson(webpageActivities)
        Future.successful(Ok(activities.length + ""))
      }
    }else{
      Future.successful(Redirect("/"))
    }
  }

  def setUserRole = UserAwareAction.async(BodyParsers.parse.json){ implicit request =>
    val submission = request.body.validate[UserRoleSubmission]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        val userId = UUID.fromString(submission.userId)
        val newRole = submission.roleId

        if(isAdmin(request.identity)){
          UserTable.findById(userId).flatMap {
            case Some(user) =>
              for {
                role <- UserRoleTable.getRole(userId)
                roleNames <- RoleTable.getRoleNames
              } yield {
                if(role == "Owner") {
                  BadRequest("Owner's role cannot be changed")
                } else if (newRole == "Owner") {
                  BadRequest("Cannot set a new owner")
                } else if (!roleNames.contains(newRole)) {
                  BadRequest("Invalid role")
                } else {
                  UserRoleTable.setRole(userId, newRole)
                  Ok(Json.obj("username" -> user.username, "user_id" -> userId, "role" -> newRole))
                }
              }
            case None =>
              Future.successful(BadRequest("No user has this user ID"))
          }
        } else {
          Future.successful(Redirect("/"))
        }
      }
    )
  }
}
