package controllers

import actor._
import controllers.base._
import formats.json.AdminFormats._
import formats.json.LabelFormats._
import formats.json.UserFormats._
import models.auth.{DefaultEnv, WithAdmin, WithOwner}
import models.label.LabelTypeEnum
import models.user.RoleTable
import models.utils.JobRunTrigger
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.dispatch.Dispatcher
import play.api.cache.AsyncCacheApi
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.{Configuration, Logger}
import play.silhouette.api.Silhouette
import play.silhouette.impl.exceptions.IdentityNotFoundException
import service._

import java.time.temporal.ChronoUnit
import java.time.{Instant, OffsetDateTime, ZoneOffset}
import java.util.concurrent.ThreadPoolExecutor
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters.CollectionHasAsScala
import scala.util.Try
import scala.util.control.NonFatal

@Singleton
class AdminController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    val config: Configuration,
    configService: service.ConfigService,
    cacheApi: AsyncCacheApi,
    authenticationService: service.AuthenticationService,
    adminService: service.AdminService,
    labelService: LabelService,
    streetService: StreetService,
    panoDataService: PanoDataService,
    osmWayService: service.OsmWayService,
    userService: service.UserService,
    jobRunService: JobRunService,
    actorSystem: ActorSystem
)(implicit ec: ExecutionContext)
    extends CustomBaseController(cc) {

  implicit val implicitConfig: Configuration = config
  private val logger                         = Logger(this.getClass)

  /**
   * Get a list of all labels for the admin page, as a GeoJSON FeatureCollection of points.
   *
   * The public variant without the admin-only fields is LabelController.getAllLabelsForLabelMap at /labels/all. The
   * response is streamed from the db in a chunked response rather than materialized in memory (#3932).
   */
  def getAllLabels = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    val labels = labelService.getLabelsForLabelMap(Seq(), Seq(), Seq(), DEFAULT_BATCH_SIZE)
    Future.successful(streamGeoJson(labels.map(labelForLabelMapToGeoJson(_, admin = true)), "adminapi/labels/all"))
  }

  /**
   * Get per-tag usage counts for the admin Data Quality page.
   *
   * Admin-gated: this serves usage statistics, not the tag vocabulary. The public vocabulary lives at
   * `/v3/api/labelTags`.
   *
   * @return JSON array of `{label_type, tag, count}` objects.
   */
  def getTagCounts = cc.securityService.SecuredAction(WithAdmin()) { _ =>
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

  def getAuditedStreetsWithTimestamps = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getAuditedStreetsWithTimestamps.map { streets =>
      Ok(Json.obj("type" -> "FeatureCollection", "features" -> streets.map(auditedStreetWithTimestampToGeoJSON)))
    }
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
                "backup_image_url" -> panoDataService.backupImageUrl(metadata.panoId),
                "can_edit"         -> true
              )
          )
        }
      case None => Future.successful(NotFound(s"No label found with ID: $labelId"))
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
   * Saves the admin-editable account settings for another user in one request, from the Manage user tab of their
   * dashboard (`/admin/user/:username/admin`): username, role, team, manual quality flag, service-hours opt-in, the two
   * privacy flags, and (on infra3D deployments) infra3D access.
   *
   * Every setting is required (a missing one is a 400, never a reset to a default). Every check that can refuse the
   * save — an Owner can't be changed at all, only an Owner can set an admin's quality, only someone with infra3D access
   * can grant it, the username rules — runs before the first write, so a refused save applies nothing.
   */
  def saveUserSettings = cc.securityService.SecuredAction(WithAdmin(), parse.json) { implicit request =>
    val admin                   = request.identity
    def reject(message: String) = Future.successful(BadRequest(Json.obj("success" -> false, "error" -> message)))

    request.body.validate[AdminUserSettingsSubmission] match {
      case JsError(errors) => reject(s"Invalid settings: ${JsError.toJson(errors).keys.mkString(", ")}")
      case JsSuccess(s, _) =>
        val userId = s.userId
        val teamId = s.teamId.filter(_ > 0)
        authenticationService.findByUserId(userId).flatMap {
          case None       => reject("No user has this user ID")
          case Some(user) =>
            for {
              // A user who has never visited this city has no user_stat row yet; without one the privacy and quality
              // writes below would match nothing and the save would report success having changed nothing.
              _        <- authenticationService.addUserStatEntryIfNew(userId)
              stats    <- userService.getUserStats(userId)
              currTeam <- userService.getUserTeam(userId)
              response <- {
                val usernameChanged = s.username != user.username
                val roleChanged     = s.role != user.role
                val teamChanged     = currTeam.map(_.teamId) != teamId
                val serviceChanged  = s.communityService != user.communityService
                val privacyChanged  =
                  stats.exists(st => st.onLeaderboard != s.onLeaderboard || st.publicProfile != s.publicProfile)
                val qualityChanged = stats.exists(_.highQualityManual != s.highQualityManual)
                val infra3dChanged = s.infra3dAccess.exists(_ != user.infra3dAccess)
                val anyChanged     = usernameChanged || roleChanged || teamChanged || serviceChanged ||
                  privacyChanged || qualityChanged || infra3dChanged

                // Ordered from the broadest refusal to the narrowest.
                val firstError: Option[String] =
                  if (anyChanged && user.role == "Owner") Some("An Owner's settings can't be changed")
                  else if (roleChanged && !RoleTable.ADMIN_ASSIGNABLE_ROLES.contains(s.role))
                    Some(s"Can't assign role ${s.role}")
                  else if (roleChanged && !RoleTable.ADMIN_ASSIGNABLE_ROLES.contains(user.role))
                    Some(s"A ${user.role} account's role can't be changed")
                  else if (qualityChanged && user.role == "Administrator" && admin.role != "Owner")
                    Some("An admin's quality can only be set by an Owner")
                  else if (infra3dChanged && !admin.infra3dAccess) Some("Only a user with infra3D access can grant it")
                  else None

                val usernameCheck: Future[Either[String, Unit]] =
                  if (firstError.isDefined) Future.successful(Left(firstError.get))
                  else if (usernameChanged) userService.validateUsername(userId, s.username).map {
                    case Left(errorKey) => Left(Messages(errorKey))
                    case Right(_)       => Right(())
                  }
                  else Future.successful(Right(()))

                usernameCheck.flatMap {
                  case Left(message) => reject(message)
                  case Right(_)      =>
                    for {
                      _ <- userService.updatePrivacySettings(userId, s.onLeaderboard, s.publicProfile)
                      _ <- teamId
                        .map(id => userService.setUserTeam(userId, id))
                        .getOrElse(userService.leaveTeam(userId))
                      _ <- authenticationService.setCommunityServiceStatus(userId, s.communityService)
                      _ <- if (roleChanged) authenticationService.updateRole(userId, s.role) else Future.successful(0)
                      _ <- s.infra3dAccess
                        .filter(_ => infra3dChanged)
                        .map(access => authenticationService.setInfra3dAccess(userId, access))
                        .getOrElse(Future.successful(0))
                      newQuality <-
                        if (qualityChanged) userService.setManualUserQuality(userId, s.highQualityManual)
                        else Future.successful(stats.map(_.highQuality))
                      _ <-
                        if (usernameChanged) userService.changeUsername(userId, s.username)
                        else Future.successful(Right(user.username))
                    } yield {
                      cc.loggingService.insert(
                        admin.userId,
                        request.ipAddress,
                        s"Click_module=AdminSaveUserSettings_User=$userId"
                      )
                      if (roleChanged) {
                        cc.loggingService.insert(
                          admin.userId,
                          request.ipAddress,
                          s"UpdateRole_User=${userId}_Old=${user.role}_New=${s.role}"
                        )
                      }
                      if (qualityChanged) {
                        cc.loggingService.insert(
                          admin.userId,
                          request.ipAddress,
                          s"UpdateUserManualQuality_User=${userId}_Manual=${s.highQualityManual}_New=$newQuality"
                        )
                      }
                      // The page's URL is keyed by username, so the client needs the saved name to re-point itself.
                      Ok(Json.obj("success" -> true, "high_quality" -> newQuality, "username" -> s.username))
                    }
                }
              }
            } yield response
        }
    }
  }

  /* Clears all cached values. Should only be called from the Admin page. */
  def clearPlayCache() = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    cacheApi.removeAll().map(_ => Ok("success"))
  }

  /**
   * Updates user_stat table for users who audited in the past `hoursCutoff` hours. Update everyone if no time supplied.
   *
   * Recorded in `background_job_run` under the nightly job's name but tagged `Manual`, so the run leaves the same
   * counts and error trail the scheduler's would without being able to stand in for it (#4928).
   */
  def updateUserStats(hoursCutoff: Option[Int]) = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    val cutoffTime: OffsetDateTime = hoursCutoff match {
      case Some(hours) => OffsetDateTime.now().minusHours(hours.toLong)
      case None        => OffsetDateTime.ofInstant(Instant.EPOCH, ZoneOffset.UTC)
    }

    jobRunService
      .record(UserStatActor.Name, JobRunTrigger.Manual)(adminService.updateUserStatTable(cutoffTime)) { usersUpdated =>
        Json.obj("users_updated" -> usersUpdated)
      }
      .map { usersUpdated: Int => Ok(s"User stats updated for $usersUpdated users!") }
  }

  /**
   * Forces an immediate recompute of this deployment's engagement funnel (#288) into `funnel_stat` — the same work the
   * nightly FunnelStatActor does. Handy after a deploy so the Across Cities page shows this city without waiting a day.
   *
   * Recorded as a `Manual` run of that nightly job (#4928).
   */
  def updateFunnelStats = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)
    jobRunService
      .record(FunnelStatActor.Name, JobRunTrigger.Manual)(adminService.updateFunnelStatTable()) { rowsUpdated =>
        Json.obj("rows_written" -> rowsUpdated)
      }
      .map { rowsUpdated => Ok(s"Funnel stats updated ($rowsUpdated rows)!") }
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

  def getContributionTimeStats = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    adminService.getContributionTimeStats.map(timeStat => Ok(Json.toJson(timeStat)))
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
      case (Some(id), Some(labelType)) if LabelTypeEnum.labelTypeNames.contains(labelType) =>
        panoDataService
          .cropUrl(id, LabelTypeEnum.byName(labelType))
          .orElse(metaById.get(id).flatMap { m =>
            panoDataService.getImageUrl(m.panoId, m.panoSource, m.heading, m.pitch, m.zoom)
          })
      case _ => None
    }
  }

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
          "reaudit_streets"            -> s.reauditStreets,
          "total_distance_mi"          -> s.totalDistanceMi,
          "audited_distance_mi"        -> s.auditedDistanceMi,
          "reaudit_distance_mi"        -> s.reauditDistanceMi,
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
   * Serializes one rolling week-over-week activity window for the Across Cities page (#4758).
   *
   * Label and validation counts are what people did; AI-role output is reported in its own `ai_*` fields rather than
   * folded in, because one pipeline account can dwarf every person in the project (#4931).
   *
   * @param w The current- and prior-window totals for one city, or summed across all of them.
   * @return  The window as snake_case JSON (v3 API convention).
   */
  private def activityWindowJson(w: ActivityWindowSummary): JsObject = Json.obj(
    "labels_7d"               -> w.labels7d,
    "labels_prior_7d"         -> w.labelsPrior7d,
    "validations_7d"          -> w.validations7d,
    "validations_prior_7d"    -> w.validationsPrior7d,
    "ai_labels_7d"            -> w.aiLabels7d,
    "ai_labels_prior_7d"      -> w.aiLabelsPrior7d,
    "ai_validations_7d"       -> w.aiValidations7d,
    "ai_validations_prior_7d" -> w.aiValidationsPrior7d,
    "contributors_7d"         -> w.contributors7d,
    "contributors_prior_7d"   -> w.contributorsPrior7d,
    "anon_sessions_7d"        -> w.anonSessions7d,
    "anon_sessions_prior_7d"  -> w.anonSessionsPrior7d,
    "ai_agents_7d"            -> w.aiAgents7d
  )

  /**
   * Serializes one city's window plus the contributors it is made of, for the "Most active cities" hover cards (#4931).
   *
   * Contributors are named because the page is Owner-gated; these are the same usernames the admin user table shows.
   * `contributor_total` is how many the capped array was drawn from, which is what lets a card say how many people it
   * is not showing — counting that from the array itself would be bounded by the cap.
   *
   * @param w One city's rolling windows and its (already capped) contributor list.
   * @return  The window's fields plus a `contributors` array, busiest first, and the untruncated count.
   */
  private def cityActivityWindowJson(w: CityActivityWindow): JsObject = activityWindowJson(w.summary) ++ Json.obj(
    "contributor_total" -> w.contributorTotal,
    "contributors"      -> JsArray(w.contributors.map { c =>
      Json.obj(
        "username"             -> c.username,
        "kind"                 -> c.kind.toString,
        "labels_7d"            -> c.labels7d,
        "labels_prior_7d"      -> c.labelsPrior7d,
        "validations_7d"       -> c.validations7d,
        "validations_prior_7d" -> c.validationsPrior7d
      )
    })
  )

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
    // The trailing-7-day daily series drives the "this week" bar charts (#4686), and the window summary the
    // week-over-week deltas on the "Today & this week" tiles (#4758).
    val scorecardsF    = configService.getCityScorecards()
    val allTimeF       = configService.getCrossCityWeeklyTrend(None)
    val dailyF         = configService.getCrossCityDailyTrend(7)
    val windowSummaryF = configService.getCrossCityActivitySummary()
    val labelingSpeedF = configService.getCrossCityLabelingSpeed()

    for {
      withFlags     <- scorecardsF
      allTimeTrend  <- allTimeF
      dailyTrend    <- dailyF
      windowSummary <- windowSummaryF
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
      // new_users feeds the cumulative-users chart (#4686): each person counts once, in their first-activity week.
      val overTimeAllTime = JsArray(allTimeTrend.map { w =>
        Json.obj(
          "week_start"   -> w.weekStart.toString,
          "labels"       -> w.labels,
          "validations"  -> w.validations,
          "active_users" -> w.activeUsers,
          "new_users"    -> w.newUsers
        )
      })

      // Trailing-7-day cross-city daily series for the "this week" bar charts (#4686); zero-filled, today partial.
      // Each day also carries the breakdown its hover card shows (#4931): the human/AI split, the day's busiest
      // cities, and the people who were active, so the card is derived from the same rows the bar is summed from.
      val overTimeDaily = JsArray(dailyTrend.map { d =>
        Json.obj(
          "day"               -> d.point.day.toString,
          "labels"            -> d.point.labels,
          "validations"       -> d.point.validations,
          "contributors"      -> d.point.contributors,
          "anon_sessions"     -> d.point.anonSessions,
          "ai_labels"         -> d.point.aiLabels,
          "ai_validations"    -> d.point.aiValidations,
          "ai_agents"         -> d.point.aiAgents,
          "contributor_total" -> d.contributorTotal,
          "top_cities"        -> JsArray(d.topCities.map { city =>
            val cityName: String = cityInfoById.get(city.cityId).map(_.cityNameShort).getOrElse(city.cityId)
            Json.obj(
              "city_id"      -> city.cityId,
              "city_name"    -> cityName,
              "labels"       -> city.labels,
              "validations"  -> city.validations,
              "contributors" -> city.contributors
            )
          }),
          "contributor_list" -> JsArray(d.contributors.map { c =>
            Json.obj(
              "username"    -> c.username,
              "kind"        -> c.kind.toString,
              "labels"      -> c.labels,
              "validations" -> c.validations
            )
          })
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
          "over_time_daily"    -> overTimeDaily,
          // Rolling week-over-week windows (trailing 7 days vs the 7 before) for the "Today & this week" tiles
          // (#4758). Headcounts here are distinct across every city, so they can come out below the same column
          // summed down `window_by_city` — someone who mapped in three cities is one contributor here.
          "window_summary" -> activityWindowJson(windowSummary.total),
          // The same windows kept per city, for the "Most active cities" table. Emitted as its own block rather than
          // merged into `cities` because the scorecard rows already carry labels_7d/validations_7d on a slightly
          // different basis (see getCityWindowActivityByUserBySchema) and two same-named fields would invite mixing
          // them.
          "window_by_city" -> JsObject(windowSummary.byCity.toSeq.map { case (cityId, w) =>
            cityId -> cityActivityWindowJson(w)
          }),
          "summary" -> Json.obj(
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
   *
   * Recorded as a `Manual` run of the nightly street-priority job (#4928). Only the recalculation step, not the
   * imagery-freshness sync and region_completion rebuild the nightly sequence wraps around it, which is why the run
   * records no counts.
   */
  def recalculateStreetPriority = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    jobRunService
      .record(RecalculateStreetPriorityActor.Name, JobRunTrigger.Manual)(streetService.recalculateStreetPriority)(_ =>
        Json.obj()
      )
      .map(_ => Ok("Successfully recalculated street priorities"))
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
   *
   * Recorded in `background_job_run` like the nightly sweep, but tagged `Manual` so a run someone kicked off by hand
   * can't stand in for one the scheduler never fired (#4928).
   */
  def checkImagery() = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    jobRunService
      .record(CheckImageExpiryActor.Name, JobRunTrigger.Manual)(panoDataService.checkForImagery)(_.runDetails)
      .map { results => Ok(results.summary) }
  }

  /**
   * Refreshes the cached OSM way data (speed limits etc.). Same as the nightly process, for QA and initial backfill.
   *
   * Recorded as a `Manual` run of that nightly job (#4928). This one runs for tens of minutes and can half-fail, so
   * the recorded counts and error are the only durable account of what a given trigger did.
   */
  def refreshOsmWayData() = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    jobRunService
      .record(OsmWayRefreshActor.Name, JobRunTrigger.Manual)(osmWayService.refreshOsmWayData()) { waysRefreshed =>
        Json.obj("ways_refreshed" -> waysRefreshed)
      }
      .map { waysRefreshed => Ok(Json.obj("ways_refreshed" -> waysRefreshed)) }
      .recover { case NonFatal(e) =>
        logger.error("OSM way data refresh failed.", e)
        // Chunks upsert as they complete, so partial progress survives and a re-trigger resumes from what's missing.
        ServiceUnavailable(
          Json.obj("error" -> s"Refresh failed partway (${e.getMessage}). Progress is saved; trigger again to resume.")
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
