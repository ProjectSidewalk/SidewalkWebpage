package service

import scala.concurrent.{ExecutionContext, Future}
import javax.inject._
import com.google.inject.ImplementedBy
import controllers.helper.ValidateHelper.AdminValidateParams
import models.amt.AMTAssignmentTable
import models.label._
import models.mission.{Mission, MissionSetProgress, MissionTable}
import models.user.SidewalkUserWithRole
import service.utils.ConfigService

import java.sql.Timestamp
import models.utils.MyPostgresDriver
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import models.utils.MyPostgresDriver.api._

@ImplementedBy(classOf[LabelServiceImpl])
trait LabelService {
  def countLabels(labelType: Option[String] = None): Future[Int]
  def selectAllTags: Future[Seq[models.label.Tag]]
  def selectTagsByLabelType(labelType: String): Future[Seq[models.label.Tag]]
  def getTagsForCurrentCity: Future[Seq[models.label.Tag]]
  def getSingleLabelMetadata(labelId: Int, userId: String): Future[Option[LabelMetadata]]
  def getExtraAdminValidateData(labelIds: Seq[Int]): Future[Seq[AdminValidationData]]
  def selectLocationsAndSeveritiesOfLabels(regionIds: Seq[Int], routeIds: Seq[Int]): Future[Seq[LabelLocationWithSeverity]]
  def getGalleryLabels(n: Int, labelTypeId: Option[Int], loadedLabelIds: Set[Int], valOptions: Set[String], regionIds: Set[Int], severity: Set[Int], tags: Set[String], userId: String): Future[Seq[LabelValidationMetadata]]
  def retrieveLabelListForValidation(userId: String, n: Int, labelTypeId: Int, userIds: Set[String]=Set(), regionIds: Set[Int]=Set(), skippedLabelId: Option[Int]=None): Future[Seq[LabelValidationMetadata]]
  def getDataForValidationPages(user: SidewalkUserWithRole, labelCount: Int, adminParams: AdminValidateParams): Future[(Option[Mission], MissionSetProgress, Seq[LabelValidationMetadata], Seq[AdminValidationData])]
}

