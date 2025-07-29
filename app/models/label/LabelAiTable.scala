package models.label

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.ExecutionContext

case class LabelAi(
    labelAiId: Int,
    labelId: Int,
    validationResult: Int,
    validationAccuracy: Double,
    tags: Option[List[String]],
    apiVersion: String,
    timeCreated: OffsetDateTime
)

class LabelAiTableDef(tag: Tag) extends Table[LabelAi](tag, "label_ai") {
  def labelAiId: Rep[Int]              = column[Int]("label_ai_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int]                = column[Int]("label_id")
  def validationResult: Rep[Int]       = column[Int]("validation_result")
  def validationAccuracy: Rep[Double]  = column[Double]("validation_accuracy")
  def tags: Rep[Option[List[String]]]  = column[Option[List[String]]]("tags")
  def apiVersion: Rep[String]          = column[String]("api_version")
  def timeCreated: Rep[OffsetDateTime] = column[OffsetDateTime]("time_created", O.Default(OffsetDateTime.now))

  def * = (labelAiId, labelId, validationResult, validationAccuracy, tags, apiVersion, timeCreated) <> (
    (LabelAi.apply _).tupled,
    LabelAi.unapply
  )

//  def label: ForeignKeyQuery[LabelTable, Label] =
//    foreignKey("label_ai_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)
}

@ImplementedBy(classOf[LabelAiTable])
trait LabelAiTableRepository {}

@Singleton
class LabelAiTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit val ec: ExecutionContext)
    extends LabelAiTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val labelAis = TableQuery[LabelAiTableDef]

  /**
   * Find a label AI information by label id.
   */
  def findByLabelId(labelId: Int): DBIO[Option[LabelAi]] = {
    labelAis.filter(_.labelId === labelId).result.headOption
  }

  /**
   * Stores label AI information into the label_ai table.
   */
  def save(labelAi: LabelAi): DBIO[Int] = {
    (labelAis returning labelAis.map(_.labelAiId)) += labelAi
  }
}
