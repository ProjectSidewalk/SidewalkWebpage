package models.survey

import models.utils.MyPostgresDriver.api._
import play.api.Play.current

import play.api.Play
import play.api.db.slick.DatabaseConfigProvider
import slick.driver.JdbcProfile
import scala.concurrent.Future

import scala.concurrent.ExecutionContext.Implicits.global

case class SurveyCategoryOption(surveyCategoryOptionId: Int, surveyCategoryOptionText: String)

class SurveyCategoryOptionTable(tag: Tag) extends Table[SurveyCategoryOption](tag, Some("sidewalk"), "survey_category_option") {
  def surveyCategoryOptionId = column[Int]("survey_question_id", O.PrimaryKey, O.AutoInc)
  def surveyCategoryOptionText = column[String]("survey_question_text")

  def * = (surveyCategoryOptionId, surveyCategoryOptionText) <> ((SurveyCategoryOption.apply _).tupled, SurveyCategoryOption.unapply)
}

object SurveyCategoryOptionTable {
  val dbConfig = DatabaseConfigProvider.get[JdbcProfile](Play.current)
  val db = dbConfig.db
  val surveyQuestions = TableQuery[SurveyQuestionTable]
  val surveyCategoryOptions = TableQuery[SurveyCategoryOptionTable]
  val surveyOptions = TableQuery[SurveyOptionTable]

  def listOptionsByCategory(surveyCategoryOptionId: Option[Int]): Future[Option[List[SurveyOption]]] = {
    surveyCategoryOptionId match {
      case Some(scId) =>
        db.run(
          surveyOptions.filter(_.surveyCategoryOptionId === scId).to[List].result).map(Some(_))
      case None => Future.successful(None)
    }
  }

  def save(surveyCategoryOption: SurveyCategoryOption): Future[Int] = db.run(
    ((surveyCategoryOptions returning surveyCategoryOptions.map(_.surveyCategoryOptionId)) += surveyCategoryOption).transactionally)
}