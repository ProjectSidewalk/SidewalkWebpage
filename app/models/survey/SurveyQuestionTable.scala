package models.survey

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play.current

import javax.inject.{Inject, Singleton}

case class SurveyQuestion(surveyQuestionId: Int, surveyQuestionTextId: String, surveyInputType: String, surveyDisplayRank: Option[Int], deleted: Boolean, surveyUserRoleId: Int, required: Boolean)

class SurveyQuestionTableDef(tag: Tag) extends Table[SurveyQuestion](tag, "survey_question") {
  def surveyQuestionId: Rep[Int] = column[Int]("survey_question_id", O.PrimaryKey, O.AutoInc)
  def surveyQuestionTextId: Rep[String] = column[String]("survey_question_text_id")
  def surveyInputType: Rep[String] = column[String]("survey_input_type")
  def surveyDisplayRank: Rep[Option[Int]] = column[Option[Int]]("survey_display_rank")
  def deleted: Rep[Boolean] = column[Boolean]("deleted")
  def surveyUserRoleId: Rep[Int] = column[Int]("survey_user_role_id")
  def required: Rep[Boolean] = column[Boolean]("required")

  def * = (surveyQuestionId, surveyQuestionTextId, surveyInputType, surveyDisplayRank, deleted, surveyUserRoleId, required) <> ((SurveyQuestion.apply _).tupled, SurveyQuestion.unapply)
}

@ImplementedBy(classOf[SurveyQuestionTable])
trait SurveyQuestionTableRepository {
}

@Singleton
class SurveyQuestionTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends SurveyQuestionTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  val surveyQuestions = TableQuery[SurveyQuestionTableDef]
  val surveyOptions = TableQuery[SurveyOptionTableDef]

//  def getQuestionById(surveyQuestionId: Int): Option[SurveyQuestion] = {
//    surveyQuestions.filter(_.surveyQuestionId === surveyQuestionId).firstOption
//  }
//
//  def listOptionsByQuestion(surveyQuestionId: Int): List[SurveyOption] = {
//    surveyOptions.filter(_.surveyQuestionId === surveyQuestionId).list
//  }
//
//  def listAll: List[SurveyQuestion] = {
//    surveyQuestions.filter(_.deleted === false).list
//  }
}
