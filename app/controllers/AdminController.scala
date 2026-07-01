package controllers

import controllers.base._
import controllers.helper.ControllerUtils.{isAdmin, parseIntegerSeq}
import executors.CpuIntensiveExecutionContext
import formats.json.AdminFormats._
import formats.json.LabelFormats._
import formats.json.UserFormats._
import models.auth.{DefaultEnv, WithAdmin, WithOwner}
import models.label.LabelTypeEnum
import models.user.{RoleTable, SidewalkUserWithRole}
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
import java.time.temporal.ChronoUnit
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
    for {
      commonData <- configService.getCommonPageData(request2Messages.lang)
      tags       <- labelService.getTagsForCurrentCity
    } yield {
      cc.loggingService.insert(request.identity.userId, request.ipAddress, "Visit_Admin")
      Ok(views.html.admin.index(commonData, "Sidewalk - Admin", request.identity, tags))
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
          tags                             <- labelService.getTagsForCurrentCity
        } yield {
          cc.loggingService.insert(user.userId, request.ipAddress, s"Visit_AdminUserDashboard_User=$username")
          Ok(
            views.html.userProfile(commonData, "Sidewalk - Dashboard", request.identity, user, tags, userProfileData,
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
              "coordinates" -> Json.arr(label.lng, label.lat)
            ),
            "properties" -> Json.obj(
              "audit_task_id"        -> label.auditTaskId,
              "label_id"             -> label.labelId,
              "label_type"           -> label.labelType,
              "severity"             -> label.severity,
              "correct"              -> label.correct,
              "has_validations"      -> label.hasValidations,
              "has_admin_validation" -> label.hasAdminValidation,
              "ai_validation"        -> label.aiValidation.map(_.toString),
              "expired"              -> label.expired,
              "has_backup"           -> label.hasBackup,
              "high_quality_user"    -> label.highQualityUser,
              "ai_generated"         -> label.aiGenerated,
              "tags"                 -> label.tags
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
   * Tag-by-severity counts for the Data Quality tag-severity heatmap (#4272): how each label type's tags distribute
   * across the 1–3 severity scale. snake_case per the dashboard convention.
   */
  def getTagSeverityCounts = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getTagSeverityCounts.map { counts =>
      Ok(Json.obj("tag_severity" -> JsArray(counts.map { c =>
        Json.obj("label_type" -> c.labelType, "tag" -> c.tag, "severity" -> c.severity, "count" -> c.count)
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
                "coordinates" -> Json.arr(label.lng, label.lat)
              ),
              "properties" -> Json.obj(
                "label_id"          -> label.labelId,
                "label_type"        -> label.labelType,
                "severity"          -> label.severity,
                "correct"           -> label.correct,
                "has_validations"   -> label.hasValidations,
                "ai_validation"     -> label.aiValidation.map(_.toString),
                "expired"           -> label.expired,
                "has_backup"        -> label.hasBackup,
                "high_quality_user" -> label.highQualityUser,
                "ai_generated"      -> label.aiGenerated,
                "tags"              -> label.tags
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
    val userId: String = request.identity.userId
    labelService.getSingleLabelMetadata(labelId, userId).flatMap {
      case Some(metadata) =>
        labelService.getExtraAdminValidateData(Seq(labelId)).map { adminData =>
          Ok(
            labelMetadataWithValidationToJsonAdmin(metadata, adminData.head) ++
              Json.obj(
                "crop_url"         -> panoDataService.cropUrl(metadata.labelId, metadata.labelType),
                "backup_image_url" -> panoDataService.backupImageUrl(metadata.panoId)
              )
          )
        }
      case None => Future.successful(NotFound(s"No label found with ID: $labelId"))
    }
  }

  /**
   * Get metadata for a given label ID (excludes personal identifiers like username).
   */
  def getLabelData(labelId: Int) = cc.securityService.SecuredAction { implicit request =>
    val userId: String = request.identity.userId
    labelService.getSingleLabelMetadata(labelId, userId).map {
      case Some(metadata) =>
        Ok(
          labelMetadataWithValidationToJson(metadata) ++
            Json.obj(
              "crop_url"         -> panoDataService.cropUrl(metadata.labelId, metadata.labelType),
              "backup_image_url" -> panoDataService.backupImageUrl(metadata.panoId)
            )
        )
      case None => NotFound(s"No label found with ID: $labelId")
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
   * Unified daily activity time series for the redesigned admin dashboard's Activity page (#4272).
   *
   * Returns one row per calendar day with the volume of each contribution type (labels, validations, audits, missions),
   * sign-ins and active users split registered-vs-anonymous, and new registered accounts. Only days with activity are
   * emitted; the client zero-fills and rolls up by range/granularity. snake_case output per the dashboard convention.
   */
  def getActivityByDay = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getActivityByDay.map { series =>
      Ok(Json.obj("series" -> JsArray(series.map { r =>
        Json.obj(
          "date"               -> r.date.toString,
          "labels"             -> r.labels,
          "validations"        -> r.validations,
          "audits"             -> r.audits,
          "missions"           -> r.missions,
          "signins_registered" -> r.signinsRegistered,
          "signins_anon"       -> r.signinsAnon,
          "active_registered"  -> r.activeRegistered,
          "active_anon"        -> r.activeAnon,
          "new_users"          -> r.newUsers
        )
      })))
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

  /**
   * Updates high_quality_manual and high_quality in the database for the given user.
   */
  def setUserQualityManual = cc.securityService.SecuredAction(WithAdmin(), parse.json) { implicit request =>
    val submission = request.body.validate[UserQualitySubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        val userId: String                  = submission.userId
        val newUserQuality: Option[Boolean] = submission.userQualityManual

        authenticationService.findByUserId(userId) flatMap {
          case Some(user) =>
            if (user.role == "Owner") {
              Future.successful(
                BadRequest(Json.obj("status" -> "Error", "message" -> "Owner's quality cannot be changed"))
              )
            } else if (user.role == "Administrator" && request.identity.role != "Owner") {
              Future.successful(
                BadRequest(Json.obj("status" -> "Error", "message" -> "Admin's quality can only be set by an Owner"))
              )
            } else {
              // Update the high_quality_manual and high_quality columns. Recomputes high_quality if input is None.
              userService
                .setManualUserQuality(userId, newUserQuality)
                .map {
                  case Some(newQuality) =>
                    val logText = s"UpdateUserManualQuality_User=${userId}_Manual=${newUserQuality}_New=$newQuality"
                    cc.loggingService.insert(request.identity.userId, request.ipAddress, logText)
                    Ok(Json.obj("new_user_quality" -> newQuality))
                  case None => BadRequest(Json.obj("status" -> "Error", "message" -> "Likely an excluded user"))
                }
            }
          case None =>
            Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> "No user has this user_id")))
        }
      }
    )
  }

  /**
   * Updates <city>_infra3d_access column in the database for the given user.
   */
  def setInfra3dAccess = cc.securityService.SecuredAction(WithAdmin(), parse.json) { implicit request =>
    val submission = request.body.validate[UserInfra3dAccess]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        authenticationService.findByUserId(submission.userId) flatMap {
          case Some(user) =>
            if (user.role == "Owner") {
              Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> "Owner access can't be changed")))
            } else if (!request.identity.infra3dAccess) {
              Future.successful(
                BadRequest(Json.obj("status" -> "Error", "message" -> "Lacking permission to grant access"))
              )
            } else {
              authenticationService
                .setInfra3dAccess(submission.userId, submission.access)
                .map { rowsUpdated =>
                  if (rowsUpdated > 0) Ok(Json.obj("message" -> "infra3D access updated successfully"))
                  else BadRequest(Json.obj("error" -> "Failed to update infra3D access"))
                }
            }
          case None =>
            Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> "No user has this user_id")))
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
   * Forces an immediate recompute of this deployment's engagement funnel (#288) into `funnel_stat` — the same work the
   * nightly FunnelStatActor does. Handy after a deploy so the Across Cities page shows this city without waiting a day.
   */
  def updateFunnelStats = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)
    adminService.updateFunnelStatTable().map { rowsUpdated => Ok(s"Funnel stats updated ($rowsUpdated rows)!") }
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

  def getContributionTimeStats = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
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

  /**
   * Recent-activity stream for the redesigned admin dashboard's Activity page (#4272): the latest labels, validations,
   * and comments interleaved by recency, each tagged with who did it and (where applicable) the label it points at.
   * snake_case output per the dashboard convention.
   */
  def getRecentActivity(n: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getRecentActivity(n).flatMap { items =>
      // Enrich the feed batch with two cheap scoped lookups, run in parallel: a preview thumbnail per labelled item,
      // and a "who is this contributor" summary (role + totals) per distinct user.
      val labelIds  = items.collect { case i if i.labelId.isDefined && i.labelType.isDefined => i.labelId.get }.distinct
      val usernames = items.map(_.username).distinct
      val metaFut   = adminService.getLabelThumbnailMeta(labelIds)
      val userFut   = adminService.getUserSummaries(usernames)
      for {
        metaById   <- metaFut
        userByName <- userFut
      } yield {
        Ok(Json.obj("activity" -> JsArray(items.map { i =>
          val user = userByName.get(i.username)
          Json.obj(
            "activity_type"     -> i.activityType,
            "username"          -> i.username,
            "timestamp"         -> i.timestamp,
            "label_id"          -> i.labelId,
            "label_type"        -> i.labelType,
            "validation_result" -> i.validationResult,
            "comment"           -> i.comment,
            "thumbnail_url"     -> thumbnailUrl(i, metaById),
            "user_role"         -> user.map(_.role),
            "user_labels"       -> user.map(_.labels),
            "user_validations"  -> user.map(_.validations)
          )
        })))
      }
    }
  }

  /**
   * Builds the best available preview-image URL for a recent-activity item, or None when it has no label to preview.
   *
   * Prefers a saved label crop (the actual cropped label view) when one exists on disk; otherwise falls back to a
   * Street View Static thumbnail built from the label's pano/POV metadata (GSV panos only). Mirrors the Gallery's
   * crop-then-GSV image strategy.
   *
   * @param item     The recent-activity item.
   * @param metaById Pano/POV metadata for the batch's label ids, keyed by label id.
   * @return A signed image URL, or None for items without a previewable label (e.g. comments).
   */
  private def thumbnailUrl(item: RecentActivityItem, metaById: Map[Int, LabelThumbnailMeta]): Option[String] = {
    (item.labelId, item.labelType) match {
      case (Some(id), Some(labelType)) if LabelTypeEnum.validLabelTypes.contains(labelType) =>
        panoDataService
          .cropUrl(id, LabelTypeEnum.byName(labelType))
          .orElse(metaById.get(id).flatMap { m =>
            panoDataService.getImageUrl(m.panoId, m.panoSource, m.heading, m.pitch, m.zoom)
          })
      case _ => None
    }
  }

  def getRecentLabelMetadata = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    labelService.getRecentLabelMetadata(5000).map(labelMetadata => Ok(Json.toJson(labelMetadata)))
  }

  /**
   * Get the stats for the users table in the admin page.
   */
  /**
   * Contributors-page leaderboards for the redesigned admin dashboard (#4272): top labelers (with label-type mix and
   * severity distribution) and top validators (with agree/disagree/unsure split). snake_case per the dashboard convention.
   */
  def getContributorLeaderboards(n: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getContributorLeaderboards(n).map { boards =>
      Ok(
        Json.obj(
          "top_labelers" -> JsArray(boards.labelers.map { l =>
            Json.obj(
              "user_id"                  -> l.userId,
              "username"                 -> l.username,
              "role"                     -> l.role,
              "labels"                   -> l.labels,
              "own_validated"            -> l.ownValidated,
              "own_validated_agreed_pct" -> l.ownValidatedAgreedPct,
              "high_quality"             -> l.highQuality,
              "label_type_counts"        -> JsArray(l.labelTypeCounts.map { case (labelType, count) =>
                Json.obj("label_type" -> labelType, "count" -> count)
              }),
              "severity_counts" -> JsArray(l.severityCounts.map { case (severity, count) =>
                Json.obj("severity" -> severity, "count" -> count)
              })
            )
          }),
          "top_validators" -> JsArray(boards.validators.map { v =>
            Json.obj(
              "user_id"       -> v.userId,
              "username"      -> v.username,
              "role"          -> v.role,
              "validations"   -> v.validations,
              "agree"         -> v.agree,
              "disagree"      -> v.disagree,
              "unsure"        -> v.unsure,
              "agreement_pct" -> v.agreementPct
            )
          })
        )
      )
    }
  }

  /**
   * Humans-vs-AI comparison for the redesigned admin dashboard: AI vs human as labeler, validator, and tagger.
   * Output is snake_case per the v3 naming convention; the AI group is always present (all-zero where there's no AI
   * activity) so the page can render consistent empty states.
   */
  def getHumanVsAiStats = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getHumanVsAiStats.map { stats =>
      def labelerJson(l: service.HumanAiLabelerStats): JsObject = Json.obj(
        "group"      -> l.group,
        "total"      -> l.total,
        "validated"  -> l.validated,
        "correct"    -> l.correct,
        "type_stats" -> JsArray(l.typeStats.map { t =>
          Json.obj("label_type" -> t.labelType, "count" -> t.count, "validated" -> t.validated, "correct" -> t.correct)
        }),
        "severity_counts" -> JsArray(l.severityCounts.map { case (severity, count) =>
          Json.obj("severity" -> severity, "count" -> count)
        })
      )
      def validatorJson(v: service.HumanAiValidatorStats): JsObject = Json.obj(
        "group"    -> v.group,
        "total"    -> v.total,
        "agree"    -> v.agree,
        "disagree" -> v.disagree,
        "unsure"   -> v.unsure
      )
      def tagsJson(tags: Seq[(String, Int)]): JsArray =
        JsArray(tags.map { case (tag, count) => Json.obj("tag" -> tag, "count" -> count) })
      Ok(
        Json.obj(
          "labelers"   -> JsArray(stats.labelers.map(labelerJson)),
          "validators" -> JsArray(stats.validators.map(validatorJson)),
          "tagger"     -> Json.obj(
            "labels_assessed" -> stats.tagger.labelsAssessed,
            "avg_confidence"  -> stats.tagger.avgConfidence,
            "ai_tags"         -> tagsJson(stats.tagger.aiTags),
            "human_tags"      -> tagsJson(stats.tagger.humanTags)
          )
        )
      )
    }
  }

  /**
   * Top-line snapshot for the redesigned admin dashboard's Overview landing page (#4272): one KPI cluster per lens
   * (coverage, data quality, contributors, activity pulse, humans-vs-AI share, API usage). snake_case per the dashboard
   * convention. Every percentage's denominator is included so the page can show its N.
   */
  def getOverviewSummary = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getOverviewSummary.map { s =>
      val lastActivity = s.lastActivity.map { i =>
        Json.obj(
          "activity_type"     -> i.activityType,
          "username"          -> i.username,
          "timestamp"         -> i.timestamp,
          "label_id"          -> i.labelId,
          "label_type"        -> i.labelType,
          "validation_result" -> i.validationResult,
          "comment"           -> i.comment
        )
      }
      Ok(
        Json.obj(
          "total_streets"              -> s.totalStreets,
          "audited_streets"            -> s.auditedStreets,
          "total_distance_mi"          -> s.totalDistanceMi,
          "audited_distance_mi"        -> s.auditedDistanceMi,
          "total_labels"               -> s.totalLabels,
          "total_validations"          -> s.totalValidations,
          "labels_past_week"           -> s.labelsPastWeek,
          "validations_past_week"      -> s.validationsPastWeek,
          "audits_past_week"           -> s.auditsPastWeek,
          "contributors"               -> s.contributors,
          "human_labels"               -> s.humanLabels,
          "ai_labels"                  -> s.aiLabels,
          "human_validations"          -> s.humanValidations,
          "ai_validations"             -> s.aiValidations,
          "ai_assessments"             -> s.aiAssessments,
          "api_calls_external"         -> s.apiCallsExternal,
          "api_unique_clients"         -> s.apiUniqueClients,
          "api_window_days"            -> s.apiWindowDays,
          "labels_awaiting_validation" -> s.labelsAwaitingValidation,
          "low_quality_users"          -> s.lowQualityUsers,
          "last_activity"              -> lastActivity
        )
      )
    }
  }

  /**
   * Returns a per-city summary scorecard for every deployment, for the cross-city "Across Cities" overview (#4329).
   *
   * Owner-gated: all cities share one database, so per-city Administrators must not see other cities' detail. Merges the
   * computed metrics ([[service.ConfigService.getCityScorecards]]) with each city's display name / URL / visibility
   * (from config, so they stay language-aware) and echoes the anomaly thresholds + cross-city median in the summary
   * block so the page can label the "needs attention" items. All field names are snake_case (v3 API convention).
   */
  def getCityScorecards = cc.securityService.SecuredAction(WithOwner()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)
    val cityInfoById: Map[String, CityInfo] =
      configService.getAllCityInfo(request2Messages.lang).map(ci => ci.cityId -> ci).toMap

    // Fetch the per-city scorecards and the all-time cross-city weekly series in parallel; the page's "over time" charts
    // default to the last 12 weeks (derived client-side from each city's weekly_trend) and toggle to this all-time set.
    val scorecardsF    = configService.getCityScorecards()
    val allTimeF       = configService.getCrossCityWeeklyTrend(None)
    val labelingSpeedF = configService.getCrossCityLabelingSpeed()

    for {
      withFlags     <- scorecardsF
      allTimeTrend  <- allTimeF
      labelingSpeed <- labelingSpeedF
    } yield {
      val now        = OffsetDateTime.now()
      val scorecards = withFlags.map(_.scorecard)

      val cities = withFlags.map { case CityScorecardWithFlags(sc, anomalies) =>
        val info = cityInfoById.get(sc.cityId)
        // Per-label-type breakdown (the data-pattern lens), keyed by label type with snake_case stat names.
        val byLabelType = JsObject(sc.byLabelType.toSeq.map { case (labelType, s) =>
          labelType -> Json.obj(
            "labels"    -> s.labels,
            "validated" -> s.labelsValidated,
            "agree"     -> s.labelsValidatedAgree,
            "disagree"  -> s.labelsValidatedDisagree
          )
        })
        // Trailing weekly activity (oldest first) — drives per-city sparklines and the aggregate overview line charts.
        val weeklyTrend = JsArray(sc.weeklyTrend.map { w =>
          Json.obj(
            "week_start"   -> w.weekStart.toString,
            "labels"       -> w.labels,
            "validations"  -> w.validations,
            "active_users" -> w.activeUsers
          )
        })
        Json.obj(
          "city_id"             -> sc.cityId,
          "city_name"           -> info.map(_.cityNameShort),
          "city_name_formatted" -> info.map(_.cityNameFormatted),
          "url"                 -> info.map(_.URL),
          "visibility"          -> info.map(_.visibility),
          // Coverage lens.
          "coverage"          -> sc.coverage,
          "total_streets"     -> sc.totalStreets,
          "audited_streets"   -> sc.auditedStreets,
          "streets_remaining" -> (sc.totalStreets - sc.auditedStreets),
          "total_km"          -> sc.totalKm,
          "audited_km"        -> sc.auditedKm,
          "km_remaining"      -> math.max(0.0, sc.totalKm - sc.auditedKm),
          // Data + quality lens.
          "total_labels"             -> sc.totalLabels,
          "ai_labels"                -> sc.aiLabels,
          "ai_label_share"           -> (if (sc.totalLabels > 0) sc.aiLabels.toDouble / sc.totalLabels else 0.0),
          "labels_validated"         -> sc.labelsValidated,
          "labels_validated_share"   -> (if (sc.totalLabels > 0) sc.labelsValidated.toDouble / sc.totalLabels else 0.0),
          "labels_with_severity"     -> sc.labelsWithSeverity,
          "labels_severity_eligible" -> sc.labelsSeverityEligible,
          // Share computed only over types that CAN have a severity (NoSidewalk/Signal/Occlusion excluded).
          "severity_share" -> (if (sc.labelsSeverityEligible > 0)
                                 sc.labelsWithSeverity.toDouble / sc.labelsSeverityEligible
                               else 0.0),
          "labels_with_tags"    -> sc.labelsWithTags,
          "labels_tag_eligible" -> sc.labelsTagEligible,
          // Share computed only over types that CAN have tags (types present in the deployment's tag table).
          "tags_share" -> (if (sc.labelsTagEligible > 0) sc.labelsWithTags.toDouble / sc.labelsTagEligible else 0.0),
          "validations_per_label" -> (if (sc.totalLabels > 0) sc.totalValidations.toDouble / sc.totalLabels else 0.0),
          "total_validations"     -> sc.totalValidations,
          "validations_agree"     -> sc.validationsAgree,
          "validations_disagree"  -> sc.validationsDisagree,
          "validation_disagreement_rate" -> ConfigService.disagreementRate(sc),
          "ai_validations"               -> sc.aiValidations,
          "ai_validation_share" -> (if (sc.totalValidations > 0) sc.aiValidations.toDouble / sc.totalValidations
                                    else 0.0),
          "by_label_type" -> byLabelType,
          // People lens.
          "active_contributors"      -> sc.activeContributors,
          "low_quality_contributors" -> sc.lowQualityContributors,
          // Activity lens.
          "labels_7d"           -> sc.labels7d,
          "labels_30d"          -> sc.labels30d,
          "validations_7d"      -> sc.validations7d,
          "validations_30d"     -> sc.validations30d,
          "audits_7d"           -> sc.audits7d,
          "audits_30d"          -> sc.audits30d,
          "last_activity"       -> sc.lastActivity,
          "days_since_activity" -> sc.lastActivity.map(ts => ChronoUnit.DAYS.between(ts, now)),
          "weekly_trend"        -> weeklyTrend,
          // Contributors & effort (per-user output is median/p90, not mean±SD — the distribution is power-law).
          "labels_per_user_median"      -> sc.labelsPerUserMedian,
          "labels_per_user_p90"         -> sc.labelsPerUserP90,
          "num_labelers"                -> sc.numLabelers,
          "validations_per_user_median" -> sc.validationsPerUserMedian,
          "validations_per_user_p90"    -> sc.validationsPerUserP90,
          "num_validators"              -> sc.numValidators,
          "seconds_per_validation"      -> sc.validationSecondsMedian,
          "seconds_to_validate_10"      -> (sc.validationSecondsMedian * 10),
          // Labeling speed (seconds of active auditing per 100 m) from the daily-cached heavy path; None if no data.
          "seconds_per_100m" -> labelingSpeed.get(sc.cityId),
          // Lifecycle/health state: active | wrapped_up | stalled | low_traction (#4329).
          "lifecycle" -> ConfigService.lifecycle(sc, now),
          "anomalies" -> anomalies
        )
      }

      // Cross-city weekly series for the full project history (the "All time" toggle on the over-time charts).
      val overTimeAllTime = JsArray(allTimeTrend.map { w =>
        Json.obj(
          "week_start"   -> w.weekStart.toString,
          "labels"       -> w.labels,
          "validations"  -> w.validations,
          "active_users" -> w.activeUsers
        )
      })

      // Project-wide "hero" totals, summed from the cities shown above so they reconcile with the table. Distinct
      // countries come from city config; languages from the app's supported set. global_agreement is the share of
      // agree/disagree validations that agreed. total_users is the sum of per-city contributors (a person who
      // contributes in two cities counts in each — there is no cross-city dedup here).
      val numCountries      = scorecards.flatMap(sc => cityInfoById.get(sc.cityId).map(_.countryId)).distinct.size
      val numLanguages      = config.get[Seq[String]]("play.i18n.langs").size
      val totalContributors = scorecards.map(_.activeContributors).sum
      val totalKm           = scorecards.map(_.auditedKm).sum
      val totalLabels       = scorecards.map(_.totalLabels).sum
      val totalValidations  = scorecards.map(_.totalValidations).sum
      val sumAgree          = scorecards.map(_.validationsAgree).sum
      val sumDisagree       = scorecards.map(_.validationsDisagree).sum
      val globalAgreement   = if (sumAgree + sumDisagree > 0) sumAgree.toDouble / (sumAgree + sumDisagree) else 0.0

      Ok(
        Json.obj(
          "cities"             -> cities,
          "over_time_all_time" -> overTimeAllTime,
          "summary"            -> Json.obj(
            "num_cities"                -> scorecards.length,
            "num_countries"             -> numCountries,
            "num_languages"             -> numLanguages,
            "total_users"               -> totalContributors,
            "total_km"                  -> totalKm,
            "total_labels"              -> totalLabels,
            "total_validations"         -> totalValidations,
            "total_datapoints"          -> (totalLabels.toLong + totalValidations.toLong),
            "global_agreement"          -> globalAgreement,
            "median_disagreement_rate"  -> ConfigService.medianDisagreementRate(scorecards),
            "active_within_days"        -> ConfigService.ActiveWithinDays,
            "wrapped_up_coverage"       -> ConfigService.WrappedUpCoverage,
            "low_traction_contributors" -> ConfigService.LowTractionContributors
          )
        )
      )
    }
  }

  /**
   * Returns every available city's precomputed engagement funnel for one time window (#288), for the Across Cities
   * page's funnel comparison. Owner-only (cross-deployment data). Output is snake_case per the v3 convention; the
   * `steps` array names the eight funnel steps in order so the client never hardcodes them.
   *
   * @param window "30d", "90d", or "all"; anything else (or absent) falls back to "30d".
   */
  /**
   * Serializes one funnel segment to snake_case JSON (#288): its raw step counts plus the derived step-over-step and
   * overall conversion ratios. Shared by the cross-city and single-city funnel endpoints so both emit the same shape.
   */
  private def funnelSegJson(seg: FunnelSegment): JsObject = Json.obj(
    "steps"              -> seg.steps,
    "step_conversion"    -> ConfigService.stepConversion(seg.steps),
    "overall_conversion" -> ConfigService.overallConversion(seg.steps)
  )

  def getCityFunnels(window: Option[String]) = cc.securityService.SecuredAction(WithOwner()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)
    // Only these three windows are precomputed in funnel_stat; reject anything else rather than 500 on a cache miss.
    val windowKey                           = window.filter(Set("30d", "90d", "all")).getOrElse("30d")
    val cityInfoById: Map[String, CityInfo] =
      configService.getAllCityInfo(request2Messages.lang).map(ci => ci.cityId -> ci).toMap

    configService.getCityFunnels(windowKey).map { funnelsByType =>
      def cityJson(f: CityFunnel): JsObject = {
        val info = cityInfoById.get(f.cityId)
        Json.obj(
          "city_id"             -> f.cityId,
          "city_name"           -> info.map(_.cityNameShort),
          "city_name_formatted" -> info.map(_.cityNameFormatted),
          "url"                 -> info.map(_.URL),
          "visibility"          -> info.map(_.visibility),
          "all"                 -> funnelSegJson(f.all),
          "registered"          -> funnelSegJson(f.registered),
          "anonymous"           -> funnelSegJson(f.anonymous),
          "desktop"             -> funnelSegJson(f.desktop),
          "mobile"              -> funnelSegJson(f.mobile),
          "device_unknown"      -> funnelSegJson(f.deviceUnknown)
        )
      }
      // One entry per funnel type ("mapping", "contribution"), each with its own step list and per-city rows. `steps`
      // names the steps in order so the client never hardcodes them.
      val funnels = JsObject(ConfigService.FunnelDefs.map { case (funnelType, stepKeys) =>
        funnelType -> Json.obj(
          "steps"  -> stepKeys,
          "cities" -> JsArray(funnelsByType.getOrElse(funnelType, Seq.empty).map(cityJson))
        )
      })
      Ok(Json.obj("window" -> windowKey, "funnels" -> funnels))
    }
  }

  /**
   * Returns THIS deployment's own precomputed engagement funnels for one time window (#4379), for the per-city
   * Contributors page. Admin-gated (per-city Administrators see their own city), unlike the Owner-gated cross-city
   * [[getCityFunnels]]. Output is snake_case per the v3 convention; each funnel's `steps` array names its steps in
   * order so the client never hardcodes them, and segments are keyed (not a `cities` array) since there is one city.
   *
   * @param window "30d", "90d", or "all"; anything else (or absent) falls back to "30d".
   */
  def getCurrentCityFunnels(window: Option[String]) = cc.securityService.SecuredAction(WithAdmin()) {
    implicit request =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)
      // Only these three windows are precomputed in funnel_stat; reject anything else rather than 500 on a cache miss.
      val windowKey = window.filter(Set("30d", "90d", "all")).getOrElse("30d")

      configService.getCurrentCityFunnels(windowKey).map { result =>
        def segmentsJson(f: CityFunnel): JsObject = Json.obj(
          "all"            -> funnelSegJson(f.all),
          "registered"     -> funnelSegJson(f.registered),
          "anonymous"      -> funnelSegJson(f.anonymous),
          "desktop"        -> funnelSegJson(f.desktop),
          "mobile"         -> funnelSegJson(f.mobile),
          "device_unknown" -> funnelSegJson(f.deviceUnknown)
        )
        // One entry per funnel type the city has data for, each with its ordered step keys and this city's segments.
        val funnels = JsObject(ConfigService.FunnelDefs.collect {
          case (funnelType, stepKeys) if result.byType.contains(funnelType) =>
            funnelType -> Json.obj("steps" -> stepKeys, "segments" -> segmentsJson(result.byType(funnelType)))
        })
        // ISO-8601 string (OffsetDateTime.toString) so the page can show a "data as of" label; null until precomputed.
        Ok(Json.obj("window" -> windowKey, "computed_at" -> result.computedAt.map(_.toString), "funnels" -> funnels))
      }
  }

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
  /**
   * Returns v3 API usage analytics aggregated from the webpage_activity log.
   *
   * Requires admin authentication. Accepts two optional query params:
   *  - `excludeApiDocs` (Boolean, default true): exclude requests that carry `source=apiDocs` so that
   *    automated previews in the API docs page are not counted as real consumer traffic.
   *  - `days` (Int, default 30): number of calendar days of history to include; 0 = all time.
   *
   * @param excludeApiDocs Whether to exclude requests from the API docs preview widgets.
   * @param days           Number of past days of history; 0 means all time.
   * @return JSON object with endpoint_counts, daily_counts, unique_ips, format_counts, and total_calls.
   */
  def getApiAnalytics(excludeApiDocs: Boolean, days: Int) = cc.securityService.SecuredAction(WithAdmin()) {
    implicit request =>
      logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
      adminService.getApiAnalytics(excludeApiDocs, days).map {
        case (endpointCounts, dailyCounts, uniqueIps, formatCounts) =>
          val totalCalls = endpointCounts.map(_.count).sum
          Ok(
            Json.obj(
              "endpoint_counts" -> endpointCounts.map(c => Json.obj("endpoint" -> c.endpoint, "count" -> c.count)),
              "daily_counts"    -> dailyCounts.map(c => Json.obj("date" -> c.date, "count" -> c.count)),
              "unique_ips"      -> uniqueIps,
              "format_counts"   -> formatCounts
                .map(c => Json.obj("endpoint" -> c.endpoint, "format" -> c.format, "count" -> c.count)),
              "total_calls" -> totalCalls
            )
          )
      }
  }

  /**
   * Returns v3 API usage split by source (external vs the docs "Try it" widgets) for the redesigned admin dashboard.
   *
   * Pivots the per-source rows into `external`/`api_docs` columns per endpoint, day, and format so the page can show
   * real external adoption alongside docs-driven traffic in one request.
   *
   * @param days Number of past days to include (0 = all time).
   */
  def getApiAnalyticsBySource(days: Int) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getApiAnalyticsBySource(days).map { data =>
      def split(rows: Seq[(String, Long)]): (Long, Long) = (
        rows.collect { case (s, c) if s == "external" => c }.sum,
        rows.collect { case (s, c) if s == "apiDocs" => c }.sum
      )
      // Pivot the per-source rows for each dimension into (key, external, apiDocs); sort endpoints/formats by external
      // usage (the signal we care about) and days chronologically.
      val endpoints = data.endpointCounts
        .groupBy(_.endpoint)
        .map { case (ep, rows) => val (e, d) = split(rows.map(r => (r.source, r.count))); (ep, e, d) }
        .toSeq
        .sortBy(-_._2)
      val daily = data.dailyCounts
        .groupBy(_.date)
        .map { case (date, rows) => val (e, d) = split(rows.map(r => (r.source, r.count))); (date, e, d) }
        .toSeq
        .sortBy(_._1)
      val formats = data.formatCounts
        .groupBy(_.format)
        .map { case (fmt, rows) => val (e, d) = split(rows.map(r => (r.source, r.count))); (fmt, e, d) }
        .toSeq
        .sortBy(-_._2)

      val extCalls  = endpoints.map(_._2).sum
      val docsCalls = endpoints.map(_._3).sum
      val extIps    = data.ipCounts.find(_.source == "external").map(_.uniqueIps).getOrElse(0L)
      val docsIps   = data.ipCounts.find(_.source == "apiDocs").map(_.uniqueIps).getOrElse(0L)

      Ok(
        Json.obj(
          "days"             -> days,
          "total_calls"      -> (extCalls + docsCalls),
          "total_unique_ips" -> data.totalUniqueIps,
          "last_api_call"    -> data.lastApiCall,
          "sources"          -> Json.obj(
            "external" -> Json.obj("calls" -> extCalls, "unique_ips" -> extIps),
            "api_docs" -> Json.obj("calls" -> docsCalls, "unique_ips" -> docsIps)
          ),
          "endpoints" -> JsArray(endpoints.map { case (ep, e, d) =>
            Json.obj("endpoint" -> ep, "external" -> e, "api_docs" -> d)
          }),
          "daily" -> JsArray(daily.map { case (date, e, d) =>
            Json.obj("date" -> date, "external" -> e, "api_docs" -> d)
          }),
          "formats" -> JsArray(formats.map { case (fmt, e, d) =>
            Json.obj("format" -> fmt, "external" -> e, "api_docs" -> d)
          })
        )
      )
    }
  }

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
