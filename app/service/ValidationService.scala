package service

import com.google.inject.ImplementedBy
import models.label._
import models.mission.MissionType
import models.user.{Role, SidewalkUserWithRole, UserStatTable}
import models.utils.CommonUtils.UiSource.UiSource
import models.utils.CommonUtils.ViewerType
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import models.validation._
import org.postgresql.util.{PSQLException, PSQLState}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

/**
 * One vote to record, with the type, severity and tags the validator wants the label to have. Those are applied as an
 * edit linked to the vote only for an Agree that changes them (#2575, #3671).
 *
 * @param validation   The vote, with `labelType` set to the type the validator was shown.
 * @param newLabelType The type the label should become; an Agree carrying one is recorded as a vote on that type.
 * @param canEdit      Whether an Agree may apply the submitted type, severity and tags; only admins edit through a vote.
 */
case class ValidationSubmission(
    validation: LabelValidation,
    newLabelType: Option[LabelTypeEnum.Base],
    severity: Option[Int],
    tags: List[String],
    comment: Option[ValidationTaskComment],
    undone: Boolean,
    redone: Boolean,
    canEdit: Boolean
)

/** A canned reason the user's standing vote on the label doesn't take (#5475); the comment is not stored. */
case class ReasonNotOffered(reason: ValidationReason.Value) extends Exception(s"reason '$reason' not offered here")

@ImplementedBy(classOf[ValidationServiceImpl])
trait ValidationService {
  def countValidations: Future[Int]
  def countHumanValidations: Future[Int]
  def countValidations(userId: String): Future[Int]
  def insertEnvironment(env: ValidationTaskEnvironment): Future[Int]
  def insertMultipleInteractions(interactions: Seq[ValidationTaskInteraction]): Future[Seq[Int]]
  def replaceComment(comment: ValidationTaskComment, labelType: LabelTypeEnum.Base): Future[Int]
  def deleteComment(labelId: Int, userId: String): Future[Int]
  def currentVote(labelId: Int, userId: String, labelType: LabelTypeEnum.Base): Future[Option[ValidationOption.Value]]
  def submitValidations(validationSubmissions: Seq[ValidationSubmission]): Future[Seq[Int]]
  def submitValidationsDbio(validationSubmissions: Seq[ValidationSubmission]): DBIO[Seq[Int]]
  def deleteLabel(labelId: Int, editor: SidewalkUserWithRole, source: UiSource): Future[LabelEditOutcome]
}

