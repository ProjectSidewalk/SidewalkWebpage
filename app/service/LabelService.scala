package service

import com.google.inject.ImplementedBy
import controllers.helper.ValidateHelper.AdminValidateParams
import formats.json.ValidationTaskSubmissionFormats.ValidationMissionProgress
import models.label.LabelTable._
import models.label._
import models.mission.{Mission, MissionTable}
import models.user.SidewalkUserWithRole
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import models.validation.LabelValidationTable
import play.api.Logger
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.dbio.DBIO

import java.time.OffsetDateTime
import javax.inject._
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Random

case class ValidationTaskPostReturnValue(hasMissionAvailable: Option[Boolean], mission: Option[Mission], labels: Seq[LabelValidationMetadata], adminData: Seq[AdminValidationData], progress: Option[(Int, Int, Int)])

@ImplementedBy(classOf[LabelServiceImpl])
trait LabelService {
  def countLabels: Future[Int]
  def selectAllTags: DBIO[Seq[models.label.Tag]]
  def selectAllTagsFuture: Future[Seq[models.label.Tag]]
  def selectTagsByLabelType(labelType: String): DBIO[Seq[models.label.Tag]]
  def getTagsForCurrentCity: Future[Seq[models.label.Tag]]
  def cleanTagList(tags: Seq[String], labelTypeId: Int): DBIO[Seq[String]]
  def getSingleLabelMetadata(labelId: Int, userId: String): Future[Option[LabelMetadata]]
  def getRecentLabelMetadata(takeN: Int): Future[Seq[LabelMetadata]]
  def getExtraAdminValidateData(labelIds: Seq[Int]): Future[Seq[AdminValidationData]]
  def selectLocationsAndSeveritiesOfLabels(regionIds: Seq[Int], routeIds: Seq[Int]): Future[Seq[LabelLocationWithSeverity]]
  def getGalleryLabels(n: Int, labelTypeId: Option[Int], loadedLabelIds: Set[Int], valOptions: Set[String], regionIds: Set[Int], severity: Set[Int], tags: Set[String], userId: String): Future[Seq[LabelValidationMetadata]]
  def retrieveLabelListForValidation(userId: String, n: Int, labelTypeId: Int, userIds: Set[String]=Set(), regionIds: Set[Int]=Set(), skippedLabelId: Option[Int]=None): Future[Seq[LabelValidationMetadata]]
  def getDataForValidationPages(user: SidewalkUserWithRole, labelCount: Int, adminParams: AdminValidateParams): Future[(Option[Mission], Option[(Int, Int, Int)], Seq[LabelValidationMetadata], Seq[AdminValidationData])]
  def getDataForValidatePostRequest(user: SidewalkUserWithRole, missionProgress: Option[ValidationMissionProgress], adminParams: AdminValidateParams): Future[ValidationTaskPostReturnValue]
  def getRecentValidatedLabelsForUser(userId: String, labelTypes: Set[String], nPerType: Int): Future[Map[String, Seq[LabelMetadataUserDash]]]
  def getLabelsFromUserInRegion(regionId: Int, userId: String): Future[Seq[ResumeLabelMetadata]]
  def insertLabel(label: Label): DBIO[Int]
  def updateLabelFromExplore(labelId: Int, deleted: Boolean, severity: Option[Int], temporary: Boolean, description: Option[String], tags: List[String]): DBIO[Int]
}

