package models.survey

import models.utils.MyPostgresDriver.simple._
import play.api.Play.current

case class SurveyQuestion(surveyQuestionId: Int, surveyQuestionTextId: String, surveyInputType: String, surveyDisplayRank: Option[Int], deleted: Boolean, surveyUserRoleId: Int, required: Boolean)

class SurveyQuestionTable(tag: Tag) extends Table[SurveyQuestion](tag, "survey_question") {
  def surveyQuestionId = column[Int]("survey_question_id", O.PrimaryKey, O.AutoInc)
  def surveyQuestionTextId = column[String]("survey_question_text_id", O.NotNull)
  def surveyInputType = column[String]("survey_input_type", O.NotNull)
  def surveyDisplayRank = column[Option[Int]]("survey_display_rank", O.Nullable)
  def deleted = column[Boolean]("deleted", O.NotNull)
  def surveyUserRoleId = column[Int]("survey_user_role_id",O.NotNull)
  def required = column[Boolean]("required", O.NotNull)

  def * = (surveyQuestionId, surveyQuestionTextId, surveyInputType, surveyDisplayRank, deleted, surveyUserRoleId, required) <> ((SurveyQuestion.apply _).tupled, SurveyQuestion.unapply)
}

object SurveyQuestionTable{
  val db = play.api.db.slick.DB
  val surveyQuestions = TableQuery[SurveyQuestionTable]
  val surveyOptions = TableQuery[SurveyOptionTable]

  def getQuestionById(surveyQuestionId: Int): Option[SurveyQuestion] = db.withTransaction { implicit session =>
    surveyQuestions.filter(_.surveyQuestionId === surveyQuestionId).firstOption
  }

  def listOptionsByQuestion(surveyQuestionId: Int): Option[List[SurveyOption]] = db.withTransaction { implicit session =>
    val question: Option[SurveyQuestion] = getQuestionById(surveyQuestionId)
    question match{
      case Some(q) =>
        Some(surveyOptions.filter(_.surveyQuestionId === surveyQuestionId).list)
      case None =>
        None
    }
  }

  def listAll: List[SurveyQuestion] = db.withTransaction { implicit session =>
    surveyQuestions.filter(_.deleted === false).list
  }
}
