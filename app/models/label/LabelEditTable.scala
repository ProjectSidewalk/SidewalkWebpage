package models.label

import com.google.inject.ImplementedBy
import models.api.{LabelEditDataForApi, LabelEditFiltersForApi}
import models.user.SidewalkUserTableDef
import models.utils.CommonUtils.UiSource.UiSource
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import models.validation.LabelValidationTableDef
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

/**
 * One change to a label's severity and/or tags after its creation (#2575): who made it, from what, to what, and
 * from which UI. The source of truth for edits; `label_history` is the state log derived from them.
 *
 * @param labelValidationId The vote this edit was submitted with, when it was made in a validation tool. Such an
 *                          edit lives and dies with its vote; a standalone edit from the label popup has none.
 */
case class LabelEdit(
    labelEditId: Int,
    labelId: Int,
    userId: String,
    oldSeverity: Option[Int],
    newSeverity: Option[Int],
    oldTags: List[String],
    newTags: List[String],
    source: UiSource,
    editTime: OffsetDateTime,
    labelValidationId: Option[Int]
)

class LabelEditTableDef(tag: slick.lifted.Tag) extends Table[LabelEdit](tag, "label_edit") {
  def labelEditId: Rep[Int]         = column[Int]("label_edit_id", O.PrimaryKey, O.AutoInc)
  def labelId: Rep[Int]             = column[Int]("label_id")
  def userId: Rep[String]           = column[String]("user_id")
  def oldSeverity: Rep[Option[Int]] = column[Option[Int]]("old_severity") // CHECK: NULL or 1-3.
  def newSeverity: Rep[Option[Int]] = column[Option[Int]]("new_severity") // CHECK: NULL or 1-3.
  def oldTags: Rep[List[String]]    = column[List[String]]("old_tags")
  def newTags: Rep[List[String]]    = column[List[String]]("new_tags")
  def source: Rep[UiSource]         = column[UiSource]("source")
  // DEFAULT now() in the DB (O.Default holds a value, not an expression).
  def editTime: Rep[OffsetDateTime]       = column[OffsetDateTime]("edit_time")
  def labelValidationId: Rep[Option[Int]] = column[Option[Int]]("label_validation_id")
  // CHECK label_edit_not_noop_check: the severity differs or the tag sets differ.

  def * =
    (labelEditId, labelId, userId, oldSeverity, newSeverity, oldTags, newTags, source, editTime, labelValidationId) <> (
      (LabelEdit.apply _).tupled,
      LabelEdit.unapply
    )

  def label           = foreignKey("label_edit_label_id_fkey", labelId, TableQuery[LabelTableDef])(_.labelId)
  def user            = foreignKey("label_edit_user_id_fkey", userId, TableQuery[SidewalkUserTableDef])(_.userId)
  def labelValidation =
    foreignKey("label_edit_label_validation_id_fkey", labelValidationId, TableQuery[LabelValidationTableDef])(
      _.labelValidationId.?
    )
  def labelValidationUnique = index("label_edit_label_validation_id_key", labelValidationId, unique = true)
}

@ImplementedBy(classOf[LabelEditTable])
trait LabelEditTableRepository {}

@Singleton
class LabelEditTable @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    implicit val ec: ExecutionContext
) extends LabelEditTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val labelEdits       = TableQuery[LabelEditTableDef]
  val labelsUnfiltered = TableQuery[LabelTableDef]

  def insert(edit: LabelEdit): DBIO[Int] =
    (labelEdits returning labelEdits.map(_.labelEditId)) += edit

  def find(labelEditId: Int): DBIO[Option[LabelEdit]] =
    labelEdits.filter(_.labelEditId === labelEditId).result.headOption

  def findByLabelValidationId(labelValidationId: Int): DBIO[Option[LabelEdit]] =
    labelEdits.filter(_.labelValidationId === labelValidationId).result.headOption

  /** The most recent edit to a label, the one a new edit by the same user may fold into. */
  def latestForLabel(labelId: Int): DBIO[Option[LabelEdit]] =
    labelEdits.filter(_.labelId === labelId).sortBy(e => (e.editTime.desc, e.labelEditId.desc)).result.headOption

  /** The edit to the same label made right after `edit`, whose old state is `edit`'s new state. */
  def nextAfter(edit: LabelEdit): DBIO[Option[LabelEdit]] =
    labelEdits
      .filter(e =>
        e.labelId === edit.labelId &&
          (e.editTime > edit.editTime || (e.editTime === edit.editTime && e.labelEditId > edit.labelEditId))
      )
      .sortBy(e => (e.editTime.asc, e.labelEditId.asc))
      .result
      .headOption

  /** Extends a folded edit with a later change: its new state and time move, its old state stays. */
  def updateNewState(labelEditId: Int, severity: Option[Int], tags: List[String], editTime: OffsetDateTime): DBIO[Int] =
    labelEdits
      .filter(_.labelEditId === labelEditId)
      .map(e => (e.newSeverity, e.newTags, e.editTime))
      .update((severity, tags, editTime))

  /** Rebases an edit onto a different starting state, after the edit before it was unwound. */
  def updateOldState(labelEditId: Int, severity: Option[Int], tags: List[String]): DBIO[Int] =
    labelEdits.filter(_.labelEditId === labelEditId).map(e => (e.oldSeverity, e.oldTags)).update((severity, tags))

  def delete(labelEditId: Int): DBIO[Int] = labelEdits.filter(_.labelEditId === labelEditId).delete

  /**
   * Edits for the v3 API, joined to their label.
   */
  def getLabelEditsForApi(filters: LabelEditFiltersForApi): Query[_, (LabelEdit, Label), Seq] = {
    for {
      edit  <- labelEdits
      label <- labelsUnfiltered if edit.labelId === label.labelId
      if filters.labelId.map(edit.labelId === _).getOrElse(true: Rep[Boolean]) &&
        filters.userId.map(edit.userId === _).getOrElse(true: Rep[Boolean]) &&
        filters.labelType.map(label.labelType === _).getOrElse(true: Rep[Boolean]) &&
        filters.editTimestamp.map(edit.editTime >= _).getOrElse(true: Rep[Boolean]) &&
        filters.source.map(edit.source === _).getOrElse(true: Rep[Boolean]) &&
        filters.withValidation.map(linked => edit.labelValidationId.isDefined === linked).getOrElse(true: Rep[Boolean])
    } yield (edit, label)
  }

  /** Converts a row from `getLabelEditsForApi` to its API shape. */
  def tupleToLabelEditDataForApi(tuple: (LabelEdit, Label)): LabelEditDataForApi = {
    val (edit, label) = tuple
    LabelEditDataForApi(
      labelEditId = edit.labelEditId, labelId = edit.labelId, labelType = label.labelType.name, userId = edit.userId,
      oldSeverity = edit.oldSeverity, newSeverity = edit.newSeverity, oldTags = edit.oldTags, newTags = edit.newTags,
      source = edit.source, editTime = edit.editTime, labelValidationId = edit.labelValidationId
    )
  }
}
