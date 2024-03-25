package models.label

import java.sql.Timestamp
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import play.api.Play
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class LabelHistory(labelHistoryId: Int, labelId: Int, severity: Option[Int], tags: List[String], updatedBy: String,
                        versionStart: Timestamp, versionEnd: Option[Timestamp])

class LabelHistoryTable(tag: slick.lifted.Tag) extends Table[LabelHistory](tag, "label_history") {
  def labelHistoryId = column[Int]("label_history_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def severity = column[Option[Int]]("severity", O.Nullable)
  def tags = column[List[String]]("tags", O.NotNull, O.Default(List()))
  def updatedBy = column[String]("updated_by", O.NotNull)
  def versionStart = column[Timestamp]("version_start", O.NotNull)
  def versionEnd = column[Option[Timestamp]]("version_end", O.Nullable)

  def * = (
    labelHistoryId, labelId, severity, tags, updatedBy, versionStart, versionEnd
  ) <> ((LabelHistory.apply _).tupled, LabelHistory.unapply)

  def label: ForeignKeyQuery[LabelTable, Label] =
    foreignKey("label_history_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("label_history_user_id_fkey", updatedBy, TableQuery[UserTable])(_.userId)
}

/**
 * Data access object for the label_history table.
 */
object LabelHistoryTable {
  import MyPostgresDriver.plainImplicits._

  val db = play.api.db.slick.DB
  val labelHistory = TableQuery[LabelHistoryTable]

  def save(label: LabelHistory): Int = db.withSession { implicit session =>
    val labelHistoryId: Int = (labelHistory returning labelHistory.map(_.labelHistoryId)) += label
    labelHistoryId
  }

}
