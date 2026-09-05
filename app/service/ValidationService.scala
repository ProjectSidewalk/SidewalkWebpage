package service

import com.google.inject.ImplementedBy
import models.label._
import models.user.UserStatTable
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import models.validation._
import org.postgresql.util.PSQLException
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}

/**
 * One validation as submitted, with the severity and tags the validator wants the label to have. Those are applied as
 * an edit linked to the vote only for an Agree that changes them (#2575).
 */
case class ValidationSubmission(
    validation: LabelValidation,
    severity: Option[Int],
    tags: List[String],
    comment: Option[ValidationTaskComment],
    undone: Boolean,
    redone: Boolean
)

@ImplementedBy(classOf[ValidationServiceImpl])
trait ValidationService {
  def countValidations: Future[Int]
  def countHumanValidations: Future[Int]
  def countValidations(userId: String): Future[Int]
  def insertEnvironment(env: ValidationTaskEnvironment): Future[Int]
  def insertMultipleInteractions(interactions: Seq[ValidationTaskInteraction]): Future[Seq[Int]]
  def replaceComment(comment: ValidationTaskComment): Future[Int]
  def deleteComment(labelId: Int, userId: String): Future[Int]
  def submitValidations(validationSubmissions: Seq[ValidationSubmission]): Future[Seq[Int]]
  def submitValidationsDbio(validationSubmissions: Seq[ValidationSubmission]): DBIO[Seq[Int]]
}

@Singleton
class ValidationServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    labelValidationTable: LabelValidationTable,
    validationTaskEnvironmentTable: ValidationTaskEnvironmentTable,
    validationTaskInteractionTable: ValidationTaskInteractionTable,
    validationTaskCommentTable: ValidationTaskCommentTable,
    labelTable: LabelTable,
    labelEditService: LabelEditService,
    userStatTable: UserStatTable,
    implicit val ec: ExecutionContext
) extends ValidationService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val validationLabels = TableQuery[LabelValidationTableDef]
  val labelsUnfiltered = TableQuery[LabelTableDef]

  /** SQLState for a Postgres unique-constraint violation. */
  private val UniqueViolation: String = "23505"

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
   * Deletes a validation in the label_validation table, unwinding the edit it was submitted with. Also updates
   * validation counts in the label table.
   * @param oldVal The validation to delete.
   * @return Int count of rows deleted, either 0 or 1.
   */
  private def deleteLabelValidation(oldVal: LabelValidation): DBIO[Int] = {
    (for {
      _ <- {
        if (oldVal.validationResult == ValidationOption.Agree)
          labelEditService.revertEditForValidation(oldVal.labelValidationId)
        else DBIO.successful(false)
      }
      excludedUser <- userStatTable.isExcludedUser(oldVal.userId)
      labeler      <- labelTable.find(oldVal.labelId).map(_.get.userId)
      rowsAffected <- validationLabels.filter(_.labelValidationId === oldVal.labelValidationId).delete
      _            <- {
        if (labeler != oldVal.userId & !excludedUser)
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
      isExcludedUser       <- userStatTable.isExcludedUser(labelVal.userId)
      userThatAppliedLabel <- labelsUnfiltered.filter(_.labelId === labelVal.labelId).map(_.userId).result.head
      _                    <- {
        if (userThatAppliedLabel != labelVal.userId & !isExcludedUser)
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
   * @return The validation_task_comment_id of the comment that was stored.
   */
  def replaceComment(comment: ValidationTaskComment): Future[Int] = runWithUniqueViolationRetry {
    (for {
      _         <- validationTaskCommentTable.deleteIfExists(comment.labelId, comment.userId)
      commentId <- validationTaskCommentTable.insert(comment)
    } yield commentId).transactionally
  }

  /**
   * Removes the user's comment on a label, if they left one.
   *
   * Backs the label card's explicit Delete control (#5015). Deleting is otherwise only reachable by clearing the
   * vote the comment rode in on, which throws away the verdict along with the text.
   *
   * @return Count of comments deleted, 0 or 1.
   */
  def deleteComment(labelId: Int, userId: String): Future[Int] =
    db.run(validationTaskCommentTable.deleteIfExists(labelId, userId))

  /**
   * Submits a set of validations from a POST request on Validate.
   * @param validationSubmissions A sequence of ValidationSubmission objects
   * @return A sequence of the label_validation_ids of the inserted/updated validations.
   */
  def submitValidations(validationSubmissions: Seq[ValidationSubmission]): Future[Seq[Int]] =
    runWithUniqueViolationRetry(submitValidationsDbio(validationSubmissions))

  /**
   * Submits a set of validations from a POST request on Validate.
   * @param validationSubmissions A sequence of ValidationSubmission objects
   * @return A sequence of the label_validation_ids of the inserted/updated validations.
   */
  def submitValidationsDbio(validationSubmissions: Seq[ValidationSubmission]): DBIO[Seq[Int]] = {
    val valSubmitActions: Seq[DBIO[Int]] = for (valSubmission <- validationSubmissions) yield {
      val validation: LabelValidation = valSubmission.validation

      labelValidationTable.getValidation(validation.labelId, validation.userId).flatMap { existingVal =>
        // The undone/redone flags cover the replacements the client knows about, but a duplicate can arrive without
        // them: a POST retried after its original committed, or the label served again in a later mission. Removing
        // first makes those a clean replacement (latest verdict wins) instead of a unique-constraint violation, and
        // reuses the redo path so severity/tags, label_history, and validation counts unwind first (#4377).
        val oldValRemoved = existingVal match {
          case Some(oldVal) => deleteLabelValidation(oldVal).map(_ > 0)
          case None         => DBIO.successful(false)
        }

        // Comments are keyed by (label, user) rather than by validation — one apiece, per
        // validation_task_comment_label_id_user_id_unique (#4942) — so only clear them when this submission accounts
        // for them: an undo/redo retracts the comment that came with
        // the vote, and a submission carrying its own replaces it. A repeat validation carrying none must leave the
        // user's earlier free text alone — nothing could restore it.
        val oldCommentRemoved = if (valSubmission.undone || valSubmission.redone || valSubmission.comment.isDefined) {
          validationTaskCommentTable.deleteIfExists(validation.labelId, validation.userId)
        } else DBIO.successful(0)

        // If the validation is new or is an update for an undone label, save it.
        val newValInserted = if (!valSubmission.undone) {
          for {
            newValId: Int <- insert(validation)
            // Only an Agree applies the submitted severity and tags; the edit is linked to the vote so an undo unwinds it.
            _ <- {
              if (validation.validationResult == ValidationOption.Agree) {
                labelEditService.applyEdit(validation.labelId, validation.userId, valSubmission.severity,
                  valSubmission.tags, validation.source, Some(newValId))
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
