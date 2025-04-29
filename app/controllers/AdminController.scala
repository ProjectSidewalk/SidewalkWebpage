package controllers

import controllers.base._
import controllers.helper.ControllerUtils.{isAdmin, parseIntegerSeq}
import formats.json.AdminFormats._
import formats.json.LabelFormat._
import formats.json.UserFormats._
import models.auth.{DefaultEnv, WithAdmin}
import models.label.LabelTypeTable
import models.user.RoleTable
import play.api.Configuration
import play.api.cache.AsyncCacheApi
import play.api.i18n.Messages
import play.api.libs.json.{JsArray, JsError, JsObject, Json}
import play.api.mvc.AnyContent
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.UserAwareRequest
import play.silhouette.impl.exceptions.IdentityNotFoundException
import service._

import java.time.format.DateTimeFormatter
import java.time.{Instant, OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.collection.parallel.CollectionConverters._
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class AdminController @Inject() (cc: CustomControllerComponents,
                                 val silhouette: Silhouette[DefaultEnv],
                                 val config: Configuration,
                                 configService: service.ConfigService,
                                 cacheApi: AsyncCacheApi,
                                 authenticationService: service.AuthenticationService,
                                 adminService: service.AdminService,
                                 regionService: RegionService,
                                 labelService: LabelService,
                                 streetService: StreetService,
                                 userService: service.UserService
                                )(implicit ec: ExecutionContext, assets: AssetsFinder) extends CustomBaseController(cc) {
  implicit val implicitConfig = config
  val dateFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")

  /**
   * Loads the admin page.
   */
  def index = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, "Visit_Admin")
      Ok(views.html.admin.index(commonData, "Sidewalk - Admin", request.identity))
    }
  }

  /**
   * Loads the admin version of the user dashboard page.
   */
  def userProfile(username: String) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    authenticationService.findByUsername(username).flatMap {
      case Some(user) =>
        val metricSystem: Boolean = Messages("measurement.system") == "metric"
        for {
          userProfileData: UserProfileData <- userService.getUserProfileData(user.userId, metricSystem)
          adminData <- adminService.getAdminUserProfileData(user.userId)
          commonData <- configService.getCommonPageData(request2Messages.lang)
        } yield {
          cc.loggingService.insert(user.userId, request.remoteAddress, s"Visit_AdminUserDashboard_User=$username")
          Ok(views.html.userProfile(commonData, "Sidewalk - Dashboard", request.identity, user, userProfileData, Some(adminData)))
        }
      case _ => Future.failed(new IdentityNotFoundException("Username not found."))
    }
  }

  /**
   * Loads the page that shows a single label with a search box to view others.
   */
  def label(labelId: Int) = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      val admin: Boolean = isAdmin(request.identity)
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, s"Visit_LabelView_Label=${labelId}_Admin=$admin")
      Ok(views.html.admin.label(commonData, "Sidewalk - LabelView", request.identity, admin, labelId))
    }
  }

  /**
   * Loads the page that replays an audit task.
   */
  def task(taskId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    for {
      commonData <- configService.getCommonPageData(request2Messages.lang)
      maybeTask <- adminService.findAuditTask(taskId)
    } yield {
      maybeTask match {
        case Some(task) =>
          cc.loggingService.insert(request.identity.userId, request.remoteAddress, s"Visit_AdminTask_TaskId=$taskId")
          Ok(views.html.admin.task(commonData, "Sidewalk - TaskView", request.identity, task))
        case None =>
          cc.loggingService.insert(request.identity.userId, request.remoteAddress, s"Visit_AdminTask_TaskId=${taskId}_NotFound")
          // TODO Return NotFound exception.
          NotFound(s"Task with ID $taskId not found.")
      }
    }
  }

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
   * Get a list of all tags used for the admin page.
   */
  def getTagCounts = Action.async {
    adminService.getTagCounts.map { tagCounts =>
      Ok(Json.toJson(tagCounts.map(tagCount => {
        Json.obj(
          "label_type" -> tagCount.labelType,
          "tag" -> tagCount.tag,
          "count" -> tagCount.count
        )
      })))
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
  def getAllAttributes = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    adminService.getAllGlobalAttributes.map { clusters =>
      val features: Seq[JsObject] = clusters.par.map { cluster =>
        Json.obj(
          "type" -> "Feature",
          // TODO turning this to geojson should maybe be in MyPostgresProfile.scala? Maybe we should be storing as a point first?
          "geometry" -> Json.obj(
            "type" -> "Point",
            "coordinates" -> Json.arr(cluster.lng.toDouble, cluster.lat.toDouble)
          ),
          "properties" -> Json.obj(
            "attribute_id" -> cluster.globalAttributeId,
            "label_type" -> LabelTypeTable.labelTypeIdToLabelType(cluster.labelTypeId),
            "severity" -> cluster.severity
          )
        )
      }.seq
      val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
      Ok(featureCollection)
    }
  }

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
  def getAllUserCompletedMissionCounts = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    adminService.selectMissionCountsPerUser.map { missionCounts =>
      Ok(Json.toJson(missionCounts.map(x => {
        Json.obj("user_id" -> x._1, "role" -> x._2, "count" -> x._3)
      })))
    }
  }

  /**
   * Gets count of completed missions for each anonymous user (diff users have diff ip addresses).
   */
  def getAllUserSignInCounts = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    adminService.getSignInCounts.map { counts =>
      Ok(Json.toJson(counts.map(count => { Json.obj("user_id" -> count._1, "role" -> count._2, "count" -> count._3) })))
    }
  }

  /**
   * Returns city coverage percentage by Date.
   */
  def getCompletionRateByDate = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    adminService.streetDistanceCompletionRateByDate.map { streets =>
      Ok(Json.toJson(streets.map(x => {
        Json.obj("date" -> dateFormatter.format(x._1), "completion" -> x._2)
      })))
    }
  }

  def getAuditedStreetsWithTimestamps = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    adminService.getAuditedStreetsWithTimestamps.map { streets =>
      Ok(Json.obj("type" -> "FeatureCollection", "features" -> streets.map(auditedStreetWithTimestampToGeoJSON)))
    }
  }

  /**
   * Get the list of interactions logged for the given audit task. Used to reconstruct the task for playback.
   */
  def getAnAuditTaskPath(taskId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    adminService.getAuditInteractionsWithLabels(taskId).map { actions => Ok(auditTaskInteractionsToGeoJSON(actions)) }
  }

  /**
   * Get metadata for a given label ID (for admins; includes personal identifiers like username).
   */
  def getAdminLabelData(labelId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    labelService.getSingleLabelMetadata(labelId, request.identity.userId).flatMap {
      case Some(metadata) =>
        labelService.getExtraAdminValidateData(Seq(labelId)).map(adminData => {
          Ok(labelMetadataWithValidationToJsonAdmin(metadata, adminData.head))
        })
      case None => Future.successful(NotFound(s"No label found with ID: $labelId"))
    }
  }

  /**
   * Get metadata for a given label ID (excludes personal identifiers like username).
   */
  def getLabelData(labelId: Int) = cc.securityService.SecuredAction { implicit request =>
    labelService.getSingleLabelMetadata(labelId, request.identity.userId).map {
      case Some(metadata) => Ok(labelMetadataWithValidationToJson(metadata))
      case None =>           NotFound(s"No label found with ID: $labelId")
    }
  }

  /**
   * Get a count of the number of labels placed by each user.
   */
  def getAllUserLabelCounts = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    adminService.getLabelCountsByUser.map { labelCounts =>
      Ok(Json.toJson(labelCounts.map(x => Json.obj(
        "user_id" -> x._1, "role" -> x._2, "count" -> x._3
      ))))
    }
  }

  /**
   * Outputs a list of validation counts for all users with the user's role, the number of their labels that were
   * validated, and the number of their labels that were validated & agreed with.
   */
  def getAllUserValidationCounts = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    adminService.getValidationCountsByUser.map { validationCounts =>
      Ok(Json.toJson(validationCounts.map(x => Json.obj(
        "user_id" -> x._1, "role" -> x._2._1, "count" -> x._2._2, "agreed" -> x._2._3
      ))))
    }
  }

  /**
   * Get a count of the number of audits that have been completed each day.
   */
  def getAllAuditCounts = Action.async { implicit request =>
    adminService.getAuditCountsByDate.map { auditCounts =>
      Ok(Json.toJson(auditCounts.map(x => Json.obj(
        "date" -> dateFormatter.format(x._1), "count" -> x._2
      ))))
    }
  }

  /**
   * Get a count of the number of audits that have been completed each day.
   */
  def getAllLabelCounts = Action.async { implicit request =>
    adminService.getLabelCountsByDate.map { labelCounts =>
      Ok(Json.toJson(labelCounts.map(x => Json.obj(
        "date" -> dateFormatter.format(x._1), "count" -> x._2
      ))))
    }
  }

  /**
   * Get a count of the number of validations that have been completed each day.
   */
  def getAllValidationCounts = Action.async { implicit request =>
    adminService.getValidationCountsByDate.map { valCounts =>
      Ok(Json.toJson(valCounts.map(x => Json.obj(
        "date" -> dateFormatter.format(x._1), "count" -> x._2
      ))))
    }
  }

  /**
   * Updates the role in the database for the given user.
   */
  def setUserRole = cc.securityService.SecuredAction(WithAdmin(), parse.json) { implicit request =>
    val submission = request.body.validate[UserRoleSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        val userId: String = submission.userId
        val newRole: String = submission.roleId

        authenticationService.findByUserId(userId) flatMap {
          case Some(user) =>
            if (user.role == "Owner") {
              Future.successful(BadRequest("Owner's role cannot be changed"))
            } else if (newRole == "Owner") {
              Future.successful(BadRequest("Cannot set a new owner"))
            } else if (!RoleTable.VALID_ROLES.contains(newRole)) {
              Future.successful(BadRequest("Invalid role"))
            } else {
              authenticationService.setRole(userId, newRole).map(_ => {
                cc.loggingService.insert(request.identity.userId, request.remoteAddress, s"UpdateRole_User=${userId}_Old=${user.role}_New=$newRole")
                Ok(Json.obj("username" -> user.username, "user_id" -> userId, "role" -> newRole))
              })
            }
          case None =>
            Future.successful(BadRequest("No user has this user ID"))
        }
      }
    )
  }

  /* Clears all cached values. Should only be called from the Admin page. */
  def clearPlayCache() = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cacheApi.removeAll().map(_ => Ok("success"))
  }

  /**
   * Updates user_stat table for users who audited in the past `hoursCutoff` hours. Update everyone if no time supplied.
   */
  def updateUserStats(hoursCutoff: Option[Int]) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    val cutoffTime: OffsetDateTime = hoursCutoff match {
      case Some(hours) => OffsetDateTime.now().minusHours(hours)
      case None => OffsetDateTime.ofInstant(Instant.EPOCH, ZoneOffset.UTC)
    }

    adminService.updateUserStatTable(cutoffTime).map { usersUpdated: Int =>
      Ok(s"User stats updated for $usersUpdated users!")
    }
  }

  /**
   * Updates a single flag for a single audit task specified by the audit task id.
   */
  def setTaskFlag() = cc.securityService.SecuredAction(WithAdmin(), parse.json) { implicit request =>
    val submission = request.body.validate[TaskFlagSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        userService.updateTaskFlag(submission.auditTaskId, submission.flag, submission.state)
          .map { tasksUpdated: Int => Ok(Json.obj("tasks_updated" -> tasksUpdated)) }
      }
    )
  }

  /**
   * Updates the flags of all tasks before the given date for the given user.
   */
  def setTaskFlagsBeforeDate() = cc.securityService.SecuredAction(WithAdmin(), parse.json) { implicit request =>
    val submission = request.body.validate[TaskFlagsByDateSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        val userId: String = submission.userId
        authenticationService.findByUserId(userId).flatMap {
          case Some(user) =>
            userService.updateTaskFlagsBeforeDate(userId, submission.date, submission.flag, submission.state)
              .map { tasksUpdated: Int => Ok(Json.obj("tasks_updated" -> tasksUpdated)) }
          case _ => Future.failed(new IdentityNotFoundException("Username not found."))
        }
      }
    )
  }

  /**
   * Gets street edge data for the coverage section of the admin page.
   */
  def getCoverageData = silhouette.UserAwareAction.async { implicit request =>
    val JSON_ROLE_MAP = Map(
      "All" -> "all_users",
      "Registered" -> "registered",
      "Anonymous" -> "anonymous",
      "Turker" -> "turker",
      "Researcher" -> "researcher"
    )
    adminService.getCoverageData.map { coverageData: CoverageData =>
      // Convert the role names to the JSON format.
      val auditCounts = coverageData.streetCounts.audited.map { case (role, n) => (JSON_ROLE_MAP(role), n) }
      val auditCountsHQ = coverageData.streetCounts.auditedHighQualityOnly.map { case (role, n) => (JSON_ROLE_MAP(role), n) }
      val dists = coverageData.streetDistance.audited.map { case (role, n) => (JSON_ROLE_MAP(role), n) }
      val distsHQ = coverageData.streetDistance.auditedHighQualityOnly.map { case (role, n) => (JSON_ROLE_MAP(role), n) }

      // Put all data into JSON.
      Ok(Json.obj(
        "street_counts" -> Json.obj(
          "total" -> coverageData.streetCounts.total,
          "audited" -> Json.obj(
            "any_quality" -> Json.toJson(auditCounts),
            "high_quality" -> Json.toJson(auditCountsHQ),
            "with_overlap" -> Json.toJson(coverageData.streetCounts.withOverlap)
          )
        ),
        "street_distance" -> Json.obj(
          "units" -> "miles",
          "total" -> coverageData.streetDistance.total,
          "audited" -> Json.obj(
            "any_quality" -> Json.toJson(dists),
            "high_quality" -> Json.toJson(distsHQ),
            "with_overlap" -> Json.toJson(coverageData.streetDistance.withOverlap)
          )
        )
      ))
    }
  }

  /**
   * Gets the number of users who have contributed to the Activities table on the admin page.
   */
  def getNumUsersContributed = silhouette.UserAwareAction.async { implicit request =>
    adminService.getNumUsersContributed.map(userCounts => Ok(Json.toJson(userCounts)))
  }

  def getContributionTimeStats = silhouette.UserAwareAction.async { implicit request =>
    adminService.getContributionTimeStats.map(timeStat => Ok(Json.toJson(timeStat)))
  }

  def getLabelCountStats = silhouette.UserAwareAction.async { implicit request =>
    adminService.getLabelCountStats.map(labelCount => Ok(Json.toJson(labelCount)))
  }

  def getValidationCountStats = silhouette.UserAwareAction.async { implicit request =>
    adminService.getValidationCountStats.map(validationCount => Ok(Json.toJson(validationCount)))
  }

  def getRecentComments = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    adminService.getRecentExploreAndValidateComments.map(comment => Ok(Json.toJson(comment)))
  }

  def getRecentLabelMetadata = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    labelService.getRecentLabelMetadata(5000).map(labelMetadata => Ok(Json.toJson(labelMetadata)))
  }

  /**
   * Get the stats for the users table in the admin page.
   */
  def getUserStats = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    for {
      userStats <- adminService.getUserStatsForAdminPage
      teams <- userService.getAllTeams
    } yield {
      Ok(Json.obj(
        "user_stats" -> Json.toJson(userStats),
        "teams" -> Json.toJson(teams)
      ))
    }
  }

  /**
   * Recalculates street edge priority for all streets.
   */
  def recalculateStreetPriority = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    streetService.recalculateStreetPriority.map(_ => Ok("Successfully recalculated street priorities"))
  }

  /**
   * Updates the open status of the specified team.
   *
   * @param teamId The ID of the team to update.
   */
  def updateTeamStatus(teamId: Int) = cc.securityService.SecuredAction(WithAdmin(), parse.json) { request =>
    val open: Boolean = (request.body \ "open").as[Boolean]
    adminService.updateTeamStatus(teamId, open).map { _ =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, s"UpdateTeamStatus_Team=${teamId}_Open=$open")
      Ok(Json.obj("status" -> "success", "team_id" -> teamId, "open" -> open))
    }
  }

  /**
   * Updates the visibility status of the specified team.
   *
   * @param teamId The ID of the team to update.
   */
  def updateTeamVisibility(teamId: Int) = cc.securityService.SecuredAction(WithAdmin(), parse.json) { request =>
    val visible: Boolean = (request.body \ "visible").as[Boolean]
    adminService.updateTeamVisibility(teamId, visible).map { _ =>
      cc.loggingService.insert(request.identity.userId, request.remoteAddress, s"UpdateTeamVisibility_Team=${teamId}_Visible=$visible")
      Ok(Json.obj("status" -> "success", "team_id" -> teamId, "visible" -> visible))
    }
  }
}
