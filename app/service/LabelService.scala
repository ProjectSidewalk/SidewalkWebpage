package service

import com.google.inject.ImplementedBy
import controllers.helper.ValidateHelper.ValidateParams
import formats.json.ValidateFormats.ValidationMissionProgress
import models.label.LabelTable._
import models.label.{Tag, _}
import models.mission.{Mission, MissionTable, MissionType}
import models.pano.PanoSource
import models.pano.PanoSource.PanoSource
import models.user.SidewalkUserWithRole
import models.utils.CommonUtils.UiSource
import models.utils.MyPostgresProfile.api._
import models.utils.{ExcludedTag, LatLngBBox, MyPostgresProfile}
import models.validation.LabelValidationTable
import models.validation.ValidationQueuePolicy.ValidationQueue
import org.apache.pekko.stream.scaladsl.Source
import play.api.Logger
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.dbio.DBIO

import javax.inject._
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Random

case class ValidationTaskPostReturnValue(
    hasMissionAvailable: Option[Boolean],
    mission: Option[Mission],
    labels: Seq[LabelValidationMetadata],
    adminData: Seq[AdminValidationData],
    progress: Option[(Int, Int, Int)]
)

@ImplementedBy(classOf[LabelServiceImpl])
trait LabelService {
  def countLabels: Future[Int]
  def countLabelsInRegion(regionId: Int): Future[Int]
  def selectAllTags: DBIO[Seq[models.label.Tag]]
  def selectAllTagsFuture: Future[Seq[models.label.Tag]]
  def selectTagsByLabelType(labelType: LabelTypeEnum.Base): Future[Seq[models.label.Tag]]
  def getTagsForCurrentCity: Future[Seq[models.label.Tag]]
  def cleanTagList(tags: Seq[String], labelType: LabelTypeEnum.Base): DBIO[Seq[String]]
  def getSingleLabelMetadata(labelId: Int, userId: String): Future[Option[LabelMetadata]]
  def getLabelLatLng(labelId: Int): Future[Option[LatLng]]
  def getRecentLabelMetadata(takeN: Int): Future[Seq[LabelMetadata]]
  def getExtraAdminValidateData(labelIds: Seq[Int]): Future[Seq[AdminValidationData]]
  def getLabelsForLabelMap(
      regionIds: Seq[Int],
      routeIds: Seq[Int],
      aiValOptions: Seq[String],
      bbox: Option[LatLngBBox],
      batchSize: Int
  ): Source[LabelForLabelMap, _]
  def getGalleryLabels(
      n: Int,
      labelTypes: Set[LabelTypeEnum.Base],
      loadedLabelIds: Set[Int],
      valOptions: Set[String],
      regionIds: Set[Int],
      severity: Set[Option[Int]],
      tagsByLabelType: Map[LabelTypeEnum.Base, Set[String]],
      aiValOptions: Set[String],
      userId: String,
      recentFirst: Boolean = false,
      staticImageryOnly: Boolean = false
  ): Future[Seq[LabelValidationMetadata]]
  def retrieveLabelListForValidation(
      userId: String,
      n: Int,
      viewer: PanoSource,
      labelType: LabelTypeEnum.Base,
      queues: Seq[ValidationQueue],
      userIds: Option[Set[String]] = None,
      regionIds: Option[Set[Int]] = None,
      unvalidatedOnly: Boolean = false,
      excludedLabelIds: Set[Int] = Set.empty
  ): Future[Seq[LabelValidationMetadata]]
  def getDataForValidationPages(
      user: SidewalkUserWithRole,
      labelCount: Int,
      validateParams: ValidateParams
  ): Future[(Option[Mission], Option[(Int, Int, Int)], Seq[LabelValidationMetadata], Seq[AdminValidationData])]
  def getDataForValidatePostRequest(
      user: SidewalkUserWithRole,
      missionProgress: Option[ValidationMissionProgress],
      validateParams: ValidateParams
  ): Future[ValidationTaskPostReturnValue]
  def getMoreLabelsToValidate(
      user: SidewalkUserWithRole,
      labelType: LabelTypeEnum.Base,
      labelsNeeded: Int,
      excludedLabelIds: Set[Int],
      validateParams: ValidateParams
  ): Future[(Seq[LabelValidationMetadata], Seq[AdminValidationData])]
  def getRecentValidatedLabelsForUser(
      userId: String,
      labelTypes: Set[LabelTypeEnum.Base],
      nPerType: Int
  ): Future[Map[LabelTypeEnum.Base, Seq[LabelMetadataUserDash]]]
  def recordMistakeVote(labelId: Int, userId: String, agrees: Boolean): Future[Boolean]
  def recordMistakeNote(labelId: Int, userId: String, comment: Option[String]): Future[Boolean]
  def getLabelsFromUserInRegion(regionId: Int, userId: String): Future[Seq[ResumeLabelMetadata]]
  def insertLabel(label: Label): DBIO[Int]
}

