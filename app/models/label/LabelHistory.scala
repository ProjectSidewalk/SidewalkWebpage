package models.label

import java.sql.Timestamp
import models.daos.slick.DBTableDefinitions.{DBUser, UserTable}
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.simple._
import play.api.Play
import play.api.Play.current
import scala.slick.lifted.ForeignKeyQuery

case class LabelHistory(labelHistoryId: Int, labelId: Int, severity: Option[Int], tags: List[String], editedBy: String,
                        editTime: Timestamp, source: String, labelValidationId: Option[Int]) {
  require(List("Explore", "ValidateDesktop", "ValidateDesktopNew", "ValidateMobile", "LabelMap", "GalleryImage", "GalleryExpandedImage", "GalleryThumbs", "AdminUserDashboard", "AdminLabelSearchTab", "ExternalTagValidationASSETS2024").contains(source), "Invalid source for Label History table.")
}

class LabelHistoryTable(tag: slick.lifted.Tag) extends Table[LabelHistory](tag, "label_history") {
  def labelHistoryId = column[Int]("label_history_id", O.PrimaryKey, O.AutoInc)
  def labelId = column[Int]("label_id", O.NotNull)
  def severity = column[Option[Int]]("severity", O.Nullable)
  def tags = column[List[String]]("tags", O.NotNull, O.Default(List()))
  def editedBy = column[String]("edited_by", O.NotNull)
  def editTime = column[Timestamp]("edit_time", O.NotNull)
  def source = column[String]("source", O.NotNull)
  def labelValidationId = column[Option[Int]]("label_validation_id", O.Nullable)

  def * = (
    labelHistoryId, labelId, severity, tags, editedBy, editTime, source, labelValidationId
  ) <> ((LabelHistory.apply _).tupled, LabelHistory.unapply)

  def label: ForeignKeyQuery[LabelTable, Label] =
    foreignKey("label_history_label_id_fkey", labelId, TableQuery[LabelTable])(_.labelId)

  def user: ForeignKeyQuery[UserTable, DBUser] =
    foreignKey("label_history_user_id_fkey", editedBy, TableQuery[UserTable])(_.userId)

  def labelValidation: ForeignKeyQuery[LabelValidationTable, LabelValidation] =
    foreignKey("label_history_label_validation_id_fkey", labelValidationId, TableQuery[LabelValidationTable])(_.labelValidationId)
}

/**
 * Data access object for the label_history table.
 */
object LabelHistoryTable {
  import MyPostgresDriver.plainImplicits._

  val db = play.api.db.slick.DB
  val labelHistory = TableQuery[LabelHistoryTable]

  def save(l: LabelHistory)(implicit session: Session): Int = {
    val labelHistoryId: Int = (labelHistory returning labelHistory.map(_.labelHistoryId)) +=
      LabelHistory(0, l.labelId, l.severity, l.tags.distinct, l.editedBy, l.editTime, l.source, l.labelValidationId)
    labelHistoryId
  }
}
