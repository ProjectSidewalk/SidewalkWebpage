package models.user

import com.google.inject.ImplementedBy
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current

import java.sql.Timestamp
import models.survey._
import models.utils.MyPostgresDriver

import javax.inject.{Inject, Singleton}


case class UserSurveyOptionSubmission(userSurveyOptionSubmissionId: Int, userId: String, surveyQuestionId: Int, surveyOptionId: Option[Int], timeSubmitted: Timestamp, numMissionsCompleted: Int)

class UserSurveyOptionSubmissionTableDef(tag: Tag) extends Table[UserSurveyOptionSubmission](tag, "user_survey_option_submission") {
  def userSurveyOptionSubmissionId: Rep[Int] = column[Int]("user_survey_option_submission_id", O.PrimaryKey, O.AutoInc)
  def userId: Rep[String] = column[String]("user_id")
  def surveyQuestionId: Rep[Int] = column[Int]("survey_question_id")
  def surveyOptionId: Rep[Option[Int]] = column[Option[Int]]("survey_option_id")
  def timeSubmitted: Rep[Timestamp] = column[Timestamp]("time_submitted")
  def numMissionsCompleted: Rep[Int] = column[Int]("num_missions_completed")

  def * = (userSurveyOptionSubmissionId, userId, surveyQuestionId, surveyOptionId, timeSubmitted, numMissionsCompleted) <> ((UserSurveyOptionSubmission.apply _).tupled, UserSurveyOptionSubmission.unapply)

//  def user: ForeignKeyQuery[UserTable, DBUser] =
//    foreignKey("user_survey_option_submission_user_id_fkey", userId, TableQuery[UserTableDef])(_.userId)
//  def survey_question: ForeignKeyQuery[SurveyQuestionTable, SurveyQuestion] =
//    foreignKey("user_survey_option_submission_survey_question_id_fkey", surveyQuestionId, TableQuery[SurveyQuestionTableDef])(_.surveyQuestionId)
}

@ImplementedBy(classOf[UserSurveyOptionSubmissionTable])
trait UserSurveyOptionSubmissionTableRepository {
  def insert(optionSubmission: UserSurveyOptionSubmission): DBIO[Int]
}

@Singleton
class UserSurveyOptionSubmissionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends UserSurveyOptionSubmissionTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  val userSurveyOptionSubmissions = TableQuery[UserSurveyOptionSubmissionTableDef]

  def insert(optionSubmission: UserSurveyOptionSubmission): DBIO[Int] = {
    (userSurveyOptionSubmissions returning userSurveyOptionSubmissions.map(_.userSurveyOptionSubmissionId)) += optionSubmission
  }
}