/** The parts of Validate's label-type selection that are pure arithmetic, so they can be tested without a database. */
object LabelServiceImpl {

  /**
   * Picks the queue a mission is chosen from, and the label types that queue can fill a mission with.
   *
   * The cascade is walked in order and the first queue with at least one such type wins, so Expert Validate falls
   * back from triage to the crowd's queue and finally to everything rather than stalling when a queue empties out.
   *
   * @param candidates    Per-type counts, already narrowed to the types this mission may use.
   * @param queues        The cascade, in order.
   * @param missionLength How many labels a mission needs.
   * @return              The winning queue and its types; `(Any, empty)` when no queue can fill a mission, which
   *                      leaves the caller with no label type to serve.
   */
  private[service] def chooseQueueAndTypes(
      candidates: Seq[LabelTypeValidationsLeft],
      queues: Seq[ValidationQueue],
      missionLength: Int
  ): (ValidationQueue, Seq[LabelTypeValidationsLeft]) = {
    queues
      .map(queue => (queue, candidates.filter(_.countFor(queue) >= missionLength)))
      .find { case (_, types) => types.nonEmpty }
      .getOrElse((ValidationQueue.Any, Seq.empty[LabelTypeValidationsLeft]))
  }

  /**
   * How much a label type's share of the type lottery is weighted.
   *
   * `Any` is the endless-game fallback rather than a statement about what needs validating, so it weighs every type
   * equally; the other queues weigh a type by how many labels it has left in that queue.
   */
  private[service] def typeWeight(queue: ValidationQueue, labelType: LabelTypeValidationsLeft): Int = {
    if (queue == ValidationQueue.Any) 1 else labelType.countFor(queue)
  }
}

