package controllers

import controllers.base._
import controllers.helper.ControllerUtils.{isMobile, parseIntegerSeq}
import executors.CpuIntensiveExecutionContext
import formats.json.LabelFormats.labelMetadataUserDashToJson
import formats.json.UserFormats._
import models.auth._
import models.label.LabelTypeEnum
import models.user.SidewalkUserWithRole
import models.utils.CommonUtils.METERS_TO_MILES
import models.utils.ProfanityGuard
import models.utils.MyPostgresProfile.api._
import play.api.i18n.Messages
import play.api.libs.json.{JsObject, Json}
import play.api.{Configuration, Logger}
import play.silhouette.api.Silhouette
import play.silhouette.impl.exceptions.IdentityNotFoundException

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class UserProfileController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    val config: Configuration,
    configService: service.ConfigService,
    authenticationService: service.AuthenticationService,
    userService: service.UserService,
    labelService: service.LabelService,
    streetService: service.StreetService,
    panoDataService: service.PanoDataService,
    implicit val ec: ExecutionContext,
    cpuEc: CpuIntensiveExecutionContext
)(implicit assets: AssetsFinder)
    extends CustomBaseController(cc) {

  implicit val implicitConfig: Configuration = config
  private val logger                         = Logger(this.getClass)

  /**
   * Loads the user dashboard page.
   */
  def userProfile = cc.securityService.SecuredAction(WithSignedIn()) { implicit request =>
    val user: SidewalkUserWithRole = request.identity
    val metricSystem: Boolean      = Messages("measurement.system") == "metric"
    if (isMobile(request)) {
      cc.loggingService.insert(user.userId, request.ipAddress, "Visit_UserDashboard_RedirectMobileLanding")
      Future.successful(Redirect("/mobileLanding"))
    } else {
      for {
        userProfileData <- userService.getUserProfileData(user.userId, metricSystem)
        commonData      <- configService.getCommonPageData(request2Messages.lang)
        tags            <- labelService.getTagsForCurrentCity
      } yield {
        cc.loggingService.insert(user.userId, request.ipAddress, "Visit_UserDashboard")
        Ok(
          views.html
            .userProfile(commonData, "Sidewalk - Dashboard", user, user, tags, userProfileData, adminData = None)
        )
      }
    }
  }

  /** Builds the choropleth GeoJSON FeatureCollection for a set of a user's audited streets. */
  private def streetsToGeoJson(streets: Seq[models.street.StreetEdge]): JsObject = {
    val features: Seq[JsObject] = streets.map { street =>
      val properties: JsObject = Json.obj("street_edge_id" -> street.streetEdgeId, "way_type" -> street.wayType)
      Json.obj("type" -> "Feature", "geometry" -> street.geom, "properties" -> properties)
    }
    Json.obj("type" -> "FeatureCollection", "features" -> features)
  }

  /** Builds the GeoJSON FeatureCollection of a user's label points for the choropleth. */
  private def labelsToGeoJson(labels: Seq[models.label.LabelLocation]): JsObject = {
    val features: Seq[JsObject] = labels.map { label =>
      Json.obj(
        "type"       -> "Feature",
        "geometry"   -> Json.obj("type" -> "Point", "coordinates" -> Json.arr(label.lng, label.lat)),
        "properties" -> Json.obj(
          "audit_task_id"   -> label.auditTaskId,
          "label_id"        -> label.labelId,
          "pano_id"         -> label.panoId,
          "label_type"      -> label.labelType,
          "correct"         -> label.correct,
          "has_validations" -> label.hasValidations,
          "expired"         -> label.expired
        )
      )
    }
    Json.obj("type" -> "FeatureCollection", "features" -> features)
  }

  /**
   * Get the list of streets that have been audited by the given user.
   */
  def getAuditedStreets(userId: String) = cc.securityService.SecuredAction(WithAdminOrIsUser(userId)) {
    implicit request =>
      logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
      authenticationService.findByUserId(userId).flatMap {
        case Some(user) => userService.getAuditedStreets(userId).map(streets => Ok(streetsToGeoJson(streets)))
        case _          => Future.failed(new IdentityNotFoundException("Username not found."))
      }
  }

  /**
   * Public version of [[getAuditedStreets]] for the public profile map, keyed by username and gated on the target's
   * `public_profile` flag (or the viewer being the owner). Returns 403 for a private profile or unknown user, so the
   * map on a private profile stays empty.
   *
   * @param username The mapper whose audited streets to return.
   */
  def getPublicAuditedStreets(username: String) = cc.securityService.SecuredAction { implicit request =>
    userService.resolveVisibleUser(username, isOwner = request.identity.username == username).flatMap {
      case Some(uid) => userService.getAuditedStreets(uid).map(streets => Ok(streetsToGeoJson(streets)))
      case None      => Future.successful(Forbidden(Json.obj("status" -> "private")))
    }
  }

  /**
   * Get the list of all streets and whether they have been audited or not, regardless of user.
   */
  def getAllStreets(filterLowQuality: Boolean, regions: Option[String], routes: Option[String]) = Action.async {
    implicit request =>
      logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
      val regionIds: Seq[Int] = parseIntegerSeq(regions)
      val routeIds: Seq[Int]  = parseIntegerSeq(routes)

      streetService
        .selectStreetsWithAuditStatus(filterLowQuality, regionIds, routeIds)
        .map { streets =>
          val features: Seq[JsObject] = streets.map { street =>
            val properties: JsObject = Json.obj(
              "street_edge_id" -> street.streetEdgeId,
              "way_type"       -> street.wayType,
              "region_id"      -> street.regionId,
              "audited"        -> street.audited
            )
            Json.obj("type" -> "Feature", "geometry" -> street.geom, "properties" -> properties)
          }
          val featureCollection: JsObject = Json.obj("type" -> "FeatureCollection", "features" -> features)
          Ok(featureCollection)
        }(cpuEc)
  }

  /**
   * Get the list of labels submitted by the given user. Only include labels in the given region if supplied.
   */
  def getSubmittedLabels(userId: String, regionId: Option[Int]) =
    cc.securityService.SecuredAction(WithAdminOrIsUser(userId)) { implicit request =>
      logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
      authenticationService.findByUserId(userId).flatMap {
        case Some(user) => userService.getLabelLocations(userId, regionId).map(labels => Ok(labelsToGeoJson(labels)))
        case _          => Future.failed(new IdentityNotFoundException("Username not found."))
      }
    }

  /**
   * Public version of [[getSubmittedLabels]] for the public profile map, keyed by username and gated on the target's
   * `public_profile` flag (or the viewer being the owner). Returns 403 for a private profile or unknown user.
   *
   * @param username The mapper whose labels to return.
   */
  def getPublicSubmittedLabels(username: String) = cc.securityService.SecuredAction { implicit request =>
    userService.resolveVisibleUser(username, isOwner = request.identity.username == username).flatMap {
      case Some(uid) => userService.getLabelLocations(uid, None).map(labels => Ok(labelsToGeoJson(labels)))
      case None      => Future.successful(Forbidden(Json.obj("status" -> "private")))
    }
  }

  /**
   * Get up `n` recent mistakes for each label type, using validations provided by other users.
   * @param userId ID of the user whose mistakes we want to find.
   * @param n Number of mistakes to retrieve for each label type.
   * @return
   */
  def getRecentMistakes(userId: String, n: Int) = cc.securityService.SecuredAction(WithAdminOrIsUser(userId)) {
    implicit request =>
      logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
      authenticationService.findByUserId(userId).flatMap {
        case Some(user) =>
          val labelTypes: Set[LabelTypeEnum.Base] = LabelTypeEnum.primaryValidateLabelTypes
          labelService.getRecentValidatedLabelsForUser(userId, labelTypes, n).map { validations =>
            val validationJson = Json.toJson(labelTypes.map { labelType =>
              labelType.name -> validations(labelType).map { l =>
                val gsvImageUrl: Option[String] =
                  panoDataService.getImageUrl(l.panoId, l.panoSource, l.pov.heading, l.pov.pitch, l.pov.zoom)
                labelMetadataUserDashToJson(l, gsvImageUrl)
              }
            }.toMap)
            Ok(validationJson)
          }
        case _ => Future.failed(new IdentityNotFoundException("Username not found."))
      }
  }

  /**
   * Records the signed-in user's agree/contest vote on one of their own labels validated as incorrect (#2996): agree
   * it was a mistake, or contest it (claim it was correct). Only affects the user's own labels (the service verifies
   * ownership); once answered, the label drops off the dashboard's "recent mistakes". Instant — the dashboard card
   * commits on click, and the vote preserves any note already on the row.
   *
   * Expects a JSON body: `{ "label_id": Int, "agrees": Boolean }`.
   */
  def mistakeVote() = cc.securityService.SecuredAction(parse.json) { request =>
    val userId: String  = request.identity.userId
    val labelId: Int    = (request.body \ "label_id").as[Int]
    val agrees: Boolean = (request.body \ "agrees").as[Boolean]
    cc.loggingService.insert(userId, request.ipAddress, s"Click_module=MistakeVote_agrees=$agrees")
    labelService.recordMistakeVote(labelId, userId, agrees).map { recorded =>
      if (recorded) Ok(Json.obj("success" -> true)) else Forbidden(Json.obj("success" -> false))
    }
  }

  /**
   * Records (or clears) the user's note on one of their own labels validated as incorrect (#2996). Independent of the
   * vote — a note can stand alone, and saving one preserves any existing vote.
   */
  def mistakeNote() = cc.securityService.SecuredAction(parse.json) { request =>
    val userId: String          = request.identity.userId
    val labelId: Int            = (request.body \ "label_id").as[Int]
    val comment: Option[String] = (request.body \ "comment").asOpt[String].map(_.trim).filter(_.nonEmpty)
    cc.loggingService.insert(userId, request.ipAddress, "Click_module=MistakeNote")
    labelService.recordMistakeNote(labelId, userId, comment).map { recorded =>
      if (recorded) Ok(Json.obj("success" -> true)) else Forbidden(Json.obj("success" -> false))
    }
  }

  /**
   * Sets the team of the given user.
   */
  def setUserTeam(userId: String, teamId: Int) =
    cc.securityService.SecuredAction(WithAdminOrRegisteredAndIsUser(userId)) { implicit request =>
      cc.loggingService.insert(request.identity.userId, request.ipAddress, request.toString)
      userService
        .setUserTeam(userId, teamId)
        .map(_ => Ok(Json.obj("user_id" -> userId, "team_id" -> teamId)))
    }

  /**
   * Creates a team and puts it in the team table.
   */
  def createTeam() = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val user                = request.identity
    val name: String        = (request.body \ "name").as[String].trim
    val description: String = (request.body \ "description").asOpt[String].getOrElse("").trim

    def bad(msgKey: String) = Future.successful(BadRequest(Json.obj("success" -> false, "error" -> Messages(msgKey))))

    // Validate before inserting: signed-in only, sane lengths, and no abusive language in the public-facing name or
    // description (moderation; consolidate with the sign-up guard in #4375).
    if (user.role == "Anonymous")
      Future.successful(
        Forbidden(Json.obj("success" -> false, "error" -> Messages("dashboard.team.error.signin")))
      )
    else if (name.length < 2 || name.length > 50)
      bad("dashboard.team.error.name.length")
    else if (description.length > 300)
      bad("dashboard.team.error.desc.length")
    else if (!ProfanityGuard.isClean(name) || !ProfanityGuard.isClean(description))
      bad("dashboard.team.error.name.allowed")
    else {
      // Create the team and immediately join it, so creating a team is one seamless step.
      userService.createTeam(name, description).flatMap { teamId =>
        userService.setUserTeam(user.userId, teamId).map { _ =>
          cc.loggingService.insert(user.userId, request.ipAddress, "Click_module=CreateTeam")
          Ok(Json.obj("success" -> true, "team_id" -> teamId))
        }
      }
    }
  }

  /**
   * Grabs a list of all the teams in the tables, regardless of open or closed status.
   */
  def getTeams = Action.async { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    userService.getAllTeams.map(teams => Ok(Json.toJson(teams)))
  }

  /**
   * Gets some basic stats about the logged-in user that we show across the site: distance, label count, and accuracy.
   */
  def getBasicUserStats = cc.securityService.SecuredAction { implicit request =>
    val userId: String = request.identity.userId

    // Get distance audited by the user. Convert meters to km if using metric system, to miles if using IS.
    val auditedDistance: Future[Double] = userService
      .getDistanceAudited(userId)
      .map(auditedDistance => {
        if (Messages("measurement.system") == "metric") auditedDistance / 1000d
        else auditedDistance * METERS_TO_MILES
      })
    val labelCount: Future[Int]          = userService.countLabelsFromUser(userId)
    val missionCount: Future[Int]        = userService.countCompletedMissions(userId)
    val validationCount: Future[Int]     = userService.countValidations(userId)
    val accuracy: Future[Option[Double]] = userService.getUserAccuracy(userId)

    // Run in parallel and return the results as a JSON object.
    for {
      auditedDistance <- auditedDistance
      labelCount      <- labelCount
      missionCount    <- missionCount
      validationCount <- validationCount
      accuracy        <- accuracy
    } yield Ok(
      Json.obj(
        "distance_audited" -> auditedDistance,
        "label_count"      -> labelCount,
        "mission_count"    -> missionCount,
        "validation_count" -> validationCount,
        "accuracy"         -> accuracy
      )
    )
  }
}
