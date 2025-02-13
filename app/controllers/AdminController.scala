package controllers

import play.silhouette.api.actions.UserAwareRequest

import java.util.UUID
import javax.inject.{Inject, Singleton}
import java.net.URLDecoder
import java.sql.Timestamp
import java.time.Instant
import play.silhouette.api.Silhouette
import models.auth.{DefaultEnv, WithAdmin}
import controllers.base._
import models.label.{AdminValidationData, LabelMetadata}
import play.api.mvc.{Action, AnyContent}
import service.LabelService
import service.region.RegionService

import scala.concurrent.ExecutionContext
import controllers.helper.ControllerUtils.{isAdmin, parseIntegerSeq}
import formats.json.LabelFormat
import formats.json.TaskFormats._
import formats.json.AdminUpdateSubmissionFormats._
import formats.json.LabelFormat._
import formats.json.OrganizationFormats._
import formats.json.UserFormats._

import scala.collection.parallel.CollectionConverters._
//import models.attribute.{GlobalAttribute, GlobalAttributeTable}
import models.audit.{AuditTaskInteractionTable, AuditTaskTable, AuditedStreetWithTimestamp, InteractionWithLabel}
//import models.daos.slick._
import models.gsv.{GSVDataSlim, GSVDataTable}
//import models.label.LabelTable.{AdminValidationData, LabelMetadata}
import models.label.{LabelLocationWithSeverity, LabelPointTable, LabelTable, LabelTypeTable, LabelValidationTable}
import models.mission.MissionTable
import models.region.RegionCompletionTable
import models.street.StreetEdgeTable
import models.user._
import models.utils.CommonUtils.METERS_TO_MILES
import play.api.libs.json.{JsArray, JsError, JsObject, JsValue, Json}
//import play.extras.geojson
//import play.api.cache.EhCachePlugin
//import play.extras.geojson.{LatLng, Point}

import javax.naming.AuthenticationException
import scala.concurrent.Future

@Singleton
class AdminController @Inject() (
                                  cc: CustomControllerComponents,
                                  val silhouette: Silhouette[DefaultEnv],
                                  regionService: RegionService,
                                  labelService: LabelService
                                )(implicit ec: ExecutionContext, assets: AssetsFinder) extends CustomBaseController(cc) {

  /**
   * Loads the admin page.
   */
//  def index = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      if (request.identity.nonEmpty) {
//        val timestamp: Timestamp = Timestamp.from(Instant.now)
//        val ipAddress: String = request.remoteAddress
//        val user: User = request.identity.get
//        cc.loggingService.insert(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_Admin", timestamp))
//      }
//      Future.successful(Ok(views.html.admin.index("Project Sidewalk", request.identity)))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }

  /**
   * Loads the admin version of the user dashboard page.
   */
//  def userProfile(username: String) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      UserTable.find(username) match {
//        case Some(user) =>
//          // Get distance audited by the user. Convert meters to km if using metric system, to miles if using IS.
//          val auditedDistance: Float = {
//            val userId: UUID = UUID.fromString(user.userId)
//            if (Messages("measurement.system") == "metric") AuditTaskTable.getDistanceAudited(userId) / 1000F
//            else AuditTaskTable.getDistanceAudited(userId) * METERS_TO_MILES
//          }
//          Future.successful(Ok(views.html.admin.user("Project Sidewalk", request.identity.get, user, auditedDistance)))
//        case _ => Future.failed(new NotFoundException("Username not found."))
//      }
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }

  /**
   * Loads the page that shows a single label.
   */
//  def label(labelId: Int) = cc.securityService.SecuredAction { implicit request =>
//    val admin: Boolean = isAdmin(request.identity)
//    Future.successful(Ok(views.html.admin.label("Sidewalk LabelView", request.identity, admin, labelId)))
//  }

  /**
   * Loads the page that replays an audit task.
   */
