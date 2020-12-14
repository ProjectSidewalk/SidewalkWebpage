package models.survey

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class SurveyOption(surveyOptionId: Int, surveyQuestionId: Int, surveyDisplayRank: Option[Int])

class SurveyOptionTable(tag: Tag) extends Table[SurveyOption](tag, Some("sidewalk"), "survey_option") {
  def surveyOptionId = column[Int]("survey_option_id", O.PrimaryKey)
  def surveyQuestionId = column[Int]("survey_question_id", O.NotNull)
  def surveyDisplayRank = column[Option[Int]]("survey_display_rank", O.Nullable)

  def * = (surveyOptionId, surveyQuestionId, surveyDisplayRank) <> ((SurveyOption.apply _).tupled, SurveyOption.unapply)
  def surveyQuestion: ForeignKeyQuery[SurveyQuestionTable, SurveyQuestion] =
    foreignKey("survey_option_survey_question_id_fkey", surveyQuestionId, TableQuery[SurveyQuestionTable])(_.surveyQuestionId)
}

object SurveyOptionTable {
  val db = play.api.db.slick.DB
  val surveyOptions = TableQuery[SurveyOptionTable]
}
