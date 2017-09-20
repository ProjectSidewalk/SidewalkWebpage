package models.survey

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

import scala.slick.lifted.ForeignKeyQuery

case class SurveyOption(surveyOptionId: Int, surveyCategoryOptionId: Int, surveyOptionText: String, surveyDisplayRank: Option[Int])

class SurveyOptionTable(tag: Tag) extends Table[SurveyOption](tag, Some("sidewalk"), "survey_option") {
  def surveyOptionId = column[Int]("survey_option_id", O.PrimaryKey)
  def surveyCategoryOptionId = column[Int]("survey_category_option_id", O.NotNull)
  def surveyOptionText = column[String]("survey_option_text", O.NotNull)
  def surveyDisplayRank = column[Option[Int]]("survey_display_rank", O.Nullable)

  def * = (surveyOptionId, surveyCategoryOptionId, surveyOptionText, surveyDisplayRank) <> ((SurveyOption.apply _).tupled, SurveyOption.unapply)
  def survey_category_option: ForeignKeyQuery[SurveyCategoryOptionTable, SurveyCategoryOption] =
    foreignKey("survey_option_survey_category_option_id_fkey", surveyCategoryOptionId, TableQuery[SurveyCategoryOptionTable])(_.surveyCategoryOptionId)
}

object SurveyOptionTable{
  val db = play.api.db.slick.DB
  val surveyOptions = TableQuery[SurveyOptionTable]

  def save(surveyOption: SurveyOption): Int = db.withTransaction { implicit session =>
    val surveyOptionId: Int =
      (surveyOptions returning surveyOptions.map(_.surveyOptionId)) += surveyOption
    surveyOptionId
  }
}