//  def task(taskId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      AuditTaskTable.find(taskId) match {
//        case Some(task) => Future.successful(Ok(views.html.admin.task("Project Sidewalk", request.identity, task)))
//        case _ => Future.successful(Redirect("/"))
//      }
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }

  /**
   * Get a list of all labels for the admin page.
   */
  def getAllLabels = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    labelService.selectLocationsAndSeveritiesOfLabels(Seq(), Seq()).map { labels =>
      val features: Seq[JsObject] = labels.par.map { label =>
        Json.obj(
          "type" -> "Feature",
          // TODO turning this to geojson should maybe be in MyPostgresProfile.scala? Maybe we should be storing as a point first?
          "geometry" -> Json.obj(
            "type" -> "Point",
            "coordinates" -> Json.arr(label.lng.toDouble, label.lat.toDouble)
          ),
          "properties" -> Json.obj(
            "audit_task_id" -> label.auditTaskId,
            "label_id" -> label.labelId,
            "label_type" -> label.labelType,
            "severity" -> label.severity,
            "correct" -> label.correct,
            "high_quality_user" -> label.highQualityUser
          )
        )
      }.seq
      val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
      Ok(featureCollection)
    }
  }

  /**
   * Get a list of all labels with metadata needed for /labelMap.
   */
  def getAllLabelsForLabelMap(regions: Option[String], routes: Option[String]) = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
    val regionIds: Seq[Int] = parseIntegerSeq(regions)
    val routeIds: Seq[Int] = parseIntegerSeq(routes)

    labelService.selectLocationsAndSeveritiesOfLabels(regionIds, routeIds).map { labels =>
      val features: Seq[JsObject] = labels.par.map { label =>
        Json.obj(
          "type" -> "Feature",
          // TODO turning this to geojson should maybe be in MyPostgresProfile.scala? Maybe we should be storing as a point first?
          "geometry" -> Json.obj(
            "type" -> "Point",
            "coordinates" -> Json.arr(label.lng.toDouble, label.lat.toDouble)
          ),
          "properties" -> Json.obj(
            "label_id" -> label.labelId,
            "label_type" -> label.labelType,
            "severity" -> label.severity,
            "correct" -> label.correct,
            "has_validations" -> label.hasValidations,
            "expired" -> label.expired,
            "high_quality_user" -> label.highQualityUser
          )
        )
      }.seq
      val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
      Ok(featureCollection)
    }
  }

  /**
    * Get a list of all global attributes.
    */
