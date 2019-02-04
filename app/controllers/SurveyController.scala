package controllers

import java.sql.Timestamp
import java.time.Instant
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
import play.api.Logger
import play.api.libs.json._
import play.api.mvc._

import scala.collection.immutable.Seq
import scala.concurrent.Future

import scala.concurrent.ExecutionContext.Implicits.global

/**
  * Survey controller
  */
class SurveyController @Inject() (implicit val env: Environment[User, SessionAuthenticator])
  extends Silhouette[User, SessionAuthenticator] with ProvidesHeader {

//  val anonymousUser: DBUser = UserTable.find("anonymous").get //FIXME

  def postSurvey = UserAwareAction.async(BodyParsers.parse.json) { implicit request =>
    var submission = request.body.validate[Seq[SurveySingleSubmission]]

    submission.fold(
      errors => {
        Future.successful(BadRequest(Json.obj("status" -> "Error", "message" -> JsError.toJson(errors))))
      },
      submission => {

        (request.identity match {
          case Some(user) => Future.successful(user.userId.toString)
          case None =>
            Logger.warn("User without a user_id completed a survey, but every user should have a user_id.")
            UserTable.find("anonymous")
              .map(_.get.userId.toString)
        }).flatMap { userId =>
          val timestamp: Timestamp = new Timestamp(Instant.now.toEpochMilli)

          //this will log when a user submits a survey response
          val ipAddress: String = request.remoteAddress
          WebpageActivityTable.save(WebpageActivity(0, userId.toString, ipAddress, "SurveySubmit", timestamp))

          val allSurveyQuestions = SurveyQuestionTable.listAll
          val allSurveyQuestionIds = allSurveyQuestions.map(_.map(_.surveyQuestionId))
          val answeredQuestionIds = submission.map(_.surveyQuestionId.toInt)
          val unansweredQuestionIds = allSurveyQuestionIds.map(_ diff answeredQuestionIds)
          // Iterate over all the questions and check if there is a submission attribute matching question id.
          // Add the associated submission to the user_submission tables for that question

          MissionTable.countCompletedMissionsByUserId(UUID.fromString(userId), includeOnboarding = false).flatMap {
            numMissionsCompleted =>
              val submissionSaves = submission.map { q =>
                val questionId = q.surveyQuestionId.toInt
                val temp_question = SurveyQuestionTable.getQuestionById(questionId)
                temp_question.flatMap {
                  case Some(question) =>
                    if (question.surveyInputType != "free-text-feedback") {
                      val userSurveyOptionSubmission = UserSurveyOptionSubmission(0, userId, question.surveyQuestionId, Some(q.answerText.toInt), timestamp, numMissionsCompleted)
                      UserSurveyOptionSubmissionTable.save(userSurveyOptionSubmission)
                    }
                    else {
                      val userSurveyTextSubmission = UserSurveyTextSubmission(0, userId, question.surveyQuestionId, Some(q.answerText), timestamp, numMissionsCompleted)
                      UserSurveyTextSubmissionTable.save(userSurveyTextSubmission)
                    }
                  case None => Future.successful(0)
                }
              }
              val unansweredQuestionSaves = unansweredQuestionIds.flatMap { questionIds =>
                val userSurveySaves = questionIds.map { questionId =>
                  val temp_question = SurveyQuestionTable.getQuestionById(questionId)
                  temp_question.flatMap {
                    case Some(question)=>
                      if(question.surveyInputType != "free-text-feedback"){
                        val userSurveyOptionSubmission = UserSurveyOptionSubmission(0, userId, question.surveyQuestionId, None, timestamp, numMissionsCompleted)
                        UserSurveyOptionSubmissionTable.save(userSurveyOptionSubmission)
                      }
                      else {
                        val userSurveyTextSubmission = UserSurveyTextSubmission(0, userId, question.surveyQuestionId, None, timestamp, numMissionsCompleted)
                        UserSurveyTextSubmissionTable.save(userSurveyTextSubmission)
                      }
                    case None => Future.successful(0)
                  }
                }
                Future.sequence(userSurveySaves)
              }

              for {
                _ <- Future.sequence(submissionSaves)
                _ <- unansweredQuestionSaves
              } yield {
                Ok(Json.obj("survey_success" -> "True"))
              }
          }
        }
      }
    )

  }

  def shouldDisplaySurvey = UserAwareAction.async { implicit request =>
    request.identity match {
      case Some(user) =>
        val userId: UUID = user.userId

        for {
          userRole <- UserRoleTable.getRole(userId)
          missionCount <- MissionTable.countCompletedMissionsByUserId(userId, includeOnboarding = false)
        } yield {
          val numMissionsBeforeSurvey = 1
          // The survey should show after the user completes their first non-tutorial mission. NOTE the number of missions
          // before survey is actually 2, but this check is done before the next mission is updated on the back-end.
          val displaySurvey: Boolean = (missionCount == numMissionsBeforeSurvey)
          Ok(Json.obj("displayModal" -> displaySurvey))
        }
      case None => Future.successful(Redirect(s"/anonSignUp?url=/survey/display"))
    }
  }
}