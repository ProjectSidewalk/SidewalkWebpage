package controllers

import com.mohiva.play.silhouette.api.Silhouette
import models.auth.DefaultEnv
import controllers.base._
import models.utils.MapParams

import javax.inject._
import play.api.mvc._
import play.api.Play
import play.api.libs.json.{JsObject, Json}
import service.region.RegionService
import service.utils.ConfigService
import com.vividsolutions.jts.geom.MultiPolygon
import controllers.helper.ControllerUtils.parseIntegerSeq
import models.audit.StreetEdgeWithAuditStatus
import models.user.SidewalkUserWithRole
import service.audit.AuditTaskService

import scala.concurrent.ExecutionContext
//import play.api.libs.json._
import models.utils.MyPostgresProfile.api._

import scala.concurrent.Future
import scala.util.Try

@Singleton
class UserProfileController @Inject()(
                                       cc: CustomControllerComponents,
                                       val silhouette: Silhouette[DefaultEnv],
                                       auditTaskService: AuditTaskService
                                     )(implicit ec: ExecutionContext, assets: AssetsFinder) extends CustomBaseController(cc) {
//  /*
//  * Loads the user dashboard page.
//  */
//  def userProfile = cc.securityService.SecuredAction { implicit request =>
//    // If they are an anonymous user, send them to the sign in page.
//    if (request.identity.isEmpty || request.identity.get.role == "Anonymous") {
//      Future.successful(Redirect(s"/signIn?url=/"))
//    } else {
//      val user: User = request.identity.get
//      val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)
//      val ipAddress: String = request.remoteAddress
//      cc.loggingService.insert(WebpageActivity(0, user.userId.toString, ipAddress, "Visit_UserDashboard", timestamp))
//      // Get distance audited by the user. Convert meters to km if using metric system, to miles if using IS.
//      val auditedDistance: Float = {
//        if (Messages("measurement.system") == "metric") AuditTaskTable.getDistanceAudited(user.userId) / 1000F
//        else AuditTaskTable.getDistanceAudited(user.userId) * METERS_TO_MILES
//      }
//      Future.successful(Ok(views.html.userProfile(s"Project Sidewalk", Some(user), auditedDistance)))
//    }
//  }
//
//  /**
//   * Get the list of streets that have been audited by the signed in user.
//   */
//  def getAuditedStreets = cc.securityService.SecuredAction { implicit request =>
//    request.identity match {
//      case Some(user) =>
//        val streets = AuditTaskTable.getAuditedStreets(user.userId)
//        val features: List[JsObject] = streets.map { edge =>
//          val coordinates: Array[Coordinate] = edge.geom.getCoordinates
//          val latlngs: List[geojson.LatLng] = coordinates.map(coord => geojson.LatLng(coord.y, coord.x)).toList
//          val linestring: geojson.LineString[geojson.LatLng] = geojson.LineString(latlngs)
//          val properties = Json.obj(
//            "street_edge_id" -> edge.streetEdgeId,
//            "way_type" -> edge.wayType
//          )
//          Json.obj("type" -> "Feature", "geometry" -> linestring, "properties" -> properties)
//        }
//        val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
//        Future.successful(Ok(featureCollection))
//      case None => Future.successful(Ok(Json.obj(
//        "error" -> "0",
//        "message" -> "We could not find your username in our system :("
//      )))
//    }
//  }
//
  /**
   * Get the list of all streets and whether they have been audited or not, regardless of user.
   */
  def getAllStreets(filterLowQuality: Boolean, regions: Option[String], routes: Option[String]) = Action.async { implicit request =>
    val regionIds: Seq[Int] = parseIntegerSeq(regions)
    val routeIds: Seq[Int] = parseIntegerSeq(regions)

    auditTaskService.selectStreetsWithAuditStatus(filterLowQuality, regionIds, routeIds).map { streets =>
      val features: Seq[JsObject] = streets.map { street =>
        val properties: JsObject = Json.obj(
          "street_edge_id" -> street.streetEdgeId,
          "way_type" -> street.wayType,
          "region_id" -> street.regionId,
          "audited" -> street.audited
        )
        Json.obj("type" -> "Feature", "geometry" -> street.geom, "properties" -> properties)
      }
      val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
      Ok(featureCollection)
    }
  }
//
//  /**
//   * Get the list of labels submitted by the signed in user. Only include labels in the given region if supplied.
//   */
//  def getSubmittedLabels(regionId: Option[Int]) = cc.securityService.SecuredAction { implicit request =>
//    request.identity match {
//      case Some(user) =>
//        val labels: List[LabelLocation] = LabelTable.getLabelLocations(user.userId, regionId)
//        val features: List[JsObject] = labels.map { label =>
//          val point = geojson.Point(geojson.LatLng(label.lat.toDouble, label.lng.toDouble))
//          val properties = Json.obj(
//            "audit_task_id" -> label.auditTaskId,
//            "label_id" -> label.labelId,
//            "gsv_panorama_id" -> label.gsvPanoramaId,
//            "label_type" -> label.labelType,
//            "correct" -> label.correct,
//            "has_validations" -> label.hasValidations
//          )
//          Json.obj("type" -> "Feature", "geometry" -> point, "properties" -> properties)
//        }
//        val featureCollection = Json.obj("type" -> "FeatureCollection", "features" -> features)
//        Future.successful(Ok(featureCollection))
//      case None =>  Future.successful(Ok(Json.obj(
//        "error" -> "0",
//        "message" -> "Your user id could not be found."
//      )))
//    }
//  }
//
//  /**
//   * Get a count of the number of audits that have been completed each day.
//   */
//  def getAllAuditCounts = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    val auditCounts = AuditTaskTable.auditCounts
//    val json = Json.arr(auditCounts.map(x => Json.obj(
//      "date" -> x.date, "count" -> x.count
//    )))
//    Future.successful(Ok(json))
//  }
//
//  /**
//   * Get a count of the number of labels that have been added each day.
//   */
//  def getAllLabelCounts = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    val labelCounts = LabelTable.selectLabelCountsPerDay
//    val json = Json.arr(labelCounts.map(x => Json.obj(
//      "date" -> x.date, "count" -> x.count
//    )))
//    Future.successful(Ok(json))
//  }
//
//  /**
//   * Get a count of the number of validations that have been completed each day.
//   */
//  def getAllValidationCounts = silhouette.UserAwareAction.async { implicit request: UserAwareRequest[DefaultEnv, AnyContent] =>
//    val validationCounts = LabelValidationTable.getValidationsByDate
//    val json = Json.arr(validationCounts.map(x => Json.obj(
//      "date" -> x.date, "count" -> x.count
//    )))
//    Future.successful(Ok(json))
//  }
//
//  /**
//   * Get up `n` recent mistakes for each label type, using validations provided by other users.
//   * @param n Number of mistakes to retrieve for each label type.
//   * @return
//   */
//  def getRecentMistakes(n: Int) = silhouette.UserAwareAction.async {implicit request =>
//    val labelTypes: List[String] = List("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "Crosswalk", "Signal")
//    val validations = LabelTable.getRecentValidatedLabelsForUser(request.identity.get.userId, n, labelTypes)
//    val validationJson: JsValue = Json.toJson(labelTypes.map { t =>
//      t -> validations.filter(_.labelType == t).map(labelMetadataUserDashToJson)
//    }.toMap)
//    Future.successful(Ok(validationJson))
//  }
//
//  /**
//   * Sets the org of the given user.
//   *
//   * @param orgId The id of the org the user is to be added to.
//   *              If the id is not a valid org (e.g. 0), then the user is removed from their current org without
//   *              being added to a new one.
//   */
//  def setUserOrg(orgId: Int) = cc.securityService.SecuredAction { implicit request =>
//    request.identity match {
//      case Some(user) =>
//        val userId: UUID = user.userId
//        if (user.role != "Anonymous") {
//          val userOrg: Option[Int] = UserOrgTable.getOrg(userId)
//          if (userOrg.isEmpty) {
//            UserOrgTable.insert(userId, orgId)
//          } else if (userOrg.get != orgId) {
//            UserOrgTable.remove(userId, userOrg.get)
//            UserOrgTable.insert(userId, orgId)
//          }
//        }
//        Future.successful(Ok(Json.obj("user_id" -> userId, "org_id" -> orgId)))
//      case None =>
//        Future.successful(Ok(Json.obj("error" -> "0", "message" -> "Your user id could not be found.")))
//    }
//  }
//
//  /**
//   * Creates a team and puts them in the organization table.
//   */
//  def createTeam() = Action(parse.json) { request =>
//    val orgName: String = (request.body \ "name").as[String]
//    val orgDescription: String = (request.body \ "description").as[String]
//
//    // Inserting into the database and capturing the generated orgId.
//    val orgId: Int = OrganizationTable.insert(orgName, orgDescription)
//
//    Ok(Json.obj(
//      "message" -> "Organization created successfully!",
//      "org_id" -> orgId
//    ))
//  }
//
//
//  /**
//   * Gets some basic stats about the logged in user that we show across the site: distance, label count, and accuracy.
//   */
//  def getBasicUserStats = cc.securityService.SecuredAction { implicit request =>
//    request.identity match {
//      case Some(user) =>
//        val userId: UUID = user.userId
//        // Get distance audited by the user. Convert meters to km if using metric system, to miles if using IS.
//        val auditedDistance: Float = {
//          if (Messages("measurement.system") == "metric") AuditTaskTable.getDistanceAudited(userId) / 1000F
//          else AuditTaskTable.getDistanceAudited(userId) * METERS_TO_MILES
//        }
//        Future.successful(Ok(Json.obj(
//          "distance_audited" -> auditedDistance,
//          "label_count" -> LabelTable.countLabels(userId),
//          "accuracy" -> LabelValidationTable.getUserAccuracy(userId)
//        )))
//      case None =>
//        Future.successful(Ok(Json.obj("error" -> "0", "message" -> "Your user id could not be found.")))
//    }
//  }
}

