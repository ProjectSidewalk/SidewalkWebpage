package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current

import java.sql.Timestamp
import models.survey._
import models.utils.MyPostgresDriver

import javax.inject.{Inject, Singleton}


case class UserSurveyTextSubmission(userSurveyTextSubmissionId: Int, userId: String, surveyQuestionId: Int, surveyTextSubmission: Option[String], timeSubmitted: Timestamp, numMissionsCompleted: Int)

class UserSurveyTextSubmissionTableDef(tag: Tag) extends Table[UserSurveyTextSubmission](tag, "user_survey_text_submission") {
  def userSurveyTextSubmissionId: Rep[Int] = column[Int]("user_survey_text_submission_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String] = column[String]("user_id")
  def surveyQuestionId: Rep[Int] = column[Int]("survey_question_id")
  def surveyTextSubmission: Rep[Option[String]] = column[Option[String]]("survey_text_submission")
  def timeSubmitted: Rep[Timestamp] = column[Timestamp]("time_submitted")
  def numMissionsCompleted: Rep[Int] = column[Int]("num_missions_completed")

  def * = (userSurveyTextSubmissionId, userId, surveyQuestionId, surveyTextSubmission, timeSubmitted, numMissionsCompleted) <> ((UserSurveyTextSubmission.apply _).tupled, UserSurveyTextSubmission.unapply)

//  def user: ForeignKeyQuery[UserTable, DBUser] =
//    foreignKey("user_survey_text_submission_user_id_fkey", userId, TableQuery[UserTableDef])(_.userId)
//  def survey_question: ForeignKeyQuery[SurveyQuestionTable, SurveyQuestion] =
//    foreignKey("user_survey_text_submission_survey_question_id_fkey", surveyQuestionId, TableQuery[SurveyQuestionTableDef])(_.surveyQuestionId)
}

@ImplementedBy(classOf[UserSurveyTextSubmissionTable])
trait UserSurveyTextSubmissionTableRepository {
}

@Singleton
class UserSurveyTextSubmissionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends UserSurveyTextSubmissionTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val userSurveyTextSubmissions = TableQuery[UserSurveyTextSubmissionTableDef]

//  def save(textSubmission: UserSurveyTextSubmission): Int = {
//    (userSurveyTextSubmissions returning userSurveyTextSubmissions.map(_.userSurveyTextSubmissionId)) += textSubmission
//  }
}