//  def getAllAttributes = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      val attributes: List[GlobalAttribute] = GlobalAttributeTable.getAllGlobalAttributes
//      val features: List[JsObject] = attributes.map { attribute =>
//        val point = geojson.Point(geojson.LatLng(attribute.lat.toDouble, attribute.lng.toDouble))
//        val properties = Json.obj(
//          "attribute_id" -> attribute.globalAttributeId,
//          "label_type" -> LabelTypeTable.labelTypeIdToLabelType(attribute.labelTypeId).get,
//          "severity" -> attribute.severity
//        )
//        Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
//      }
//      val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
//      Future.successful(Ok(featureCollection))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }

  /**
    * Get audit coverage of each neighborhood.
    */
  def getNeighborhoodCompletionRate(regions: Option[String]) = Action.async { implicit request =>
    val regionIds: Seq[Int] = parseIntegerSeq(regions)

    for {
      regionCompletionInit <- regionService.initializeRegionCompletionTable
      // TODO do I need to explicitly make sure that the init happens first? I think so.
      neighborhoods <- regionService.selectAllNamedNeighborhoodCompletions(regionIds)
    } yield {
      val completionRates: Seq[JsObject] = for (neighborhood <- neighborhoods) yield {
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
      Ok(JsArray(completionRates))
    }
  }

  /**
    * Gets count of completed missions for each user.
    */
//  def getAllUserCompletedMissionCounts = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      val missionCounts: List[(String, String, Int)] = MissionTable.selectMissionCountsPerUser
//      val jsonArray = Json.arr(missionCounts.map(x => {
//        Json.obj("user_id" -> x._1, "role" -> x._2, "count" -> x._3)
//      }))
//      Future.successful(Ok(jsonArray))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }

  /**
    * Gets count of completed missions for each anonymous user (diff users have diff ip addresses).
    */
//  def getAllUserSignInCounts = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      val counts: List[(String, String, Int)] = WebpageActivityTable.selectAllSignInCounts
//      val jsonArray = Json.arr(counts.map(x => { Json.obj("user_id" -> x._1, "role" -> x._2, "count" -> x._3) }))
//      Future.successful(Ok(jsonArray))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }


  /**
    * Returns city coverage percentage by Date.
    */
//  def getCompletionRateByDate = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      val streets: Seq[(String, Float)] = StreetEdgeTable.streetDistanceCompletionRateByDate(1)
//      val json = Json.arr(streets.map(x => {
//        Json.obj(
//          "date" -> x._1, "completion" -> x._2
//        )
//      }))
//
//      Future.successful(Ok(json))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }

  /**
    * Returns label counts by label type, for each region.
    */
//  def getRegionNegativeLabelCounts() = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//
//    // Groups by region_id... json looks like: {region_id: 123, labels: {NoCurbRamp: 5, Obstacle: 10, ...}}
//    val features: List[JsObject] = GlobalAttributeTable.selectNegativeAttributeCountsByRegion().groupBy(_._1).map {
//      case (rId, group) => Json.obj(
//        "region_id" -> rId,
//        "labels" -> Json.toJson(group.map(x => (x._2, x._3)).toMap)
//      )
//    }.toList
//
//    val jsonObjectList = features.map(x => Json.toJson(x))
//    Future.successful(Ok(JsArray(jsonObjectList)))
//  }

  /**
   * Get the list of labels added by the given user.
   */
//  def getLabelsCollectedByAUser(username: String) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      UserTable.find(username) match {
//        case Some(user) =>
//          val labels = LabelTable.getLabelLocations(UUID.fromString(user.userId))
//          val features: List[JsObject] = labels.map { label =>
//            val point = geojson.Point(geojson.LatLng(label.lat.toDouble, label.lng.toDouble))
//            val properties = Json.obj(
//              "audit_task_id" -> label.auditTaskId,
//              "label_id" -> label.labelId,
//              "gsv_panorama_id" -> label.gsvPanoramaId,
//              "label_type" -> label.labelType,
//              "correct" -> label.correct,
//              "has_validations" -> label.hasValidations
//            )
//            Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
//          }
//          val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
//          Future.successful(Ok(featureCollection))
//        case _ => Future.failed(new NotFoundException("Username not found."))
//      }
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }

  /**
   * Get the list of streets audited by the given user.
   */
//  def getStreetsAuditedByAUser(username: String) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      UserTable.find(username) match {
//        case Some(user) =>
//          val streets = AuditTaskTable.getAuditedStreets(UUID.fromString(user.userId))
//          val features: List[JsObject] = streets.map { edge =>
//            val coordinates: Array[Coordinate] = edge.geom.getCoordinates
//            val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList // Map it to an immutable list
//          val linestring: geojson.LineString[geojson.LatLng] = geojson.LineString(latlngs)
//            val properties = Json.obj(
//              "street_edge_id" -> edge.streetEdgeId,
//              "way_type" -> edge.wayType
//            )
//            Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
//          }
//          val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
//          Future.successful(Ok(featureCollection))
//        case _ => Future.failed(new NotFoundException("Username not found."))
//      }
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }

