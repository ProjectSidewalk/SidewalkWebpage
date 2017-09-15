package controllers

import java.sql.Timestamp
import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import com.vividsolutions.jts.geom._
import controllers.headers.ProvidesHeader
import formats.json.IssueFormats._
import formats.json.SurveySubmissionFormats._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.survey._
import models.user._
import models.mission.MissionTable
import org.joda.time.{DateTime, DateTimeZone}
import play.api.libs.json._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.mvc._
import play.api.Play.current
import play.extras.geojson

import scala.concurrent.Future

/**
  * Audit controller
  */
class SurveyController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

  val anonymousUser: DBUser = UserTable.find("anonymous").get

  def postSurvey = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[SurveySubmission]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toFlatJson(errors))))
      },
      submission => {

        val userId: String = request.identity match {
          case Some(user) => user.userId.toString
          case None =>
            val user: Option[DBUser] = UserTable.find("anonymous")
            user.get.userId.toString
        }

        val ipAddress: String = request.remoteAddress
        val now = new DateTime(DateTimeZone.UTC)
        val timestamp: Timestamp = new Timestamp(now.toInstant.getMillis)
        val numMissionsCompleted: Int = MissionTable.countCompletedMissionsByUserId(UUID.fromString(userId))

        val allSurveyQuestions = SurveyQuestionTable.listAll
        val allSurveyQuestionIds = allSurveyQuestions.map(_.surveyQuestionId)
        val answeredQuestions = submission.answeredQuestions
        val answeredQuestionIds = submission.answeredQuestions.map(_.surveyQuestionId.toInt)
        val unansweredQuestionIds = allSurveyQuestionIds diff answeredQuestionIds
        // Iterate over all the questions and check if there is a submission attribute matching question id.
        // Add the associated submission to the user_submission tables for that question


        answeredQuestions.foreach{ q =>
          val questionId = q.surveyQuestionId.toInt
          val temp_question = SurveyQuestionTable.getQuestionById(questionId)
          temp_question match{
            case Some(question) =>
              if (question.surveyInputType != "free-text-feedback") {
                val userSurveyOptionSubmission = UserSurveyOptionSubmission(0, userId, question.surveyQuestionId, Some(q.answerText.toInt), timestamp, numMissionsCompleted)
                val userSurveyOptionSubmissionId: Int = UserSurveyOptionSubmissionTable.save(userSurveyOptionSubmission)
              }
              else {
                val userSurveyTextSubmission = UserSurveyTextSubmission(0, userId, question.surveyQuestionId, Some(q.answerText), timestamp, numMissionsCompleted)
                val userSurveyTextSubmissionId: Int = UserSurveyTextSubmissionTable.save(userSurveyTextSubmission)
              }
            case None =>
              None
          }
        }
        unansweredQuestionIds.foreach{ questionId =>
          val temp_question = SurveyQuestionTable.getQuestionById(questionId)
          temp_question match{
            case Some(question)=>
              if(question.surveyInputType != "free-text-feedback"){
                val userSurveyOptionSubmission = UserSurveyOptionSubmission(0, userId, question.surveyQuestionId, None, timestamp, numMissionsCompleted)
                val userSurveyOptionSubmissionId: Int = UserSurveyOptionSubmissionTable.save(userSurveyOptionSubmission)
              }
              else{
                val userSurveyTextSubmission = UserSurveyTextSubmission(0, userId, question.surveyQuestionId, None, timestamp, numMissionsCompleted)
                val userSurveyTextSubmissionId: Int = UserSurveyTextSubmissionTable.save(userSurveyTextSubmission)
              }
            case None =>
              None
          }
        }

        Future.successful(Ok(Json.obj("survey_success" -> "True")))
      }
    )

  }

  def shouldDisplaySurvey = UserAwareAction.async { implicit request =>
    val userId: UUID = request.identity match {
      case Some(user) => user.userId
      case None =>
        val user: Option[DBUser] = UserTable.find("anonymous")
        UUID.fromString(user.get.userId)
    }
    val userRoles = UserRoleTable.getRoles(userId)

    val numMissionsBeforeSurvey = 2
    val userRoleForSurvey = "Turker"

    val displaySurvey = userRoles.contains(userRoleForSurvey) //&& MissionTable.countCompletedMissionsByUserId(userId) == numMissionsBeforeSurvey
    Future.successful(Ok(Json.obj("displayModal" -> displaySurvey)))

  }

}