@Singleton
class LabelServiceImpl @Inject()(
                                  protected val dbConfigProvider: DatabaseConfigProvider,
                                  configService: ConfigService,
                                  gsvDataService: GSVDataService,
                                  labelTable: LabelTable,
                                  tagTable: TagTable,
                                  labelValidationTable: LabelValidationTable,
                                  missionService: MissionService,
                                  implicit val ec: ExecutionContext
                                 ) extends LabelService with HasDatabaseConfigProvider[MyPostgresDriver] {
  //  import driver.api._

  def countLabels(labelType: Option[String] = None): Future[Int] = {
    labelType match {
      case Some(lType) => db.run(labelTable.countLabels(lType))
      case None => db.run(labelTable.countLabels)
    }
  }

  def selectAllTags: Future[Seq[models.label.Tag]] = {
    configService.cachedFuture[Seq[models.label.Tag]]("selectAllTags()")(db.run(tagTable.selectAllTags))
  }

  def selectTagsByLabelType(labelType: String): Future[Seq[models.label.Tag]] = {
    selectAllTags.map(_.filter(_.labelTypeId == LabelTypeTable.labelTypeToId(labelType)))
  }

  def getTagsForCurrentCity: Future[Seq[models.label.Tag]] = {
    for {
      excludedTags <- configService.getExcludedTags
      allTags <- selectAllTags
    } yield {
      allTags.filterNot(t => excludedTags.contains(t.tag))
    }
  }

  def getSingleLabelMetadata(labelId: Int, userId: String): Future[Option[LabelMetadata]] = {
    db.run(labelTable.getRecentLabelsMetadata(1, None, Some(userId), Some(labelId)).map(_.headOption))
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

    // Function to put the raw labels into the correct case class.
    def processLabels(rawLabels: Seq[(Int, String, String, String, Timestamp, Option[Float], Option[Float], Float,
      Float, Int, (Int, Int), Option[Int], Boolean, Option[String], Int, Int, (Int, Int, Int, Option[Boolean]),
      Option[Int], List[String])]): Seq[LabelValidationMetadata] = {
      rawLabels.map { l =>
        LabelValidationMetadata(
          l._1, l._2, l._3, l._4, l._5, l._6.get, l._7.get, l._8, l._9, l._10, LocationXY.tupled(l._11), l._12, l._13,
          l._14, l._15, l._16, LabelValidationInfo.tupled(l._17), l._18, l._19
        )
      }
    }

    // Recursive helper function that queries for valid labels of a specific type in batches.
    def findValidLabelsForType(labelTypeId: Int, remaining: Int, batchNumber: Int = 0, accumulator: Seq[LabelValidationMetadata] = Seq.empty): Future[Seq[LabelValidationMetadata]] = {
      println(s"findValidLabelsForType: $labelTypeId, $remaining")
      if (remaining <= 0) {
        Future.successful(accumulator)
      } else {
        val batchSize = remaining * 5 // Get 5x the needed amount, shouldn't need to query again.

        // Get a batch of labels.
        db.run(
            labelTable.getGalleryLabelsQuery(Some(labelTypeId), loadedLabelIds, valOptions, regionIds, severity, tags, userId)
              .drop(batchSize * batchNumber).take(batchSize).result
          ).map(processLabels)
          .flatMap { labels =>
            // Check each of those labels for GSV imagery in parallel.
            checkGsvImageryBatch(labels).flatMap { validLabels =>
              if (validLabels.isEmpty) {
                Future.successful(accumulator) // No more valid labels found.
              } else {
                // Add the valid labels to the accumulator and recurse.
                val newValidLabels = validLabels.take(remaining)
                findValidLabelsForType(labelTypeId,
                  remaining - newValidLabels.size,
                  batchNumber + 1,
                  accumulator ++ newValidLabels)
              }
            }
          }
      }
    }

    // Main logic. If a label type is specified, get labels for that type. Otherwise, get labels for all types.
    if (labelTypeId.isDefined) {
      findValidLabelsForType(labelTypeId.get, n)
    } else {
      // Get labels for each type in parallel.
      val nPerType = n / LabelTypeTable.primaryLabelTypes.size
      Future.sequence(
        LabelTypeTable.primaryLabelTypes.map { labelType =>
          findValidLabelsForType(LabelTypeTable.labelTypeToId(labelType), nPerType)
        }
      ).map { labelsByType =>
        scala.util.Random.shuffle(labelsByType.flatten).toSeq // Combine and shuffle.
      }
    }
  }

  // Checks each label in a batch for GSV imagery in parallel.
  private def checkGsvImageryBatch(labels: Seq[LabelValidationMetadata]): Future[Seq[LabelValidationMetadata]] = {
    Future.traverse(labels) { label =>
      gsvDataService.panoExists(label.gsvPanoramaId).map {
        case Some(true) => Some(label)
        case _ => None
      }
    }.map(_.flatten)
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
    // TODO combine this code with the code for Gallery labels.
    // TODO can we make this and the Gallery queries transactions to prevent label dupes?

    // Function to put the raw labels into the correct case class.
    def processLabels(rawLabels: Seq[(Int, String, String, String, Timestamp, Option[Float], Option[Float], Float,
      Float, Int, (Int, Int), Option[Int], Boolean, Option[String], Int, Int, (Int, Int, Int, Option[Boolean]),
      Option[Int], List[String])]): Seq[LabelValidationMetadata] = {
      rawLabels.map { l =>
        LabelValidationMetadata(
          l._1, l._2, l._3, l._4, l._5, l._6.get, l._7.get, l._8, l._9, l._10, LocationXY.tupled(l._11), l._12, l._13,
          l._14, l._15, l._16, LabelValidationInfo.tupled(l._17), l._18, l._19
        )
      }
    }

    // Recursive helper function that queries for valid labels of a specific type in batches.
    def findValidLabelsForType(labelTypeId: Int, remaining: Int, batchNumber: Int = 0, accumulator: Seq[LabelValidationMetadata] = Seq.empty): Future[Seq[LabelValidationMetadata]] = {
      println(s"findValidLabelsForType: $labelTypeId, $remaining")
      if (remaining <= 0) {
        Future.successful(accumulator)
      } else {
        val batchSize = remaining * 5 // Get 5x the needed amount, shouldn't need to query again.

        // Get a batch of labels.
        db.run(
            labelTable.retrieveLabelListForValidationQuery(userId, labelTypeId, userIds, regionIds, skippedLabelId)
              .drop(batchSize * batchNumber).take(batchSize).result
          ).map(processLabels)
          .flatMap { labels =>
            // Check each of those labels for GSV imagery in parallel.
            checkGsvImageryBatch(labels).flatMap { validLabels =>
              if (validLabels.isEmpty) {
                Future.successful(accumulator) // No more valid labels found.
              } else {
                // Add the valid labels to the accumulator and recurse.
                val newValidLabels = validLabels.take(remaining)
                findValidLabelsForType(labelTypeId,
                  remaining - newValidLabels.size,
                  batchNumber + 1,
                  accumulator ++ newValidLabels)
              }
            }
          }
      }
    }

    // Randomize those n * 5 high priority labels to prevent similar labels in a mission.
    // TODO
    //    potentialLabels = scala.util.Random.shuffle(potentialLabels)

    findValidLabelsForType(labelTypeId, n)
  }

  /**
   * Get the data needed by the various Validate endpoints.
   *
   * @return (mission, missionSetProgress, labelList, adminData)
   */
  def getDataForValidationPages(user: SidewalkUserWithRole, labelCount: Int, adminParams: AdminValidateParams): Future[(Option[Mission], MissionSetProgress, Seq[LabelValidationMetadata], Seq[AdminValidationData])] = {

    // TODO actually set this up for turkers.
    val missionSetProgress: MissionSetProgress =
      MissionTable.defaultValidationMissionSetProgress
    //      if (user.role == "Turker") MissionTable.getProgressOnMissionSet(user.username)
//      else MissionTable.defaultValidationMissionSetProgress

    // TODO actually implement this.
    val labelTypeId: Option[Int] = Some(1)
//    val labelTypeId: Option[Int] = getLabelTypeIdToValidate(user.userId, labelCount, adminParams.labelTypeId)

    // Checks if there are still labels in the database for the user to validate.
    if (labelTypeId.isDefined && missionSetProgress.missionType == "validation") {
      for {
        mission: Mission <- missionService.resumeOrCreateNewValidationMission(
          user.userId, AMTAssignmentTable.TURKER_PAY_PER_LABEL_VALIDATION, 0.0, "validation", labelTypeId.get
        ).map(_.get)

        // Get list of labels and their metadata for Validate page. Get extra metadata if it's for Admin Validate.
        labelsProgress: Int = mission.labelsProgress.get
        labelsToValidate: Int = MissionTable.validationMissionLabelsToRetrieve
        labelsToRetrieve: Int = labelsToValidate - labelsProgress
        labelMetadata <- retrieveLabelListForValidation(user.userId, labelsToRetrieve, labelTypeId.get, adminParams.userIds.map(_.toSet).getOrElse(Set()), adminParams.neighborhoodIds.map(_.toSet).getOrElse(Set()))
        adminData <- {
          if (adminParams.adminVersion) getExtraAdminValidateData(labelMetadata.map(_.labelId))
          else Future.successful(Seq.empty[AdminValidationData])
        }
      } yield {
        (Some(mission), missionSetProgress, labelMetadata, adminData)
      }

      // TODO implement getValidationProgress.
//      val progressJsObject: JsObject = LabelValidationTable.getValidationProgress(mission.missionId)
    } else {
      // TODO When fixing the mission sequence infrastructure (#1916), this should update that table since there are
      //      no validation missions that can be done.
      Future.successful((Option.empty[Mission], missionSetProgress, Seq.empty[LabelValidationMetadata], Seq.empty[AdminValidationData]))
    }
  }
}
