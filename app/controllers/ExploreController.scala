package controllers

import controllers.base._
import controllers.helper.ControllerUtils.{isAdmin, isMobile}
import formats.json.CommentSubmissionFormats._
import formats.json.ExploreFormats._
import formats.json.MissionFormats._
import models.audit._
import models.auth.DefaultEnv
import models.label.LabelTypeEnum
import models.mission.MissionType
import models.pano.PanoSource
import models.street.{StreetEdgeIssue, StreetEdgeIssueType}
import models.user._
import play.api.libs.json._
import play.api.mvc.Result
import play.api.{Configuration, Logger}
import play.silhouette.api.Silhouette
import service.ExploreTaskPostReturnValue

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

@Singleton
class ExploreController @Inject() (
    cc: CustomControllerComponents,
    val silhouette: Silhouette[DefaultEnv],
    val config: Configuration,
    configService: service.ConfigService,
    exploreService: service.ExploreService,
    missionService: service.MissionService,
    aiService: service.AiService
)(implicit ec: ExecutionContext, assets: AssetsFinder)
    extends CustomBaseController(cc) {

  implicit val implicitConfig: Configuration = config
  private val logger                         = Logger(this.getClass)

  /**
   * Returns an explore page.
   */
  def explore(
      newRegion: Boolean,
      retakeTutorial: Option[Boolean],
      routeId: Option[Int],
      resumeRoute: Boolean,
      regionId: Option[Int],
      streetEdgeId: Option[Int],
      lat: Option[Double],
      lng: Option[Double],
      panoId: Option[String]
  ) = cc.securityService.SecuredAction { implicit request =>
    val user: SidewalkUserWithRole = request.identity
    val pageTitle: String          = "Sidewalk - Explore"

    // Labeling isn't supported on phones/tablets, so send mobile users to the mobile landing page instead.
    if (isMobile(request)) {
      cc.loggingService.insert(user.userId, request.ipAddress, "Visit_Audit_RedirectMobileLanding")
      Future.successful(Redirect("/mobileLanding"))
    } else {
      // NOTE: precedence is routeId, then streetEdgeId, then regionId, then lat/lng (an address drop-in, #4451).
      for {
        exploreData <- (routeId, streetEdgeId, regionId, lat, lng) match {
          case (Some(routeId), _, _, _, _) =>
            exploreService.getDataForExplorePage(user.userId, retakeTutorial.getOrElse(false), newRegion = false,
              Some(routeId), resumeRoute, regionId = None, streetEdgeId = None)
          case (_, Some(streetEdgeId), _, _, _) =>
            exploreService.getDataForExplorePage(user.userId, retakingTutorial = false, newRegion = false,
              routeId = None, resumeRoute = false, regionId = None, Some(streetEdgeId))
          case (_, _, Some(regionId), _, _) =>
            exploreService.getDataForExplorePage(user.userId, retakeTutorial.getOrElse(false), newRegion = false,
              routeId = None, resumeRoute = resumeRoute, Some(regionId), streetEdgeId = None)
          case (_, _, _, Some(lt), Some(lg)) =>
            // Free exploration at a searched address under an exploreAddress mission (#4451); falls back to the
            // normal flow when no street is close enough to the requested point.
            exploreService.getDataForExploreAddressPage(user.userId, lt, lg).flatMap {
              case Some(exploreAddressData) => Future.successful(exploreAddressData)
              case None                     =>
                exploreService.getDataForExplorePage(user.userId, retakeTutorial.getOrElse(false), newRegion,
                  routeId = None, resumeRoute, regionId = None, streetEdgeId = None)
            }
          case _ =>
            exploreService.getDataForExplorePage(user.userId, retakeTutorial.getOrElse(false), newRegion,
              routeId = None, resumeRoute, regionId = None, streetEdgeId = None)
        }
        commonData <- configService.getCommonPageData(request2Messages.lang)
      } yield {
        val isExploreAddress: Boolean =
          exploreData.mission.missionType == MissionType.ExploreAddress

        // Log visit to the Explore page.
        val activityStr: String =
          if (exploreData.userRoute.isDefined) s"Visit_Audit_RouteId=${exploreData.userRoute.get.routeId}"
          else if (streetEdgeId.isDefined) s"Visit_Audit_StreetEdgeId=${streetEdgeId.get}"
          else if (regionId.isDefined) s"Visit_Audit_RegionId=${regionId.get}"
          else if (isExploreAddress) s"Visit_Audit_ExploreAddress_Lat=${lat.get}_Lng=${lng.get}"
          else if (newRegion) "Visit_Audit_NewRegionSelected"
          else "Visit_Audit"
        cc.loggingService.insert(user.userId, request.ipAddress, activityStr)

        // Load the Explore page. The match statement below just passes along any extra params. The pano is seeded at
        // panoId or lat/lng for an admin exploring a specific street, or at lat/lng for an address drop-in (any user).
        (streetEdgeId, isAdmin(user), panoId, lat, lng) match {
          case (Some(s), true, Some(p), _, _) =>
            Ok(views.html.apps.explore(commonData, pageTitle, user, exploreData, None, None, Some(p)))
          case (Some(s), true, _, Some(lt), Some(lg)) =>
            Ok(views.html.apps.explore(commonData, pageTitle, user, exploreData, Some(lt), Some(lg)))
          case (None, _, _, Some(lt), Some(lg)) if isExploreAddress =>
            Ok(views.html.apps.explore(commonData, pageTitle, user, exploreData, Some(lt), Some(lg)))
          case _ => Ok(views.html.apps.explore(commonData, pageTitle, user, exploreData))
        }
      }
    }
  }

  /**
   * This method handles a comment POST request. It parses the comment and inserts it into the comment table.
   */
  def postComment = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[CommentSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      data => {
        exploreService
          .insertComment(
            AuditTaskComment(0, data.auditTaskId, data.missionId, data.streetEdgeId, request.identity.userId,
              request.ipAddress, data.panoId, data.heading, data.pitch, data.zoom, data.lat, data.lng,
              OffsetDateTime.now, data.comment)
          )
          .map { commentId: Int => Ok(Json.obj("comment_id" -> commentId)) }
      }
    )
  }

  /**
   * Determine whether a survey should be shown to the signed-in user.
   */
  def shouldDisplaySurvey = cc.securityService.SecuredAction { implicit request =>
    exploreService
      .shouldDisplaySurvey(request.identity.userId)
      .map(displaySurvey => Ok(Json.obj("displayModal" -> displaySurvey)))
  }

  /**
   * Submit the data associated with a completed survey.
   */
  def postSurvey = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[Seq[SurveySingleSubmission]]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      data => {
        exploreService.submitSurvey(request.identity.userId, request.ipAddress, data).map { _ =>
          cc.loggingService.insert(request.identity.userId, request.ipAddress, "SurveySubmit")
          Ok(Json.obj("survey_success" -> "True"))
        }
      }
    )
  }

  /**
   * Return the completed missions in the user's current region in a JSON array.
   */
  def getUserMissionsInRegion(regionId: Int) = cc.securityService.SecuredAction { implicit request =>
    missionService
      .getUserMissionsInRegion(request.identity.userId, regionId)
      .map(missions => Ok(JsArray(missions.map(Json.toJson(_)))))
  }

  /**
   * This method handles a POST request in which user reports missing imagery.
   */
  def postNoImagery = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[NoStreetViewSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      noSv => {
        exploreService
          .insertNoImagery(
            noSv.task,
            StreetEdgeIssue(0, noSv.task.streetEdgeId, StreetEdgeIssueType.PanoNotAvailable, request.identity.userId,
              request.ipAddress, OffsetDateTime.now),
            noSv.missionId
          )
          .map(_ => Ok(Json.obj("success" -> noSv.task.streetEdgeId)))
      }
    )
  }

  /**
   * Get the audit tasks in the given region for the signed-in user.
   */
  def getTasksInARegion(regionId: Int) = cc.securityService.SecuredAction { implicit request =>
    exploreService
      .selectTasksInARegion(regionId, request.identity.userId)
      .map(tasks => Ok(Json.obj("type" -> "FeatureCollection", "features" -> JsArray(tasks.map(Json.toJson(_))))))
  }

  def getTasksInARoute(userRouteId: Int) = Action.async { implicit request =>
    logger.debug(request.toString) // Added bc scalafmt doesn't like "implicit _" & compiler needs us to use request.
    exploreService
      .selectTasksInRoute(userRouteId)
      .map(tasks => Ok(Json.obj("type" -> "FeatureCollection", "features" -> JsArray(tasks.map(Json.toJson(_))))))
  }

  /**
   * Parse the submitted data and insert them into tables.
   */
  def post = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[AuditTaskSubmission]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      submission => { processAuditTaskSubmissions(submission, request.ipAddress, request.identity) }
    )
  }

  /**
   * Helper function that updates database with all data submitted through the explore page.
   */
  private def processAuditTaskSubmissions(
      data: AuditTaskSubmission,
      ipAddress: String,
      user: SidewalkUserWithRole
  ): Future[Result] = {
    val missionId: Int           = data.missionProgress.missionId
    val currTime: OffsetDateTime = data.timestamp

    // First do all the important stuff that needs to be done synchronously.
    val response: Future[Result] =
      exploreService.submitExploreData(data, user.userId).map { returnData: ExploreTaskPostReturnValue =>
        // Now we do all the stuff that can be done async, we can return the response before these are done.
        // TODO we should catch any errors from these submissions and log them.

        // Insert pano metadata async.
        // TODO would make sense to do this before submitting labels, then label table can have foreign key on pano_id.
        exploreService.savePanoInfo(data.panos)

        // Insert environment async.
        val env: EnvironmentSubmission = data.environment
        exploreService.insertEnvironment(
          AuditTaskEnvironment(0, returnData.auditTaskId, missionId, env.browser, env.browserVersion, env.browserWidth,
            env.browserHeight, env.availWidth, env.availHeight, env.screenWidth, env.screenHeight, env.operatingSystem,
            Some(ipAddress), env.language, env.cssZoom, Some(currTime))
        )

        // Insert interactions async, send time spent auditing to scistarter (which uses the interactions table).
        exploreService
          .insertMultipleInteractions(data.interactions.map { interaction =>
            AuditTaskInteraction(0, returnData.auditTaskId, missionId, interaction.action, interaction.panoId,
              interaction.lat, interaction.lng, interaction.heading, interaction.pitch, interaction.zoom,
              interaction.note, interaction.temporaryLabelId, interaction.timestamp)
          })
          .map { _ =>
            // Send labels to SidewalkAI API for AI validation. Only available for some label types and imagery sources.
            val labelsToSend = returnData.newLabels.filter { l =>
              LabelTypeEnum.aiLabelTypes.contains(l.labelType) && l.panoSource == PanoSource.Gsv && !l.tutorial
            }
            aiService
              .validateLabelsWithAi(labelsToSend.map(_.labelId))
              .onComplete {
                case Success(_) => if (labelsToSend.nonEmpty) logger.info(s"AI validation(s) completed successfully.")
                case Failure(e) => logger.error("Error occurred when submitting AI validations:", e)
              }

            // Send contributions to SciStarter async so that it can be recorded in their user dashboard there.
            val eligibleUser: Boolean = RoleTable.SCISTARTER_ROLES.contains(user.role)
            if (returnData.newLabels.nonEmpty && config.get[String]("environment-type") == "prod" && eligibleUser) {
              exploreService
                .secondsSpentAuditing(
                  user.userId,
                  returnData.newLabels.map(_.labelId).min,
                  returnData.newLabels.map(_.timeCreated).max
                )
                .flatMap { timeSpent: Double =>
                  configService.sendSciStarterContributions(user.email, returnData.newLabels.length, timeSpent)
                }
            }
          }

        // Return the final result.
        Ok(
          Json.obj(
            "audit_task_id"  -> returnData.auditTaskId,
            "street_edge_id" -> data.auditTask.streetEdgeId,
            "mission"        -> returnData.mission.map(Json.toJson(_)),
            "label_ids"      -> returnData.newLabels
              .map(l => Json.obj("label_id" -> l.labelId, "temporary_label_id" -> l.temporaryLabelId)),
            "updated_streets" -> returnData.updatedStreets.map(Json.toJson(_)),
            "refresh_page" -> returnData.refreshPage // If we notice something out of whack, tell front-end to refresh.
          )
        )
      }
    response
  }
}
