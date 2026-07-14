package models.label

import com.google.inject.ImplementedBy
import models.label.AiImageSource.AiImageSource
import models.utils.MyPostgresProfile.api._
import models.utils.{AiTagConfidence, MyPostgresProfile}
import models.validation.ValidationOption
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.ExecutionContext

// NOTE need to update ai_image_source enum in postgres as well if changing this Enumeration.
object AiImageSource extends Enumeration {
  type AiImageSource = Value
  val Download = Value("download")
  val Cache    = Value("cache")
}

case class LabelAiAssessment(
    labelAiAssessmentId: Int,
    labelId: Int,
    validationResult: ValidationOption.Value,
    validationAccuracy: Double,
    validationConfidence: Double,
    tags: Option[List[String]],
    tagsNotPresent: Option[List[String]],
    tagsConfidence: Option[Seq[AiTagConfidence]],
    apiVersion: String,
    validatorModelId: String,
    validatorTrainingDate: OffsetDateTime,
    taggerModelId: Option[String],
    taggerTrainingDate: Option[OffsetDateTime],
    timestamp: OffsetDateTime,
    labelValidationId: Option[Int],
    aiImageSource: AiImageSource
)

class LabelAiAssessmentTableDef(tag: Tag) extends Table[LabelAiAssessment](tag, "label_ai_assessment") {
  def labelAiAssessmentId: Rep[Int]                     = column[Int]("label_ai_assessment_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int]                                 = column[Int]("label_id")
  def validationResult: Rep[ValidationOption.Value]     = column[ValidationOption.Value]("validation_result")
  def validationAccuracy: Rep[Double]                   = column[Double]("validation_accuracy")
  def validationConfidence: Rep[Double]                 = column[Double]("validation_confidence")
  def tags: Rep[Option[List[String]]]                   = column[Option[List[String]]]("tags")
  def tagsNotPresent: Rep[Option[List[String]]]         = column[Option[List[String]]]("tags_not_present")
  def tagsConfidence: Rep[Option[Seq[AiTagConfidence]]] = column[Option[Seq[AiTagConfidence]]]("tags_confidence")
  def apiVersion: Rep[String]                           = column[String]("api_version")
  def validatorModelId: Rep[String]                     = column[String]("validator_model_id")
  def validatorTrainingDate: Rep[OffsetDateTime]        = column[OffsetDateTime]("validator_training_date")
  def taggerModelId: Rep[Option[String]]                = column[Option[String]]("tagger_model_id")
  def taggerTrainingDate: Rep[Option[OffsetDateTime]]   = column[Option[OffsetDateTime]]("tagger_training_date")
  def timestamp: Rep[OffsetDateTime]      = column[OffsetDateTime]("timestamp", O.Default(OffsetDateTime.now))
  def labelValidationId: Rep[Option[Int]] = column[Option[Int]]("label_validation_id")
  def aiImageSource: Rep[AiImageSource]   = column[AiImageSource]("ai_image_source")

  def * =
    (labelAiAssessmentId, labelId, validationResult, validationAccuracy, validationConfidence, tags, tagsNotPresent,
      tagsConfidence, apiVersion, validatorModelId, validatorTrainingDate, taggerModelId, taggerTrainingDate, timestamp,
      labelValidationId, aiImageSource) <> (
      (LabelAiAssessment.apply _).tupled,
      LabelAiAssessment.unapply
    )

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

  /**
   * Summary of the AI's per-label assessments, for the Humans-vs-AI dashboard's tagger lens: how many labels the AI
   * has assessed and its mean validation confidence across them.
   *
   * @return DBIO[(labelsAssessed, avgConfidence)] — avgConfidence is None when there are no assessments.
   */
  def getAssessmentSummary: DBIO[(Int, Option[Double])] = {
    for {
      count <- labelAiAssessments.length.result
      avg   <- labelAiAssessments.map(_.validationConfidence).avg.result
    } yield (count, avg)
  }

  /**
   * AI-applied tag counts across all assessments, for the Humans-vs-AI tagger lens (compared against the human tag
   * baseline). Each assessment's `tags` array is flattened in Scala — only the tags column is fetched — so the page
   * can show which tags the AI tagger applies and how often.
   *
   * @return DBIO[Seq[(tag, count)]].
   */
  def getAiTagCounts: DBIO[Seq[(String, Int)]] = {
    labelAiAssessments.map(_.tags).result.map { tagLists =>
      tagLists.flatten.flatten
        .groupBy(identity)
        .map { case (tag, occurrences) => (tag, occurrences.size) }
        .toSeq
    }
  }
}
