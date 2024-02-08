package models.user

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import java.sql.Timestamp
import models.survey._
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import scala.slick.lifted.ForeignKeyQuery

case class UserSurveyTextSubmission(userSurveyTextSubmissionId: Int, userId: String, surveyQuestionId: Int, surveyTextSubmission: Option[String], timeSubmitted: Timestamp, numMissionsCompleted: Int)

class UserSurveyTextSubmissionTable(tag: Tag) extends Table[UserSurveyTextSubmission](tag, "user_survey_text_submission") {
  def userSurveyTextSubmissionId = column[Int]("user_survey_text_submission_id", O.PrimaryKey, O.AutoInc)
  def userId = column[String]("user_id", O.NotNull)
  def surveyQuestionId = column[Int]("survey_question_id", O.NotNull)
  def surveyTextSubmission = column[Option[String]]("survey_text_submission", O.Nullable)
  def timeSubmitted = column[Timestamp]("time_submitted", O.Nullable)
  def numMissionsCompleted = column[Int]("num_missions_completed", O.NotNull)

  def * = (userSurveyTextSubmissionId, userId, surveyQuestionId, surveyTextSubmission, timeSubmitted, numMissionsCompleted) <> ((UserSurveyTextSubmission.apply _).tupled, UserSurveyTextSubmission.unapply)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("user_survey_text_submission_user_id_fkey", userId, TableQuery[UserTable])(_.userId)
  def survey_question: ForeignKeyQuery[SurveyQuestionTable, SurveyQuestion] =
    foreignKey("user_survey_text_submission_survey_question_id_fkey", surveyQuestionId, TableQuery[SurveyQuestionTable])(_.surveyQuestionId)
}

object UserSurveyTextSubmissionTable{
  val db = play.api.db.slick.DB
  val userSurveyTextSubmissions = TableQuery[UserSurveyTextSubmissionTable]

  def save(userSurveyTextSubmission: UserSurveyTextSubmission): Int = db.withTransaction { implicit session =>
    val userSurveyTextSubmissionId: Int =
      (userSurveyTextSubmissions returning userSurveyTextSubmissions.map(_.userSurveyTextSubmissionId)) += userSurveyTextSubmission
    userSurveyTextSubmissionId
  }
}