//  def getAuditedStreetsWithTimestamps = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      val streets: List[AuditedStreetWithTimestamp] = AuditTaskTable.getAuditedStreetsWithTimestamps
//      val features: List[JsObject] = streets.map(_.toGeoJSON)
//      val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
//      Future.successful(Ok(featureCollection))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }
//
//  /**
//   * Get the list of labels added by the given user along with the associated audit tasks.
//   */
//  def getSubmittedTasksWithLabels(username: String) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      UserTable.find(username) match {
//        case Some(user) =>
//          val tasksWithLabels = AuditTaskTable.selectTasksWithLabels(UUID.fromString(user.userId)).map(x => Json.toJson(x))
//          Future.successful(Ok(JsArray(tasksWithLabels)))
//        case _ => Future.failed(new NotFoundException("Username not found."))
//      }
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }
//
//  /**
//   * Get the list of interactions logged for the given audit task. Used to reconstruct the task for playback.
//   */
//  def getAnAuditTaskPath(taskId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      AuditTaskTable.find(taskId) match {
//        case Some(task) =>
//          // Select interactions and format it into a geojson
//          val interactionsWithLabels: List[InteractionWithLabel] = AuditTaskInteractionTable.selectAuditInteractionsWithLabels(task.auditTaskId)
//          val featureCollection: JsObject = AuditTaskInteractionTable.auditTaskInteractionsToGeoJSON(interactionsWithLabels)
//          Future.successful(Ok(featureCollection))
//        case _ => Future.successful(Ok(Json.obj("error" -> "no user found")))
//      }
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }

  /**
   * Get metadata for a given label ID (for admins; includes personal identifiers like username).
   */
  def getAdminLabelData(labelId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    labelService.getSingleLabelMetadata(labelId, request.identity.userId).flatMap {
      case Some(metadata) =>
        labelService.getExtraAdminValidateData(Seq(labelId)).map(adminData => {
          Ok(LabelFormat.labelMetadataWithValidationToJsonAdmin(metadata, adminData.head))
        })
      case None => Future.successful(NotFound(s"No label found with ID: $labelId"))
    }
  }

  /**
   * Get metadata for a given label ID (excludes personal identifiers like username).
   */
  def getLabelData(labelId: Int) = cc.securityService.SecuredAction { implicit request =>
    labelService.getSingleLabelMetadata(labelId, request.identity.userId).map {
      case Some(metadata) => Ok(LabelFormat.labelMetadataWithValidationToJson(metadata))
      case None =>           NotFound(s"No label found with ID: $labelId")
    }
  }