@Singleton
class ValidationServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    labelValidationTable: LabelValidationTable,
    validationTaskEnvironmentTable: ValidationTaskEnvironmentTable,
    validationTaskInteractionTable: ValidationTaskInteractionTable,
    validationTaskCommentTable: ValidationTaskCommentTable,
    labelTable: LabelTable,
    labelPointTable: LabelPointTable,
    labelEditService: LabelEditService,
    missionService: MissionService,
    userStatTable: UserStatTable,
    implicit val ec: ExecutionContext
) extends ValidationService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val validationLabels = TableQuery[LabelValidationTableDef]
  val labelsUnfiltered = TableQuery[LabelTableDef]

  /** SQLState for a Postgres unique-constraint violation. */
  private val UniqueViolation: String = PSQLState.UNIQUE_VIOLATION.getState

  /**
   * Runs a write that replaces a user's earlier row, re-running it once if a concurrent writer got there first.
   *
   * Neither write path can see a concurrent writer's uncommitted row: one reads its own snapshot to decide whether to
   * replace and finds nothing, the other deletes and removes nothing, so both go on to insert. Re-running once is
   * enough: the winner has committed by then, so the retry's read or delete does see its row (#4377, #4942).
   */
  private def runWithUniqueViolationRetry[T](action: => DBIO[T]): Future[T] = {
    db.run(action).recoverWith { case e: PSQLException if e.getSQLState == UniqueViolation => db.run(action) }
  }

  def countValidations: Future[Int]                 = db.run(labelValidationTable.countValidations)
  def countHumanValidations: Future[Int]            = db.run(labelValidationTable.countHumanValidations)
  def countValidations(userId: String): Future[Int] = db.run(labelValidationTable.countValidations(userId))

  /**
   * Updates the validation counts and correctness columns in the label table given a new incoming validation.
   * @param labelId label_id of the label with a new validation
   * @param newResult the new validation if there is one (Agree, Disagree, or Unsure)
   * @param oldResult the old validation if the user had validated this label in the past
   */
  def updateValidationCounts(
      labelId: Int,
      newResult: Option[ValidationOption.Value],
      oldResult: Option[ValidationOption.Value]
  ): DBIO[Int] = {
    labelTable
      .find(labelId)
      .flatMap {
        case Some(label) =>
          // Get the validation counts that are in the database right now.
          val oldCounts: (Int, Int, Int) = (label.agreeCount, label.disagreeCount, label.unsureCount)

          // Add 1 to the correct count for the new validation. In case of delete, no match is found.
          val countsWithNewVal: (Int, Int, Int) = newResult match {
            case Some(ValidationOption.Agree)    => (oldCounts._1 + 1, oldCounts._2, oldCounts._3)
            case Some(ValidationOption.Disagree) => (oldCounts._1, oldCounts._2 + 1, oldCounts._3)
            case Some(ValidationOption.Unsure)   => (oldCounts._1, oldCounts._2, oldCounts._3 + 1)
            case _                               => oldCounts
          }

          // If there was a previous validation from this user, subtract 1 for that old validation. O/w use previous result.
          val countsWithoutOldVal: (Int, Int, Int) = oldResult match {
            case Some(ValidationOption.Agree)    => (countsWithNewVal._1 - 1, countsWithNewVal._2, countsWithNewVal._3)
            case Some(ValidationOption.Disagree) => (countsWithNewVal._1, countsWithNewVal._2 - 1, countsWithNewVal._3)
            case Some(ValidationOption.Unsure)   => (countsWithNewVal._1, countsWithNewVal._2, countsWithNewVal._3 - 1)
            case _                               => countsWithNewVal
          }

          // Determine whether the label is correct. Agree > disagree = correct; disagree > agree = incorrect; o/w null.
          val labelCorrect: Option[Boolean] = {
            if (countsWithoutOldVal._1 > countsWithoutOldVal._2) Some(true)
            else if (countsWithoutOldVal._2 > countsWithoutOldVal._1) Some(false)
            else None
          }

          // Update the agree_count, disagree_count, unsure_count, and correct columns in the label table.
          labelsUnfiltered
            .filter(_.labelId === labelId)
            .map(l => (l.agreeCount, l.disagreeCount, l.unsureCount, l.correct))
            .update((countsWithoutOldVal._1, countsWithoutOldVal._2, countsWithoutOldVal._3, labelCorrect))

        case None =>
          DBIO.successful(0)
      }
      .transactionally
  }

  /**
   * Whether a vote goes into the label's counts: not the labeler's own, not from an excluded user, and cast on the
   * type the label has now (#3671). Must match `FilteredTables.isVerdictVote`.
   */
  private def counts(vote: LabelValidation, label: Label, excludedUser: Boolean): Boolean =
    label.userId != vote.userId && !excludedUser && vote.labelType == label.labelType

  /**
   * Deletes a validation in the label_validation table, unwinding the edit it was submitted with. Also updates
   * validation counts in the label table.
   * @param oldVal The validation to delete.
   * @param retracted Whether the vote is being taken back, as opposed to replaced by a newer one from the same user.
   *                  A replacement keeps any type change the vote carried; see revertEditForValidation.
   * @return Int count of rows deleted, either 0 or 1.
   */
  private def deleteLabelValidation(oldVal: LabelValidation, retracted: Boolean): DBIO[Int] = {
    (for {
      _ <- {
        if (oldVal.validationResult == ValidationOption.Agree)
          labelEditService.revertEditForValidation(oldVal.labelValidationId, retracted)
        else DBIO.successful(false)
      }
      excludedUser <- userStatTable.isExcludedUser(oldVal.userId)
      // Read after the revert: unwinding a type change puts the label back on the type this vote was cast on.
      label        <- labelTable.find(oldVal.labelId).map(_.get)
      rowsAffected <- validationLabels.filter(_.labelValidationId === oldVal.labelValidationId).delete
      _            <- {
        if (counts(oldVal, label, excludedUser))
          updateValidationCounts(oldVal.labelId, None, Some(oldVal.validationResult))
        else DBIO.successful(0)
      }
    } yield {
      rowsAffected
    }).transactionally
  }

  /**
   * Inserts into the label_validation table. Updates severity, tags, & validation counts in the label table.
   * @return The label_validation_id of the inserted/updated validation.
   */
  def insert(labelVal: LabelValidation): DBIO[Int] = {
    for {
      isExcludedUser <- userStatTable.isExcludedUser(labelVal.userId)
      label          <- labelsUnfiltered.filter(_.labelId === labelVal.labelId).result.head
      _              <- {
        if (counts(labelVal, label, isExcludedUser))
          updateValidationCounts(labelVal.labelId, Some(labelVal.validationResult), None)
        else DBIO.successful(0)
      }
      newValId <- (validationLabels returning validationLabels.map(_.labelValidationId)) += labelVal
    } yield newValId
  }.transactionally

  def insertEnvironment(env: ValidationTaskEnvironment): Future[Int] =
    db.run(validationTaskEnvironmentTable.insert(env))

  def insertMultipleInteractions(interactions: Seq[ValidationTaskInteraction]): Future[Seq[Int]] =
    db.run(validationTaskInteractionTable.insertMultiple(interactions))

  /**
   * Records the user's comment on a label, replacing whatever they had said about it before.
   *
   * A canned reason has to be one the user's standing vote takes (#5475), and that vote can be moving at the same
   * moment: a vote change on the label card deletes the old comment and inserts the new vote in its own
   * transaction. So the vote row is read `FOR UPDATE` inside this transaction — a change in flight commits first
   * and the row is then gone, so the reason is refused rather than filed under the new vote — and the controller's
   * earlier read of the vote is only the friendly early answer.
   *
   * @param labelType The label's type as the client saw it, the key a vote row is looked up by.
   * @return The validation_task_comment_id of the comment that was stored.
   * @throws ReasonNotOffered when the reason isn't one the user's current vote on the label takes.
   */
  def replaceComment(comment: ValidationTaskComment, labelType: LabelTypeEnum.Base): Future[Int] =
    runWithUniqueViolationRetry {
      val reasonAllowed: DBIO[Unit] = comment.reason match {
        case None         => DBIO.successful(())
        case Some(reason) =>
          labelValidationTable.lockValidation(comment.labelId, comment.userId, labelType).flatMap { vote =>
            if (vote.exists(v => ValidationReason.offered(labelType, v).contains(reason))) DBIO.successful(())
            else DBIO.failed(ReasonNotOffered(reason))
          }
      }
      (for {
        _ <- reasonAllowed
        _ <- validationTaskCommentTable.archive(comment.labelId, comment.userId, ValidationCommentChangeType.Edit)
        commentId <- validationTaskCommentTable.insert(comment)
      } yield commentId).transactionally
    }

  /**
   * The user's standing vote on a label, as the reason a comment may carry has to be one that vote takes (#5475).
   * @return The vote on the label's current type, or None when they have none.
   */
  def currentVote(labelId: Int, userId: String, labelType: LabelTypeEnum.Base): Future[Option[ValidationOption.Value]] =
    db.run(labelValidationTable.getValidation(labelId, userId, labelType)).map(_.map(_.validationResult))

  /**
   * Removes the user's comment on a label, if they left one.
   *
   * Backs the label card's explicit Delete control (#5015). Deleting is otherwise only reachable by clearing the
   * vote the comment rode in on, which throws away the verdict along with the text.
   *
   * The text leaves every read path in the tool but is kept in `validation_task_comment_history`, marked a
   * deliberate delete rather than a side effect (#5076).
   *
   * @return Count of comments deleted, 0 or 1.
   */
  def deleteComment(labelId: Int, userId: String): Future[Int] =
    db.run(validationTaskCommentTable.archive(labelId, userId, ValidationCommentChangeType.Delete))

  /**
   * Submits a set of validations from a POST request on Validate.
   * @param validationSubmissions A sequence of ValidationSubmission objects
   * @return A sequence of the label_validation_ids of the inserted/updated validations.
   */
  def submitValidations(validationSubmissions: Seq[ValidationSubmission]): Future[Seq[Int]] =
    runWithUniqueViolationRetry(submitValidationsDbio(validationSubmissions))

  /**
   * Deletes a label from the label popup (#3591). An admin deleting someone else's label first files a Disagree, so
   * the delete counts against the labeler the way a vote would. Anyone but the labeler or an admin is refused.
   */
  def deleteLabel(labelId: Int, editor: SidewalkUserWithRole, source: UiSource): Future[LabelEditOutcome] = {
    val isAdmin: Boolean = Role.ADMIN_ROLES.contains(editor.role)
    db.run(labelTable.find(labelId)).flatMap {
      case None                                                     => Future.successful(LabelEditOutcome.NotFound)
      case Some(label) if label.userId != editor.userId && !isAdmin => Future.successful(LabelEditOutcome.Forbidden)
      case Some(label) if label.deleted                 => Future.successful(LabelEditOutcome.Applied(label))
      case Some(label) if label.userId == editor.userId =>
        db.run(labelEditService.deleteLabelDbio(labelId, editor.userId, source).transactionally)
      case Some(label) =>
        missionService
          .resumeOrCreateNewValidateMission(editor.userId, MissionType.LabelmapValidation, label.labelType)
          .flatMap { mission =>
            runWithUniqueViolationRetry(
              (for {
                _       <- disagreeAsAdmin(label, editor.userId, mission.get.missionId, source)
                outcome <- labelEditService.deleteLabelDbio(labelId, editor.userId, source)
              } yield outcome).transactionally
            )
          }
    }
  }

  /** A Disagree on the label from where it was placed, the only viewpoint a delete has. */
  private def disagreeAsAdmin(label: Label, adminId: String, missionId: Int, source: UiSource): DBIO[Seq[Int]] = {
    val now = OffsetDateTime.now
    labelPointTable.labelPoints.filter(_.labelId === label.labelId).result.head.flatMap { point =>
      submitValidationsDbio(
        Seq(
          ValidationSubmission(
            LabelValidation(0, label.labelId, label.labelType, ValidationOption.Disagree, adminId, missionId,
              Some(point.canvasX), Some(point.canvasY), point.heading, point.pitch, point.zoom, point.canvasWidth,
              point.canvasHeight, now, now, source, ViewerType.Default),
            newLabelType = None,
            label.severity,
            label.tags,
            comment = None,
            undone = false,
            redone = false,
            canEdit = false
          )
        )
      )
    }
  }

  /**
   * Submits a set of validations from a POST request on Validate.
   * @param validationSubmissions A sequence of ValidationSubmission objects
   * @return A sequence of the label_validation_ids of the inserted/updated validations.
   */
  def submitValidationsDbio(validationSubmissions: Seq[ValidationSubmission]): DBIO[Seq[Int]] = {
    val valSubmitActions: Seq[DBIO[Int]] = for (valSubmission <- validationSubmissions) yield {
      // An Agree that changes the label's type is a vote on the new type (#3671): it is what the validator asserts,
      // and it starts the re-typed label's count at one agree while every earlier vote drops out as stale.
      val typeChange: Option[LabelTypeEnum.Base] = valSubmission.newLabelType.filter(_ =>
        valSubmission.validation.validationResult == ValidationOption.Agree && valSubmission.canEdit
      )
      val validation: LabelValidation =
        typeChange.fold(valSubmission.validation)(t => valSubmission.validation.copy(labelType = t))

      // A vote on a deleted label is dropped (#3591): a mission batch or stale card must not hand a verdict to a label
      // its labeler deleted before it had one. An admin's delete files its Disagree first, so that one lands.
      val deleted: DBIO[Boolean] =
        labelsUnfiltered.filter(_.labelId === validation.labelId).map(_.deleted).result.headOption.map(_.contains(true))
      deleted.flatMap(
        if (_) DBIO.successful(0)
        else
          labelValidationTable.getValidation(validation.labelId, validation.userId, validation.labelType).flatMap {
            existingVal =>
              // The undone/redone flags cover the replacements the client knows about, but a duplicate can arrive
              // without them: a POST retried after its original committed, or the label served again in a later
              // mission. Removing first makes those a clean replacement (latest verdict wins) instead of a
              // unique-constraint violation, and reuses the redo path so severity/tags, label_history, and validation
              // counts unwind first (#4377).
              val oldValRemoved = existingVal match {
                case Some(oldVal) => deleteLabelValidation(oldVal, retracted = valSubmission.undone).map(_ > 0)
                case None         => DBIO.successful(false)
              }

              // Comments are keyed by (label, user), one apiece (#4942), so only clear one when this submission
              // accounts for it: an undo/redo retracts the comment that came with the vote, and a submission carrying
              // its own replaces it. A repeat validation carrying none leaves the user's earlier text alone.
              val oldCommentRemoved =
                if (valSubmission.undone || valSubmission.redone || valSubmission.comment.isDefined) {
                  // A retracted vote taking the text with it is no request to erase anything, so the history tells it
                  // apart from an edit (#5076). An undo inserts nothing afterwards, so a comment riding along with one
                  // is retracted rather than replaced.
                  val changeType =
                    if (valSubmission.comment.isDefined && !valSubmission.undone) ValidationCommentChangeType.Edit
                    else ValidationCommentChangeType.ValidationChange
                  validationTaskCommentTable.archive(validation.labelId, validation.userId, changeType)
                } else DBIO.successful(0)

              // If the validation is new or is an update for an undone label, save it.
              val newValInserted = if (!valSubmission.undone) {
                for {
                  newValId: Int <- insert(validation)
                  // Only an Agree applies the submitted type, severity and tags; the edit is linked to the vote so an
                  // undo unwinds it.
                  _ <- {
                    if (validation.validationResult == ValidationOption.Agree && valSubmission.canEdit) {
                      labelEditService.applyEdit(validation.labelId, validation.userId, typeChange,
                        valSubmission.severity, valSubmission.tags, validation.source, Some(newValId))
                    } else DBIO.successful(None)
                  }
                  // Insert the comment if there is one.
                  _ <- valSubmission.comment match {
                    case Some(comment) => validationTaskCommentTable.insert(comment)
                    case None          => DBIO.successful(0)
                  }
                } yield newValId
              } else DBIO.successful(0)

              for {
                _        <- oldCommentRemoved
                _        <- oldValRemoved
                newValId <- newValInserted
              } yield newValId
          }
      )
    }

    // For any users whose labels have been validated, update their accuracy in the user_stat table.
    (for {
      newValIds      <- DBIO.sequence(valSubmitActions)
      usersValidated <-
        if (validationSubmissions.nonEmpty) {
          labelValidationTable.usersValidated(validationSubmissions.map(_.validation.labelId))
        } else DBIO.successful(Seq.empty)
      _ <-
        if (usersValidated.nonEmpty) {
          userStatTable.updateAccuracy(usersValidated)
        } else DBIO.successful(())
    } yield newValIds).transactionally.map(_.filter(_ > 0)) // Remove 0's representing deletions instead of insertions.
  }
}
