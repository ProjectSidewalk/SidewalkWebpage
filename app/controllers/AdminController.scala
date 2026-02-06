package controllers

import controllers.base._
import controllers.helper.ControllerUtils.{isAdmin, parseIntegerSeq}
import executors.CpuIntensiveExecutionContext
import formats.json.AdminFormats._
import formats.json.LabelFormats._
import formats.json.UserFormats._
import models.auth.{DefaultEnv, WithAdmin}
import models.user.{RoleTable, SidewalkUserWithRole}
import models.validation.LabelValidationTable
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.dispatch.Dispatcher
import play.api.cache.AsyncCacheApi
import play.api.i18n.Messages
import play.api.libs.json.{JsArray, JsError, JsObject, Json}
import play.api.{Configuration, Logger}
import play.silhouette.api.Silhouette
import play.silhouette.impl.exceptions.IdentityNotFoundException
import service._

import java.time.format.DateTimeFormatter
import java.time.{Instant, OffsetDateTime, ZoneOffset}
import java.util.concurrent.ThreadPoolExecutor
import javax.inject.{Inject, Singleton}
import scala.collection.parallel.CollectionConverters._
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters.CollectionHasAsScala
import scala.util.Try

@Singleton
class AdminController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    val config: Configuration,
    configService: service.ConfigService,
    cacheApi: AsyncCacheApi,
    authenticationService: service.AuthenticationService,
    adminService: service.AdminService,
    regionService: RegionService,
    labelService: LabelService,
    streetService: StreetService,
    panoDataService: PanoDataService,
    userService: service.UserService,
    actorSystem: ActorSystem,
    cpuEc: CpuIntensiveExecutionContext
)(implicit ec: ExecutionContext, assets: AssetsFinder)
    extends CustomBaseController(cc) {

  implicit val implicitConfig: Configuration = config
  val dateFormatter: DateTimeFormatter       = DateTimeFormatter.ofPattern("yyyy-MM-dd")
  private val logger                         = Logger(this.getClass)

  /**
   * Loads the admin page.
   */
  def index = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin")
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
          adminData                        <- adminService.getAdminUserProfileData(user.userId)
          commonData                       <- configService.getCommonPageData(request2Messages.lang)
        } yield {
          cc.loggingService.insert(user.userId, request.ipAddress, s"Visit_AdminUserDashboard_User=$username")
          Ok(
            views.html.userProfile(commonData, "Sidewalk - Dashboard", request.identity, user, userProfileData,
              Some(adminData))
          )
        }
      case _ => Future.failed(new IdentityNotFoundException("Username not found."))
    }
  }

  /**
   * Loads the page that shows a single label with a search box to view others.
   */
  def label(labelId: Int) = cc.securityService.SecuredAction { implicit request =>
    configService.getCommonPageData(request2Messages.lang).map { commonData =>
      val user: SidewalkUserWithRole = request.identity
      val admin: Boolean             = isAdmin(request.identity)
      cc.loggingService.insert(user.userId, request.ipAddress, s"Visit_LabelView_Label=${labelId}_Admin=$admin")
      Ok(views.html.admin.label(commonData, "Sidewalk - LabelView", user, admin, labelId))
    }
  }

  /**
   * Loads the page that replays an audit task.
   */
  def task(taskId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    for {
      commonData <- configService.getCommonPageData(request2Messages.lang)
      maybeTask  <- adminService.findAuditTask(taskId)
    } yield {
      val user: SidewalkUserWithRole = request.identity
      maybeTask match {
        case Some(task) =>
          cc.loggingService.insert(user.userId, request.ipAddress, s"Visit_AdminTask_TaskId=$taskId")
          Ok(views.html.admin.task(commonData, "Sidewalk - TaskView", user, task))
        case None =>
          cc.loggingService.insert(user.userId, request.ipAddress, s"Visit_AdminTask_TaskId=${taskId}_NotFound")
          NotFound(s"Task with ID $taskId not found.")
      }
    }
  }

  /**
   * Get a list of all labels for the admin page.
   */
  def getAllLabels = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    labelService
      .getLabelsForLabelMap(Seq(), Seq(), Seq())
      .map { labels =>
        val features: Seq[JsObject] = labels.par.map { label =>
          Json.obj(
            "type"     -> "Feature",
            "geometry" -> Json.obj(
              "type"        -> "Point",
              "coordinates" -> Json.arr(label.lng.toDouble, label.lat.toDouble)
            ),
            "properties" -> Json.obj(
              "audit_task_id"     -> label.auditTaskId,
              "label_id"          -> label.labelId,
              "label_type"        -> label.labelType,
              "severity"          -> label.severity,
              "correct"           -> label.correct,
              "high_quality_user" -> label.highQualityUser,
              "ai_generated"      -> label.aiGenerated
            )
          )
        }.seq
        val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
        Ok(featureCollection)
      }(cpuEc)
  }

  /**
   * Get a list of all tags used for the admin page.
   */
  def getTagCounts = Action.async {
    adminService.getTagCounts.map { tagCounts =>
      Ok(Json.toJson(tagCounts.map(tagCount => {
        Json.obj(
          "label_type" -> tagCount.labelType,
          "tag"        -> tagCount.tag,
          "count"      -> tagCount.count
        )
      })))
    }
  }

  /**
   * Get a list of all labels with metadata needed for /labelMap.
   */
  def getAllLabelsForLabelMap(regions: Option[String], routes: Option[String], aiValidationOptions: Option[String]) =
    Action.async { implicit request =>
      logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
      val regionIds: Seq[Int]    = parseIntegerSeq(regions)
      val routeIds: Seq[Int]     = parseIntegerSeq(routes)
      val aiValOpts: Seq[String] = aiValidationOptions.map(_.split(",").toSeq.distinct).getOrElse(Seq())

      labelService
        .getLabelsForLabelMap(regionIds, routeIds, aiValOpts)
        .map { labels =>
          val features: Seq[JsObject] = labels.par.map { label =>
            Json.obj(
              "type"     -> "Feature",
              "geometry" -> Json.obj(
                "type"        -> "Point",
                "coordinates" -> Json.arr(label.lng.toDouble, label.lat.toDouble)
              ),
              "properties" -> Json.obj(
                "label_id"          -> label.labelId,
                "label_type"        -> label.labelType,
                "severity"          -> label.severity,
                "correct"           -> label.correct,
                "has_validations"   -> label.hasValidations,
                "ai_validation"     -> label.aiValidation.map(LabelValidationTable.validationOptions.get),
                "expired"           -> label.expired,
                "high_quality_user" -> label.highQualityUser,
                "ai_generated"      -> label.aiGenerated
              )
            )
          }.seq
          val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
          Ok(featureCollection)
        }(cpuEc)
    }

  /**
   * Get audit coverage of each neighborhood.
   */
  def getNeighborhoodCompletionRate(regions: Option[String]) = Action.async { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    val regionIds: Seq[Int] = parseIntegerSeq(regions)

    for {
      regionCompletionInit <- regionService.initializeRegionCompletionTable
      neighborhoods        <- regionService.selectAllNamedNeighborhoodCompletions(regionIds)
    } yield {
      val completionRates: Seq[JsObject] = for (neighborhood <- neighborhoods) yield {
        val completionRate: Double =
          if (neighborhood.totalDistance > 0) neighborhood.auditedDistance / neighborhood.totalDistance
          else 1.0d
        Json.obj(
          "region_id"            -> neighborhood.regionId,
          "total_distance_m"     -> neighborhood.totalDistance,
          "completed_distance_m" -> neighborhood.auditedDistance,
          "rate"                 -> completionRate,
          "name"                 -> neighborhood.name
        )
      }
      Ok(JsArray(completionRates))
    }
  }

  /**
   * Gets count of completed missions for each user.
   */
  def getAllUserCompletedMissionCounts = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
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
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getSignInCounts.map { counts =>
      Ok(Json.toJson(counts.map(count => { Json.obj("user_id" -> count._1, "role" -> count._2, "count" -> count._3) })))
    }
  }

  /**
   * Returns city coverage percentage by Date.
   */
  def getCompletionRateByDate = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.streetDistanceCompletionRateByDate.map { streets =>
      Ok(Json.toJson(streets.map(x => {
        Json.obj("date" -> dateFormatter.format(x._1), "completion" -> x._2)
      })))
    }
  }

  def getAuditedStreetsWithTimestamps = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getAuditedStreetsWithTimestamps.map { streets =>
      Ok(Json.obj("type" -> "FeatureCollection", "features" -> streets.map(auditedStreetWithTimestampToGeoJSON)))
    }
  }

  /**
   * Get the list of interactions logged for the given audit task. Used to reconstruct the task for playback.
   */
  def getAnAuditTaskPath(taskId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getAuditInteractionsWithLabels(taskId).map { actions => Ok(auditTaskInteractionsToGeoJSON(actions)) }
  }

  /**
   * Get metadata for a given label ID (for admins; includes personal identifiers like username).
   */
  def getAdminLabelData(labelId: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    labelService.getSingleLabelMetadata(labelId, request.identity.userId).flatMap {
      case Some(metadata) =>
        labelService
          .getExtraAdminValidateData(Seq(labelId))
          .map(adminData => {
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
      case None           => NotFound(s"No label found with ID: $labelId")
    }
  }

  /**
   * Get a count of the number of labels placed by each user.
   */
  def getAllUserLabelCounts = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getLabelCountsByUser.map { labelCounts =>
      Ok(Json.toJson(labelCounts.map(x => Json.obj("user_id" -> x._1, "role" -> x._2, "count" -> x._3))))
    }
  }

  /**
   * Outputs a list of validation counts for all users with the user's role, the number of their labels that were
   * validated, and the number of their labels that were validated & agreed with.
   */
  def getAllUserValidationCounts = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getValidationCountsByUser.map { validationCounts =>
      Ok(
        Json.toJson(
          validationCounts.map(x =>
            Json.obj("user_id" -> x._1, "role" -> x._2._1, "count" -> x._2._2, "agreed" -> x._2._3)
          )
        )
      )
    }
  }

  /**
   * Get a count of the number of audits that have been completed each day.
   */
  def getAllAuditCounts = Action.async { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getAuditCountsByDate.map { auditCounts =>
      Ok(Json.toJson(auditCounts.map(x => Json.obj("date" -> dateFormatter.format(x._1), "count" -> x._2))))
    }
  }

  /**
   * Get a count of the number of audits that have been completed each day.
   */
  def getAllLabelCounts = Action.async { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getLabelCountsByDate.map { labelCounts =>
      Ok(Json.toJson(labelCounts.map(x => Json.obj("date" -> dateFormatter.format(x._1), "count" -> x._2))))
    }
  }

  /**
   * Get a count of the number of validations that have been completed each day.
   */
  def getAllValidationCounts = Action.async { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getValidationCountsByDate.map { valCounts =>
      Ok(Json.toJson(valCounts.map(x => Json.obj("date" -> dateFormatter.format(x._1), "count" -> x._2))))
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
        val userId: String  = submission.userId
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
              authenticationService
                .updateRole(userId, newRole)
                .map(_ => {
                  val logText = s"UpdateRole_User=${userId}_Old=${user.role}_New=$newRole"
                  cc.loggingService.insert(request.identity.userId, request.ipAddress, logText)
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
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    cacheApi.removeAll().map(_ => Ok("success"))
  }

  /**
   * Updates user_stat table for users who audited in the past `hoursCutoff` hours. Update everyone if no time supplied.
   */
  def updateUserStats(hoursCutoff: Option[Int]) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    val cutoffTime: OffsetDateTime = hoursCutoff match {
      case Some(hours) => OffsetDateTime.now().minusHours(hours.toLong)
      case None        => OffsetDateTime.ofInstant(Instant.EPOCH, ZoneOffset.UTC)
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
        userService
          .updateTaskFlag(submission.auditTaskId, submission.flag, submission.state)
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
            userService
              .updateTaskFlagsBeforeDate(userId, submission.date, submission.flag, submission.state)
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
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    val JSON_ROLE_MAP = Map(
      "All"        -> "all_users",
      "Registered" -> "registered",
      "Anonymous"  -> "anonymous",
      "Turker"     -> "turker",
      "Researcher" -> "researcher"
    )
    adminService.getCoverageData.map { data: CoverageData =>
      // Convert the role names to the JSON format.
      val auditCounts   = data.streetCounts.audited.map { case (role, n) => (JSON_ROLE_MAP(role), n) }
      val auditCountsHQ = data.streetCounts.auditedHighQualityOnly.map { case (role, n) => (JSON_ROLE_MAP(role), n) }
      val dists         = data.streetDistance.audited.map { case (role, n) => (JSON_ROLE_MAP(role), n) }
      val distsHQ       = data.streetDistance.auditedHighQualityOnly.map { case (role, n) => (JSON_ROLE_MAP(role), n) }

      // Put all data into JSON.
      Ok(
        Json.obj(
          "street_counts" -> Json.obj(
            "total"   -> data.streetCounts.total,
            "audited" -> Json.obj(
              "any_quality"  -> Json.toJson(auditCounts),
              "high_quality" -> Json.toJson(auditCountsHQ),
              "with_overlap" -> Json.toJson(data.streetCounts.withOverlap)
            )
          ),
          "street_distance" -> Json.obj(
            "units"   -> "miles",
            "total"   -> data.streetDistance.total,
            "audited" -> Json.obj(
              "any_quality"  -> Json.toJson(dists),
              "high_quality" -> Json.toJson(distsHQ),
              "with_overlap" -> Json.toJson(data.streetDistance.withOverlap)
            )
          )
        )
      )
    }
  }

  /**
   * Gets the number of users who have contributed to the Activities table on the admin page.
   */
  def getNumUsersContributed = silhouette.UserAwareAction.async { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getNumUsersContributed.map(userCounts => Ok(Json.toJson(userCounts)))
  }

  def getContributionTimeStats = silhouette.UserAwareAction.async { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getContributionTimeStats.map(timeStat => Ok(Json.toJson(timeStat)))
  }

  def getLabelCountStats = silhouette.UserAwareAction.async { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getLabelCountStats.map(labelCount => Ok(Json.toJson(labelCount)))
  }

  def getValidationCountStats = silhouette.UserAwareAction.async { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getValidationCountStats.map(validationCount => Ok(Json.toJson(validationCount)))
  }

  def getRecentComments = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getRecentExploreAndValidateComments.map(comment => Ok(Json.toJson(comment)))
  }

  def getRecentLabelMetadata = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    labelService.getRecentLabelMetadata(5000).map(labelMetadata => Ok(Json.toJson(labelMetadata)))
  }

  /**
   * Get the stats for the users table in the admin page.
   */
  def getUserStats = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    for {
      userStats <- adminService.getUserStatsForAdminPage
      teams     <- userService.getAllTeams
    } yield {
      Ok(Json.obj("user_stats" -> Json.toJson(userStats), "teams" -> Json.toJson(teams)))
    }
  }

  /**
   * Recalculates street edge priority for all streets.
   */
  def recalculateStreetPriority = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
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
      val logText = s"UpdateTeamStatus_Team=${teamId}_Open=$open"
      cc.loggingService.insert(request.identity.userId, request.ipAddress, logText)
      Ok(Json.obj("status" -> "success", "team_id" -> teamId, "open" -> open))
    }
  }

  /**
   * Updates the visibility status of the specified team.
   * @param teamId The ID of the team to update.
   */
  def updateTeamVisibility(teamId: Int) = cc.securityService.SecuredAction(WithAdmin(), parse.json) { request =>
    val visible: Boolean = (request.body \ "visible").as[Boolean]
    adminService.updateTeamVisibility(teamId, visible).map { _ =>
      val logText = s"UpdateTeamVisibility_Team=${teamId}_Visible=$visible"
      cc.loggingService.insert(request.identity.userId, request.ipAddress, logText)
      Ok(Json.obj("status" -> "success", "team_id" -> teamId, "visible" -> visible))
    }
  }

  /**
   * Checks for imagery that might be missing. Same as nightly process.
   */
  def checkImagery() = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    panoDataService.checkForImagery.map { results => Ok(results) }
  }

  /**
   * Returns information about the thread pools used by the application. Useful for debugging & monitoring thread usage.
   */
  def getThreadPoolStats = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    val dispatcherNames = List("database-operations", "cpu-intensive", "pekko.actor.default-dispatcher")

    val info = new StringBuilder()
    info.append("=== Custom Dispatchers ===\n")
    info.append(
      dispatcherNames
        .map { name =>
          Try {
            val dispatcher = actorSystem.dispatchers.lookup(name)
            dispatcher match {
              case d: Dispatcher =>
                // Access the underlying executor through reflection.
                val executorField = classOf[Dispatcher].getDeclaredField("executorServiceDelegate")
                executorField.setAccessible(true)
                val lazyDelegate = executorField.get(d)

                // Now unwrap the LazyExecutorServiceDelegate.
                val lazyDelegateClass   = lazyDelegate.getClass
                val actualExecutorField = lazyDelegateClass.getDeclaredField("executor")
                actualExecutorField.setAccessible(true)
                val actualExecutor = actualExecutorField.get(lazyDelegate)

                actualExecutor match {
                  case tpe: ThreadPoolExecutor =>
                    s"$name (ThreadPoolExecutor):\n" +
                      s"  Core: ${tpe.getCorePoolSize}, Max: ${tpe.getMaximumPoolSize}\n" +
                      s"  Active: ${tpe.getActiveCount}, Pool Size: ${tpe.getPoolSize}\n" +
                      s"  Queue Size: ${tpe.getQueue.size()}, Completed: ${tpe.getCompletedTaskCount}\n"
                  case fjp: java.util.concurrent.ForkJoinPool =>
                    s"$name (ForkJoinPool):\n" +
                      s"  Parallelism: ${fjp.getParallelism}\n" +
                      s"  Active: ${fjp.getActiveThreadCount}, Pool Size: ${fjp.getPoolSize}\n" +
                      s"  Running: ${fjp.getRunningThreadCount}, Queued: ${fjp.getQueuedTaskCount}\n"
                  case null =>
                    s"$name: Lazy executor not yet initialized (null)\n"
                  case _ =>
                    s"$name: Actual executor type: ${actualExecutor.getClass.getSimpleName}\n"
                }
              case _ =>
                s"$name: Dispatcher type: ${dispatcher.getClass.getSimpleName}\n"
            }
          }.recover { case ex => s"$name: Error - ${ex.getMessage}\n" }.get
        }
        .mkString("\n")
    )

    // Add Slick thread monitoring
    info.append("\n=== All JVM Threads (looking for Slick) ===\n")
    val allThreads   = Thread.getAllStackTraces.keySet.asScala
    val slickThreads = allThreads.filter(t =>
      t.getName.contains("slick") ||
        t.getName.contains("database") ||
        t.getName.contains("HikariPool") ||
        t.getName.contains("connection")
    )

    slickThreads.foreach { thread => info.append(s"${thread.getName} - State: ${thread.getState}\n") }

    // Also show total thread count by type
    info.append("\n=== Thread Summary ===\n")
    val threadGroups = allThreads.groupBy(_.getName.split("-").head)
    threadGroups.foreach { case (prefix, threads) =>
      info.append(s"$prefix: ${threads.size} threads\n")
    }

    Future.successful(Ok(info.toString).as("text/plain"))
  }
}
