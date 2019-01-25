package models.survey

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import scala.concurrent.ExecutionContext.Implicits.global

case class SurveyQuestion(surveyQuestionId: Int, surveyQuestionText: String, surveyInputType: String, surveyCategoryOptionId: Option[Int], surveyDisplayRank: Option[Int], deleted: Boolean, surveyUserRoleId: Int, required: Boolean)

class SurveyQuestionTable(tag: Tag) extends Table[SurveyQuestion](tag, Some("sidewalk"), "survey_question") {
  def surveyQuestionId = column[Int]("survey_question_id", O.PrimaryKey, O.AutoInc)
  def surveyQuestionText = column[String]("survey_question_text")
  def surveyInputType = column[String]("survey_input_type")
  def surveyCategoryOptionId = column[Option[Int]]("survey_category_option_id")
  def surveyDisplayRank = column[Option[Int]]("survey_display_rank")
  def deleted = column[Boolean]("deleted")
  def surveyUserRoleId = column[Int]("survey_user_role_id")
  def required = column[Boolean]("required")

  def * = (surveyQuestionId, surveyQuestionText, surveyInputType, surveyCategoryOptionId, surveyDisplayRank, deleted, surveyUserRoleId, required) <> ((SurveyQuestion.apply _).tupled, SurveyQuestion.unapply)

  def survey_category_option = foreignKey("survey_question_survey_category_option_id_fkey", surveyCategoryOptionId, TableQuery[SurveyCategoryOptionTable])(_.surveyCategoryOptionId.?)

}

object SurveyQuestionTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val surveyQuestions = TableQuery[SurveyQuestionTable]
  val surveyOptions = TableQuery[SurveyOptionTable]

  def getQuestionById(surveyQuestionId: Int): Future[Option[SurveyQuestion]] = db.run(
    surveyQuestions.filter(_.surveyQuestionId === surveyQuestionId).result.headOption)

  def listOptionsByQuestion(surveyQuestionId: Int): Future[Option[List[SurveyOption]]] = {
    getQuestionById(surveyQuestionId).flatMap {
      case Some(q) =>
        val categoryOptionId = q.surveyCategoryOptionId
        SurveyCategoryOptionTable.listOptionsByCategory(categoryOptionId)
      case None => Future.successful(None)
    }
  }

  def listAll: Future[List[SurveyQuestion]] = db.run(
    surveyQuestions.filter(_.deleted === false).to[List].result)

  def listAllByUserRoleId(userRoleId: Int): Future[List[SurveyQuestion]] = db.run(
    surveyQuestions.filter(x => x.deleted === false && x.surveyUserRoleId === userRoleId).to[List].result)

  def save(surveyQuestion: SurveyQuestion): Future[Int] = db.run(
    ((surveyQuestions returning surveyQuestions.map(_.surveyQuestionId)) += surveyQuestion).transactionally)
}