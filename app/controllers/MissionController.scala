package controllers

import javax.inject.Inject
import java.sql.Timestamp

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import org.joda.time.{DateTime, DateTimeZone}
import controllers.headers.ProvidesHeader
import formats.json.TaskSubmissionFormats.AMTAssignmentCompletionSubmission
import models.mission.{Mission, MissionTable}
import models.user.{User, UserCurrentRegionTable}
import models.amt.AMTAssignmentTable
import play.api.libs.json._
import play.api.mvc.{Action, BodyParsers}

import scala.concurrent.Future


class MissionController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  val payPerMile = 4.17

  /**
    * Return the completed missions in the user's current region in a JSON array.
    *
    * @return
    */
  def getMissionsInCurrentRegion() = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        // Get the missions for the currently assigned neighborhood.
        val userCurrentRegion: Option[Int] = UserCurrentRegionTable.currentRegion(user.userId)
        if (userCurrentRegion.isEmpty)
          println(s"problem with /neighborhoodMissions: user has no current region.")

        val completedMissions: List[Mission] =
          MissionTable.selectCompletedAuditMissionsByAUser(user.userId, userCurrentRegion.get, includeOnboarding = true)

        Future.successful(Ok(JsArray(completedMissions.map(_.toJSON))))

        // If the user doesn't already have an anonymous ID, sign them up and rerun.
      case _ => Future.successful(Redirect(s"/anonSignUp?url=/neighborhoodMissions"))
    }
  }

  /**
    * Return the completed missions in a JSON array.
    *
    * @return
    */
  def getCompletedMissions() = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val missions: List[Mission] = MissionTable.selectCompletedMissionsByAUser(user.userId, includeOnboarding = true)
        Future.successful(Ok(JsArray(missions.map(_.toJSON))))
      // If the user doesn't already have an anonymous ID, sign them up and rerun.
      case _ => Future.successful(Redirect(s"/anonSignUp?url=/completedMissions"))
    }
  }

  def postAMTAssignment = Action.async(BodyParsers.parse.json) { implicit request =>
    // Validation https://www.playframework.com/documentation/2.3.x/ScalaJson

    val submission = request.body.validate[AMTAssignmentCompletionSubmission]

    val now = new DateTime(DateTimeZone.UTC)
    val timestamp: Timestamp = new Timestamp(now.getMillis)

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {
        val amtAssignmentId: Option[Int] = Option(submission.assignmentId)
        amtAssignmentId match {
          case Some(asgId) =>
            // Update the AMTAssignmentTable
            AMTAssignmentTable.updateAssignmentEnd(asgId, timestamp)
            AMTAssignmentTable.updateCompleted(asgId, completed=true)
            Future.successful(Ok(Json.obj("success" -> true)))
          case None =>
            Future.successful(Ok(Json.obj("success" -> false)))
        }
      }
    )
  }

  def getRewardPerMile = Action.async { implicit request =>
    Future.successful(Ok(Json.obj("rewardPerMile" -> payPerMile)))
  }

}

