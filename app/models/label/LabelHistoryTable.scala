package models.label

import com.google.inject.ImplementedBy

import java.sql.Timestamp
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.Play

import javax.inject.{Inject, Singleton}


case class LabelHistory(labelHistoryId: Int, labelId: Int, severity: Option[Int], tags: Seq[String], editedBy: String,
                        editTime: Timestamp, source: String, labelValidationId: Option[Int]) {
  require(Seq("Explore", "ValidateDesktop", "ValidateDesktopNew", "ValidateMobile", "LabelMap", "GalleryImage", "GalleryExpandedImage", "GalleryThumbs", "AdminUserDashboard", "AdminLabelSearchTab", "ExternalTagValidationASSETS2024").contains(source), "Invalid source for Label History table.")
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

  // Need to do all this nonsense just to convert tags from a List to a Seq, since Slick doesn't have support for Seq.
  def * = (
    labelHistoryId, labelId, severity, tags, editedBy, editTime, source, labelValidationId
  ) <> (
    { t: (Int, Int, Option[Int], List[String], String, Timestamp, String, Option[Int]) =>
      LabelHistory(t._1, t._2, t._3, t._4.toSeq, t._5, t._6, t._7, t._8)
    },
    { lh: LabelHistory =>
      Some((lh.labelHistoryId, lh.labelId, lh.severity, lh.tags.toList, lh.editedBy, lh.editTime, lh.source, lh.labelValidationId))
    }
  )

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
  def insert(l: LabelHistory): DBIO[Int]
}

@Singleton
class LabelHistoryTable @Inject()(protected val dbConfigProvider: DatabaseConfigProvider) extends LabelHistoryTableRepository with HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._
  
  val labelHistory = TableQuery[LabelHistoryTableDef]

  def findByLabelId(labelId: Int): DBIO[Seq[LabelHistory]] = {
    labelHistory.filter(_.labelId === labelId).result
  }

  def findByLabelValidationId(labelValidationId: Int): DBIO[Seq[LabelHistory]] = {
    labelHistory.filter(_.labelValidationId === labelValidationId).result
  }

  def insert(l: LabelHistory): DBIO[Int] = {
    (labelHistory returning labelHistory.map(_.labelHistoryId)) +=
      LabelHistory(0, l.labelId, l.severity, l.tags.distinct, l.editedBy, l.editTime, l.source, l.labelValidationId)
  }
}
