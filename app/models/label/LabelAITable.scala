package models.label

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.ExecutionContext

case class LabelAI(
    labelAiId: Int,
    labelId: Int,
    aiTags: Option[List[String]],
    aiValidationAccuracy: Option[Float],
    aiValidationResult: Option[Int],
    apiVersion: Option[String],
    timeCreated: OffsetDateTime
)

class LabelAITableDef(tag: Tag) extends Table[LabelAI](tag, "label_ai") {
  def labelAiId: Rep[Int]                      = column[Int]("label_ai_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int]                        = column[Int]("label_id")
  def aiTags: Rep[Option[List[String]]]        = column[Option[List[String]]]("ai_tags")
  def aiValidationAccuracy: Rep[Option[Float]] = column[Option[Float]]("ai_validation_accuracy")
  def aiValidationResult: Rep[Option[Int]]     = column[Option[Int]]("ai_validation_result")
  def apiVersion: Rep[Option[String]]          = column[Option[String]]("api_version")
  def timeCreated: Rep[OffsetDateTime]         = column[OffsetDateTime]("time_created", O.Default(OffsetDateTime.now))

  def * = (labelAiId, labelId, aiTags, aiValidationAccuracy, aiValidationResult, apiVersion, timeCreated) <> (
    (LabelAI.apply _).tupled,
    LabelAI.unapply
  )

//  def label: ForeignKeyQuery[LabelTable, Label] =
//    foreignKey("label_ai_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)
}

@ImplementedBy(classOf[LabelAITable])
trait LabelAITableRepository {}

@Singleton
class LabelAITable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit val ec: ExecutionContext)
    extends LabelAITableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val labelAIs = TableQuery[LabelAITableDef]

  /**
   * Find a label AI information by label id.
   */
  def findByLabelId(labelId: Int): DBIO[Option[LabelAI]] = {
    labelAIs.filter(_.labelId === labelId).result.headOption
  }

  /**
   * Stores label AI information into the label_ai table.
   */
  def save(labelAI: LabelAI): DBIO[Int] = {
    (labelAIs returning labelAIs.map(_.labelAiId)) += labelAI
  }
}
