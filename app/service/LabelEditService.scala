package service

import com.google.inject.ImplementedBy
import models.cluster.ClusterLabelTable
import models.label._
import models.user.{Role, SidewalkUserWithRole, UserStatTable}
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

  /** The label's type changed under the editor, so the edit they built on the old type was not applied. */
  case class Conflict(label: Label) extends LabelEditOutcome
}

@ImplementedBy(classOf[LabelEditServiceImpl])
trait LabelEditService {
  def applyEdit(
      labelId: Int,
      userId: String,
      labelType: Option[LabelTypeEnum.Base],
      severity: Option[Int],
      tags: Seq[String],
      source: UiSource,
      labelValidationId: Option[Int]
  ): DBIO[Option[Label]]
  def editLabel(
      labelId: Int,
      editor: SidewalkUserWithRole,
      labelTypeSeen: Option[LabelTypeEnum.Base],
      labelType: Option[LabelTypeEnum.Base],
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
 * Records changes to a label's type, severity and tags (#2575, #3671).
 *
 * Every change after a label's creation is a `label_edit` row with a matching `label_history` row recording the
 * resulting state; the label row itself is updated alongside. An edit submitted with a validation is linked to it and
 * is unwound when the vote is; a standalone edit from the label popup stands on its own.
 *
 * A type change also puts a different set of the label's votes in play (only votes cast on the current type count),
 * takes the label out of its per-type cluster, and moves its crop to the new type's directory.
 */
@Singleton
class LabelEditServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    labelTable: LabelTable,
    labelEditTable: LabelEditTable,
    labelHistoryTable: LabelHistoryTable,
    labelService: LabelService,
    userStatTable: UserStatTable,
    clusterLabelTable: ClusterLabelTable,
    panoDataService: PanoDataService,
    shareImageCache: ShareImageCache,
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

  /** The type, severity and tags a label has, or would have; tags compare as sets because their stored order is arbitrary. */
  private case class State(labelType: LabelTypeEnum.Base, severity: Option[Int], tags: List[String]) {
    def sameAs(other: State): Boolean =
      labelType == other.labelType && severity == other.severity && tags.toSet == other.tags.toSet
  }

  private def stateOf(label: Label): State = State(label.labelType, label.severity, label.tags)

  /**
   * Records a change to a label's type, severity and/or tags, and applies it to the label.
   *
   * The submitted values are the state the editor wants. Tags are cleaned against the (new) type. When the type
   * changes, a submitted severity equal to the label's current one is taken as carried over, and survives only if
   * both types read their rating the same way; a different one is a rating given for the new type and stands. Any
   * type never rated gets none. Nothing is written if the result leaves the label as it is.
   * A standalone edit by the same user from the same surface as the label's latest edit, within EDIT_FOLD_WINDOW of
   * it, folds into that row; a fold that nets out to the row's starting state deletes the row instead.
   *
   * @param labelType         The type the label should have; None keeps its current one.
   * @param labelValidationId The vote the edit is submitted with, for edits made in a validation tool. Such an edit
   *                          is unwound with the vote and never folds.
   * @return The label as it now stands, or None if there is no such label.
   */
  def applyEdit(
      labelId: Int,
      userId: String,
      labelType: Option[LabelTypeEnum.Base],
      severity: Option[Int],
      tags: Seq[String],
      source: UiSource,
      labelValidationId: Option[Int]
  ): DBIO[Option[Label]] = {
    val labelQuery = labelsUnfiltered.filter(_.labelId === labelId)
    labelQuery.result.headOption.flatMap {
      case None        => DBIO.successful(None)
      case Some(label) =>
        val newType: LabelTypeEnum.Base = labelType.getOrElse(label.labelType)
        val newSeverity: Option[Int]    =
          if (newType == label.labelType || severity != label.severity) labelService.severityFor(newType, severity)
          else LabelTypeEnum.severityAfterTypeChange(label.labelType, newType, severity)
        labelService.cleanTagList(tags, newType).flatMap { cleaned =>
          val target = State(newType, newSeverity, cleaned.toList)
          if (target.sameAs(stateOf(label))) DBIO.successful(Some(label))
          else {
            val now = OffsetDateTime.now
            for {
              latest <- labelEditTable.latestForLabel(labelId)
              _      <- latest match {
                case Some(prev) if labelValidationId.isEmpty && foldsInto(prev, userId, source, now) =>
                  if (target.sameAs(State(prev.oldLabelType, prev.oldSeverity, prev.oldTags))) {
                    labelHistoryTable.deleteForEdit(prev.labelEditId).andThen(labelEditTable.delete(prev.labelEditId))
                  } else {
                    labelEditTable
                      .updateNewState(prev.labelEditId, target.labelType, target.severity, target.tags, now)
                      .andThen(
                        labelHistoryTable
                          .updateStateForEdit(prev.labelEditId, target.labelType, target.severity, target.tags, now)
                      )
                  }
                case _ =>
                  for {
                    editId <- labelEditTable.insert(
                      LabelEdit(0, labelId, userId, label.labelType, target.labelType, label.severity, target.severity,
                        label.tags, target.tags, source, now, labelValidationId)
                    )
                    _ <- labelHistoryTable.insert(
                      LabelHistory(0, labelId, target.labelType, target.severity, target.tags, userId, now, source,
                        Some(editId))
                    )
                  } yield ()
              }
              _ <- writeState(label, target)
            } yield Some(label.copy(labelType = target.labelType, severity = target.severity, tags = target.tags))
          }
        }
    }.transactionally
  }

  private def foldsInto(prev: LabelEdit, userId: String, source: UiSource, now: OffsetDateTime): Boolean =
    prev.userId == userId && prev.source == source && prev.labelValidationId.isEmpty &&
      prev.editTime.isAfter(now.minus(EDIT_FOLD_WINDOW))

  private def writeState(label: Label, target: State): DBIO[Unit] = {
    val update = labelsUnfiltered
      .filter(_.labelId === label.labelId)
      .map(l => (l.labelType, l.severity, l.tags))
      .update((target.labelType, target.severity, target.tags))
    if (target.labelType == label.labelType) update.map(_ => ())
    else update.andThen(afterTypeChange(label, target.labelType))
  }

  /**
   * What follows a label changing type from `label.labelType` to `newType`:
   *  - only votes cast on the current type count, so the label's counts and its labeler's accuracy are recomputed;
   *  - clusters are per type, so the label leaves its cluster (which also gets the region re-clustered);
   *  - crops are filed by type, so the crop moves, and the cached share image built on the old type is dropped.
   * The file moves happen inside the transaction; a rollback after them leaves nothing broken, since a crop is
   * looked up by the label's type and is re-cut by CropService when missing.
   */
  private def afterTypeChange(label: Label, newType: LabelTypeEnum.Base): DBIO[Unit] = {
    for {
      _ <- labelTable.recalculateValidationCountsForLabel(label.labelId)
      _ <- userStatTable.updateAccuracy(Seq(label.userId))
      _ <- clusterLabelTable.deleteForLabel(label.labelId)
    } yield {
      panoDataService.moveCrop(label.labelId, label.labelType, newType)
      shareImageCache.invalidate(label.labelId)
    }
  }

  /**
   * An edit from the label popup, allowed to the labeler and to admins.
   *
   * @param labelTypeSeen The type the popup showed the editor, when it sends one. An edit built on a type the label no
   *                      longer has is refused as a Conflict rather than applied to the wrong type.
   */
  def editLabel(
      labelId: Int,
      editor: SidewalkUserWithRole,
      labelTypeSeen: Option[LabelTypeEnum.Base],
      labelType: Option[LabelTypeEnum.Base],
      severity: Option[Int],
      tags: Seq[String],
      source: UiSource
  ): Future[LabelEditOutcome] = {
    val isAdmin: Boolean = Role.ADMIN_ROLES.contains(editor.role)
    db.run(
      labelTable
        .find(labelId)
        .flatMap {
          case None                                                      => DBIO.successful(LabelEditOutcome.NotFound)
          case Some(label) if label.deleted                              => DBIO.successful(LabelEditOutcome.NotFound)
          case Some(label) if label.userId != editor.userId && !isAdmin  => DBIO.successful(LabelEditOutcome.Forbidden)
          case Some(label) if labelTypeSeen.exists(_ != label.labelType) =>
            DBIO.successful(LabelEditOutcome.Conflict(label))
          case Some(_) =>
            applyEdit(labelId, editor.userId, labelType, severity, tags, source, None).map {
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
    val oldState = State(edit.oldLabelType, edit.oldSeverity, edit.oldTags)
    for {
      next  <- labelEditTable.nextAfter(edit)
      label <- labelsUnfiltered.filter(_.labelId === edit.labelId).result.head
      _     <- labelHistoryTable.deleteForEdit(edit.labelEditId)
      _     <- labelEditTable.delete(edit.labelEditId)
      _     <- next match {
        case None                                                                        => writeState(label, oldState)
        case Some(n) if oldState.sameAs(State(n.newLabelType, n.newSeverity, n.newTags)) =>
          labelHistoryTable.deleteForEdit(n.labelEditId).andThen(labelEditTable.delete(n.labelEditId))
        case Some(n) =>
          labelEditTable.updateOldState(n.labelEditId, edit.oldLabelType, edit.oldSeverity, edit.oldTags)
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
        if (historyCount > 1) applyEdit(labelId, label.userId, None, severity, tags, UiSource.Explore, None)
        else {
          labelService.cleanTagList(tags, label.labelType).flatMap { cleaned =>
            val target = State(label.labelType, labelService.severityFor(label.labelType, severity), cleaned.toList)
            if (!target.sameAs(stateOf(label))) {
              for {
                _ <- labelHistoryTable.labelHistory
                  .filter(_.labelId === labelId)
                  .map(h => (h.severity, h.tags))
                  .update((target.severity, target.tags))
                _ <- labelQuery.map(l => (l.severity, l.tags)).update((target.severity, target.tags))
              } yield ()
            } else DBIO.successful(())
          }
        }
      rowsUpdated: Int <- labelQuery.map(l => (l.deleted, l.description)).update((deleted, description))
    } yield rowsUpdated
  }
}
