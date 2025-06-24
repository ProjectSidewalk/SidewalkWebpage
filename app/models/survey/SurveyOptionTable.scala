package models.survey

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}

case class SurveyOption(surveyOptionId: Int, surveyQuestionId: Int, surveyDisplayRank: Option[Int])

class SurveyOptionTableDef(tag: Tag) extends Table[SurveyOption](tag, "survey_option") {
  def surveyOptionId: Rep[Int]            = column[Int]("survey_option_id", O.PrimaryKey)
  def surveyQuestionId: Rep[Int]          = column[Int]("survey_question_id")
  def surveyDisplayRank: Rep[Option[Int]] = column[Option[Int]]("survey_display_rank")

  def * = (surveyOptionId, surveyQuestionId, surveyDisplayRank) <> ((SurveyOption.apply _).tupled, SurveyOption.unapply)

//  def surveyQuestion: ForeignKeyQuery[SurveyQuestionTable, SurveyQuestion] =
//    foreignKey("survey_option_survey_question_id_fkey", surveyQuestionId, TableQuery[SurveyQuestionTableDef])(_.surveyQuestionId)
}

@ImplementedBy(classOf[SurveyOptionTable])
trait SurveyOptionTableRepository {}

@Singleton
class SurveyOptionTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends SurveyOptionTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val surveyOptions = TableQuery[SurveyOptionTableDef]
}
