package controllers

import javax.inject.{Inject, Singleton}
import play.silhouette.api.Silhouette
import models.auth.DefaultEnv
import controllers.base._
import org.locationtech.jts.geom._
import formats.json.TaskSubmissionFormats._
import formats.json.TaskFormats._
import formats.json.MissionFormats._
import models.user.RoleTable
import service.ExploreTaskPostReturnValue
import java.time.OffsetDateTime
import scala.concurrent.ExecutionContext
import models.audit._
import models.street.StreetEdgeIssue
import models.user.SidewalkUserWithRole
import play.api.libs.json._
import play.api.mvc._

import scala.concurrent.Future

@Singleton
class TaskController @Inject() (cc: CustomControllerComponents,
                                val silhouette: Silhouette[DefaultEnv],
                                config: play.api.Configuration,
                                configService: service.ConfigService,
                                exploreService: service.ExploreService
                               )(implicit ec: ExecutionContext) extends CustomBaseController(cc) {

  val gf: GeometryFactory = new GeometryFactory(new PrecisionModel(), 4326)

  /**
   * This method handles a POST request in which user reports a missing Street View image.
   */
  def postNoStreetView = cc.securityService.SecuredAction(parse.json) { implicit request =>
    val submission = request.body.validate[Int]
    submission.fold(
      errors => { Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors)))) },
      streetEdgeId => {
        println("Posting no GSV for street edge " + streetEdgeId)
        exploreService.insertNoGSV(StreetEdgeIssue(
          0, streetEdgeId, "GSVNotAvailable", request.identity.userId, request.remoteAddress, OffsetDateTime.now
        )).map(_ => Ok)
      }
    )
  }

  /**
   * Get the audit tasks in the given region for the signed-in user.
   */
  def getTasksInARegion(regionId: Int) = cc.securityService.SecuredAction { implicit request =>
    exploreService.selectTasksInARegion(regionId, request.identity.userId)
      .map(tasks => Ok(Json.obj("type" -> "FeatureCollection", "features" -> JsArray(tasks.map(Json.toJson(_))))))
  }

  def getTasksInARoute(userRouteId: Int) = Action.async { implicit request =>
    exploreService.selectTasksInRoute(userRouteId).map(tasks => Ok(JsArray(tasks.map(Json.toJson(_)))))
  }

  /**
    * Parse JSON data sent as plain text, convert it to JSON, and process it as JSON.
    */
  def postBeacon = silhouette.UserAwareAction.async(parse.text) { implicit request =>
    val json: JsValue = Json.parse(request.body)
    val submission: JsResult[AuditTaskSubmission] = json.validate[AuditTaskSubmission]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        request.identity match {
          case Some(user) => processAuditTaskSubmissions(submission, request.remoteAddress, user)
          case None => Future.successful(Unauthorized(Json.obj("status" -> "Error", "message" -> "User not logged in.")))
        }
      }
    )
  }

  /**
   * Parse the submitted data and insert them into tables.
   */
  def post = silhouette.UserAwareAction.async(parse.json) { implicit request =>
    val submission: JsResult[AuditTaskSubmission] = request.body.validate[AuditTaskSubmission]
    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {
        request.identity match {
          case Some(user) => processAuditTaskSubmissions(submission, request.remoteAddress, user)
          case None => Future.successful(Unauthorized(Json.obj("status" -> "Error", "message" -> "User not logged in.")))
        }
      }
    )
  }

  /**
   * Helper function that updates database with all data submitted through the explore page.
   */
  def processAuditTaskSubmissions(data: AuditTaskSubmission, ipAddress: String, user: SidewalkUserWithRole) = {
    val missionId: Int = data.missionProgress.missionId
    val currTime: OffsetDateTime = data.timestamp

    // First do all the important stuff that needs to be done synchronously.
    val response: Future[Result] = exploreService.submitExploreData(data, user.userId).map { returnData: ExploreTaskPostReturnValue =>
      // Now we do all the stuff that can be done async, we can return the response before these are done.
      // TODO we should catch any errors from these submissions and log them.

      // Insert GSV metadata async.
      // TODO would make sense to do this before submitting labels, then label table can have foreign key on pano_id.
      exploreService.savePanoInfo(data.gsvPanoramas)

      // Insert environment async.
      val env: EnvironmentSubmission = data.environment
      exploreService.insertEnvironment(AuditTaskEnvironment(0, returnData.auditTaskId, missionId, env.browser, env.browserVersion,
        env.browserWidth, env.browserHeight, env.availWidth, env.availHeight, env.screenWidth, env.screenHeight,
        env.operatingSystem, Some(ipAddress), env.language, env.cssZoom, Some(currTime)))

      // Insert interactions async, send time spent auditing to scistarter (which uses the interactions table).
      exploreService.insertMultipleInteractions(data.interactions.map { interaction =>
        AuditTaskInteraction(0, returnData.auditTaskId, missionId, interaction.action, interaction.gsvPanoramaId,
          interaction.lat, interaction.lng, interaction.heading, interaction.pitch, interaction.zoom, interaction.note,
          interaction.temporaryLabelId, interaction.timestamp)
      }).map { _ =>
        // Send contributions to SciStarter async so that it can be recorded in their user dashboard there.
        val eligibleUser: Boolean = RoleTable.SCISTARTER_ROLES.contains(user.role)
        if (returnData.newLabels.nonEmpty && config.get[String]("environment-type") == "prod" && eligibleUser) {
          val scistarterResponse: Future[Int] =
            exploreService.secondsSpentAuditing(user.userId, returnData.newLabels.map(_._1).min, returnData.newLabels.map(_._3).max)
              .flatMap { timeSpent: Float =>
                configService.sendSciStarterContributions(user.email, returnData.newLabels.length, timeSpent)
              }
        }
      }

      // Return the final result.
      Ok(Json.obj(
        "audit_task_id" -> returnData.auditTaskId,
        "street_edge_id" -> data.auditTask.streetEdgeId,
        "mission" -> returnData.mission.map(Json.toJson(_)),
        "label_ids" -> returnData.newLabels.map(l => Json.obj("label_id" -> l._1, "temporary_label_id" -> l._2)),
        "updated_streets" -> returnData.updatedStreets.map(Json.toJson(_)),
        "refresh_page" -> returnData.refreshPage // If we notice something out of whack, tell front-end to refresh.
      ))
    }
    response
  }
}
