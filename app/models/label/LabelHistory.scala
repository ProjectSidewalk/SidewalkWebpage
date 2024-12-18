package models.label

import com.google.inject.ImplementedBy

import java.sql.Timestamp
import models.utils.MyPostgresDriver
import models.utils.MyPostgresDriver.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play
import play.api.Play.current

import javax.inject.{Inject, Singleton}


case class LabelHistory(labelHistoryId: Int, labelId: Int, severity: Option[Int], tags: List[String], editedBy: String,
                        editTime: Timestamp, source: String, labelValidationId: Option[Int]) {
  require(List("Explore", "ValidateDesktop", "ValidateDesktopNew", "ValidateMobile", "LabelMap", "GalleryImage", "GalleryExpandedImage", "GalleryThumbs", "AdminUserDashboard", "AdminLabelSearchTab", "ExternalTagValidationASSETS2024").contains(source), "Invalid source for Label History table.")
}

class LabelHistoryTableDef(tag: slick.lifted.Tag) extends Table[LabelHistory](tag, "label_history") {
  def labelHistoryId: Rep[Int] = column[Int]("label_history_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int] = column[Int]("label_id")
  def severity: Rep[Option[Int]] = column[Option[Int]]("severity")
  def tags: Rep[List[String]] = column[List[String]]("tags", O.Default(List()))
  def editedBy: Rep[String] = column[String]("edited_by")
  def editTime: Rep[Timestamp] = column[Timestamp]("edit_time")
  def source: Rep[String] = column[String]("source")
  def labelValidationId: Rep[Option[Int]] = column[Option[Int]]("label_validation_id")

  def * = (
    labelHistoryId, labelId, severity, tags, editedBy, editTime, source, labelValidationId
  ) <> ((LabelHistory.apply _).tupled, LabelHistory.unapply)

//  def label: ForeignKeyQuery[LabelTable, Label] =
//    foreignKey("label_history_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
//
//  def user: ForeignKeyQuery[UserTable, DBUser] =
//    foreignKey("label_history_user_id_fkey", editedBy, TableQuery[UserTableDef])(_.userId)
//
//  def labelValidation: ForeignKeyQuery[LabelValidationTable, LabelValidation] =
//    foreignKey("label_history_label_validation_id_fkey", labelValidationId, TableQuery[LabelValidationTableDef])(_.labelValidationId)
}

@ImplementedBy(classOf[LabelHistoryTable])
trait LabelHistoryTableRepository {
}

@Singleton
class LabelHistoryTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends LabelHistoryTableRepository with HasDatabaseConfigProvider[MyPostgresDriver] {
  import driver.api._
  
  val labelHistory = TableQuery[LabelHistoryTableDef]

//  def save(l: LabelHistory)(implicit session: Session): Int = {
//    val labelHistoryId: Int = (labelHistory returning labelHistory.map(_.labelHistoryId)) +=
//      LabelHistory(0, l.labelId, l.severity, l.tags.distinct, l.editedBy, l.editTime, l.source, l.labelValidationId)
//    labelHistoryId
//  }
}
