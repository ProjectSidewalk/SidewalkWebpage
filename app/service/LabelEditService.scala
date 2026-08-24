package service

import com.google.inject.ImplementedBy
import models.label._
import models.user.{RoleTable, SidewalkUserWithRole}
import models.utils.CommonUtils.UiSource
import models.utils.CommonUtils.UiSource.UiSource
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.{Duration, OffsetDateTime}
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

/** What came of a request to edit a label from the label popup. */
sealed trait LabelEditOutcome
object LabelEditOutcome {
  case object NotFound             extends LabelEditOutcome
  case object Forbidden            extends LabelEditOutcome
  case class Applied(label: Label) extends LabelEditOutcome
}

@ImplementedBy(classOf[LabelEditServiceImpl])
trait LabelEditService {
  def applyEdit(
      labelId: Int,
      userId: String,
      severity: Option[Int],
      tags: Seq[String],
      source: UiSource,
      labelValidationId: Option[Int]
  ): DBIO[Option[Label]]
  def editLabel(
      labelId: Int,
      editor: SidewalkUserWithRole,
      severity: Option[Int],
      tags: Seq[String],
      source: UiSource
  ): Future[LabelEditOutcome]
  def revertEditForValidation(labelValidationId: Int): DBIO[Boolean]
  def updateLabelFromExplore(
      labelId: Int,
      deleted: Boolean,
      severity: Option[Int],
      description: Option[String],
      tags: List[String]
  ): DBIO[Int]
}

/**
 * Records changes to a label's severity and tags (#2575).
 *
 * Every change after a label's creation is a `label_edit` row (who, from what, to what, where) with a matching
 * `label_history` row recording the resulting state; the label row itself is updated alongside. An edit submitted
 * with a validation is linked to it and is unwound when the vote is; a standalone edit from the label popup stands
 * on its own, whatever the editor later votes.
 */
