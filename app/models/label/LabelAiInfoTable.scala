package models.label

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile.api._
import models.utils.{AiTagConfidence, MyPostgresProfile}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.ExecutionContext

case class LabelAiInfo(
    labelAiInfoId: Int,
    labelId: Int,
    confidence: Double,
    apiVersion: String,
    modelId: String,
    modelTrainingDate: OffsetDateTime,
)

class LabelAiInfoTableDef(tag: Tag) extends Table[LabelAiInfo](tag, "label_ai_info") {
  def labelAiInfoId: Rep[Int]                = column[Int]("label_ai_info_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int]                      = column[Int]("label_id")
  def confidence: Rep[Double]                = column[Double]("confidence")
  def apiVersion: Rep[String]                = column[String]("api_version")
  def modelId: Rep[String]                   = column[String]("model_id")
  def modelTrainingDate: Rep[OffsetDateTime] = column[OffsetDateTime]("model_training_date")

  def * = (labelAiInfoId, labelId, confidence, apiVersion, modelId, modelTrainingDate) <> (
    (LabelAiInfo.apply _).tupled,
    LabelAiInfo.unapply
  )

//  def label: ForeignKeyQuery[LabelTable, Label] =
//    foreignKey("label_ai_info_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)
}

@ImplementedBy(classOf[LabelAiInfoTable])
trait LabelAiInfoTableRepository {}

@Singleton
class LabelAiInfoTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit
    val ec: ExecutionContext
) extends LabelAiInfoTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val labelAiInfos = TableQuery[LabelAiInfoTableDef]

  /**
   * Find a label AI information by label id.
   */
  def findByLabelId(labelId: Int): DBIO[Option[LabelAiInfo]] = {
    labelAiInfos.filter(_.labelId === labelId).result.headOption
  }

  /**
   * Stores label AI information into the label_ai_info table.
   */
  def save(labelAiInfo: LabelAiInfo): DBIO[Int] = {
    (labelAiInfos returning labelAiInfos.map(_.labelAiInfoId)) += labelAiInfo
  }
}
