package models.survey

import models.survey.SurveyQuestionTable.{db, surveyQuestions}
import models.utils.MyPostgresDriver.api._
import play.api.Play.current
import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile

import scala.concurrent.Future

case class SurveyOption(surveyOptionId: Int, surveyCategoryOptionId: Int, surveyOptionText: String, surveyDisplayRank: Option[Int])

class SurveyOptionTable(tag: Tag) extends Table[SurveyOption](tag, Some("sidewalk"), "survey_option") {
  def surveyOptionId = column[Int]("survey_option_id", O.PrimaryKey)
  def surveyCategoryOptionId = column[Int]("survey_category_option_id")
  def surveyOptionText = column[String]("survey_option_text")
  def surveyDisplayRank = column[Option[Int]]("survey_display_rank")

  def * = (surveyOptionId, surveyCategoryOptionId, surveyOptionText, surveyDisplayRank) <> ((SurveyOption.apply _).tupled, SurveyOption.unapply)
  def survey_category_option = foreignKey("survey_option_survey_category_option_id_fkey", surveyCategoryOptionId, TableQuery[SurveyCategoryOptionTable])(_.surveyCategoryOptionId)
}

object SurveyOptionTable{
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val surveyOptions = TableQuery[SurveyOptionTable]


  def listAll: Future[List[SurveyOption]] = db.run(
    surveyOptions.to[List].result
  )

  def save(surveyOption: SurveyOption): Future[Int] = db.run(
    ((surveyOptions returning surveyOptions.map(_.surveyOptionId)) += surveyOption).transactionally
  )
}