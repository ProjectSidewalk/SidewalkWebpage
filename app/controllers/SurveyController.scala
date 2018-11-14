package controllers

import java.sql.Timestamp
import java.util.UUID
import javax.inject.Inject

import com.mohiva.play.silhouette.api.{Environment, Silhouette}
import com.mohiva.play.silhouette.impl.authenticators.SessionAuthenticator
import controllers.headers.ProvidesHeader
import formats.json.SurveySubmissionFormats._
import models.daos.slickdaos.DBTableDefinitions.{DBUser, UserTable}
import models.survey._
import models.user._
import models.mission.MissionTable
import org.joda.time.{DateTime, DateTimeZone}
import play.api.Logger
import play.api.libs.json._
import play.api.mvc._
//import play.api.Play.current
//import play.api.i18n.Messages.Implicits._
import play.api.i18n.{I18nSupport, MessagesApi}

import scala.collection.immutable.Seq
import scala.concurrent.Future

/**
  * Survey controller
  */
class SurveyController @Inject() (implicit val env: Environment[User, SessionAuthenticator], val messagesApi: MessagesApi)
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader with I18nSupport {

  val anonymousUser: DBUser = UserTable.find("anonymous").get

  def postSurvey = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[Seq[SurveySingleSubmission]]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {

        val userId: String = request.identity match {
          case Some(user) => user.userId.toString
          case None =>
            Logger.warn("User without a user_id completed a survey, but every user should have a user_id.")
            val user: Option[DBUser] = UserTable.find("anonymous")
            user.get.userId.toString
        }

        val now = new DateTime(DateTimeZone.UTC)
        val timestamp: Timestamp = new Timestamp(now.toInstant.getMillis)
        val numMissionsCompleted: Int = MissionTable.countCompletedMissionsByUserId(UUID.fromString(userId), includeOnboarding = false)

        val allSurveyQuestions = SurveyQuestionTable.listAll
        val allSurveyQuestionIds = allSurveyQuestions.map(_.surveyQuestionId)
        val answeredQuestionIds = submission.map(_.surveyQuestionId.toInt)
        val unansweredQuestionIds = allSurveyQuestionIds diff answeredQuestionIds
        // Iterate over all the questions and check if there is a submission attribute matching question id.
        // Add the associated submission to the user_submission tables for that question


        submission.foreach{ q =>
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
    request.identity match {
      case Some(user) =>
        val userId: UUID = user.userId
        val userRole: String = UserRoleTable.getRole(userId)

        // NOTE the number of missions before survey is actually 3, but this check is done before the next mission is
        // updated on the back-end.
        val numMissionsBeforeSurvey = 1
        val userRoleForSurvey = "Turker"

        val displaySurvey = userRole == userRoleForSurvey && MissionTable.countCompletedMissionsByUserId(userId, includeOnboarding = false) == numMissionsBeforeSurvey
        Future.successful(Ok(Json.obj("displayModal" -> displaySurvey)))

      case None => Future.successful(Redirect(s"/anonSignUp?url=/survey/display"))
    }
  }
}