@Singleton
class LabelEditServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    labelTable: LabelTable,
    labelEditTable: LabelEditTable,
    labelHistoryTable: LabelHistoryTable,
    labelService: LabelService,
    implicit val ec: ExecutionContext
) extends LabelEditService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  /**
   * How long a standalone edit stays open to folding. The popup writes each change as it happens, so without folding
   * one visit to a label would scatter across several rows; a user's consecutive changes from the same surface within
   * this window update one row instead, and a row whose changes net out is removed.
   */
  val EDIT_FOLD_WINDOW: Duration = Duration.ofMinutes(15)

  private val labelsUnfiltered = TableQuery[LabelTableDef]

  /** Whether a label's severity and tags would change; tags compare as sets because their stored order is arbitrary. */
  private def changes(label: Label, severity: Option[Int], tags: Seq[String]): Boolean =
    label.severity != severity || label.tags.toSet != tags.toSet

  /**
   * Records a change to a label's severity and tags, and applies it to the label.
   *
   * Tags are cleaned against the label's type first, and nothing is written if the result leaves the label as it is.
   * A standalone edit by the same user from the same surface as the label's latest edit, within EDIT_FOLD_WINDOW of
   * it, folds into that row; a fold that nets out to the row's starting state deletes the row instead.
   *
   * @param labelValidationId The vote the edit is submitted with, for edits made in a validation tool. Such an edit
   *                          is unwound with the vote and never folds.
   * @return The label as it now stands, or None if there is no such label.
   */
  def applyEdit(
      labelId: Int,
      userId: String,
      severity: Option[Int],
      tags: Seq[String],
      source: UiSource,
      labelValidationId: Option[Int]
  ): DBIO[Option[Label]] = {
    val labelQuery = labelsUnfiltered.filter(_.labelId === labelId)
    labelQuery.result.headOption.flatMap {
      case None        => DBIO.successful(None)
      case Some(label) =>
        labelService.cleanTagList(tags, label.labelTypeId).flatMap { cleaned =>
          val cleanedTags: List[String] = cleaned.toList
          if (!changes(label, severity, cleanedTags)) DBIO.successful(Some(label))
          else {
            val now = OffsetDateTime.now
            for {
              latest <- labelEditTable.latestForLabel(labelId)
              _      <- latest match {
                case Some(prev) if labelValidationId.isEmpty && foldsInto(prev, userId, source, now) =>
                  if (prev.oldSeverity == severity && prev.oldTags.toSet == cleanedTags.toSet) {
                    labelHistoryTable.deleteForEdit(prev.labelEditId).andThen(labelEditTable.delete(prev.labelEditId))
                  } else {
                    labelEditTable
                      .updateNewState(prev.labelEditId, severity, cleanedTags, now)
                      .andThen(labelHistoryTable.updateStateForEdit(prev.labelEditId, severity, cleanedTags, now))
                  }
                case _ =>
                  for {
                    editId <- labelEditTable.insert(
                      LabelEdit(0, labelId, userId, label.severity, severity, label.tags, cleanedTags, source, now,
                        labelValidationId)
                    )
                    _ <- labelHistoryTable.insert(
                      LabelHistory(0, labelId, severity, cleanedTags, userId, now, source, Some(editId))
                    )
                  } yield ()
              }
              _ <- labelQuery.map(l => (l.severity, l.tags)).update((severity, cleanedTags))
            } yield Some(label.copy(severity = severity, tags = cleanedTags))
          }
        }
    }.transactionally
  }

  private def foldsInto(prev: LabelEdit, userId: String, source: UiSource, now: OffsetDateTime): Boolean =
    prev.userId == userId && prev.source == source && prev.labelValidationId.isEmpty &&
      prev.editTime.isAfter(now.minus(EDIT_FOLD_WINDOW))

  /** An edit from the label popup, allowed to the labeler and to admins. */
  def editLabel(
      labelId: Int,
      editor: SidewalkUserWithRole,
      severity: Option[Int],
      tags: Seq[String],
      source: UiSource
  ): Future[LabelEditOutcome] = {
    val isAdmin: Boolean = RoleTable.ADMIN_ROLES.contains(editor.role)
    db.run(
      labelTable
        .find(labelId)
        .flatMap {
          case None                                                     => DBIO.successful(LabelEditOutcome.NotFound)
          case Some(label) if label.deleted                             => DBIO.successful(LabelEditOutcome.NotFound)
          case Some(label) if label.userId != editor.userId && !isAdmin => DBIO.successful(LabelEditOutcome.Forbidden)
          case Some(_)                                                  =>
            applyEdit(labelId, editor.userId, severity, tags, source, None).map {
              case Some(updated) => LabelEditOutcome.Applied(updated)
              case None          => LabelEditOutcome.NotFound
            }
        }
        .transactionally
    )
  }

  /**
   * Unwinds the edit submitted with a validation, for when the vote is deleted or replaced.
   * @return Whether the validation had an edit to unwind.
   */
  def revertEditForValidation(labelValidationId: Int): DBIO[Boolean] = {
    labelEditTable
      .findByLabelValidationId(labelValidationId)
      .flatMap {
        case None       => DBIO.successful(false)
        case Some(edit) => revertEdit(edit).map(_ => true)
      }
      .transactionally
  }

  /**
   * Removes an edit as though it never happened. If it was the label's latest, the label goes back to the edit's
   * old state. Otherwise the edit after it is rebased onto that old state -- and dropped too if, from there, it
   * changes nothing (its new state equals that old state).
   */
  private def revertEdit(edit: LabelEdit): DBIO[Unit] = {
    for {
      next <- labelEditTable.nextAfter(edit)
      _    <- labelHistoryTable.deleteForEdit(edit.labelEditId)
      _    <- labelEditTable.delete(edit.labelEditId)
      _    <- next match {
        case None =>
          labelsUnfiltered
            .filter(_.labelId === edit.labelId)
            .map(l => (l.severity, l.tags))
            .update((edit.oldSeverity, edit.oldTags))
        case Some(n) if n.newSeverity == edit.oldSeverity && n.newTags.toSet == edit.oldTags.toSet =>
          labelHistoryTable.deleteForEdit(n.labelEditId).andThen(labelEditTable.delete(n.labelEditId))
        case Some(n) =>
          labelEditTable.updateOldState(n.labelEditId, edit.oldSeverity, edit.oldTags)
      }
    } yield ()
  }

  /**
   * Updates the metadata a user can change on the Explore page after placing a label. While the label's only history
   * row is its creation row, the change is part of placing it and that row absorbs it; after that it is an edit.
   */
  def updateLabelFromExplore(
      labelId: Int,
      deleted: Boolean,
      severity: Option[Int],
      description: Option[String],
      tags: List[String]
  ): DBIO[Int] = {
    val labelQuery = labelsUnfiltered.filter(_.labelId === labelId)
    for {
      label: Label      <- labelQuery.result.head
      historyCount: Int <- labelHistoryTable.countForLabel(labelId)
      _                 <-
        if (historyCount > 1) applyEdit(labelId, label.userId, severity, tags, UiSource.Explore, None)
        else {
          labelService.cleanTagList(tags, label.labelTypeId).flatMap { cleaned =>
            val cleanedTags: List[String] = cleaned.toList
            if (changes(label, severity, cleanedTags)) {
              for {
                _ <- labelHistoryTable.labelHistory
                  .filter(_.labelId === labelId)
                  .map(h => (h.severity, h.tags))
                  .update((severity, cleanedTags))
                _ <- labelQuery.map(l => (l.severity, l.tags)).update((severity, cleanedTags))
              } yield ()
            } else DBIO.successful(())
          }
        }
      rowsUpdated: Int <- labelQuery.map(l => (l.deleted, l.description)).update((deleted, description))
    } yield rowsUpdated
  }
}
