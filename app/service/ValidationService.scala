package service

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import models.label.{LabelHistory, LabelHistoryTable, LabelHistoryTableDef, LabelTable, LabelTableDef, LabelValidation, LabelValidationTable, LabelValidationTableDef}
import models.user.UserStatTable
import models.utils.MyPostgresProfile
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import models.utils.MyPostgresProfile.api._
import models.validation.{ValidationTaskComment, ValidationTaskCommentTable, ValidationTaskEnvironment, ValidationTaskEnvironmentTable, ValidationTaskInteraction, ValidationTaskInteractionTable}

import java.sql.Timestamp
import java.time.Instant

case class ValidationSubmission(validation: LabelValidation, comment: Option[ValidationTaskComment], undone: Boolean, redone: Boolean)

@ImplementedBy(classOf[ValidationServiceImpl])
trait ValidationService {
  def countValidations: Future[Int]
  def countValidations(userId: String): Future[Int]
  def insertEnvironment(env: ValidationTaskEnvironment): Future[Int]
  def insertMultipleInteractions(interactions: Seq[ValidationTaskInteraction]): Future[Seq[Int]]
  def insertComment(comment: ValidationTaskComment): Future[Int]
  def deleteCommentIfExists(labelId: Int, missionId: Int): Future[Int]
  def submitValidations(validationSubmissions: Seq[ValidationSubmission]): Future[Seq[Int]]
}

