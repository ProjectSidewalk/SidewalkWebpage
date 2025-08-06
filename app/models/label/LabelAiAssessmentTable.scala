package models.label

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile.api._
import models.utils.{AiTagConfidence, MyPostgresProfile}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.ExecutionContext

case class LabelAiAssessment(
    labelAiAssessmentId: Int,
    labelId: Int,
    validationResult: Int,
    validationAccuracy: Double,
    validationConfidence: Double,
    tags: Option[List[String]],
    tagsConfidence: Option[Seq[AiTagConfidence]],
    apiVersion: String,
    timeCreated: OffsetDateTime
)

class LabelAiAssessmentTableDef(tag: Tag) extends Table[LabelAiAssessment](tag, "label_ai_assessment") {
  def labelAiAssessmentId: Rep[Int]                     = column[Int]("label_ai_assessment_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int]                                 = column[Int]("label_id")
  def validationResult: Rep[Int]                        = column[Int]("validation_result")
  def validationAccuracy: Rep[Double]                   = column[Double]("validation_accuracy")
  def validationConfidence: Rep[Double]                 = column[Double]("validation_confidence")
  def tags: Rep[Option[List[String]]]                   = column[Option[List[String]]]("tags")
  def tagsConfidence: Rep[Option[Seq[AiTagConfidence]]] = column[Option[Seq[AiTagConfidence]]]("tags_confidence")
  def apiVersion: Rep[String]                           = column[String]("api_version")
  def timeCreated: Rep[OffsetDateTime] = column[OffsetDateTime]("time_created", O.Default(OffsetDateTime.now))

  def * = (labelAiAssessmentId, labelId, validationResult, validationAccuracy, validationConfidence, tags,
    tagsConfidence, apiVersion, timeCreated) <> ((LabelAiAssessment.apply _).tupled, LabelAiAssessment.unapply)

//  def label: ForeignKeyQuery[LabelTable, Label] =
//    foreignKey("label_ai_assessment_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)
}

@ImplementedBy(classOf[LabelAiAssessmentTable])
trait LabelAiAssessmentTableRepository {}

@Singleton
class LabelAiAssessmentTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit
    val ec: ExecutionContext
) extends LabelAiAssessmentTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val labelAiAssessments = TableQuery[LabelAiAssessmentTableDef]

  /**
   * Find a label AI information by label id.
   */
  def findByLabelId(labelId: Int): DBIO[Option[LabelAiAssessment]] = {
    labelAiAssessments.filter(_.labelId === labelId).result.headOption
  }

  /**
   * Stores label AI information into the label_ai_assessment table.
   */
  def save(labelAiAssessment: LabelAiAssessment): DBIO[Int] = {
    (labelAiAssessments returning labelAiAssessments.map(_.labelAiAssessmentId)) += labelAiAssessment
  }
}
