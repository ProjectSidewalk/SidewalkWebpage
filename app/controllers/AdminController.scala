package controllers

import actor.*
import controllers.base.*
import formats.json.AdminFormats.{given, *}
import formats.json.LabelFormats.*
import formats.json.UserFormats.given
import models.auth.{DefaultEnv, WithAdmin, WithOwner}
import models.api.{ApiError, ApiModelUtils}
import models.label.{LabelDeletion, LabelPanoMetadata, LabelType}
import models.user.Role
import models.utils.JobRunTrigger
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.dispatch.Dispatcher
import play.api.cache.AsyncCacheApi
import play.api.i18n.Messages
import play.api.libs.json.*
import play.api.{Configuration, Logger}
import play.silhouette.api.Silhouette
import play.silhouette.impl.exceptions.IdentityNotFoundException
import service.*

import java.time.temporal.ChronoUnit
import java.time.{Instant, OffsetDateTime, ZoneOffset}
import java.util.concurrent.ThreadPoolExecutor
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters.MapHasAsScala
import scala.util.{Failure, Success, Try}
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
    cropService: CropService,
    osmWayService: service.OsmWayService,
    userService: service.UserService,
    jobRunService: JobRunService,
    trafficService: TrafficService,
    sidewalkPresenceService: SidewalkPresenceService,
    placesService: PlacesService,
    actorSystem: ActorSystem
)(using ec: ExecutionContext)
    extends CustomBaseController(cc) {

  given Configuration = config
  private val logger  = Logger(this.getClass)

  /**
   * Get a list of all labels for the admin page, as a GeoJSON FeatureCollection of points.
   *
   * The public variant without the admin-only fields is LabelController.getAllLabelsForLabelMap at /labels/all. The
   * response is streamed from the db in a chunked response rather than materialized in memory (#3932).
   */
  def getAllLabels = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    val labels = labelService.getLabelsForLabelMap(Seq(), Seq(), Seq(), bbox = None, DEFAULT_BATCH_SIZE)
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
  def getTagSeverityCounts = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    adminService.getTagSeverityCounts.map { counts =>
      Ok(Json.obj("tag_severity" -> JsArray(counts.map { c =>
        Json.obj("label_type" -> c.labelType, "tag" -> c.tag, "severity" -> c.severity, "count" -> c.count)
      })))
    }
  }

  def getAuditedStreetsWithTimestamps = cc.securityService.SecuredAction(WithAdmin()) { _ =>
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
        labelService.getExtraAdminValidateData(Seq(labelId)).zip(cropService.cropMarker(labelId)).map {
          case (adminData, marker) =>
            Ok(
              labelMetadataWithValidationToJsonAdmin(metadata, adminData.head) ++
                Json.obj(
                  "crop_url"         -> panoDataService.cropUrl(metadata.labelId, metadata.labelType),
                  "crop_marker"      -> marker,
                  "backup_image_url" -> panoDataService.backupImageUrl(metadata.panoId),
                  "can_edit"         -> true,
                  "deleted"          -> metadata.deleted,
                  "can_restore"      -> LabelDeletion
                    .canRestore(metadata.deleted, metadata.deletedBy, Some(request.identity))
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
  def getActivityByDay = cc.securityService.SecuredAction(WithAdmin()) { _ =>
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
   * Checks that an admin may move a user from `current` to the role named `requested`: both must be admin-assignable.
   * @return The new role, or the reason the change is refused.
   */
  private def checkRoleChange(current: Role, requested: String): Either[String, Role] =
    Role.withNameOption(requested).filter(Role.ADMIN_ASSIGNABLE_ROLES.contains) match {
      case None                                                      => Left(s"Can't assign role $requested")
      case Some(_) if !Role.ADMIN_ASSIGNABLE_ROLES.contains(current) =>
        Left(s"${current.name} accounts can't have their role changed")
      case Some(newRole) => Right(newRole)
    }

  /**
   * Updates a user's role from the Management page; only moves between `Role.ADMIN_ASSIGNABLE_ROLES` are allowed.
   */
  def setUserRole = cc.securityService.SecuredAction(WithAdmin(), parse.json) { implicit request =>
    val submission = request.body.validate[UserRoleSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => {
        val userId: String = submission.userId
        authenticationService.findByUserId(userId) flatMap {
          case Some(user) =>
            checkRoleChange(user.role, submission.roleId) match {
              case Left(error)    => Future.successful(BadRequest(error))
              case Right(newRole) =>
                authenticationService
                  .updateRole(userId, newRole)
                  .map(_ => {
                    val logText = s"UpdateRole_User=${userId}_Old=${user.role.name}_New=${newRole.name}"
                    cc.loggingService.insert(request.identity.userId, request.ipAddress, logText)
                    Ok(Json.obj("username" -> user.username, "user_id" -> userId, "role" -> newRole.name))
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
   * dashboard (`/admin/user/:username/manage`): username, role, team, manual quality flag, exclusion, service-hours
   * opt-in, the two privacy flags, and (on infra3D deployments) infra3D access.
   *
   * An excluded user is always saved as manually low quality, whatever quality the request asked for. A change to
   * quality or exclusion recalculates street priority in the background, since it changes whose audits count.
   *
   * Every setting is required (a missing one is a 400, never a reset to a default). Every check that can refuse the
   * save — an Owner can't be changed at all, only an Owner can set an admin's quality or exclusion, only someone with
   * infra3D access can grant it, the username rules — runs before the first write, so a refused save applies nothing.
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
                // None for a role the enum doesn't know, which the assignable-roles check below refuses by name.
                val newRole: Option[Role] = Role.withNameOption(s.role)
                val usernameChanged       = s.username != user.username
                val roleChanged           = !newRole.contains(user.role)
                val teamChanged           = currTeam.map(_.teamId) != teamId
                val serviceChanged        = s.communityService != user.communityService
                val privacyChanged        =
                  stats.exists(st => st.onLeaderboard != s.onLeaderboard || st.publicProfile != s.publicProfile)
                // An excluded user's quality is set by the exclusion, so the quality field is ignored for them.
                val qualityChanged  = !s.excluded && stats.exists(_.highQualityManual != s.highQualityManual)
                val excludedChanged = stats.exists(_.excluded != s.excluded)
                val infra3dChanged  = s.infra3dAccess.exists(_ != user.infra3dAccess)
                val anyChanged      = usernameChanged || roleChanged || teamChanged || serviceChanged ||
                  privacyChanged || qualityChanged || excludedChanged || infra3dChanged

                val roleError: Option[String] =
                  if (roleChanged) checkRoleChange(user.role, s.role).left.toOption else None

                // Ordered from the broadest refusal to the narrowest.
                val firstError: Option[String] =
                  if (anyChanged && user.role == Role.Owner) Some("An Owner's settings can't be changed")
                  else if (roleError.isDefined) roleError
                  else if (excludedChanged && user.role == Role.Administrator && admin.role != Role.Owner)
                    Some("An admin can only be excluded by an Owner")
                  else if (qualityChanged && user.role == Role.Administrator && admin.role != Role.Owner)
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
                      _ <-
                        if (serviceChanged) userService.setCommunityService(userId, s.communityService)
                        else Future.successful(0)
                      // newRole is defined here: an unrecognized one was refused by the assignable-roles check above.
                      _ <- newRole
                        .filter(_ => roleChanged)
                        .map(role => authenticationService.updateRole(userId, role))
                        .getOrElse(Future.successful(0))
                      _ <- s.infra3dAccess
                        .filter(_ => infra3dChanged)
                        .map(access => authenticationService.setInfra3dAccess(userId, access))
                        .getOrElse(Future.successful(0))
                      // Un-exclude before the quality write, which skips excluded users.
                      excludedQuality <-
                        if (excludedChanged) userService.setUserExcluded(userId, s.excluded)
                        else Future.successful(stats.map(_.highQuality))
                      newQuality <-
                        if (qualityChanged) userService.setManualUserQuality(userId, s.highQualityManual)
                        else Future.successful(excludedQuality)
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
                        val _ = cc.loggingService.insert(
                          admin.userId,
                          request.ipAddress,
                          s"UpdateRole_User=${userId}_Old=${user.role.name}_New=${s.role}"
                        )
                      }
                      if (qualityChanged) {
                        val _ = cc.loggingService.insert(
                          admin.userId,
                          request.ipAddress,
                          s"UpdateUserManualQuality_User=${userId}_Manual=${s.highQualityManual}_New=$newQuality"
                        )
                      }
                      if (excludedChanged) {
                        val _ = cc.loggingService.insert(
                          admin.userId,
                          request.ipAddress,
                          s"UpdateUserExcluded_User=${userId}_New=${s.excluded}"
                        )
                      }
                      if (qualityChanged || excludedChanged) recalculateStreetPriorityInBackground()
                      // The page's URL is keyed by username, so the client needs the saved name to re-point itself.
                      Ok(
                        Json.obj(
                          "success"      -> true,
                          "high_quality" -> newQuality,
                          "excluded"     -> s.excluded,
                          "username"     -> s.username
                        )
                      )
                    }
                }
              }
            } yield response
        }
    }
  }

  /* Clears all cached values. Should only be called from the Admin page. */
  def clearPlayCache() = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    cacheApi.removeAll().map(_ => Ok("success"))
  }

  /**
   * Updates user_stat table for users who audited in the past `hoursCutoff` hours. Update everyone if no time supplied.
   *
   * Recorded in `background_job_run` under the nightly job's name but tagged `Manual`, so the run leaves the same
   * counts and error trail the scheduler's would without being able to stand in for it (#4928).
   */
  def updateUserStats(hoursCutoff: Option[Int]) = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    val cutoffTime: OffsetDateTime = hoursCutoff match {
      case Some(hours) => OffsetDateTime.now().minusHours(hours.toLong)
      case None        => OffsetDateTime.ofInstant(Instant.EPOCH, ZoneOffset.UTC)
    }

    jobRunService
      .record(UserStatActor.Name, JobRunTrigger.Manual)(adminService.updateUserStatTable(cutoffTime))(
        UserStatActor.runDetails
      )
      .map { (usersUpdated: Int) => Ok(s"User stats updated for $usersUpdated users!") }
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
      .record(FunnelStatActor.Name, JobRunTrigger.Manual)(adminService.updateFunnelStatTable())(
        FunnelStatActor.runDetails
      )
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
          .map { (tasksUpdated: Int) => Ok(Json.obj("tasks_updated" -> tasksUpdated)) }
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
              .map { (tasksUpdated: Int) => Ok(Json.obj("tasks_updated" -> tasksUpdated)) }
          case _ => Future.failed(IdentityNotFoundException("Username not found."))
        }
      }
    )
  }

  def getContributionTimeStats = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    adminService.getContributionTimeStats.map(timeStat => Ok(Json.toJson(timeStat)))
  }

  /**
   * Recent-activity stream for the redesigned admin dashboard's Activity page (#4272): the latest labels, validations,
   * and comments interleaved by recency, each tagged with who did it and (where applicable) the label it points at.
   * snake_case output per the dashboard convention.
   *
   * @param n Number of feed items; kept within 1 to [[service.AdminService.MaxRecentActivity]].
   */
  def getRecentActivity(n: Int) = cc.securityService.SecuredAction(WithAdmin()) { _ =>
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
  private def thumbnailUrl(item: RecentActivityItem, metaById: Map[Int, LabelPanoMetadata]): Option[String] = {
    (item.labelId, item.labelType.flatMap(LabelType.withNameOption)) match {
      case (Some(id), Some(labelType)) =>
        panoDataService
          .cropUrl(id, labelType)
          .orElse(metaById.get(id).flatMap { m =>
            panoDataService.getImageUrl(m.panoId, m.panoSource, m.heading, m.pitch, m.zoom, m.canvasWidth,
              m.canvasHeight)
          })
      case _ => None
    }
  }

  /**
   * Contributors-page leaderboards for the redesigned admin dashboard (#4272): top labelers (with label-type mix and
   * severity distribution) and top validators (with agree/disagree/unsure split). snake_case per the dashboard convention.
   *
   * @param n Rows per leaderboard; kept within 1 to [[service.AdminService.MaxLeaderboardRows]].
   */
  def getContributorLeaderboards(n: Int) = cc.securityService.SecuredAction(WithAdmin()) { _ =>
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
  def getHumanVsAiStats = cc.securityService.SecuredAction(WithAdmin()) { _ =>
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
  def getOverviewSummary = cc.securityService.SecuredAction(WithAdmin()) { _ =>
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
        "kind"                 -> c.kind.name,
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
   *
   * Every read behind it is a per-JVM cache over a fan-out to every city schema, so on a cold JVM the response can't
   * wait for them all: past Apache's 60 s proxy timeout the page would get a `502` (#5432). Each read waits at most
   * [[service.ConfigService.CrossCityColdWait]] instead, and when one the page needs is still computing this answers
   * `503` + `Retry-After` with a `STILL_COMPUTING` problem body, the contract the AccessScore endpoints use (#5418),
   * while the fan-outs keep running and fill the cache for the retry.
   */
  def getCityScorecards = cc.securityService.SecuredAction(WithOwner()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)
    val cityInfoById: Map[String, CityInfo] =
      configService.getAllCityInfo(request2Messages.lang).map(ci => ci.cityId -> ci).toMap

    // Fetch the per-city scorecards and the all-time cross-city weekly series in parallel; the page's "over time" charts
    // default to the last 12 weeks (derived client-side from each city's weekly_trend) and toggle to this all-time set.
    // The trailing daily series drives the rolling "this week" (#4686) and "this month" (#5653) bar charts, the
    // trailing-year baseline their average lines, and the window summary the week-over-week deltas on the "Today &
    // this week" tiles (#4758). One 30-day read rather than a 7- and a 30-day one: the page takes the week from its
    // last seven days, so the two groups can't disagree about a shared day and the fan-out runs once.
    val dailyTrendDays = 30
    val scorecardsF    = configService.getCityScorecards()
    val allTimeF       = configService.getCrossCityWeeklyTrend(None)
    val dailyF         = configService.getCrossCityDailyTrend(dailyTrendDays)
    // A failed or still-computing baseline only costs the charts their average line; it must not take the rest of the
    // page down with it, nor hold it (the read's own cold wait bounds the latter).
    val baselineF = configService.getCrossCityDailyBaseline().recover { case e: Exception =>
      logger.warn(s"Daily baseline unavailable: ${e.getMessage}")
      None
    }
    val windowSummaryF = configService.getCrossCityActivitySummary()
    // Labeling speed is the one fan-out that scans the interaction tables, so it is the likeliest to outlast the cold
    // wait on its own. Refusing the page for it would make every retry wait on the slowest metric, and the page already
    // shows a city missing from this map as unknown, so a still-computing speed is an honest gap rather than a zero.
    val labelingSpeedF = configService
      .getCrossCityLabelingSpeed()
      .map(_.getOrElse {
        logger.warn("Cross-city labeling speed still computing; serving Across Cities without it.")
        Map.empty[String, Double]
      })
    val storyStatsF = configService.getCrossCityStoryStats()

    // Every future above is already running, so the waits overlap and the response is bounded by the longest one.
    for {
      withFlagsOpt     <- scorecardsF
      allTimeTrendOpt  <- allTimeF
      dailyTrendOpt    <- dailyF
      dailyBaseline    <- baselineF
      windowSummaryOpt <- windowSummaryF
      labelingSpeed    <- labelingSpeedF
      storyStatsOpt    <- storyStatsF
    } yield (withFlagsOpt, allTimeTrendOpt, dailyTrendOpt, windowSummaryOpt, storyStatsOpt) match {
      // Story stats stay required: an empty map would render as "no stories", which the page must never claim falsely.
      case (Some(withFlags), Some(allTimeTrend), Some(dailyTrend), Some(windowSummary), Some(storyStats)) =>
        val now        = OffsetDateTime.now()
        val scorecards = withFlags.map(_.scorecard)

        val cities = withFlags.map { case CityScorecardWithFlags(sc, anomalies) =>
          cityScorecardJson(sc, anomalies, cityInfoById.get(sc.cityId), labelingSpeed.get(sc.cityId), now)
        }
        Ok(
          Json.obj(
            "cities"             -> JsArray(cities),
            "stories"            -> storyStatsJson(storyStats, cityInfoById),
            "over_time_all_time" -> allTimeTrendJson(allTimeTrend),
            "over_time_daily"    -> dailyTrendJson(dailyTrend, cityInfoById),
            // Trailing-year per-day averages drawn as a reference line on every per-day chart (#5653), on the bars'
            // own basis so the line and the bars are comparable. Null when the baseline couldn't be computed, which the
            // page reads as "draw no line".
            "daily_baseline" -> dailyBaseline
              .map { b =>
                Json.obj(
                  "days"                 -> b.days,
                  "window_start"         -> b.windowStart.toString,
                  "window_end"           -> b.windowEnd.toString,
                  "labels_per_day"       -> b.labelsPerDay,
                  "validations_per_day"  -> b.validationsPerDay,
                  "contributors_per_day" -> b.contributorsPerDay
                )
              }
              .getOrElse(JsNull),
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
            "summary" -> crossCitySummaryJson(scorecards, cityInfoById)
          )
        )
      case _ =>
        val pending = Seq[(String, Option[?])](
          "scorecards"     -> withFlagsOpt,
          "weekly trend"   -> allTimeTrendOpt,
          "daily trend"    -> dailyTrendOpt,
          "window summary" -> windowSummaryOpt,
          "story stats"    -> storyStatsOpt
        ).collect { case (name, None) => name }
        logger.info(s"Across Cities still computing (${pending.mkString(", ")}); answering 503.")
        ApiError
          .toResult(
            ApiError.stillComputing(
              "Cross-city figures are still being computed. Retry after the number of seconds in the Retry-After " +
                "header."
            )
          )
          .withHeaders(RETRY_AFTER -> ApiError.StillComputingRetryAfterSeconds.toString)
    }
  }

  /**
   * One city's row of the scorecard table, with snake_case keys like the v3 API.
   *
   * @param info           The city's name, URL and visibility, if it is configured.
   * @param secondsPer100m Seconds of active auditing per 100 m, from the daily cache, if it has data.
   * @param now            When "days since activity" is counted from.
   * @return               The city's JSON object.
   */
  private def cityScorecardJson(
      sc: CityScorecard,
      anomalies: Seq[String],
      info: Option[CityInfo],
      secondsPer100m: Option[Double],
      now: OffsetDateTime
  ): JsObject = {
    // Per-label-type breakdown (the data-pattern lens), keyed by label type with snake_case stat names.
    val byLabelType = JsObject(
      sc.byLabelType.toSeq
        .sorted(using ApiModelUtils.labelTypeOrdering)
        .map { case (labelType, s) =>
          labelType -> Json.obj(
            "labels"    -> s.labels,
            "validated" -> s.labelsValidated,
            "agree"     -> s.labelsValidatedAgree,
            "disagree"  -> s.labelsValidatedDisagree
          )
        }
    )
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
      // Share computed only over types that CAN have a rating, i.e. RatingScale other than Unrated.
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
      "ai_validation_share"          -> (if (sc.totalValidations > 0) sc.aiValidations.toDouble / sc.totalValidations
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
      "seconds_per_100m" -> secondsPer100m,
      // Lifecycle/health state: active | wrapped_up | stalled | low_traction (#4329).
      "lifecycle" -> ConfigService.lifecycle(sc, now),
      "anomalies" -> anomalies
    )
  }

  /**
   * The project-wide weekly series behind the "All time" charts. `new_users` counts each person once, in the week
   * they first did anything, so the cumulative-users chart adds up (#4686).
   *
   * @return One object per week, oldest first.
   */
  private def allTimeTrendJson(trend: Seq[WeeklyPoint]): JsArray =
    JsArray(trend.map { w =>
      Json.obj(
        "week_start"   -> w.weekStart.toString,
        "labels"       -> w.labels,
        "validations"  -> w.validations,
        "active_users" -> w.activeUsers,
        "new_users"    -> w.newUsers
      )
    })

  /**
   * The trailing days, project-wide, for the rolling 7- and 30-day bar charts (#4686, #5653): zero-filled, today
   * partial, the week being the last seven of them. Each day
   * also carries what its hover card shows (#4931), so the card and the bar come from the same rows.
   *
   * @param cityInfoById Each city's config, for names and URLs.
   * @return             One object per day.
   */
  private def dailyTrendJson(trend: Seq[DailyActivity], cityInfoById: Map[String, CityInfo]): JsArray =
    JsArray(trend.map { d =>
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
            "url"          -> cityInfoById.get(city.cityId).map(_.URL),
            "labels"       -> city.labels,
            "validations"  -> city.validations,
            "contributors" -> city.contributors
          )
        }),
        "contributor_list" -> JsArray(d.contributors.map { c =>
          Json.obj(
            "username"    -> c.username,
            "kind"        -> c.kind.name,
            "labels"      -> c.labels,
            "validations" -> c.validations,
            // The city's URL lets the card link a name to that person's admin page in that city (#5495).
            "cities" -> JsArray(c.cities.map { city =>
              val info = cityInfoById.get(city.cityId)
              Json.obj(
                "city_id"     -> city.cityId,
                "city_name"   -> info.map(_.cityNameShort).getOrElse[String](city.cityId),
                "url"         -> info.map(_.URL),
                "labels"      -> city.labels,
                "validations" -> city.validations
              )
            })
          )
        })
      )
    })

  /**
   * Story counts per city (#5543), kept separate from the scorecard rows so a city whose scorecard failed still
   * reports its stories. `counts` is null where the count itself failed; the page shows that as unavailable, not 0.
   *
   * @return One object per city, by city id.
   */
  private def storyStatsJson(
      storyStats: Map[String, Option[CityStoryStats]],
      cityInfoById: Map[String, CityInfo]
  ): JsArray =
    JsArray(storyStats.toSeq.sortBy { case (cityId, _) => cityId }.map { case (cityId, stats) =>
      val info = cityInfoById.get(cityId)
      Json.obj(
        "city_id"   -> cityId,
        "city_name" -> info.map(_.cityNameShort),
        "url"       -> info.map(_.URL),
        "counts"    -> stats.map { st =>
          Json.obj(
            "total"      -> st.total,
            "hidden"     -> st.hidden,
            "with_photo" -> st.withPhoto,
            "last_7d"    -> st.last7d,
            "visible_7d" -> st.visible7d,
            "last_30d"   -> st.last30d,
            "newest"     -> st.newest
          )
        }
      )
    })

  /**
   * The page's headline totals, summed from the cities shown so they match the table. `total_users` adds up each
   * city's contributors, so a person active in two cities counts twice. The anomaly thresholds ride along so the
   * page can flag the "needs attention" items.
   *
   * @return The summary block.
   */
  private def crossCitySummaryJson(scorecards: Seq[CityScorecard], cityInfoById: Map[String, CityInfo]): JsObject = {
    val numCountries      = scorecards.flatMap(sc => cityInfoById.get(sc.cityId).map(_.countryId)).distinct.size
    val numLanguages      = config.get[Seq[String]]("play.i18n.langs").size
    val totalContributors = scorecards.map(_.activeContributors).sum
    val totalKm           = scorecards.map(_.auditedKm).sum
    val totalLabels       = scorecards.map(_.totalLabels).sum
    val totalValidations  = scorecards.map(_.totalValidations).sum
    val sumAgree          = scorecards.map(_.validationsAgree).sum
    val sumDisagree       = scorecards.map(_.validationsDisagree).sum
    val globalAgreement   = if (sumAgree + sumDisagree > 0) sumAgree.toDouble / (sumAgree + sumDisagree) else 0.0
    Json.obj(
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
   * Returns every configured city's web-traffic summary from the GA4 Data API (Planning#8), for the Across Cities
   * page's Traffic section. Owner-only (cross-deployment data). Output is snake_case per the v3 convention.
   *
   * GA being unreachable, unconfigured, or mid-outage must never break the dashboard, so every such case degrades to
   * `available: false` (HTTP 200) and the page renders the section as unavailable.
   */
  def getCityTraffic = cc.securityService.SecuredAction(WithOwner()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)
    trafficService
      .getCityTraffic()
      .map {
        case Some(snapshot) =>
          Ok(
            Json.obj(
              "available"       -> true,
              "fetched_at"      -> snapshot.fetchedAt,
              "traffic_by_city" -> JsObject(snapshot.cities.map(c => c.cityId -> Json.toJson(c))),
              "failed_city_ids" -> snapshot.failedCityIds
            )
          )
        case None => Ok(Json.obj("available" -> false))
      }
      .recover { case NonFatal(e) =>
        logger.warn(s"GA traffic unavailable: ${e.getMessage}")
        Ok(Json.obj("available" -> false))
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

  def getUserStats = cc.securityService.SecuredAction(WithAdmin()) { _ =>
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
   * records a null `regions_seeded` rather than a count.
   */
  def recalculateStreetPriority = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    runStreetPriorityRecalc().map(_ => Ok("Successfully recalculated street priorities"))
  }

  /** Recalculates street priority for all streets, recorded as a manual run of the nightly job. */
  private def runStreetPriorityRecalc(): Future[Seq[Int]] =
    jobRunService.record(RecalculateStreetPriorityActor.Name, JobRunTrigger.Manual)(
      streetService.recalculateStreetPriority
    )(_ => RecalculateStreetPriorityActor.runDetails(None))

  /** Recalculates street priority without making the caller wait, since it rewrites every street. */
  private def recalculateStreetPriorityInBackground(): Unit =
    runStreetPriorityRecalc().failed.foreach(e => logger.error("Background street priority recalculation failed.", e))

  /** Recounts every label's validation counts; users' accuracy catches up on the next user stats run. */
  def recalculateValidationCounts = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)
    adminService.recalculateValidationCounts().map(n => Ok(Json.obj("labels_updated" -> n)))
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
  def checkImagery() = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    jobRunService
      .record(CheckImageExpiryActor.Name, JobRunTrigger.Manual)(panoDataService.checkForImagery)(_.runDetails)
      .map { results => Ok(results.summary) }
  }

  /**
   * Cuts the missing label crops from the self-hosted pano store. Same as the nightly process, for a backfill
   * that shouldn't wait for it (#4865).
   *
   * Recorded as a `Manual` run of that nightly job (#4928), and answered as soon as the run starts rather than when
   * it ends — alone among these triggers, because a first backfill runs for about an hour, far past any proxy's read
   * timeout, and a timed-out request reads as a failed job while the run carries on unseen. The Health panel is
   * where it reports; `isRunning` is what keeps a second click from starting a second pass over the same store.
   */
  def generateCrops = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)
    // Checked before the run is recorded, so a refused trigger doesn't leave a failed run on the Health panel.
    if (cropService.isRunning) {
      Future.successful(Conflict("A crop generation run is already in progress."))
    } else {
      jobRunService
        .record(CropGenerationActor.Name, JobRunTrigger.Manual)(cropService.generateMissingCrops())(_.runDetails)
        .onComplete {
          case Success(results) => logger.info(results.summary)
          case Failure(e)       => logger.error(s"Manually triggered crop generation failed: ${e.getMessage}")
        }
      Future.successful(Accepted("Crop generation started. It reports to the Health panel when it finishes."))
    }
  }

  /**
   * Rebuilds the derived `sidewalk_presence` table now, as the nightly job does (#5279).
   *
   * Recorded as a manual run of that job, so the Health panel charts both triggers as one. The rebuild takes seconds,
   * so unlike crop generation the response waits for it and answers with the counts.
   *
   * The window a click has to land in to collide with the nightly tick is seconds wide, but the collision is ugly
   * — both transactions insert the faces of a street added since, and the loser aborts on the primary key — so it is
   * refused rather than raced. Checked before the run is recorded, as `generateCrops` does, so a refused trigger
   * doesn't leave a failed run on the Health panel.
   */
  def rebuildSidewalkPresence = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)
    if (sidewalkPresenceService.isRunning) {
      Future.successful(Conflict("A sidewalk presence rebuild is already in progress."))
    } else {
      jobRunService
        .record(SidewalkPresenceActor.Name, JobRunTrigger.Manual)(sidewalkPresenceService.rebuild())(_.runDetails)
        .map(result => Ok(result.runDetails))
    }
  }

  /**
   * Fetches the city's places from OpenStreetMap now, whatever the table's age (#5311).
   *
   * Recorded as a manual run of the nightly job, so the Health panel charts both triggers as one. The Overpass query
   * can take minutes for a big city, longer than a proxy waits on a response, so like crop generation this answers
   * at once and the run row is the account of what happened. Refused rather than raced while a run is in flight,
   * before anything is recorded, so a refused click leaves nothing on the Health panel.
   */
  def refreshPlaces = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)
    if (placesService.isRunning) {
      Future.successful(Conflict("A places refresh is already in progress."))
    } else {
      jobRunService
        .record(PlacesRefreshActor.Name, JobRunTrigger.Manual)(placesService.refresh(force = true))(_.runDetails)
        .onComplete {
          case Success(result) => logger.info(s"Manually triggered places refresh finished: ${result.runDetails}")
          case Failure(e)      => logger.error(s"Manually triggered places refresh failed: ${e.getMessage}")
        }
      Future.successful(Accepted("Places refresh started. It reports to the Health panel when it finishes."))
    }
  }

  /**
   * Recounts the served streets whose gradient is missing or stale (#5223), as the nightly job does, so the Health
   * panel reflects an import the moment it lands rather than the next morning. Recorded as a `Manual` run of that
   * job; two counts, so it answers with them.
   */
  def recountStreetGradientStaleness = cc.securityService.SecuredAction(WithAdmin()) { implicit request =>
    cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)
    jobRunService
      .record(StreetGradientStalenessActor.Name, JobRunTrigger.Manual)(streetService.countStreetGradientStaleness)(
        _.runDetails
      )
      .map(counts => Ok(counts.runDetails))
      .recover { case NonFatal(e) =>
        logger.error("Street gradient staleness recount failed.", e)
        ServiceUnavailable(Json.obj("error" -> s"Recount failed (${e.getMessage})."))
      }
  }

  /**
   * Refreshes the cached OSM way data (speed limits etc.). Same as the nightly process, for QA and initial backfill.
   *
   * Recorded as a `Manual` run of that nightly job (#4928). This one runs for tens of minutes and can half-fail, so
   * the recorded counts and error are the only durable account of what a given trigger did.
   */
  def refreshOsmWayData() = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    jobRunService
      .record(OsmWayRefreshActor.Name, JobRunTrigger.Manual)(osmWayService.refreshOsmWayData())(
        OsmWayRefreshActor.runDetails
      )
      .map { result => Ok(OsmWayRefreshActor.runDetails(result)) }
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
  def getApiAnalyticsBySource(days: Int) = cc.securityService.SecuredAction(WithAdmin()) { _ =>
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
        .sortBy { case (_, external, _) => -external }
      val daily = data.dailyCounts
        .groupBy(_.date)
        .map { case (date, rows) => val (e, d) = split(rows.map(r => (r.source, r.count))); (date, e, d) }
        .toSeq
        .sortBy { case (date, _, _) => date }
      val formats = data.formatCounts
        .groupBy(_.format)
        .map { case (fmt, rows) => val (e, d) = split(rows.map(r => (r.source, r.count))); (fmt, e, d) }
        .toSeq
        .sortBy { case (_, external, _) => -external }

      val extCalls  = endpoints.map { case (_, external, _) => external }.sum
      val docsCalls = endpoints.map { case (_, _, apiDocs) => apiDocs }.sum
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

  def getThreadPoolStats = cc.securityService.SecuredAction(WithAdmin()) { _ =>
    val dispatcherNames = List("database-operations", "cpu-intensive", "pekko.actor.default-dispatcher")

    val info = StringBuilder()
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

    // Prod has no shell for a thread dump, and one task hogging this small pool slows every streamed response (#4161).
    val stackTraces = Thread.getAllStackTraces.asScala
    val threadCpu   = java.lang.management.ManagementFactory.getThreadMXBean
    info.append("\n=== cpu-intensive threads ===\n")
    stackTraces
      .filter { case (t, _) => t.getName.contains("cpu-intensive") }
      .toSeq
      .sortBy { case (thread, _) => thread.getName }
      .foreach { case (thread, frames) =>
        val cpuSeconds = threadCpu.getThreadCpuTime(thread.getId) / 1e9
        info.append(f"${thread.getName} - State: ${thread.getState}, CPU time: $cpuSeconds%.0fs\n")
        frames.take(15).foreach(frame => info.append(s"    at $frame\n"))
      }

    // Add Slick thread monitoring
    info.append("\n=== All JVM Threads (looking for Slick) ===\n")
    val allThreads   = stackTraces.keySet
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
