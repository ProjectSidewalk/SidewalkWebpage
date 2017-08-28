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

        val allSurveyQuestions = SurveyQuestionTable.listAll
        // Iterate over all the questions and check if there is a submission attribute matching question id.
        // Add the associated submission to the user_submission tables for that question
        allSurveyQuestions.forEach{ question =>
          val questionIdString = question.surveyQuestionId.toString
          if(submission.contains(questionIdString)){
            if(question.surveyInputType != "free-text-feedback"){
              for(value <- submission(questionIdString)){
                val userOptionSubmission = UserOptionSubmission(0, userId, question.surveyQuestionId, value, timestamp)
                val userOptionSubmissionId: Int = UserOptionSubmissionTable.save(userOptionSubmission)
              }
            }
            else{
              val userTextSubmission = UserTextSubmission(0, userId, question.surveyQuestionId, submission(questionIdString), timestamp)
              val userTextSubmissionId: Int = UserTextSubmissionTable.save(userTextSubmission)
            }
          }
          else{
            if(question.surveyInputType != "free-text-feedback"){
              val userOptionSubmission = UserOptionSubmission(0, userId, question.surveyQuestionId, None, timestamp)
              val userOptionSubmissionId: Int = UserOptionSubmissionTable.save(userOptionSubmission)
            }
            else{
              val userTextSubmission = UserTextSubmission(0, userId, question.surveyQuestionId, None, timestamp)
              val userTextSubmissionId: Int = UserTextSubmissionTable.save(userTextSubmission)
            }
          }
        }
        Future.successful(Ok(Json.obj("survey_success" -> "True")))
      }
    )

  }

}