package controllers

import java.util.UUID
import javax.inject.Inject
import java.net.URLDecoder
import java.sql.Timestamp
import java.time.Instant
import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom.Coordinate
import controllers.headers.ProvidesHeader
import formats.json.TaskFormats._
import formats.json.UserRoleSubmissionFormats._
import models.attribute.{GlobalAttribute, GlobalAttributeTable}
import models.audit.{AuditTaskInteractionTable, AuditTaskTable, AuditedStreetWithTimestamp, InteractionWithLabel}
import models.daos.slick.DBTableDefinitions.UserTable
import models.gsv.GSVDataTable
import models.label.LabelTable.LabelMetadata
import models.label.{LabelPointTable, LabelTable, LabelTypeTable, LabelValidationTable}
import models.mission.MissionTable
import models.region.RegionCompletionTable
import models.street.StreetEdgeTable
import models.user._
import play.api.libs.json.{JsArray, JsError, JsObject, JsValue, Json}
import play.extras.geojson
import play.api.mvc.BodyParsers
import play.api.Play
import play.api.Play.current
import play.api.cache.EhCachePlugin
import javax.naming.AuthenticationException
import scala.concurrent.Future

/**
  * Holds the HTTP requests associated with the admin page.
  */
class AdminController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  /**
   * Checks if the given user is an Administrator.
   */
  def isAdmin(user: Option[User]): Boolean = user match {
    case Some(user) =>
      if (user.role.getOrElse("") == "Administrator" || user.role.getOrElse("") == "Owner") true else false
    case _ => false
  }

  /**
   * Loads the admin page.
   */
  def index = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      if (request.identity.nonEmpty) {
        val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
        val ipAddress: String = request.remoteAddress
        val user: User = request.identity.get
        WebpageActivityTable.save(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Admin", timestamp))
      }
      Future.successful(Ok(views.html.admin.index("Project Sidewalk", request.identity)))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
   * Loads the admin version of the user dashboard page.
   */
  def userProfile(username: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      UserTable.find(username) match {
        case Some(user) => Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity, Some(user))))
        case _ => Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity)))
      }
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
   * Loads the page that replays an audit task.
   */
  def task(taskId: Int) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      AuditTaskTable.find(taskId) match {
        case Some(task) => Future.successful(Ok(views.html.admin.task("Project Sidewalk", request.identity, task)))
        case _ => Future.successful(Redirect("/"))
      }
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
   * Get a list of all labels for the admin page.
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
          "severity" -> label.severity,
          "correct" -> label.correct,
          "high_quality_user" -> label.highQualityUser
        )
        Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
      }
      val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
      Future.successful(Ok(featureCollection))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
   * Get a list of all labels with metadata needed for /labelMap.
   */
  def getAllLabelsForLabelMap = UserAwareAction.async { implicit request =>
    val labels = LabelTable.selectLocationsAndSeveritiesOfLabels
    val features: List[JsObject] = labels.map { label =>
      val point = geojson.Point(geojson.LatLng(label.lat.toDouble, label.lng.toDouble))
      val properties = Json.obj(
        "label_id" -> label.labelId,
        "gsv_panorama_id" -> label.gsvPanoramaId,
        "label_type" -> label.labelType,
        "severity" -> label.severity,
        "correct" -> label.correct,
        "expired" -> label.expired,
        "high_quality_user" -> label.highQualityUser
      )
      Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
    }
    val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
    Future.successful(Ok(featureCollection))
  }

  /**
    * Get a list of all global attributes.
    */
  def getAllAttributes = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val attributes: List[GlobalAttribute] = GlobalAttributeTable.getAllGlobalAttributes
      val features: List[JsObject] = attributes.map { attribute =>
        val point = geojson.Point(geojson.LatLng(attribute.lat.toDouble, attribute.lng.toDouble))
        val properties = Json.obj(
          "attribute_id" -> attribute.globalAttributeId,
          "label_type" -> LabelTypeTable.labelTypeIdToLabelType(attribute.labelTypeId),
          "severity" -> attribute.severity
        )
        Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
      }
      val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
      Future.successful(Ok(featureCollection))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
    * Get audit coverage of each neighborhood.
    */
  def getNeighborhoodCompletionRate = UserAwareAction.async { implicit request =>
    RegionCompletionTable.initializeRegionCompletionTable()

    val neighborhoods = RegionCompletionTable.selectAllNamedNeighborhoodCompletions
    val completionRates: List[JsObject] = for (neighborhood <- neighborhoods) yield {
      val completionRate: Double =
        if (neighborhood.totalDistance > 0) neighborhood.auditedDistance / neighborhood.totalDistance
        else 1.0D
      Json.obj("region_id" -> neighborhood.regionId,
        "total_distance_m" -> neighborhood.totalDistance,
        "completed_distance_m" -> neighborhood.auditedDistance,
        "rate" -> completionRate,
        "name" -> neighborhood.name
      )
    }

    Future.successful(Ok(JsArray(completionRates)))
  }

  /**
    * Gets count of completed missions for each user.
    */
  def getAllUserCompletedMissionCounts = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val missionCounts: List[(String, String, Int)] = MissionTable.selectMissionCountsPerUser
      val jsonArray = Json.arr(missionCounts.map(x => {
        Json.obj("user_id" -> x._1, "role" -> x._2, "count" -> x._3)
      }))
      Future.successful(Ok(jsonArray))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
    * Gets count of completed missions for each anonymous user (diff users have diff ip addresses).
    */
  def getAllUserSignInCounts = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val counts: List[(String, String, Int)] = WebpageActivityTable.selectAllSignInCounts
      val jsonArray = Json.arr(counts.map(x => { Json.obj("user_id" -> x._1, "role" -> x._2, "count" -> x._3) }))
      Future.successful(Ok(jsonArray))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }


  /**
    * Returns city coverage percentage by Date.
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
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
    * Returns label counts by label type, for each region.
    */
  def getRegionNegativeLabelCounts() = UserAwareAction.async { implicit request =>

    // Groups by region_id... json looks like: {region_id: 123, labels: {NoCurbRamp: 5, Obstacle: 10, ...}}
    val features: List[JsObject] = GlobalAttributeTable.selectNegativeAttributeCountsByRegion().groupBy(_._1).map {
      case (rId, group) => Json.obj(
        "region_id" -> rId,
        "labels" -> Json.toJson(group.map(x => (x._2, x._3)).toMap)
      )
    }.toList

    val jsonObjectList = features.map(x => Json.toJson(x))
    Future.successful(Ok(JsArray(jsonObjectList)))
  }

  /**
   * Get the list of labels added by the given user.
   */
  def getLabelsCollectedByAUser(username: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      UserTable.find(username) match {
        case Some(user) =>
          val labels = LabelTable.getLabelLocations(UUID.fromString(user.userId))
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
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
   * Get the list of streets audited by the given user.
   */
  def getStreetsAuditedByAUser(username: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      UserTable.find(username) match {
        case Some(user) =>
          val streets = AuditTaskTable.getAuditedStreets(UUID.fromString(user.userId))
          val features: List[JsObject] = streets.map { edge =>
            val coordinates: Array[Coordinate] = edge.geom.getCoordinates
            val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList // Map it to an immutable list
          val linestring: geojson.LineString[geojson.LatLng] = geojson.LineString(latlngs)
            val properties = Json.obj(
              "street_edge_id" -> edge.streetEdgeId,
              "way_type" -> edge.wayType
            )
            Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
          }
          val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
          Future.successful(Ok(featureCollection))
        case _ => Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity)))
      }
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  def getAuditedStreetsWithTimestamps = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val streets: List[AuditedStreetWithTimestamp] = AuditTaskTable.getAuditedStreetsWithTimestamps
      val features: List[JsObject] = streets.map(_.toGeoJSON)
      val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
      Future.successful(Ok(featureCollection))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
   * Get the list of labels added by the given user along with the associated audit tasks.
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
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
   * Get the list of interactions logged for the given audit task. Used to reconstruct the task for playback.
   */
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
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
   * Get metadata for a given label ID (for admins; includes personal identifiers like username).
   */
  def getAdminLabelData(labelId: Int) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      LabelPointTable.find(labelId) match {
        case Some(labelPointObj) =>
          val userId: String = request.identity.get.userId.toString
          val labelMetadata: LabelMetadata = LabelTable.getSingleLabelMetadata(labelId, userId)
          val labelMetadataJson: JsObject = LabelTable.labelMetadataWithValidationToJsonAdmin(labelMetadata)
          Future.successful(Ok(labelMetadataJson))
        case _ => Future.successful(Ok(Json.obj("error" -> "no such label")))
      }
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
   * Get metadata for a given label ID (excludes personal identifiers like username).
   */
  def getLabelData(labelId: Int) = UserAwareAction.async { implicit request =>
    LabelPointTable.find(labelId) match {
      case Some(labelPointObj) =>
        val userId: String = request.identity.map(_.userId.toString).getOrElse("")
        val labelMetadata: LabelMetadata = LabelTable.getSingleLabelMetadata(labelId, userId)
        val labelMetadataJson: JsObject = LabelTable.labelMetadataWithValidationToJson(labelMetadata)
        Future.successful(Ok(labelMetadataJson))
      case _ => Future.successful(Ok(Json.obj("error" -> "no such label")))
    }
  }

  /**
   * Get the list of pano IDs in our database.
   * TODO remove the /adminapi/labels/panoid endpoint once all have shifted to /adminapi/panos
   */
  def getAllPanoIds() = UserAwareAction.async { implicit request =>
    val panos: List[(String, Option[Int], Option[Int])] = GSVDataTable.getAllPanos()
    val json: JsValue = Json.toJson(panos.map(p =>
      Json.obj("gsv_panorama_id" -> p._1, "image_width" -> p._2, "image_height" -> p._3)
    ))
    Future.successful(Ok(json))
  }

  /**
   * Get a count of the number of labels placed by each user.
   */
  def getAllUserLabelCounts = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val labelCounts = LabelTable.getLabelCountsPerUser
      val json: JsArray = Json.arr(labelCounts.map(x => Json.obj(
        "user_id" -> x._1, "role" -> x._2, "count" -> x._3
      )))
      Future.successful(Ok(json))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
    * Outputs a list of validation counts for all users with the user's role, the number of their labels that were
    * validated, and the number of their labels that were validated & agreed with.
    */
  def getAllUserValidationCounts = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val validationCounts = LabelValidationTable.getValidationCountsPerUser
      val json: JsArray = Json.arr(validationCounts.map(x => Json.obj(
        "user_id" -> x._1, "role" -> x._2, "count" -> x._3, "agreed" -> x._4
      )))
      Future.successful(Ok(json))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
    * If no argument is provided, returns all webpage activity records. O/w, returns all records with matching activity
    * If the activity provided doesn't exist, returns 400 (Bad Request).
    *
    * @param activity
    */
  def getWebpageActivities(activity: String) = UserAwareAction.async{ implicit request =>
    if (isAdmin(request.identity)) {
      val activities = WebpageActivityTable.webpageActivityListToJson(WebpageActivityTable.findKeyVal(activity, Array()))
      Future.successful(Ok(Json.arr(activities)))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /** Returns all records in the webpage_interactions table as a JSON array. */
  def getAllWebpageActivities = UserAwareAction.async{ implicit request =>
    if (isAdmin(request.identity)) {
      Future.successful(Ok(Json.arr(WebpageActivityTable.webpageActivityListToJson(WebpageActivityTable.getAllActivities))))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
    * Returns all records in webpage_activity table with activity field containing both activity and all keyValPairs.
    */
  def getWebpageActivitiesKeyVal(activity: String, keyValPairs: String) = UserAwareAction.async{ implicit request =>
    if (isAdmin(request.identity)) {
      // YES, we decode twice. This solves an issue with routing on the test/production server. Admin.js encodes twice.
      val keyVals: Array[String] = keyValPairs.split("/").map(URLDecoder.decode(_, "UTF-8")).map(URLDecoder.decode(_, "UTF-8"))
      val activities = WebpageActivityTable.webpageActivityListToJson(WebpageActivityTable.findKeyVal(activity, keyVals))
      Future.successful(Ok(Json.arr(activities)))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /** Returns number of records in webpage_activity table containing the specified activity. */
  def getNumWebpageActivities(activity: String) =   UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val activities = WebpageActivityTable.webpageActivityListToJson(WebpageActivityTable.findKeyVal(activity, Array()))
      Future.successful(Ok(activities.length + ""))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /** Returns number of records in webpage_activity table containing the specified activity and other keyValPairs. */
  def getNumWebpageActivitiesKeyVal(activity: String, keyValPairs: String) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val keyVals: Array[String] = keyValPairs.split("/").map(URLDecoder.decode(_, "UTF-8")).map(URLDecoder.decode(_, "UTF-8"))
      val activities = WebpageActivityTable.webpageActivityListToJson(WebpageActivityTable.findKeyVal(activity, keyVals))
      Future.successful(Ok(activities.length + ""))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
   * Updates the role in the database for the given user.
   */
  def setUserRole = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    val submission = request.body.validate[UserRoleSubmission]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        val userId: UUID = UUID.fromString(submission.userId)
        val newRole: String = submission.roleId

        if(isAdmin(request.identity)) {
          UserTable.findById(userId) match {
            case Some(user) =>
              if(UserRoleTable.getRole(userId) == "Owner") {
                Future.successful(BadRequest("Owner's role cannot be changed"))
              } else if (newRole == "Owner") {
                Future.successful(BadRequest("Cannot set a new owner"))
              } else if (!RoleTable.getRoleNames.contains(newRole)) {
                Future.successful(BadRequest("Invalid role"))
              } else {
                UserRoleTable.setRole(userId, newRole)
                Future.successful(Ok(Json.obj("username" -> user.username, "user_id" -> userId, "role" -> newRole)))
              }
            case None =>
              Future.successful(BadRequest("No user has this user ID"))
          }
        } else {
          Future.failed(new AuthenticationException("User is not an administrator"))
        }
      }
    )
  }
  
  /** Clears all cached values stored in the EhCachePlugin, which is Play's default cache plugin. */
  def clearPlayCache() = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val cacheController = Play.application.plugin[EhCachePlugin].get.manager
      val cache = cacheController.getCache("play")
      cache.removeAll()
      Future.successful(Ok("success"))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }

  /**
   * Updates user_stat table for users who audited in the past `hoursCutoff` hours. Update everyone if no time supplied.
   */
  def updateUserStats(hoursCutoff: Option[Int]) = UserAwareAction.async { implicit request =>
    if (isAdmin(request.identity)) {
      val cutoffTime: Timestamp = hoursCutoff match {
        case Some(hours) =>
          val msCutoff: Long = hours * 3600000L
          new Timestamp(Instant.now.toEpochMilli - msCutoff)
        case None =>
          new Timestamp(Instant.EPOCH.toEpochMilli)
      }

      UserStatTable.updateUserStatTable(cutoffTime)
      Future.successful(Ok("User stats updated!"))
    } else {
      Future.failed(new AuthenticationException("User is not an administrator"))
    }
  }
}