@Singleton
class LabelServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    configService: ConfigService,
    panoDataService: PanoDataService,
    labelTable: LabelTable,
    tagTable: TagTable,
    labelValidationTable: LabelValidationTable,
    labelHistoryTable: LabelHistoryTable,
    missionService: MissionService,
    implicit val ec: ExecutionContext
) extends LabelService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val logger = Logger(this.getClass)

  def countLabels: Future[Int] = db.run(labelTable.countLabels)

  /**
   * Gets the total label count in a region across all users.
   * @param regionId ID of the region to count labels in
   */
  def countLabelsInRegion(regionId: Int): Future[Int] = db.run(labelTable.countLabelsInRegion(regionId))

  def selectAllTags: DBIO[Seq[models.label.Tag]] =
    configService.cachedDBIO[Seq[models.label.Tag]]("selectAllTags()")(tagTable.selectAllTags)

  def selectAllTagsFuture: Future[Seq[models.label.Tag]] =
    db.run(selectAllTags)

  def selectTagsByLabelTypeDbio(labelType: LabelTypeEnum.Base): DBIO[Seq[models.label.Tag]] = {
    selectAllTags.map(_.filter(_.labelType == labelType))
  }

  def selectTagsByLabelType(labelType: LabelTypeEnum.Base): Future[Seq[models.label.Tag]] =
    db.run(selectTagsByLabelTypeDbio(labelType))

  def getTagsForCurrentCity: Future[Seq[models.label.Tag]] = {
    db.run(for {
      excludedTags: Seq[ExcludedTag] <- configService.getExcludedTags
      allTags: Seq[Tag]              <- selectAllTags
    } yield {
      allTags.filterNot(t => excludedTags.exists(et => et.tag == t.tag && et.labelType == t.labelType.name))
    })
  }

  def findConflictingTags(tags: Set[String], labelType: LabelTypeEnum.Base): DBIO[Seq[String]] = {
    selectTagsByLabelTypeDbio(labelType).map { allTags: Seq[models.label.Tag] =>
      allTags.filter(tag => tags.contains(tag.tag) && tag.mutuallyExclusiveWith.exists(tags.contains)).map(_.tag)
    }
  }

  /**
   * Removes any tags that are invalid or conflicting.
   * @param tags List of tags to clean
   * @param labelType Label type to filter tags by
   * @return Cleaned list of tags
   */
  def cleanTagList(tags: Seq[String], labelType: LabelTypeEnum.Base): DBIO[Seq[String]] = {
    for {
      validTags: Seq[String] <- selectTagsByLabelTypeDbio(labelType).map(_.map(_.tag))
      cleanedTags: Seq[String] = tags.distinct.filter(t => validTags.contains(t))
      conflictingTags: Seq[String] <- findConflictingTags(cleanedTags.toSet, labelType)
    } yield {
      if (conflictingTags.nonEmpty) {
        logger.warn(s"Tag list has conflicting tags, removing all that conflict: ${conflictingTags.mkString(", ")}")
        cleanedTags.filterNot(conflictingTags.contains)
      } else {
        cleanedTags
      }
    }
  }

  def getSingleLabelMetadata(labelId: Int, userId: String): Future[Option[LabelMetadata]] =
    db.run(labelTable.getRecentLabelsMetadata(1, None, Some(userId), Some(labelId)).map(_.headOption))

  def getLabelLatLng(labelId: Int): Future[Option[LatLng]] = db.run(labelTable.getLabelLatLng(labelId))

  def getRecentLabelMetadata(takeN: Int): Future[Seq[LabelMetadata]] = db.run(labelTable.getRecentLabelsMetadata(takeN))

  def getExtraAdminValidateData(labelIds: Seq[Int]): Future[Seq[AdminValidationData]] =
    db.run(labelTable.getExtraAdminValidateData(labelIds))

  def getLabelsForLabelMap(
      regionIds: Seq[Int],
      routeIds: Seq[Int],
      aiValOptions: Seq[String],
      bbox: Option[LatLngBBox],
      batchSize: Int
  ): Source[LabelForLabelMap, _] =
    // `.transactionally` is required for Postgres to honor fetchSize and stream instead of materializing (#3932). It
    // also means a pooled connection stays checked out, transaction open, for the whole response rather than just the
    // query: `Ok.chunked` backpressures from the client socket, so a slow reader pins one of the 25 connections until
    // it finishes. Prod bounds that with idle_in_transaction_session_timeout=120s, which a fetch-to-fetch gap longer
    // than that trips — the stream then fails mid-flight, and `logStreamFailures` is the only trace (see #4161).
    Source.fromPublisher(
      db.stream(
        labelTable
          .getLabelsForLabelMap(regionIds, routeIds, aiValOptions, bbox)
          .result
          .transactionally
          .withStatementParameters(fetchSize = batchSize)
      ).mapResult(labelTable.tupleToLabelForLabelMap)
    )

  /**
   * Retrieves n labels, split evenly across the requested label types. An empty set of types gives a mix of all.
   * @param n Number of labels to grab.
   * @param labelTypes        Label types to grab, split evenly between them. Empty gives a mix of every type.
   * @param loadedLabelIds    Set of labelIds already grabbed as to not grab them again.
   * @param valOptions        Set of correctness values to filter for: correct, incorrect, unsure, and/or unvalidated.
   * @param regionIds         Set of neighborhoods to get labels from. All neighborhoods if empty.
   * @param severity          Set of severities the labels grabbed can have.
   * @param tagsByLabelType   Tags each label type is narrowed to; a type absent from the map is not narrowed.
   * @param aiValOptions      Set of AI validations to filter for: correct, incorrect, unsure, and/or unvalidated.
   * @param userId            User ID of the user requesting the labels.
   * @param recentFirst       If true, draw from the most recent labels (shuffled) instead of sampling all labels.
   * @return Seq[LabelValidationMetadata]
   */
  def getGalleryLabels(
      n: Int,
      labelTypes: Set[LabelTypeEnum.Base],
      loadedLabelIds: Set[Int],
      valOptions: Set[String],
      regionIds: Set[Int],
      severity: Set[Option[Int]],
      tagsByLabelType: Map[LabelTypeEnum.Base, Set[String]],
      aiValOptions: Set[String],
      userId: String,
      recentFirst: Boolean = false,
      staticImageryOnly: Boolean = false
  ): Future[Seq[LabelValidationMetadata]] = {
    val viewer: PanoSource = configService.getPanoSource

    // One query per requested type, run in parallel and shuffled together, so a caller can ask for any subset. An
    // empty request means every type; staticImageryOnly narrows it to the types a static image can support (the
    // landing grid can't pan, so e.g. Signal is out — see staticValidatableLabelTypes). Include useCrops so that
    // labels with expired or non-Google imagery are still included if a local crop exists.
    // With recentFirst the query is ordered newest-first, so findValidLabelsForType's batching draws from the most
    // recent labels and randomize=true shuffles within that recent pool.
    val typesToSpread: Set[LabelTypeEnum.Base] =
      if (labelTypes.isEmpty) {
        if (staticImageryOnly) LabelTypeEnum.staticValidatableLabelTypes else LabelTypeEnum.primaryLabelTypes
      } else if (staticImageryOnly) {
        labelTypes.intersect(LabelTypeEnum.staticValidatableLabelTypes)
      } else {
        // An explicit request is honored as given: the Gallery offers Occlusion and Other, which the default mix
        // (primaryLabelTypes) leaves out.
        labelTypes
      }

    if (typesToSpread.isEmpty) {
      Future.successful(Seq())
    } else {
      // Split the request across the types so no one type crowds out the rest of a mixed selection.
      val nPerType: Int = math.max(1, n / typesToSpread.size)
      Future
        .sequence(typesToSpread.map { labelType =>
          findValidLabelsForType(
            labelTable.getGalleryLabelsQuery(
              viewer,
              labelType,
              loadedLabelIds,
              valOptions,
              regionIds,
              severity,
              tagsByLabelType.getOrElse(labelType, Set()),
              aiValOptions,
              userId,
              recentFirst
            ),
            randomize = true,
            useCrops = true,
            nPerType
          )
        })
        .map(labelsByType => scala.util.Random.shuffle(labelsByType.flatten).toSeq)
    }
  }

  /**
   * Get n labels for validation, sorted according to priority algorithm, after checking that imagery isn't expired.
   *
   * Starts by querying for n * 5 labels, then checks GSV API to see if each pano_id exists until we find n.
   *
   * @param userId           User ID for the current user.
   * @param n                Number of labels we need to query.
   * @param viewer           The type of pano viewer the labels must have been added on (GSV, Mapillary, etc).
   * @param labelType        Label type of labels requested.
   * @param queues           Queues to draw from, in order; each later queue only tops up what the earlier ones could
   *                         not fill, so a mission is still handed a full set of labels once the queue that should
   *                         serve it runs dry (#2929).
   * @param userIds          Optional list of user IDs to filter by.
   * @param regionIds        Optional list of region IDs to filter by.
   * @param excludedLabelIds Labels the caller already holds and must not be handed again (#4810).
   * @return                 Seq[LabelValidationMetadata]
   */
  def retrieveLabelListForValidation(
      userId: String,
      n: Int,
      viewer: PanoSource,
      labelType: LabelTypeEnum.Base,
      queues: Seq[ValidationQueue],
      userIds: Option[Set[String]] = None,
      regionIds: Option[Set[Int]] = None,
      unvalidatedOnly: Boolean = false,
      excludedLabelIds: Set[Int] = Set.empty
  ): Future[Seq[LabelValidationMetadata]] = {
    // TODO can we make this and the Gallery queries transactions to prevent label dupes?
    queues.foldLeft(Future.successful(Seq.empty[LabelValidationMetadata])) { (foundSoFar, queue) =>
      foundSoFar.flatMap { found =>
        if (found.size >= n) Future.successful(found)
        else
          findValidLabelsForType(
            labelTable.retrieveLabelListForValidationQuery(
              userId,
              viewer,
              labelType,
              queue,
              configService.getAiTagSuggestionsEnabled,
              userIds,
              regionIds,
              unvalidatedOnly,
              excludedLabelIds ++ found.map(_.labelId)
            ),
            randomize = true,
            useCrops = false,
            n - found.size
          ).map(found ++ _)
      }
    }
  }

  /**
   * Query labels from the db in batches until we have enough labels that have imagery available. Works recursively.
   * @param labelQuery Query to get labels from the db.
   * @param randomize Whether to randomize the label order or not.
   * @param useCrops If true, local static crop of pano around the label also works as well as an API call.
   * @param remaining Number of labels remaining to get.
   * @param offset Number of rows to skip; each batch advances it by the number of rows it read.
   * @param accumulator Accumulator of labels we've found so far.
   * @param tupleConverter Implicit converter to convert the tuple from the db to the appropriate case class.
   */
  private def findValidLabelsForType[A <: BasicLabelMetadata, TupleRep, Tuple](
      labelQuery: Query[TupleRep, Tuple, Seq],
      randomize: Boolean,
      useCrops: Boolean,
      remaining: Int,
      offset: Int = 0,
      accumulator: Seq[A] = Seq.empty
  )(implicit tupleConverter: TupleConverter[Tuple, A]): Future[Seq[A]] = {
    if (remaining <= 0) {
      Future.successful(accumulator)
    } else {
      val batchSize = remaining * 5 // Get 5x the needed amount, shouldn't need to query again.

      // Query for a batch of labels.
      db.run(labelQuery.drop(offset).take(batchSize).result)
        .map(l => l.map(tupleConverter.fromTuple))
        .flatMap { labels =>
          // Randomize the labels to prevent similar labels in a mission.
          val shuffledLabels: Seq[A] = if (randomize) scala.util.Random.shuffle(labels) else labels

          // Check for valid imagery in parallel.
          checkImageryBatch(shuffledLabels, useCrops).flatMap { validLabels =>
            // Skip labels an earlier batch took. The validation query orders by a score containing `random()`, which
            // Postgres re-evaluates per execution, so every batch sees a fresh shuffle and can resurface rows an
            // earlier one covered, whatever the offset. A mission holding the same label twice is what that looks
            // like to the user.
            val alreadyFound: Set[Int] = accumulator.map(_.labelId).toSet
            val newValidLabels: Seq[A] = validLabels.filterNot(l => alreadyFound.contains(l.labelId)).take(remaining)

            if (validLabels.isEmpty) {
              Future.successful(accumulator) // No more valid labels found.
            } else {
              // Add the valid labels to the accumulator and recurse.
              findValidLabelsForType(
                labelQuery,
                randomize,
                useCrops,
                remaining - newValidLabels.size,
                // Advance by the rows this batch read. `batchSize` shrinks as `remaining` does, so it can't be
                // multiplied out into an offset.
                offset + labels.size,
                accumulator ++ newValidLabels
              )
            }
          }
        }
    }
  }

  // Checks each label in a batch for imagery availability. When useCrops is true, labels with a locally-saved crop
  // image are accepted without any imagery lookup; only labels lacking a crop are looked up. When useCrops is false,
  // every label is looked up, and one with a viewable locally-hosted backup passes even when its imagery is gone.
  //
  // This is the gate expired imagery has to clear: LabelTable.imageryViewable screens on pano_data.expired, which a row
  // keeps claiming false until something checks it, so a label whose imagery died arrives here still looking live. The
  // lookup answers from pano_data where that's sound (getReusableImageryStatus) and asks the provider otherwise.
  private def checkImageryBatch[A <: BasicLabelMetadata](labels: Seq[A], useCrops: Boolean): Future[Seq[A]] = {
    // Partition: labels with local crops need no imagery lookup at all; the rest are checked one by one.
    val (withCrop, toCheck) =
      if (useCrops) labels.partition(l => panoDataService.cropExists(l.labelId, l.labelType))
      else (Seq.empty[A], labels)

    // One query up front for the answers we can reuse, so the per-label lookups below skip the provider where they can.
    // Only provider-checked sources have reusable answers, and every batch is single-source (the label queries filter
    // on the viewer's source), so asking about an Infra3d batch would spend a round trip to be told nothing.
    val cacheablePanoIds: Set[String] =
      toCheck.collect { case l if PanoSource.providerCheckedSources.contains(l.panoSource) => l.panoId }.toSet
    panoDataService.getReusableImageryStatus(cacheablePanoIds).flatMap { reusable =>
      def imageryExists(label: A): Future[Option[Boolean]] =
        reusable.get(label.panoId) match {
          case Some(exists) => Future.successful(Some(exists))
          case None         => panoDataService.panoExists(label.panoId, label.panoSource)
        }

      if (useCrops) {
        Future
          .traverse(toCheck) { label =>
            imageryExists(label).map {
              case Some(true) => Some(label)
              case _          => None
            }
          }
          .map(results => withCrop ++ results.flatten)
      } else {
        Future
          .traverse(toCheck) { label =>
            imageryExists(label).flatMap {
              case Some(true) => Future.successful(Some(label))
              // getLocalBackupImage, not backupExists: a file on disk is only usable if pano_data also has the metadata
              // Pannellum needs. Validate has no fallback behind it, so admitting a label we can't render is #4804.
              case _ => panoDataService.getLocalBackupImage(label.panoId).map(_.map(_ => label))
            }
          }
          .map(_.flatten)
      }
    }
  }

  /**
   * Get the label type to validate. Label types with more labels still needing validation have higher priority.
   *
   * The cascade decides both halves of the choice: the first queue in it that can fill a whole mission for some label
   * type is the queue that sets which types are in play and what they are weighted by. So a plain Validate mission is
   * chosen from the types the crowd can still settle, and only falls back to weighing every type equally once no type
   * has a mission's worth of those left (#2929).
   *
   * @param userId            User ID of the current user.
   * @param missionLength     Number of labels for this mission.
   * @param requiredLabelType labelType of the current mission.
   * @param queues            Queues to consider, in order; see `ValidateParams.queueCascade`.
   */
  def getLabelTypeToValidate(
      userId: String,
      missionLength: Int,
      viewerType: PanoSource,
      requiredLabelType: Option[LabelTypeEnum.Base],
      queues: Seq[ValidationQueue]
  ): Future[Option[LabelTypeEnum.Base]] = {
    db.run(labelTable.getAvailableValidationsLabelsByType(userId, viewerType).map { availValidations =>
      val candidates: Seq[LabelTypeValidationsLeft] = availValidations
        .filter(_.validationsAvailable >= missionLength)
        .filter(x => requiredLabelType.isEmpty || requiredLabelType.contains(x.labelType))
        .filter(x => LabelTypeEnum.primaryLabelTypes.contains(x.labelType))

      val (queue, availTypes) = LabelServiceImpl.chooseQueueAndTypes(candidates, queues, missionLength)

      // Unless NoSidewalk is the only available label type, remove it from the list of available types.
      val typesFiltered: Seq[LabelTypeValidationsLeft] = availTypes
        .filter(x => LabelTypeEnum.primaryValidateLabelTypes.contains(x.labelType) || availTypes.length == 1)

      if (typesFiltered.length < 2) {
        typesFiltered.map(_.labelType).headOption
      } else {
        // Each label type has at least a 2% chance of being selected. Remaining probability is divvied up
        // proportionally based on how many labels of that type the chosen queue holds.
        val totalWeight: Int = typesFiltered.map(t => LabelServiceImpl.typeWeight(queue, t)).sum
        val typeProbabilities: Seq[(LabelTypeEnum.Base, Double)] = typesFiltered.map { t =>
          (
            t.labelType,
            0.02 + (1 - typesFiltered.length * 0.02)
              * (LabelServiceImpl.typeWeight(queue, t).toDouble / totalWeight)
          )
        }

        // Get cumulative probabilities.
        val cumulativeProbabilities: Seq[Double] =
          typeProbabilities.scanLeft(0.0) { case (acc, (_, prob)) => acc + prob }.tail

        // Choose a label type proportionally based on the calculated probabilities.
        val random = new Random()
        Some(typeProbabilities(cumulativeProbabilities.indexWhere(_ > random.nextDouble()))._1)
      }
    })
  }

  /**
   * Get the data needed by the various Validate endpoints.
   * @return Future[(mission, missionProgress, labelList, adminData)]
   */
  def getDataForValidationPages(
      user: SidewalkUserWithRole,
      labelCount: Int,
      validateParams: ValidateParams
  ): Future[(Option[Mission], Option[(Int, Int, Int)], Seq[LabelValidationMetadata], Seq[AdminValidationData])] = {
    // TODO can this be merged with `getDataForValidatePostRequest`?
    val viewerType: PanoSource = configService.getPanoSource
    getLabelTypeToValidate(user.userId, labelCount, viewerType, validateParams.labelType, validateParams.queueCascade)
      .flatMap {
        case Some(labelType) =>
          for {
            mission: Mission <- missionService
              .resumeOrCreateNewValidateMission(user.userId, MissionType.Validation, labelType)
              .map(_.get)
            missionProgress: (Int, Int, Int) <- db.run(labelValidationTable.getValidationProgress(mission.missionId))

            // Get list of labels and their metadata for Validate page. Get extra metadata if it's for Expert Validate.
            labelsProgress: Int   = mission.labelsProgress.get
            labelsToValidate: Int = MissionTable.validationMissionLabelsToRetrieve
            labelsToRetrieve: Int = labelsToValidate - labelsProgress
            labelMetadata <- retrieveLabelListForValidation(user.userId, labelsToRetrieve, viewerType, labelType,
              validateParams.queueCascade, validateParams.userIds.map(_.toSet),
              validateParams.neighborhoodIds.map(_.toSet), validateParams.unvalidatedOnly)
            adminData <- {
              if (validateParams.adminVersion) getExtraAdminValidateData(labelMetadata.map(_.labelId))
              else Future.successful(Seq.empty[AdminValidationData])
            }
          } yield {
            (Some(mission), Some(missionProgress), labelMetadata, adminData)
          }
        case None =>
          Future.successful(
            (Option.empty[Mission], None, Seq.empty[LabelValidationMetadata], Seq.empty[AdminValidationData])
          )
      }
  }

  /**
   * Get replacement labels for a Validate mission that ran out of them mid-mission.
   *
   * Validate is handed exactly as many labels as its mission still needs, so a label it turns out not to be able to
   * render (#4810) would otherwise leave the mission unfinishable. This tops the queue back up.
   *
   * @param user             The user validating.
   * @param labelType        Label type of the mission being topped up.
   * @param labelsNeeded     How many labels the client is short, capped at a full mission's worth.
   * @param excludedLabelIds Every label the client already holds, so it can't be handed one back.
   * @param validateParams   The page's filters, so a topped-up label matches what the rest of the mission is.
   * @return                 (labelList, adminData) — adminData empty unless this is Expert Validate.
   */
  def getMoreLabelsToValidate(
      user: SidewalkUserWithRole,
      labelType: LabelTypeEnum.Base,
      labelsNeeded: Int,
      excludedLabelIds: Set[Int],
      validateParams: ValidateParams
  ): Future[(Seq[LabelValidationMetadata], Seq[AdminValidationData])] = {
    val viewerType: PanoSource = configService.getPanoSource
    val nToRetrieve: Int       = labelsNeeded.min(MissionTable.validationMissionLabelsToRetrieve)
    if (nToRetrieve < 1) {
      Future.successful((Seq.empty[LabelValidationMetadata], Seq.empty[AdminValidationData]))
    } else {
      for {
        labelList <- retrieveLabelListForValidation(user.userId, nToRetrieve, viewerType, labelType,
          validateParams.queueCascade, validateParams.userIds.map(_.toSet), validateParams.neighborhoodIds.map(_.toSet),
          validateParams.unvalidatedOnly, excludedLabelIds)
        adminData <- {
          if (validateParams.adminVersion) getExtraAdminValidateData(labelList.map(_.labelId))
          else Future.successful(Seq.empty[AdminValidationData])
        }
      } yield (labelList, adminData)
    }
  }

  /**
   * Get the data needed by the Validate POST endpoints.
   * @return Future[(mission, missionProgress, labelList, adminData)]
   */
  def getDataForValidatePostRequest(
      user: SidewalkUserWithRole,
      missionProgress: Option[ValidationMissionProgress],
      validateParams: ValidateParams
  ): Future[ValidationTaskPostReturnValue] = {
    // TODO can this be merged with `getDataForValidationPages`?
    val viewerType: PanoSource = configService.getPanoSource
    val labelsToRetrieve: Int  = MissionTable.validationMissionLabelsToRetrieve
    (for {
      nextMissionLabelType <- {
        if (missionProgress.exists(_.completed))
          getLabelTypeToValidate(user.userId, labelsToRetrieve, viewerType, validateParams.labelType,
            validateParams.queueCascade)
        else Future.successful(Option.empty[LabelTypeEnum.Base])
      }
    } yield {
      (missionProgress, nextMissionLabelType) match {
        case (Some(missionProgress), Some(nextMissionLabelType)) =>
          for {
            newMission: Option[Mission] <- missionService.updateMissionTableValidate(
              user,
              missionProgress,
              Some(nextMissionLabelType)
            )
            labelList: Seq[LabelValidationMetadata] <- retrieveLabelListForValidation(user.userId, labelsToRetrieve,
              viewerType, nextMissionLabelType, validateParams.queueCascade, validateParams.userIds.map(_.toSet),
              validateParams.neighborhoodIds.map(_.toSet), validateParams.unvalidatedOnly)
            adminData <- {
              if (validateParams.adminVersion) getExtraAdminValidateData(labelList.map(_.labelId))
              else Future.successful(Seq.empty[AdminValidationData])
            }
            // This could be written more simply using traverse from cats or scalaz.
            progress: Option[(Int, Int, Int)] <- Future
              .successful(newMission)
              .flatMap(
                _.fold(
                  Future.successful(None: Option[(Int, Int, Int)])
                )(m => db.run(labelValidationTable.getValidationProgress(m.missionId)).map(Some(_)))
              )
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
  def getRecentValidatedLabelsForUser(
      userId: String,
      labelTypes: Set[LabelTypeEnum.Base],
      nPerType: Int
  ): Future[Map[LabelTypeEnum.Base, Seq[LabelMetadataUserDash]]] = {
    // Get labels for each type in parallel.
    Future
      .sequence(labelTypes.map { labelType =>
        findValidLabelsForType(
          labelTable.getValidatedLabelsForUserQuery(userId, labelType),
          randomize = false,
          useCrops = false,
          nPerType
        )
          .map(labels => (labelType, labels))
      })
      .map(_.toMap)
  }

  def recordMistakeVote(labelId: Int, userId: String, agrees: Boolean): Future[Boolean] =
    db.run(labelTable.recordMistakeVote(labelId, userId, agrees))

  def recordMistakeNote(labelId: Int, userId: String, comment: Option[String]): Future[Boolean] =
    db.run(labelTable.recordMistakeNote(labelId, userId, comment))

  def getLabelsFromUserInRegion(regionId: Int, userId: String): Future[Seq[ResumeLabelMetadata]] =
    db.run(labelTable.getLabelsFromUserInRegion(regionId, userId))

  /**
   * Insert a new label into the database. Also inserts an initial entry into the label_history table.
   * @param label Label to insert.
   * @return Label ID of the newly inserted label.
   */
  def insertLabel(label: Label): DBIO[Int] = {
    for {
      cleanTags: Seq[String] <- cleanTagList(label.tags, label.labelType)
      clean: Label = label.copy(tags = cleanTags.toList)
      labelId: Int <- (labelTable.labelsUnfiltered returning labelTable.labelsUnfiltered.map(_.labelId)) += clean

      // Add a corresponding entry to the label_history table.
      _ <- labelHistoryTable.insert(
        LabelHistory(0, labelId, clean.severity, clean.tags, clean.userId, clean.timeCreated, UiSource.Explore, None)
      )
    } yield {
      labelId
    }
  }

}
