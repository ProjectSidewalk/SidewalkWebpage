package controllers

import play.silhouette.api.Silhouette
import models.auth.DefaultEnv
import controllers.base._
import models.utils.MapParams

import javax.inject._
import play.api.mvc._
import play.api.Play
import play.api.libs.json.{JsObject, Json}
import org.locationtech.jts.geom.MultiPolygon
import controllers.helper.ControllerUtils.parseIntegerSeq
import models.audit.StreetEdgeWithAuditStatus
import models.user.SidewalkUserWithRole
import models.utils.CommonUtils.METERS_TO_MILES
import play.api.i18n.Messages

import scala.concurrent.ExecutionContext
//import play.api.libs.json._
import models.utils.MyPostgresProfile.api._
import scala.concurrent.Future
import scala.util.Try

@Singleton
class UserProfileController @Inject()(
                                       cc: CustomControllerComponents,
                                       val silhouette: Silhouette[DefaultEnv],
                                       userService: service.UserService,
                                       auditTaskService: service.AuditTaskService
                                     )(implicit ec: ExecutionContext, assets: AssetsFinder) extends CustomBaseController(cc) {
//  /*
//  * Loads the user dashboard page.
//  */
//  def userProfile = cc.securityService.SecuredAction { implicit request =>
//    // If they are an anonymous user, send them to the sign-in page.
//    if (request.identity.isEmpty || request.identity.get.role.getOrElse("") == "Anonymous") {
//      Future.successful(Redirect(s"/signIn?url=/"))
//    } else {
//      val user: User = request.identity.get
//      val timestamp: OffsetDateTime = OffsetDateTime.now
//      val ipAddress: String = request.remoteAddress
//      cc.loggingService.insert(user.userId, ipAddress, "Visit_UserDashboard")
//      // Get distance audited by the user. Convert meters to km if using metric system, to miles if using IS.
//      val auditedDistance: Float = {
//        if (Messages("measurement.system") == "metric") AuditTaskTable.getDistanceAudited(user.userId) / 1000F
//        else AuditTaskTable.getDistanceAudited(user.userId) * METERS_TO_MILES
//      }
//      Future.successful(Ok(views.html.userProfile(s"Project Sidewalk", user, None, false, auditedDistance)))
//    }
//  }
//
//  /**
//   * Get the list of streets that have been audited by the signed-in user.
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
//  def getRecentMistakes(userId: String, n: Int) = silhouette.UserAwareAction.async { implicit request =>
//    if (isAdmin(request.identity) || request.identity.map(_.userId) == Some(userId)) {
//      val labelTypes: List[String] = List("CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem", "Crosswalk", "Signal")
//      val validations = LabelTable.getRecentValidatedLabelsForUser(UUID.fromString(userId), n, labelTypes)
//      val validationJson: JsValue = Json.toJson(labelTypes.map { t =>
//        t -> validations.filter(_.labelType == t).map(labelMetadataUserDashToJson)
//      }.toMap)
//      Future.successful(Ok(validationJson))
//    } else {
//      Future.successful(Ok(Json.obj("error" -> "0", "message" -> "You do not have permission to request this data.")))
//    }
//  }
//
//  /**
//   * Sets the team of the given user.
//   *
//   * @param teamId ID of team the user is to be added to. If invalid, user is just removed from their current team.
//   */
//  def setUserTeam(userId: String, teamId: Int) = cc.securityService.SecuredAction { implicit request =>
//    request.identity match {
//      case Some(user) =>
//        val userUUID: UUID = user.userId
//        if (user.role.getOrElse("") != "Anonymous" && userId == userUUID.toString) {
//          val userTeam: Option[Int] = UserTeamTable.getTeam(userUUID)
//          if (userTeam.isEmpty) {
//            UserTeamTable.save(userUUID, teamId)
//          } else if (userTeam.get != teamId) {
//            UserTeamTable.remove(userUUID, userTeam.get)
//            UserTeamTable.save(userUUID, teamId)
//          }
//        }
//        Future.successful(Ok(Json.obj("user_id" -> userUUID, "team_id" -> teamId)))
//      case None =>
//        Future.successful(Ok(Json.obj("error" -> "0", "message" -> "Your user id could not be found.")))
//    }
//  }
//
//  /**
//   * Creates a team and puts them in the team table.
//   */
//  def createTeam() = Action(parse.json) { request =>
//    val name: String = (request.body \ "name").as[String]
//    val description: String = (request.body \ "description").as[String]
//
//    // Inserting into the database and capturing the generated teamId.
//    val teamId: Int = TeamTable.insert(name, description)
//
//    Ok(Json.obj(
//      "message" -> "Team created successfully!",
//      "team_id" -> teamId
//    ))
//  }
//
//  /**
//   * Grabs a list of all the teams in the tables, regardless of open or closed status.
//   */
//  def getTeams() = Action.async { implicit request =>
//    val teams: List[Team] = TeamTable.getAllTeams()
//    Future.successful(Ok(Json.toJson(teams)))
//  }
//
//  /**
//   * Grabs a list of all "open" teams in the tables.
//   */
//  def getAllOpenTeams() = Action.async { implicit request =>
//    val openTeams: List[Team] = TeamTable.getAllOpenTeams()
//    Future.successful(Ok(Json.toJson(openTeams)))
//  }

  /**
   * Gets some basic stats about the logged-in user that we show across the site: distance, label count, and accuracy.
   */
  def getBasicUserStats = cc.securityService.SecuredAction { implicit request =>
    val userId: String = request.identity.userId

    // Get distance audited by the user. Convert meters to km if using metric system, to miles if using IS.
    val auditedDistance: Future[Float] = userService.getDistanceAudited(userId).map(auditedDistance => {
      if (Messages("measurement.system") == "metric") auditedDistance / 1000F
      else auditedDistance * METERS_TO_MILES
    })
    val labelCount: Future[Int] = userService.countLabelsFromUser(userId)
    val accuracy: Future[Option[Float]] = userService.getUserAccuracy(userId)

    // Run in parallel and return the results as a JSON object.
    for {
      auditedDistance <- auditedDistance
      labelCount <- labelCount
      accuracy <- accuracy
    } yield Ok(Json.obj(
      "distance_audited" -> auditedDistance,
      "label_count" -> labelCount,
      "accuracy" -> accuracy
    ))
  }

//  /**
//  * Updates the open status of the specified team.
//  *
//  * @param teamId The ID of the team to update.
//  */
//  def updateStatus(teamId: Int) = silhouette.UserAwareAction(parse.json) { request =>
//    if (isAdmin(request.identity)) {
//      val open: Boolean = (request.body \ "open").as[Boolean]
//      TeamTable.updateStatus(teamId, open)
//      Ok(Json.obj("status" -> "success", "team_id" -> teamId, "open" -> open))
//    } else {
//      Ok(Json.obj("status" -> "error", "message" -> "User is not an Administrator"))
//    }
//  }
//
//  /**
//  * Updates the visibility status of the specified team.
//  *
//  * @param teamId The ID of the team to update.
//  */
//  def updateVisibility(teamId: Int) = silhouette.UserAwareAction(parse.json) { request =>
//    if (isAdmin(request.identity)) {
//    val visible: Boolean = (request.body \ "visible").as[Boolean]
//    TeamTable.updateVisibility(teamId, visible)
//    Ok(Json.obj("status" -> "success", "team_id" -> teamId, "visible" -> visible))
//    } else {
//      Ok(Json.obj("status" -> "error", "message" -> "User is not an Administrator"))
//    }
//  }
}
