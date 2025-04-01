package controllers

import controllers.base._
import controllers.helper.ControllerUtils.parseIntegerSeq
import formats.json.LabelFormat.labelMetadataUserDashToJson
import models.auth._
import models.label.LabelTypeTable
import models.user.SidewalkUserWithRole
import models.utils.CommonUtils.METERS_TO_MILES
import models.utils.MyPostgresProfile.api._
import play.api.Configuration
import play.api.i18n.Messages
import play.api.libs.json.{JsObject, Json}
import play.silhouette.api.Silhouette
import play.silhouette.impl.exceptions.IdentityNotFoundException
import service.UserProfileData

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class UserProfileController @Inject()(cc: CustomControllerComponents,
                                      val silhouette: Silhouette[DefaultEnv],
                                      val config: Configuration,
                                      configService: service.ConfigService,
                                      authenticationService: service.AuthenticationService,
                                      userService: service.UserService,
                                      labelService: service.LabelService,
                                      auditTaskService: service.AuditTaskService,
                                      gsvDataService: service.GSVDataService
                                     )(implicit ec: ExecutionContext, assets: AssetsFinder) extends CustomBaseController(cc) {
  implicit val implicitConfig = config

  /**
   * Loads the user dashboard page.
   */
  def userProfile = cc.securityService.SecuredAction(WithSignedIn()) { implicit request =>
    val user: SidewalkUserWithRole = request.identity
    val metricSystem: Boolean = Messages("measurement.system") == "metric"
    for {
      userProfileData: UserProfileData <- userService.getUserProfileData(user.userId, metricSystem)
      commonData <- configService.getCommonPageData(request2Messages.lang)
    } yield {
      cc.loggingService.insert(user.userId, request.remoteAddress, "Visit_UserDashboard")
      Ok(views.html.userProfile(commonData, "Sidewalk - Dashboard", user, user, userProfileData, adminData = None))
    }
  }

  /**
   * Get the list of streets that have been audited by the given user.
   */
  def getAuditedStreets(userId: String) = cc.securityService.SecuredAction(WithAdminOrIsUser(userId)) { implicit request =>
    authenticationService.findByUserId(userId).flatMap {
      case Some(user) =>
        userService.getAuditedStreets(userId).map { streets =>
          val features: Seq[JsObject] = streets.map { street =>
            val properties: JsObject = Json.obj(
              "street_edge_id" -> street.streetEdgeId,
              "way_type" -> street.wayType
            )
            Json.obj("type" -> "Feature", "geometry" -> street.geom, "properties" -> properties)
          }
          val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
          Ok(featureCollection)
        }
      case _ => Future.failed(new IdentityNotFoundException("Username not found."))
    }
  }

  /**
   * Get the list of all streets and whether they have been audited or not, regardless of user.
   */
  def getAllStreets(filterLowQuality: Boolean, regions: Option[String], routes: Option[String]) = Action.async { implicit request =>
    val regionIds: Seq[Int] = parseIntegerSeq(regions)
    val routeIds: Seq[Int] = parseIntegerSeq(routes)

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

  /**
   * Get the list of labels submitted by the given user. Only include labels in the given region if supplied.
   */
  def getSubmittedLabels(userId: String, regionId: Option[Int]) = cc.securityService.SecuredAction(WithAdminOrIsUser(userId)) { implicit request =>
    authenticationService.findByUserId(userId).flatMap {
      case Some(user) =>
        userService.getLabelLocations(userId, regionId).map { labels =>
          val features: Seq[JsObject] = labels.map { label =>
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
                "gsv_panorama_id" -> label.gsvPanoramaId,
                "label_type" -> label.labelType,
                "correct" -> label.correct,
                "has_validations" -> label.hasValidations
              )
            )
          }
          val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
          Ok(featureCollection)
        }
      case _ => Future.failed(new IdentityNotFoundException("Username not found."))
    }
  }

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

  /**
   * Get up `n` recent mistakes for each label type, using validations provided by other users.
   * @param userId ID of the user whose mistakes we want to find.
   * @param n Number of mistakes to retrieve for each label type.
   * @return
   */
  def getRecentMistakes(userId: String, n: Int) = cc.securityService.SecuredAction(WithAdminOrIsUser(userId)) { implicit request =>
    authenticationService.findByUserId(userId).flatMap {
      case Some(user) =>
        val labelTypes: Set[String] = LabelTypeTable.primaryValidationLabelTypes
        labelService.getRecentValidatedLabelsForUser(userId, labelTypes, n).map { validations =>
          val validationJson = Json.toJson(labelTypes.map { labelType =>
            labelType -> validations(labelType).map { l =>
              val imageUrl: String = gsvDataService.getImageUrl(l.gsvPanoramaId, l.heading, l.pitch, l.zoom)
              labelMetadataUserDashToJson(l, imageUrl)
            }
          }.toMap)
          Ok(validationJson)
        }
      case _ => Future.failed(new IdentityNotFoundException("Username not found."))
    }
  }

  /**
   * Sets the team of the given user.
   */
  def setUserTeam(userId: String, teamId: Int) = cc.securityService.SecuredAction(WithAdminOrRegisteredAndIsUser(userId)) { implicit request =>
    userService.setUserTeam(userId, teamId)
      .map(_ => Ok(Json.obj("user_id" -> userId, "team_id" -> teamId)))
  }

  /**
   * Creates a team and puts it in the team table.
   */
  def createTeam() = cc.securityService.SecuredAction(parse.json) { request =>
    val name: String = (request.body \ "name").as[String]
    val description: String = (request.body \ "description").as[String]

    // Inserting into the database and capturing the generated teamId.
    userService.createTeam(name, description).map { teamId =>
      Ok(Json.obj(
        "message" -> "Team created successfully!",
        "team_id" -> teamId
      ))
    }
  }

//  /**
//   * Grabs a list of all the teams in the tables, regardless of open or closed status.
//   */
//  def getTeams() = Action.async { implicit request =>
//    val teams: List[Team] = TeamTable.getAllTeams
//    Future.successful(Ok(Json.toJson(teams)))
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
