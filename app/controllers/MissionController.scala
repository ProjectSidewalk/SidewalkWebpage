package controllers

import javax.inject.{Inject, Singleton}
import play.silhouette.api.Silhouette
import models.auth.DefaultEnv
import controllers.base._
import formats.json.MissionFormats._
import formats.json.TaskSubmissionFormats.AMTAssignmentCompletionSubmission
import models.mission.{Mission, MissionTable}
import models.user.{SidewalkUserWithRole, UserCurrentRegionTable}
import models.amt.AMTAssignmentTable
import play.api.libs.json._
import play.api.mvc.{Action, BodyParsers}

import scala.concurrent.ExecutionContext

@Singleton
class MissionController @Inject() (cc: CustomControllerComponents,
                                   val silhouette: Silhouette[DefaultEnv],
                                   missionService: service.MissionService,
                                  )(implicit ec: ExecutionContext) extends CustomBaseController(cc) {

  /**
    * Return the completed missions in the user's current region in a JSON array.
    */
  def getMissionsInCurrentRegion() = cc.securityService.SecuredAction { implicit request =>
    missionService.getMissionsInCurrentRegion(request.identity.userId)
      .map(missions => Ok(JsArray(missions.map(Json.toJson(_)))))
  }

  /**
    * Return the total reward earned by the user.
    */
//  def getTotalRewardEarned() = cc.securityService.SecuredAction { implicit request =>
//    request.identity match {
//      case Some(user) => Future.successful(Ok(Json.obj("reward_earned" -> MissionTable.totalRewardEarned(user.userId))))
//      case _ => Future.successful(Redirect(s"/anonSignUp?url=/rewardEarned"))
//    }
//  }

  /**
   * Update completion of assignment for turkers.
   */
//  def postAMTAssignment = Action.async(parse.json) { implicit request =>
//    // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson
//
//    val submission = request.body.validate[AMTAssignmentCompletionSubmission]
//
//    submission.fold(
//      errors => {
//        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
//      },
//      submission => {
//        val amtAssignmentId: Option[Int] = Option(submission.assignmentId)
//        amtAssignmentId match {
//          case Some(asgId) =>
//            // Update the AMTAssignmentTable
//            AMTAssignmentTable.updateCompleted(asgId, completed=true)
//            Future.successful(Ok(Json.obj("success" -> true)))
//          case None =>
//            Future.successful(Ok(Json.obj("success" -> false)))
//        }
//      }
//    )
//  }
}