//  /**
//   * Get metadata used for 2022 CV project for all labels, and output as JSON.
//   */
//  def getAllLabelMetadataForCV = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    val jsonFile = new java.io.File(s"cv_metadata_${Timestamp.from(Instant.now).toString}.json")
//    val writer = new java.io.PrintStream(jsonFile)
//    writer.print("[")
//
//    // Grab 10k labels at a time and write them to a JSON file to reduce server memory usage and crashes.
//    var startIndex: Int = 0
//    val batchSize: Int = 20000
//    var moreWork: Boolean = true
//    while (moreWork) {
//      val features: List[JsValue] = LabelTable.getLabelCVMetadata(startIndex, batchSize).map(l => Json.toJson(l))
//      writer.print(features.map(_.toString).mkString(","))
//      startIndex += batchSize
//      if (features.length < batchSize) moreWork = false
//      else writer.print(",")
//    }
//    writer.print("]")
//    writer.close()
//
//    Future.successful(Ok.sendFile(content = jsonFile, inline = true, onClose = () => jsonFile.delete()))
//  }
//
//  /**
//   * Get the list of pano IDs in our database.
//   * TODO remove the /adminapi/labels/panoid endpoint once all have shifted to /adminapi/panos
//   */
//  def getAllPanoIds = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    val panos: List[GSVDataSlim] = GSVDataTable.getAllPanosWithLabels
//    val json: JsValue = Json.toJson(panos.map(p => Json.toJson(p)))
//    Future.successful(Ok(json))
//  }
//
//  /**
//   * Get a count of the number of labels placed by each user.
//   */
//  def getAllUserLabelCounts = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      val labelCounts = LabelTable.getLabelCountsPerUser
//      val json: JsArray = Json.arr(labelCounts.map(x => Json.obj(
//        "user_id" -> x._1, "role" -> x._2, "count" -> x._3
//      )))
//      Future.successful(Ok(json))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }
//
//  /**
//    * Outputs a list of validation counts for all users with the user's role, the number of their labels that were
//    * validated, and the number of their labels that were validated & agreed with.
//    */
//  def getAllUserValidationCounts = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      val validationCounts = LabelValidationTable.getValidationCountsPerUser
//      val json: JsArray = Json.arr(validationCounts.map(x => Json.obj(
//        "user_id" -> x._1, "role" -> x._2, "count" -> x._3, "agreed" -> x._4
//      )))
//      Future.successful(Ok(json))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }
//
//  /**
//    * If no argument is provided, returns all webpage activity records. O/w, returns all records with matching activity
//    * If the activity provided doesn't exist, returns 400 (Bad Request).
//    *
//    * @param activity
//    */
//  def getWebpageActivities(activity: String) = silhouette.UserAwareAction.async{ implicit request =>
//    if (isAdmin(request.identity)) {
//      val activities = WebpageActivityTable.webpageActivityListToJson(WebpageActivityTable.findKeyVal(activity, Array()))
//      Future.successful(Ok(Json.arr(activities)))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }
//
//  /** Returns all records in the webpage_interactions table as a JSON array. */
//  def getAllWebpageActivities = silhouette.UserAwareAction.async{ implicit request =>
//    if (isAdmin(request.identity)) {
//      Future.successful(Ok(Json.arr(WebpageActivityTable.webpageActivityListToJson(WebpageActivityTable.getAllActivities))))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }
//
//  /**
//    * Returns all records in webpage_activity table with activity field containing both activity and all keyValPairs.
//    */
//  def getWebpageActivitiesKeyVal(activity: String, keyValPairs: String) = silhouette.UserAwareAction.async{ implicit request =>
//    if (isAdmin(request.identity)) {
//      // YES, we decode twice. This solves an issue with routing on the test/production server. Admin.js encodes twice.
//      val keyVals: Array[String] = keyValPairs.split("/").map(URLDecoder.decode(_, "UTF-8")).map(URLDecoder.decode(_, "UTF-8"))
//      val activities = WebpageActivityTable.webpageActivityListToJson(WebpageActivityTable.findKeyVal(activity, keyVals))
//      Future.successful(Ok(Json.arr(activities)))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }
//
//  /** Returns number of records in webpage_activity table containing the specified activity. */
//  def getNumWebpageActivities(activity: String) =   cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      val activities = WebpageActivityTable.webpageActivityListToJson(WebpageActivityTable.findKeyVal(activity, Array()))
//      Future.successful(Ok(activities.length + ""))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }
//
//  /** Returns number of records in webpage_activity table containing the specified activity and other keyValPairs. */
//  def getNumWebpageActivitiesKeyVal(activity: String, keyValPairs: String) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      val keyVals: Array[String] = keyValPairs.split("/").map(URLDecoder.decode(_, "UTF-8")).map(URLDecoder.decode(_, "UTF-8"))
//      val activities = WebpageActivityTable.webpageActivityListToJson(WebpageActivityTable.findKeyVal(activity, keyVals))
//      Future.successful(Ok(activities.length + ""))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }
//
//  /**
//   * Updates the role in the database for the given user.
//   */
//  def setUserRole = silhouette.UserAwareAction.async(parse.json) { implicit request =>
//    val submission = request.body.validate[UserRoleSubmission]
//
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//      },
//      submission => {
//        val userId: UUID = UUID.fromString(submission.userId)
//        val newRole: String = submission.roleId
//
//        if(isAdmin(request.identity)) {
//          UserTable.findById(userId) match {
//            case Some(user) =>
//              if(UserRoleTable.getRole(userId) == "Owner") {
//                Future.successful(BadRequest("Owner's role cannot be changed"))
//              } else if (newRole == "Owner") {
//                Future.successful(BadRequest("Cannot set a new owner"))
//              } else if (!RoleTable.getRoleNames.contains(newRole)) {
//                Future.successful(BadRequest("Invalid role"))
//              } else {
//                UserRoleTable.setRole(userId, newRole, communityService = None)
//                Future.successful(Ok(Json.obj("username" -> user.username, "user_id" -> userId, "role" -> newRole)))
//              }
//            case None =>
//              Future.successful(BadRequest("No user has this user ID"))
//          }
//        } else {
//          Future.failed(new AuthenticationException("User is not an administrator"))
//        }
//      }
//    )
//  }
//
//  /**
//   * Updates the org in the database for the given user.
//   */
//  def setUserOrg = silhouette.UserAwareAction.async(parse.json) { implicit request =>
//    val submission = request.body.validate[UserOrgSubmission]
//
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//      },
//      submission => {
//        val userId: UUID = UUID.fromString(submission.userId)
//        val newOrgId: Int = submission.orgId
//
//        if (isAdmin(request.identity)) {
//          val currentOrg: Option[Int] = UserOrgTable.getOrg(userId)
//          if (currentOrg.nonEmpty) {
//            UserOrgTable.remove(userId, currentOrg.get)
//          }
//          val rowsUpdated: Int = UserOrgTable.insert(userId, newOrgId)
//
//          if (rowsUpdated == -1 && currentOrg.isEmpty) {
//            Future.successful(BadRequest("Update failed"))
//          } else {
//            Future.successful(Ok(Json.obj("user_id" -> userId, "org_id" -> newOrgId)))
//          }
//        } else {
//          Future.failed(new AuthenticationException("User is not an administrator"))
//        }
//      }
//    )
//  }
//
//  /** Clears all cached values stored in the EhCachePlugin, which is Play's default cache plugin. */
//  def clearPlayCache() = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      val cacheController = Play.application.plugin[EhCachePlugin].get.manager
//      val cache = cacheController.getCache("play")
//      cache.removeAll()
//      Future.successful(Ok("success"))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }
//
//  /**
//   * Updates user_stat table for users who audited in the past `hoursCutoff` hours. Update everyone if no time supplied.
//   */
//  def updateUserStats(hoursCutoff: Option[Int]) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      val cutoffTime: Timestamp = hoursCutoff match {
//        case Some(hours) =>
//          val msCutoff: Long = hours * 3600000L
//          new Timestamp(Instant.now.toEpochMilli - msCutoff)
//        case None =>
//          new Timestamp(Instant.EPOCH.toEpochMilli)
//      }
//
//      UserStatTable.updateUserStatTable(cutoffTime)
//      Future.successful(Ok("User stats updated!"))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }
//
//  /**
//   * Updates the flags of all tasks before the given date for the given user.
//   */
//  def setTaskFlagsBeforeDate() = silhouette.UserAwareAction.async(parse.json) { implicit request =>
//    val submission = request.body.validate[TaskFlagsByDateSubmission]
//
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//      },
//      submission => {
//        if (isAdmin(request.identity)) {
//          UserTable.find(submission.username) match {
//            case Some(user) =>
//              val userId: UUID = UUID.fromString(user.userId)
//              val date: Timestamp = Timestamp.from(submission.date)
//              AuditTaskTable.updateTaskFlagsBeforeDate(userId, date, submission.flag, submission.state)
//              Future.successful(Ok(Json.obj("userId" -> userId, "date" -> date, "flag" -> submission.flag, "state" -> submission.state)))
//            case None =>
//              Future.successful(BadRequest("No user has this user ID"))
//          }
//        } else {
//          Future.failed(new AuthenticationException("User is not an administrator"))
//        }
//      }
//    )
//  }
//
//  /**
//   * Updates a single flag for a single audit task specified by the audit task id.
//   * @return
//   */
//  def setTaskFlag() = silhouette.UserAwareAction.async(parse.json) { implicit request =>
//    val submission = request.body.validate[TaskFlagSubmission]
//
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//      },
//      submission => {
//        if (isAdmin(request.identity)) {
//          AuditTaskTable.updateTaskFlag(submission.auditTaskId, submission.flag, submission.state)
//          Future.successful(Ok(Json.obj("auditTaskId" -> submission.auditTaskId, "flag" -> submission.flag, "state" -> submission.state)))
//        } else {
//          Future.failed(new AuthenticationException("User is not an administrator"))
//        }
//      }
//    )
//  }
//
//  /**
//   * Gets street edge data for the coverage section of the admin page.
//   */
//  def getCoverageData = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    val streetCountsData = Json.obj(
//      "total" -> StreetEdgeTable.countTotalStreets(),
//      "audited" -> Json.obj(
//        "all_users" -> Json.obj(
//          "all" -> StreetEdgeTable.countAuditedStreets(),
//          "high_quality" -> StreetEdgeTable.countAuditedStreets(1, "All", true)
//        ),
//        "registered" -> Json.obj(
//          "all" -> StreetEdgeTable.countAuditedStreets(1, "Registered"),
//          "high_quality" -> StreetEdgeTable.countAuditedStreets(1, "Registered", true)
//        ),
//        "anonymous" -> Json.obj(
//          "all" -> StreetEdgeTable.countAuditedStreets(1, "Anonymous"),
//          "high_quality" -> StreetEdgeTable.countAuditedStreets(1, "Anonymous", true)
//        ),
//        "turker" -> Json.obj(
//          "all" -> StreetEdgeTable.countAuditedStreets(1, "Turker"),
//          "high_quality" -> StreetEdgeTable.countAuditedStreets(1, "Turker", true)
//        ),
//        "researcher" -> Json.obj(
//          "all" -> StreetEdgeTable.countAuditedStreets(1, "Researcher"),
//          "high_quality" -> StreetEdgeTable.countAuditedStreets(1, "Researcher", true)
//        )
//      )
//    )
//
//    val streetDistanceData = Json.obj(
//      "total" -> StreetEdgeTable.totalStreetDistance(),
//      "audited" -> Json.obj(
//        "all_users" -> Json.obj(
//          "all" -> StreetEdgeTable.auditedStreetDistance(1),
//          "high_quality" -> StreetEdgeTable.auditedStreetDistance(1, "All", true)
//        ),
//        "registered" -> Json.obj(
//          "all" -> StreetEdgeTable.auditedStreetDistance(1, "Registered"),
//          "high_quality" -> StreetEdgeTable.auditedStreetDistance(1, "Registered", true)
//        ),
//        "anonymous" -> Json.obj(
//          "all" -> StreetEdgeTable.auditedStreetDistance(1, "Anonymous"),
//          "high_quality" -> StreetEdgeTable.auditedStreetDistance(1, "Anonymous", true)
//        ),
//        "turker" -> Json.obj(
//          "all" -> StreetEdgeTable.auditedStreetDistance(1, "Turker"),
//          "high_quality" -> StreetEdgeTable.auditedStreetDistance(1, "Turker", true)
//        ),
//        "researcher" -> Json.obj(
//          "all" -> StreetEdgeTable.auditedStreetDistance(1, "Researcher"),
//          "high_quality" -> StreetEdgeTable.auditedStreetDistance(1, "Researcher", true)
//        ),
//
//        // Audited distance over time is related, but included in a separate table on the Admin page.
//        "with_overlap" -> Json.obj(
//          "all_time" -> StreetEdgeTable.auditedStreetDistanceOverTime("all time"),
//          "today" -> StreetEdgeTable.auditedStreetDistanceOverTime("today"),
//          "week" -> StreetEdgeTable.auditedStreetDistanceOverTime("week")
//        )
//      )
//    )
//
//    val data = Json.obj(
//      "street_counts" -> streetCountsData,
//      "street_distance" -> streetDistanceData
//    )
//    Future.successful(Ok(data))
//  }
//
//  /**
//   * Get the stats for the users table in the admin page.
//   */
//  def getUserStats = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
//    if (isAdmin(request.identity)) {
//      val data = Json.obj(
//        "user_stats" -> Json.toJson(UserDAOSlick.getUserStatsForAdminPage),
//        "organizations" -> Json.toJson(OrganizationTable.getAllOrganizations)
//      )
//      Future.successful(Ok(data))
//    } else {
//      Future.failed(new AuthenticationException("User is not an administrator"))
//    }
//  }
}