@Singleton
class LabelServiceImpl @Inject()(
                                  protected val dbConfigProvider: DatabaseConfigProvider,
                                  configService: ConfigService,
                                  gsvDataService: GSVDataService,
                                  labelTable: LabelTable,
                                  tagTable: TagTable,
                                  labelValidationTable: LabelValidationTable,
                                  labelHistoryTable: LabelHistoryTable,
                                  missionService: MissionService,
                                  implicit val ec: ExecutionContext
                                 ) extends LabelService with HasDatabaseConfigProvider[MyPostgresProfile] {
  //  import profile.api._
  private val logger = Logger("application")

  def countLabels: Future[Int] = {
    db.run(labelTable.countLabels)
  }

  def selectAllTags: DBIO[Seq[models.label.Tag]] = {
    configService.cachedDBIO[Seq[models.label.Tag]]("selectAllTags()")(tagTable.selectAllTags)
  }

  def selectAllTagsFuture: Future[Seq[models.label.Tag]] = {
    db.run(selectAllTags)
  }

  def selectTagsByLabelTypeId(labelTypeId: Int): DBIO[Seq[models.label.Tag]] = {
    selectAllTags.map(_.filter(_.labelTypeId == labelTypeId))
  }

  def selectTagsByLabelType(labelType: String): DBIO[Seq[models.label.Tag]] = {
    selectTagsByLabelTypeId(LabelTypeTable.labelTypeToId(labelType))
  }

  def getTagsForCurrentCity: Future[Seq[models.label.Tag]] = {
    db.run(for {
      excludedTags <- configService.getExcludedTags
      allTags <- selectAllTags
    } yield {
      allTags.filterNot(t => excludedTags.contains(t.tag))
    })
  }

  def findConflictingTags(tags: Set[String], labelTypeId: Int): DBIO[Seq[String]] = {
    selectTagsByLabelTypeId(labelTypeId).map { allTags: Seq[models.label.Tag] =>
      allTags.filter(tag => tags.contains(tag.tag) && tag.mutuallyExclusiveWith.exists(tags.contains)).map(_.tag)
    }
  }

  /**
   * Removes any tags that are invalid or conflicting.
   *
   * @param tags
   * @param labelTypeId
   * @return Cleaned list of tags
   */
  def cleanTagList(tags: Seq[String], labelTypeId: Int): DBIO[Seq[String]] = {
    for {
      validTags: Seq[String] <- selectTagsByLabelTypeId(labelTypeId).map(_.map(_.tag))
      cleanedTags: Seq[String] = tags.map(_.toLowerCase).distinct.filter(t => validTags.contains(t))
      conflictingTags: Seq[String] <- findConflictingTags(cleanedTags.toSet, labelTypeId)
    } yield {
      if (conflictingTags.nonEmpty) {
        logger.warn(s"Tag list contains conflicting tags, removing all that conflict: ${conflictingTags.mkString(", ")}")
        cleanedTags.filterNot(conflictingTags.contains)
      } else {
        cleanedTags
      }
    }
  }

  def getSingleLabelMetadata(labelId: Int, userId: String): Future[Option[LabelMetadata]] = {
    db.run(labelTable.getRecentLabelsMetadata(1, None, Some(userId), Some(labelId)).map(_.headOption))
  }

  def getRecentLabelMetadata(takeN: Int): Future[Seq[LabelMetadata]] = {
    db.run(labelTable.getRecentLabelsMetadata(takeN))
  }

  def getExtraAdminValidateData(labelIds: Seq[Int]): Future[Seq[AdminValidationData]] = {
    db.run(labelTable.getExtraAdminValidateData(labelIds))
  }

  def selectLocationsAndSeveritiesOfLabels(regionIds: Seq[Int], routeIds: Seq[Int]): Future[Seq[LabelLocationWithSeverity]] = {
    db.run(labelTable.selectLocationsAndSeveritiesOfLabels(regionIds, routeIds))
  }

  /**
   * Retrieves n labels of specified label type, severities, and tags. If no label type supplied, split across types.
   *
   * @param n Number of labels to grab.
   * @param labelTypeId       Label type specifying what type of labels to grab. None will give a mix.
   * @param loadedLabelIds    Set of labelIds already grabbed as to not grab them again.
   * @param valOptions        Set of correctness values to filter for: correct, incorrect, unsure, and/or unvalidated.
   * @param regionIds         Set of neighborhoods to get labels from. All neighborhoods if empty.
   * @param severity          Set of severities the labels grabbed can have.
   * @param tags              Set of tags the labels grabbed can have.
   * @return Seq[LabelValidationMetadata]
   */
  def getGalleryLabels(n: Int,
                       labelTypeId: Option[Int],
                       loadedLabelIds: Set[Int],
                       valOptions: Set[String],
                       regionIds: Set[Int],
                       severity: Set[Int],
                       tags: Set[String],
                       userId: String): Future[Seq[LabelValidationMetadata]] = {

    // If a label type is specified, get labels for that type. Otherwise, get labels for all types.
    if (labelTypeId.isDefined) {
      findValidLabelsForType(
        labelTable.getGalleryLabelsQuery(labelTypeId.get, loadedLabelIds, valOptions, regionIds, severity, tags, userId),
        randomize = true, n
      )
    } else {
      // Get labels for each type in parallel.
      val nPerType = n / LabelTypeTable.primaryLabelTypes.size
      Future.sequence(LabelTypeTable.primaryLabelTypes.map { labelType =>
        findValidLabelsForType(
          labelTable.getGalleryLabelsQuery(LabelTypeTable.labelTypeToId(labelType), loadedLabelIds, valOptions, regionIds, severity, tags, userId),
          randomize = true, nPerType
        )
      }).map(labelsByType => scala.util.Random.shuffle(labelsByType.flatten).toSeq)
    }
  }

  /**
   * Get n labels for validation, sorted according to priority algorithm, after checking that they have GSV imagery.
   *
   * Starts by querying for n * 5 labels, then checks GSV API to see if each gsv_panorama_id exists until we find n.
   *
   * @param userId         User ID for the current user.
   * @param n              Number of labels we need to query.
   * @param labelTypeId    Label Type ID of labels requested.
   * @param userIds        Optional list of user IDs to filter by.
   * @param regionIds      Optional list of region IDs to filter by.
   * @param skippedLabelId Label ID of the label that was just skipped (if applicable).
   * @return               Seq[LabelValidationMetadata]
   */
  def retrieveLabelListForValidation(userId: String, n: Int, labelTypeId: Int, userIds: Set[String]=Set(), regionIds: Set[Int]=Set(), skippedLabelId: Option[Int]=None): Future[Seq[LabelValidationMetadata]] = {
    // TODO can we make this and the Gallery queries transactions to prevent label dupes?
    findValidLabelsForType(labelTable.retrieveLabelListForValidationQuery(userId, labelTypeId, userIds, regionIds, skippedLabelId), randomize = true, n)
  }

  /**
   * Query labels from the db in batches until we have enough labels that have GSV imagery available. Works recursively.
   * @param labelQuery Query to get labels from the db.
   * @param randomize Whether to randomize the label order or not.
   * @param remaining Number of labels remaining to get.
   * @param batchNumber Batch number we're on, used to paginate the query.
   * @param accumulator Accumulator of labels we've found so far.
   * @param tupleConverter Implicit converter to convert the tuple from the db to the appropriate case class.
   */
  private def findValidLabelsForType[A <: BasicLabelMetadata, TupleRep, Tuple]
  (labelQuery: Query[TupleRep, Tuple, Seq], randomize: Boolean, remaining: Int, batchNumber: Int = 0, accumulator: Seq[A] = Seq.empty)
  (implicit tupleConverter: TupleConverter[Tuple, A]): Future[Seq[A]] = {
    if (remaining <= 0) {
      Future.successful(accumulator)
    } else {
      val batchSize = remaining * 5 // Get 5x the needed amount, shouldn't need to query again.

      // Query for a batch of labels.
      db.run(labelQuery.drop(batchSize * batchNumber).take(batchSize).result)
        .map(l => l.map(tupleConverter.fromTuple))
        .flatMap { labels =>
          // Randomize the labels to prevent similar labels in a mission.
          val shuffledLabels: Seq[A] = if (randomize) scala.util.Random.shuffle(labels) else labels

          // Check each of those labels for GSV imagery in parallel.
          checkGsvImageryBatch(shuffledLabels).flatMap { validLabels =>
            if (validLabels.isEmpty) {
              Future.successful(accumulator) // No more valid labels found.
            } else {
              // Add the valid labels to the accumulator and recurse.
              val newValidLabels = validLabels.take(remaining)
              findValidLabelsForType(labelQuery, randomize,
                remaining - newValidLabels.size,
                batchNumber + 1,
                accumulator ++ newValidLabels)
            }
          }
        }
    }
  }

  // Checks each label in a batch for GSV imagery in parallel.
  private def checkGsvImageryBatch[A <: BasicLabelMetadata](labels: Seq[A]): Future[Seq[A]] = {
    Future.traverse(labels) { label =>
      gsvDataService.panoExists(label.gsvPanoramaId).map {
        case Some(true) => Some(label)
        case _ => None
      }
    }.map(_.flatten)
  }

  /**
   * Get the label_type_id to validate. Label types with fewer labels with validations have higher priority.
   *
   * We get the number of labels available to validate for each label type and the number of those that have no
   * validations (or have agree=disagree). We then filter out label types with fewer than missionLength labels available
   * to validate (the size of a Validate mission), and prioritize label types more labels w/ no validations.
   *
   * @param userId            User ID of the current user.
   * @param missionLength     Number of labels for this mission.
   * @param requiredLabelType labelTypeId of the current mission.
   */
  def getLabelTypeIdToValidate(userId: String, missionLength: Int, requiredLabelType: Option[Int]): Future[Option[Int]] = {
    db.run(labelTable.getAvailableValidationsLabelsByType(userId).map { availValidations =>
      val availTypes: Seq[LabelTypeValidationsLeft] = availValidations
        .filter(_.validationsAvailable >= missionLength)
        .filter(x => requiredLabelType.isEmpty || x.labelTypeId == requiredLabelType.get)
        .filter(x => LabelTypeTable.primaryLabelTypeIds.contains(x.labelTypeId))

      // Unless NoSidewalk (7) is the only available label type, remove it from the list of available types.
      val typesFiltered: Seq[LabelTypeValidationsLeft] = availTypes
        .filter(x => LabelTypeTable.primaryValidateLabelTypeIds.contains(x.labelTypeId) || availTypes.length == 1)

      if (typesFiltered.length < 2) {
        typesFiltered.map(_.labelTypeId).headOption
      } else {
        // Each label type has at least a 3% chance of being selected. Remaining probability is divvied up proportionally
        // based on the number of remaining labels requiring a validation for each label type.
        val typeProbabilities: Seq[(Int, Double)] = if (typesFiltered.map(_.validationsNeeded).sum > 0) {
          typesFiltered.map { t =>
            (t.labelTypeId, 0.03 + (1 - typesFiltered.length * 0.03) * (t.validationsNeeded.toDouble / typesFiltered.map(_.validationsNeeded).sum))
          }
        } else {
          typesFiltered.map(x => (x.labelTypeId, 1D / typesFiltered.length))
        }

        // Get cumulative probabilities.
        val cumulativeProbabilities: Seq[Double] = typeProbabilities.scanLeft(0.0) { case (acc, (_, prob)) => acc + prob }.tail

        // Choose a label type proportionally based on the calculated probabilities.
        val random = new Random()
        val labelTypeId: Int = typeProbabilities(cumulativeProbabilities.indexWhere(_ > random.nextDouble()))._1
        Some(labelTypeId)
      }
    })
  }

  /**
   * Get the data needed by the various Validate endpoints.
   * @return Future[(mission, missionProgress, labelList, adminData)]
   */
  def getDataForValidationPages(user: SidewalkUserWithRole, labelCount: Int, adminParams: AdminValidateParams): Future[(Option[Mission], Option[(Int, Int, Int)], Seq[LabelValidationMetadata], Seq[AdminValidationData])] = {
    // TODO can this be merged with `getDataForValidatePostRequest`?
    getLabelTypeIdToValidate(user.userId, labelCount, adminParams.labelTypeId).flatMap {
      case Some(labelTypeId) =>
        for {
          mission: Mission <- missionService.resumeOrCreateNewValidationMission(user.userId, "validation", labelTypeId).map(_.get)
          missionProgress: (Int, Int, Int) <- db.run(labelValidationTable.getValidationProgress(mission.missionId))

          // Get list of labels and their metadata for Validate page. Get extra metadata if it's for Admin Validate.
          labelsProgress: Int = mission.labelsProgress.get
          labelsToValidate: Int = MissionTable.validationMissionLabelsToRetrieve
          labelsToRetrieve: Int = labelsToValidate - labelsProgress
          labelMetadata <- retrieveLabelListForValidation(user.userId, labelsToRetrieve, labelTypeId, adminParams.userIds.map(_.toSet).getOrElse(Set()), adminParams.neighborhoodIds.map(_.toSet).getOrElse(Set()))
          adminData <- {
            if (adminParams.adminVersion) getExtraAdminValidateData(labelMetadata.map(_.labelId))
            else Future.successful(Seq.empty[AdminValidationData])
          }
        } yield {
          (Some(mission), Some(missionProgress), labelMetadata, adminData)
        }
      case None =>
        Future.successful((Option.empty[Mission], None, Seq.empty[LabelValidationMetadata], Seq.empty[AdminValidationData]))
    }
  }

  /**
   * Get the data needed by the Validate POST endpoints.
   * @return Future[(mission, missionProgress, labelList, adminData)]
   */
  def getDataForValidatePostRequest(user: SidewalkUserWithRole, missionProgress: Option[ValidationMissionProgress], adminParams: AdminValidateParams): Future[ValidationTaskPostReturnValue] = {
    // TODO can this be merged with `getDataForValidationPages`?
    val labelsToRetrieve: Int = MissionTable.validationMissionLabelsToRetrieve
    (for {
      nextMissionLabelTypeId <- {
        if (missionProgress.exists(_.completed)) getLabelTypeIdToValidate(user.userId, labelsToRetrieve, adminParams.labelTypeId)
        else Future.successful(Option.empty[Int])
      }
    } yield {
      (missionProgress, nextMissionLabelTypeId) match {
        case (Some(missionProgress), Some(nextMissionLabelTypeId)) =>
          for {
            newMission: Option[Mission] <- missionService.updateMissionTableValidate(user, missionProgress, Some(nextMissionLabelTypeId))
            labelList: Seq[LabelValidationMetadata] <- retrieveLabelListForValidation(user.userId, labelsToRetrieve, nextMissionLabelTypeId, adminParams.userIds.map(_.toSet).getOrElse(Set()), adminParams.neighborhoodIds.map(_.toSet).getOrElse(Set()))
            adminData <- {
              if (adminParams.adminVersion) getExtraAdminValidateData(labelList.map(_.labelId))
              else Future.successful(Seq.empty[AdminValidationData])
            }
            // This could be written more simply using traverse from cats or scalaz.
            progress: Option[(Int, Int, Int)] <- Future.successful(newMission).flatMap(_.fold(
              Future.successful(None: Option[(Int, Int, Int)])
            )(m => db.run(labelValidationTable.getValidationProgress(m.missionId)).map(Some(_))))
          } yield {
            ValidationTaskPostReturnValue(Some(labelList.nonEmpty), newMission, labelList, adminData, progress)
          }
        case (Some(missionProgress), None) =>
          for {
            _ <- missionService.updateMissionTableValidate(user, missionProgress, None)
          } yield {
            // No more validation missions available.
            if (missionProgress.completed) {
              ValidationTaskPostReturnValue(None, None, Seq.empty, Seq.empty, None)
            } else {
              // Validation mission is still in progress.
              ValidationTaskPostReturnValue(Some(true), None, Seq.empty, Seq.empty, None)
            }
          }
        case _ =>
          // We aren't submitting mission progress (no validations).
          Future.successful(ValidationTaskPostReturnValue(None, None, Seq.empty, Seq.empty, None))
      }
    }).flatMap(identity) // Flatten the Future[Future[T]] to Future[T].
  }

  /**
   * Get the most recent validated labels for a user (with valid GSV imagery), grouped by label type.
   * @param userId User ID of the user to get labels for.
   * @param labelTypes Set of label types to get labels for.
   * @param nPerType Number of labels to get for each label type.
   */
  def getRecentValidatedLabelsForUser(userId: String, labelTypes: Set[String], nPerType: Int): Future[Map[String, Seq[LabelMetadataUserDash]]] = {
    // Get labels for each type in parallel.
    Future.sequence(labelTypes.map { labelType =>
      findValidLabelsForType(labelTable.getValidatedLabelsForUserQuery(userId, labelType), randomize = false, nPerType)
        .map(labels => (labelType, labels))
    }).map(_.toMap)
  }

  def getLabelsFromUserInRegion(regionId: Int, userId: String): Future[Seq[ResumeLabelMetadata]] = {
    db.run(labelTable.getLabelsFromUserInRegion(regionId, userId))
  }

  /**
   * Insert a new label into the database. Also inserts an initial entry into the label_history table.
   *
   * @param label Label to insert.
   * @return Label ID of the newly inserted label.
   */
  def insertLabel(label: Label): DBIO[Int] = {
    for {
      cleanTags: Seq[String] <- cleanTagList(label.tags, label.labelTypeId)
      cleanLab: Label = label.copy(tags = cleanTags.toList)
      labelId: Int <- (labelTable.labelsUnfiltered returning labelTable.labelsUnfiltered.map(_.labelId)) += cleanLab

      // Add a corresponding entry to the label_history table.
      _ <- labelHistoryTable.insert(LabelHistory(0, labelId, cleanLab.severity, cleanLab.tags, cleanLab.userId, cleanLab.timeCreated, "Explore", None))
    } yield {
      labelId
    }
  }

  /**
   * Update the metadata that users might change on the Explore page after initially placing a label.
   * @param labelId
   * @param deleted
   * @param severity
   * @param temporary
   * @param description
   * @param tags
   * @return
   */
  def updateLabelFromExplore(labelId: Int, deleted: Boolean, severity: Option[Int], temporary: Boolean, description: Option[String], tags: List[String]): DBIO[Int] = {
    val labelToUpdateQuery = labelTable.labelsUnfiltered.filter(_.labelId === labelId)

    for {
      labelToUpdate: Label <- labelToUpdateQuery.result.head
      cleanedTags: List[String] <- cleanTagList(tags, labelToUpdate.labelTypeId).map(_.toList)

      // If the severity or tags have been changed, we need to update the label_history table as well.
      _ <- if (labelToUpdate.severity != severity || labelToUpdate.tags.toSet != cleanedTags.toSet) {
        // If there are multiple entries in the label_history table, then the label has been edited before, and we need
        // to add an entirely new entry to the table, otherwise we can just update the existing entry.
        labelHistoryTable.labelHistory.filter(_.labelId === labelId).size.result.flatMap {
          case labelHistoryCount if labelHistoryCount > 1 =>
            labelHistoryTable.insert(LabelHistory(0, labelId, severity, cleanedTags, labelToUpdate.userId, OffsetDateTime.now, "Explore", None))
          case _ =>
            labelHistoryTable.labelHistory.filter(_.labelId === labelId).map(l => (l.severity, l.tags)).update((severity, cleanedTags))
        }
      } else DBIO.successful(())

      // Finally, update the label table.
      rowsUpdated: Int <- labelToUpdateQuery
        .map(l => (l.deleted, l.severity, l.temporary, l.description, l.tags))
        .update((deleted, severity, temporary, description, cleanedTags))
    } yield {
      rowsUpdated
    }
  }
}