@Singleton
class ValidationServiceImpl @Inject()(
                                  protected val dbConfigProvider: DatabaseConfigProvider,
                                  labelValidationTable: LabelValidationTable,
                                  validationTaskEnvironmentTable: ValidationTaskEnvironmentTable,
                                  validationTaskInteractionTable: ValidationTaskInteractionTable,
                                  validationTaskCommentTable: ValidationTaskCommentTable,
                                  labelTable: LabelTable,
                                  labelService: LabelService,
                                  labelHistoryTable: LabelHistoryTable,
                                  userStatTable: UserStatTable,
                                  implicit val ec: ExecutionContext
                                 ) extends ValidationService with HasDatabaseConfigProvider[MyPostgresProfile] {
  //  import profile.api._
  val validationLabels = TableQuery[LabelValidationTableDef]
  val labelsUnfiltered = TableQuery[LabelTableDef]
  val labelHistories = TableQuery[LabelHistoryTableDef]

  def countValidations: Future[Int] = db.run(labelValidationTable.countValidations)

  def countValidations(userId: String): Future[Int] = db.run(labelValidationTable.countValidations(userId))

  /**
   * Updates the validation counts and correctness columns in the label table given a new incoming validation.
   *
   * @param labelId label_id of the label with a new validation
   * @param newValidationResult the new validation: 1 meaning agree, 2 meaning disagree, and 3 meaning unsure
   * @param oldValidationResult the old validation if the user had validated this label in the past
   */
  def updateValidationCounts(labelId: Int, newValidationResult: Option[Int], oldValidationResult: Option[Int]): DBIO[Int] = {
    require(newValidationResult.isEmpty || List(1, 2, 3).contains(newValidationResult.get), "New validation results can only be 1, 2, or 3.")
    require(oldValidationResult.isEmpty || List(1, 2, 3).contains(oldValidationResult.get), "Old validation results can only be 1, 2, or 3.")

    labelTable.find(labelId).flatMap {
      case Some(label) =>
        // Get the validation counts that are in the database right now.
        val oldCounts: (Int, Int, Int) = (label.agreeCount, label.disagreeCount, label.unsureCount)

        // Add 1 to the correct count for the new validation. In case of delete, no match is found.
        val countsWithNewVal: (Int, Int, Int) = newValidationResult match {
          case Some(1) => (oldCounts._1 + 1, oldCounts._2, oldCounts._3)
          case Some(2) => (oldCounts._1, oldCounts._2 + 1, oldCounts._3)
          case Some(3) => (oldCounts._1, oldCounts._2, oldCounts._3 + 1)
          case _ => oldCounts
        }

        // If there was a previous validation from this user, subtract 1 for that old validation. O/w use previous result.
        val countsWithoutOldVal: (Int, Int, Int) = oldValidationResult match {
          case Some(1) => (countsWithNewVal._1 - 1, countsWithNewVal._2, countsWithNewVal._3)
          case Some(2) => (countsWithNewVal._1, countsWithNewVal._2 - 1, countsWithNewVal._3)
          case Some(3) => (countsWithNewVal._1, countsWithNewVal._2, countsWithNewVal._3 - 1)
          case _ => countsWithNewVal
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
    }.transactionally
  }

  /**
   * Deletes a validation in the label_validation table. Also updates validation counts in the label table.
   *
   * @param labelId
   * @param userId
   * @return Int count of rows deleted, should be either 0 or 1 because each user should have one validation per label.
   */
  private def deleteLabelValidationIfExists(labelId: Int, userId: String): DBIO[Int] = {
    labelValidationTable.getValidation(labelId, userId).flatMap {
      case Some(oldVal) =>
        for {
          historyEntryDeleted <- {
            if (oldVal.validationResult == 1) removeLabelHistoryForValidation(oldVal.labelValidationId)
            else DBIO.successful(false)
          }
          excludedUser <- userStatTable.isExcludedUser(userId)
          labeler <- labelTable.find(labelId).map(_.get.userId)
          rowsAffected <- validationLabels.filter(_.labelValidationId === oldVal.labelValidationId).delete
          _ <- {
            if (labeler != userId & !excludedUser) updateValidationCounts(labelId, None, Some(oldVal.validationResult))
            else DBIO.successful(0)
          }
        } yield {
          rowsAffected
        }
      case None => DBIO.successful(0)
    }.transactionally
  }

  /**
   * Updates the label and label_history tables appropriately when a validation is deleted (using the back button).
   *
   * If the given validation represents the most recent change to the label, undo this validation's change in the label
   * table and delete this validation. If there have been subsequent changes to the label, just delete this validation.
   * However, if the next change to the label reverses the change made by this validation, the subsequent label_history
   * entry should be deleted as well (so that the history doesn't contain a redundant entry). And if the validation did
   * not change the severity or tags, then there is nothing to remove from the label_history table.
   * .
   * @param labelValidationId
   * @return
   */
  def removeLabelHistoryForValidation(labelValidationId: Int): DBIO[Boolean] =  {
    labelHistoryTable.findByLabelValidationId(labelValidationId).map(_.headOption).flatMap {
      case Some(historyEntry) =>
        labelHistoryTable.findByLabelId(historyEntry.labelId).map(_.sortBy(_.editTime.getTime)).flatMap { fullHistory =>
          // If the given validation represents the most recent change to the label, undo this validation's change in
          // the label table and delete this validation from the label_history table.
          if (fullHistory.indexWhere(_.labelHistoryId == historyEntry.labelHistoryId) == fullHistory.length - 1) {
            val correctData: LabelHistory = fullHistory(fullHistory.length - 2)
            val labelToUpdateQuery = labelsUnfiltered.filter(_.labelId === historyEntry.labelId)
            labelToUpdateQuery.map(l => (l.severity, l.tags)).update((correctData.severity, correctData.tags.toList))
            labelHistories.filter(_.labelValidationId === labelValidationId).delete.map(_ > 0)
          } else {
            // If the next history entry reverses this one, we can update the label table and delete both entries.
            val thisEntryIdx: Int = fullHistory.indexWhere(_.labelValidationId == Some(labelValidationId))
            if (fullHistory(thisEntryIdx - 1).severity == fullHistory(thisEntryIdx + 1).severity
              && fullHistory(thisEntryIdx - 1).tags == fullHistory(thisEntryIdx + 1).tags) {
              for {
                delete1 <- labelHistories.filter(_.labelValidationId === labelValidationId).delete
                delete2 <- labelHistories.filter(_.labelValidationId === fullHistory(thisEntryIdx + 1).labelValidationId).delete
              } yield delete1 > 0 && delete2 > 0
            } else {
              labelHistories.filter(_.labelValidationId === labelValidationId).delete.map(_ > 0)
            }
          }
        }
      case None =>
        // No label_history entry to delete (this would happen if the validation didn't change severity or tags).
        DBIO.successful(false)
    }.transactionally
  }

  /**
   * Inserts into the label_validation table. Updates severity, tags, & validation counts in the label table.
   *
   * @return The label_validation_id of the inserted/updated validation.
   */
  def insert(labelVal: LabelValidation): DBIO[Int] = {
    for {
      isExcludedUser <- userStatTable.isExcludedUser(labelVal.userId)
      userThatAppliedLabel <- labelsUnfiltered.filter(_.labelId === labelVal.labelId).map(_.userId).result.head
      _ <- {
        if (userThatAppliedLabel != labelVal.userId & !isExcludedUser)
          updateValidationCounts(labelVal.labelId, Some(labelVal.validationResult), None)
        else DBIO.successful(0)
      }
      newValId <- (validationLabels returning validationLabels.map(_.labelValidationId)) += labelVal
    } yield newValId
  }.transactionally

  def insertEnvironment(env: ValidationTaskEnvironment): Future[Int] = {
    db.run(validationTaskEnvironmentTable.insert(env))
  }

  def insertMultipleInteractions(interactions: Seq[ValidationTaskInteraction]): Future[Seq[Int]] = {
    db.run(validationTaskInteractionTable.insertMultiple(interactions))
  }

  def insertComment(comment: ValidationTaskComment): Future[Int] = {
    db.run(validationTaskCommentTable.insert(comment))
  }

  def deleteCommentIfExists(labelId: Int, missionId: Int): Future[Int] = {
    db.run(validationTaskCommentTable.deleteIfExists(labelId, missionId))
  }

  /**
   * Updates severity and tags in the label table and saves the change in the label_history table. Called from Validate.
   *
   * @param labelId
   * @param severity
   * @param tags
   * @param userId
   * @return Int count of rows updated, either 0 or 1 because labelId is a primary key.
   */
  def updateAndSaveLabelHistory(labelId: Int, severity: Option[Int], tags: List[String], userId: String, source: String, labelValidationId: Int): DBIO[Int] = {
    val labelToUpdateQuery = labelsUnfiltered.filter(_.labelId === labelId)
    labelToUpdateQuery.result.headOption.flatMap {
      case Some(labelToUpdate) =>
        labelService.cleanTagList(tags, labelToUpdate.labelTypeId).flatMap { cleanedTags: Seq[String] =>
          // If there's an actual change to the label, update it and add to the label_history table. O/w update nothing.
          if (labelToUpdate.severity != severity || labelToUpdate.tags.toSet != cleanedTags.toSet) {
            for {
              cleanedTags: Seq[String] <- labelService.cleanTagList(tags, labelToUpdate.labelTypeId)
              _ <- labelHistoryTable.insert(LabelHistory(0, labelId, severity, cleanedTags, userId, new Timestamp(Instant.now.toEpochMilli), source, Some(labelValidationId)))
              rowsUpdated <- labelToUpdateQuery.map(l => (l.severity, l.tags)).update((severity, cleanedTags.toList))
            } yield {
              rowsUpdated
            }
          } else {
            DBIO.successful(0)
          }
        }
      case None => DBIO.successful(0)
    }.transactionally
  }

  /**
   * Submits a set of validations from a POST request on Validate.
   *
   * @param validationSubmissions
   * @return A sequence of the label_validation_ids of the inserted/updated validations.
   */
  def submitValidations(validationSubmissions: Seq[ValidationSubmission]): Future[Seq[Int]] = {
    val valSubmitActions: Seq[DBIO[Int]] = for (valSubmission <- validationSubmissions) yield {
      val validation: LabelValidation = valSubmission.validation

      // If undoing a validation, delete the validation and the associated comment.
      val oldValRemoved = if (valSubmission.undone || valSubmission.redone) {
        for {
          _ <- validationTaskCommentTable.deleteIfExists(validation.labelId, validation.missionId)
          _ <- deleteLabelValidationIfExists(validation.labelId, validation.userId)
        } yield true
      } else DBIO.successful(false)

      // If the validation is new or is an update for an undone label, save it.
      val newValInserted = if (!valSubmission.undone) {
        for {
          newValId: Int <- insert(validation)
          // Update the severity and tags in the label table if something changed (only applies if they marked Agree).
          _ <- {
            if (validation.validationResult == 1) {
              updateAndSaveLabelHistory(validation.labelId, validation.newSeverity, validation.newTags, validation.userId, validation.source, newValId)
            } else DBIO.successful(0)
          }
          // Insert the comment if there is one.
          _ <- valSubmission.comment match {
            case Some(comment) => validationTaskCommentTable.insert(comment)
            case None => DBIO.successful(0)
          }
        } yield newValId
      } else DBIO.successful(0)

      for {
        _ <- oldValRemoved
        newValId <- newValInserted
      } yield newValId
    }

    // For any users whose labels have been validated, update their accuracy in the user_stat table.
    db.run((for {
       newValIds <- DBIO.sequence(valSubmitActions)
       usersValidated <- if (validationSubmissions.nonEmpty) {
         labelValidationTable.usersValidated(validationSubmissions.map(_.validation.labelId))
       } else DBIO.successful(Seq.empty)
       _ <- if (usersValidated.nonEmpty) {
         userStatTable.updateAccuracy(usersValidated)
       } else DBIO.successful(())
    } yield newValIds).transactionally).map(_.filter(_ > 0)) // Remove 0's representing deletions instead of insertions.
  }
}
