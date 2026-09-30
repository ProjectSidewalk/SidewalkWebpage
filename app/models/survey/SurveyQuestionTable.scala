package models.survey

import com.google.inject.ImplementedBy
import models.user.Role
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api.{given, *}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

case class SurveyQuestion(
    surveyQuestionId: Int,
    surveyQuestionTextId: String,
    surveyInputType: String,
    surveyDisplayRank: Option[Int],
    deleted: Boolean,
    surveyUserRole: Role,
    required: Boolean
)
case class SurveyQuestionWithOptions(
    surveyQuestionId: Int,
    surveyQuestionTextId: String,
    surveyInputType: String,
    surveyDisplayRank: Option[Int],
    deleted: Boolean,
    surveyUserRole: Role,
    required: Boolean,
    options: Seq[SurveyOption]
)

class SurveyQuestionTableDef(tag: Tag) extends Table[SurveyQuestion](tag, "survey_question") {
  def surveyQuestionId: Rep[Int]        = column[Int]("survey_question_id", O.PrimaryKey, O.AutoInc)
  def surveyQuestionTextId: Rep[String] = column[String]("survey_question_text_id")
  // CHECK (survey_input_type IN ('radio', 'checkbox', 'free-text-feedback')) in the DB (no Slick DSL for CHECKs).
  def surveyInputType: Rep[String]        = column[String]("survey_input_type")
  def surveyDisplayRank: Rep[Option[Int]] = column[Option[Int]]("survey_display_rank")
  def deleted: Rep[Boolean]               = column[Boolean]("deleted", O.Default(false))
  def surveyUserRole: Rep[Role]           = column[Role]("survey_user_role", O.Default(Role.Registered))
  def required: Rep[Boolean]              = column[Boolean]("required", O.Default(false))

  def * =
    (surveyQuestionId, surveyQuestionTextId, surveyInputType, surveyDisplayRank, deleted, surveyUserRole, required)
      .mapTo[SurveyQuestion]
}

@ImplementedBy(classOf[SurveyQuestionTable])
trait SurveyQuestionTableRepository {}

@Singleton
class SurveyQuestionTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(using
    ec: ExecutionContext
) extends SurveyQuestionTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {
  val surveyQuestions = TableQuery[SurveyQuestionTableDef]
  val surveyOptions   = TableQuery[SurveyOptionTableDef]

  def listAllWithOptions: DBIO[Seq[SurveyQuestionWithOptions]] = {
    val query = for {
      (question, option) <- surveyQuestions.filter(
        _.deleted === false
      ) joinLeft surveyOptions on (_.surveyQuestionId === _.surveyQuestionId)
    } yield (question, option)
    query.result.map { rows =>
      rows
        .groupBy { case (question, _) => question }
        .map { case (question, questionRows) =>
          val options: Seq[SurveyOption] = questionRows.flatMap { case (_, option) => option }
          SurveyQuestionWithOptions(question.surveyQuestionId, question.surveyQuestionTextId, question.surveyInputType,
            question.surveyDisplayRank, question.deleted, question.surveyUserRole, question.required, options)
        }
        .toSeq
    }
  }
}
