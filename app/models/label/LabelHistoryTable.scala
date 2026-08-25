package models.label

import com.google.inject.ImplementedBy
import models.user.SidewalkUserTableDef
import models.utils.CommonUtils.UiSource.UiSource
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}

/**
 * The state of a label's severity and tags at one point in its life: its creation (one row per label, `labelEditId`
 * empty) and then after each edit (one row per `label_edit`, the source of truth this log is derived from).
 */
case class LabelHistory(
    labelHistoryId: Int,
    labelId: Int,
    severity: Option[Int],
    tags: Seq[String],
    editedBy: String,
    editTime: OffsetDateTime,
    source: UiSource,
    labelEditId: Option[Int]
)

class LabelHistoryTableDef(tag: slick.lifted.Tag) extends Table[LabelHistory](tag, "label_history") {
  def labelHistoryId: Rep[Int]   = column[Int]("label_history_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int]          = column[Int]("label_id")
  def severity: Rep[Option[Int]] = column[Option[Int]]("severity")
  def tags: Rep[List[String]]    = column[List[String]]("tags", O.Default(List()))
  def editedBy: Rep[String]      = column[String]("edited_by")
  // DEFAULT now() in the DB (O.Default holds a value, not an expression).
  def editTime: Rep[OffsetDateTime] = column[OffsetDateTime]("edit_time")
  def source: Rep[UiSource]         = column[UiSource]("source")
  def labelEditId: Rep[Option[Int]] = column[Option[Int]]("label_edit_id")

  // Need to do all this nonsense just to convert tags from a List to a Seq, since Slick doesn't have support for Seq.
  def * = (
    labelHistoryId, labelId, severity, tags, editedBy, editTime, source, labelEditId
  ) <> (
    { t: (Int, Int, Option[Int], List[String], String, OffsetDateTime, UiSource, Option[Int]) =>
      LabelHistory(t._1, t._2, t._3, t._4, t._5, t._6, t._7, t._8)
    },
    { lh: LabelHistory =>
      Some(
        (lh.labelHistoryId, lh.labelId, lh.severity, lh.tags.toList, lh.editedBy, lh.editTime, lh.source,
          lh.labelEditId)
      )
    }
  )

  def label        = foreignKey("label_history_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
  def editedByUser = foreignKey("label_history_edited_by_fkey", editedBy, TableQuery[SidewalkUserTableDef])(_.userId)
  def labelEdit    =
    foreignKey("label_history_label_edit_id_fkey", labelEditId, TableQuery[LabelEditTableDef])(_.labelEditId.?)
  def labelEditUnique = index("label_history_label_edit_id_key", labelEditId, unique = true)
}

@ImplementedBy(classOf[LabelHistoryTable])
trait LabelHistoryTableRepository {}

@Singleton
class LabelHistoryTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)
    extends LabelHistoryTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val labelHistory = TableQuery[LabelHistoryTableDef]

  def findByLabelId(labelId: Int): DBIO[Seq[LabelHistory]] = {
    labelHistory.filter(_.labelId === labelId).result
  }

  def countForLabel(labelId: Int): DBIO[Int] = labelHistory.filter(_.labelId === labelId).length.result

  def insert(l: LabelHistory): DBIO[Int] = {
    (labelHistory returning labelHistory.map(_.labelHistoryId)) +=
      LabelHistory(0, l.labelId, l.severity, l.tags.distinct, l.editedBy, l.editTime, l.source, l.labelEditId)
  }

  /** Moves the row recording an edit's outcome along with the edit, when a later change is folded into it. */
  def updateStateForEdit(
      labelEditId: Int,
      severity: Option[Int],
      tags: List[String],
      editTime: OffsetDateTime
  ): DBIO[Int] =
    labelHistory
      .filter(_.labelEditId === labelEditId)
      .map(h => (h.severity, h.tags, h.editTime))
      .update((severity, tags, editTime))

  def deleteForEdit(labelEditId: Int): DBIO[Int] = labelHistory.filter(_.labelEditId === labelEditId).delete
}
