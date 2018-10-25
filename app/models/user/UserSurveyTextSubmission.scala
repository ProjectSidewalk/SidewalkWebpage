package models.user

import models.utils.MyPostgresDriver.api._
import play.api.Play.current
import java.sql.Timestamp
import models.survey._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

case class UserSurveyTextSubmission(userSurveyTextSubmissionId: Int, userId: String, surveyQuestionId: Int, surveyTextSubmission: Option[String], timeSubmitted: Timestamp, numMissionsCompleted: Int)

class UserSurveyTextSubmissionTable(tag: Tag) extends Table[UserSurveyTextSubmission](tag, Some("sidewalk"), "user_survey_text_submission") {
  def userSurveyTextSubmissionId = column[Int]("user_survey_text_submission_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id")
  def surveyQuestionId = column[Int]("survey_question_id")
  def surveyTextSubmission = column[Option[String]]("survey_text_submission")
  def timeSubmitted = column[Timestamp]("time_submitted")
  def numMissionsCompleted = column[Int]("num_missions_completed")

  def * = (userSurveyTextSubmissionId, userId, surveyQuestionId, surveyTextSubmission, timeSubmitted, numMissionsCompleted) <> ((UserSurveyTextSubmission.apply _).tupled, UserSurveyTextSubmission.unapply)

  def user = foreignKey("user_survey_text_submission_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
  def survey_question = foreignKey("user_survey_text_submission_survey_question_id_fkey", surveyQuestionId, TableQuery[SurveyQuestionTable])(_.surveyQuestionId)
}

object UserSurveyTextSubmissionTable{
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val userSurveyTextSubmissions = TableQuery[UserSurveyTextSubmissionTable]

  def save(userSurveyTextSubmission: UserSurveyTextSubmission): Int = db.withTransaction { implicit session =>
    val userSurveyTextSubmissionId: Int =
      (userSurveyTextSubmissions returning userSurveyTextSubmissions.map(_.userSurveyTextSubmissionId)) += userSurveyTextSubmission
    userSurveyTextSubmissionId
  }
}