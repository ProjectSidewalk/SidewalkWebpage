package models.label

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.ExecutionContext

case class LabelAiFailure(labelId: Int, reason: String, timestamp: OffsetDateTime)

class LabelAiFailureTableDef(tag: Tag) extends Table[LabelAiFailure](tag, "label_ai_failure") {
  def labelId: Rep[Int]              = column[Int]("label_id", O.PrimaryKey)
  def reason: Rep[String]            = column[String]("reason")
  def timestamp: Rep[OffsetDateTime] = column[OffsetDateTime]("timestamp", O.Default(OffsetDateTime.now))

  def * = (labelId, reason, timestamp) <> (
    (LabelAiFailure.apply _).tupled,
    LabelAiFailure.unapply
  )

  def label = foreignKey("label_ai_failure_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
}

@ImplementedBy(classOf[LabelAiFailureTable])
trait LabelAiFailureTableRepository {}

@Singleton
class LabelAiFailureTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit
    val ec: ExecutionContext
) extends LabelAiFailureTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val labelAiFailures = TableQuery[LabelAiFailureTableDef]

  /**
   * Records a permanent AI validation failure for the given label so it will be skipped in future runs.
   * @param labelId The label that the AI API could not assess
   * @param reason A short description of why the failure is permanent (e.g., "Failed to fetch")
   */
  def save(labelId: Int, reason: String): DBIO[Int] = {
    labelAiFailures += LabelAiFailure(labelId, reason, OffsetDateTime.now)
  }
}
