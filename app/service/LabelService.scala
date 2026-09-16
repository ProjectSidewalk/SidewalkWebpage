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
import models.validation.{LabelValidationTable, ValidationLabelFilter}
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
  def severityFor(labelType: LabelTypeEnum.Base, severity: Option[Int]): Option[Int]
  def findLabel(labelId: Int): Future[Option[Label]]
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
      filter: ValidationLabelFilter,
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
   * @param candidates        Per-type counts, already narrowed to the types this mission may use.
   * @param queues            The cascade, in order.
   * @param missionLength     How many labels a mission needs.
   * @param allowShortMission If no queue can fill a whole mission, take one with any labels (a filtered page's pool).
   * @return                  The winning queue and its types; `(Any, empty)` when no queue qualifies, which leaves
   *                          the caller with no label type to serve.
   */
  private[service] def chooseQueueAndTypes(
      candidates: Seq[LabelTypeValidationsLeft],
      queues: Seq[ValidationQueue],
      missionLength: Int,
      allowShortMission: Boolean
  ): (ValidationQueue, Seq[LabelTypeValidationsLeft]) = {
    def firstQueueHolding(minLabels: Int): Option[(ValidationQueue, Seq[LabelTypeValidationsLeft])] =
      queues
        .map(queue => (queue, candidates.filter(_.canFill(queue, minLabels))))
        .find { case (_, types) => types.nonEmpty }

    firstQueueHolding(missionLength)
      .orElse(if (allowShortMission) firstQueueHolding(1) else None)
      .getOrElse((ValidationQueue.Any, Seq.empty[LabelTypeValidationsLeft]))
  }

  /**
   * The block face a NoSidewalk label sits on, as the key a mission dedupes by (#5285).
   *
   * An unsided label (within 1 m of the centerline) is a face of its own, so two unsided labels on one street stay two
   * candidates rather than collapsing into one.
   *
   * @param streetEdgeId   The label's street.
   * @param side           Which side of it, None when unsided.
   * @param unsidedLabelId The label itself, set only when it is unsided.
   */
  private[service] case class FaceKey(streetEdgeId: Int, side: Option[StreetSide.Value], unsidedLabelId: Option[Int])

  private[service] object FaceKey {
    def of(streetEdgeId: Int, side: Option[StreetSide.Value], labelId: Int): FaceKey =
      FaceKey(streetEdgeId, side, if (side.isEmpty) Some(labelId) else None)

    def of(label: LabelValidationMetadata): FaceKey = of(label.streetEdgeId, label.streetSide, label.labelId)
  }

  /**
   * Picks one label per block face from `candidates`, faces on streets no pick has touched yet first (#5285).
   *
   * Two passes: first every candidate whose face and street are both new, then any whose face is new, each in the
   * candidates' order. Walking in order means "one per face" keeps the face's highest-ranked label, which is why the
   * NoSidewalk fetch does not shuffle. Every face is picked from rather than only a mission's worth: the caller checks
   * imagery next and keeps what it needs, and a pick that fails that check should not cost a face further down. Filling
   * with a second label from a face the mission already holds is the caller's decision, not this method's.
   *
   * @param candidates Labels in priority order.
   * @param heldFaces  Faces the mission already holds, whose streets count as touched.
   * @return           One label per face not already held, distinct-street picks first.
   */
  private[service] def spreadAcrossFaces(
      candidates: Seq[LabelValidationMetadata],
      heldFaces: Set[FaceKey]
  ): Seq[LabelValidationMetadata] = {
    val picked      = scala.collection.mutable.ArrayBuffer.empty[LabelValidationMetadata]
    val pickedIds   = scala.collection.mutable.Set.empty[Int]
    val usedFaces   = scala.collection.mutable.Set.empty[FaceKey] ++ heldFaces
    val usedStreets = scala.collection.mutable.Set.empty[Int] ++ heldFaces.map(_.streetEdgeId)

    def take(label: LabelValidationMetadata): Unit = {
      picked += label
      pickedIds += label.labelId
      usedFaces += FaceKey.of(label)
      usedStreets += label.streetEdgeId
    }

    candidates.foreach { label =>
      if (!usedFaces.contains(FaceKey.of(label)) && !usedStreets.contains(label.streetEdgeId)) take(label)
    }
    candidates.foreach { label => if (!usedFaces.contains(FaceKey.of(label))) take(label) }
    // Back to the candidates' order: the second pass appended its picks after the first's.
    candidates.filter(label => pickedIds.contains(label.labelId))
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
  def findLabel(labelId: Int): Future[Option[Label]] = db.run(labelTable.find(labelId))

  /** A severity a label of this type can carry: the one given, or none for an unrated type. */
  def severityFor(labelType: LabelTypeEnum.Base, severity: Option[Int]): Option[Int] =
    if (labelType.ratingScale == LabelTypeEnum.RatingScale.Unrated) None else severity

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
   * @param regionIds         Set of regions to get labels from. All regions if empty.
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
          // The type arguments are spelled out because nothing else in the call pins the label type down.
          findValidLabelsForType[
            LabelValidationMetadata,
            LabelValidationMetadataTupleRep,
            LabelValidationMetadataTuple
          ](
            _ =>
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
   * @param filter           Expert Validate's user, region, and team filters.
   * @param excludedLabelIds Labels the caller already holds and must not be handed again (#4810).
   * @return                 Seq[LabelValidationMetadata]
   */
  def retrieveLabelListForValidation(
      userId: String,
      n: Int,
      viewer: PanoSource,
      labelType: LabelTypeEnum.Base,
      queues: Seq[ValidationQueue],
      filter: ValidationLabelFilter,
      unvalidatedOnly: Boolean = false,
      excludedLabelIds: Set[Int] = Set.empty
  ): Future[Seq[LabelValidationMetadata]] = {
    // TODO can we make this and the Gallery queries transactions to prevent label dupes?
    def query(queue: ValidationQueue, excluded: Set[Int], excludedFaces: Set[LabelServiceImpl.FaceKey]) =
      labelTable.retrieveLabelListForValidationQuery(
        userId,
        viewer,
        labelType,
        queue,
        configService.getAiTagSuggestionsEnabled,
        filter,
        unvalidatedOnly,
        excluded,
        // An unsided label is a face of its own, and it is already excluded by id.
        excludedFaces.collect { case LabelServiceImpl.FaceKey(edge, Some(side), _) => (edge, side) }
      )

    // Drain the cascade: each queue tops up what the earlier ones left short. The labels held so far — by the client
    // and by every queue before this one — ride along as the walk's accumulator, so each batch's query excludes them
    // (and, for a one-per-face mission, their faces) and the per-batch selector sees the whole mission.
    def drainCascade(
        alreadyFound: Seq[LabelValidationMetadata],
        randomize: Boolean,
        oneLabelPerFace: Boolean,
        heldFaces: Set[LabelServiceImpl.FaceKey]
    ): Future[Seq[LabelValidationMetadata]] = {
      def facesTaken(held: Seq[LabelValidationMetadata]): Set[LabelServiceImpl.FaceKey] =
        if (oneLabelPerFace) heldFaces ++ held.map(LabelServiceImpl.FaceKey.of) else Set.empty
      val selectFromBatch
          : (Seq[LabelValidationMetadata], Seq[LabelValidationMetadata]) => Seq[LabelValidationMetadata] =
        if (oneLabelPerFace) (batch, held) => LabelServiceImpl.spreadAcrossFaces(batch, facesTaken(held))
        else (batch, _) => batch

      queues.foldLeft(Future.successful(alreadyFound)) { (foundSoFar, queue) =>
        foundSoFar.flatMap { found =>
          if (found.size >= n) Future.successful(found)
          else
            findValidLabelsForType(
              (held: Seq[LabelValidationMetadata]) =>
                query(queue, excludedLabelIds ++ held.map(_.labelId), facesTaken(held)),
              randomize,
              useCrops = false,
              n - found.size,
              accumulator = found,
              selectFromBatch = selectFromBatch
            )
        }
      }
    }

    if (labelType != LabelTypeEnum.NoSidewalk) {
      drainCascade(Seq.empty, randomize = true, oneLabelPerFace = false, Set.empty)
    } else {
      // A NoSidewalk mission holds one label per block face, distinct streets preferred, so a validator sees the city's
      // faces rather than ten labels along one stretch (#5285). The fetch keeps the sampler's order, so "one per face"
      // keeps each face's highest-ranked label. Faces the client already holds (a top-up) count as taken. Only once
      // the whole cascade cannot fill the mission that way does a second pass fall back to more labels from the same
      // faces; that pass re-runs the queue queries, but only in a city whose faces have run out, where they are small.
      for {
        heldFaces <- db
          .run(labelTable.getFacesOfLabels(excludedLabelIds))
          .map(_.map { case (labelId, edge, side) =>
            LabelServiceImpl.FaceKey.of(edge, side, labelId)
          }.toSet)
        spread <- drainCascade(Seq.empty, randomize = false, oneLabelPerFace = true, heldFaces)
        filled <-
          if (spread.size >= n) Future.successful(spread)
          else drainCascade(spread, randomize = true, oneLabelPerFace = false, Set.empty)
      } yield filled
    }
  }

  /**
   * Query labels from the db in batches until we have enough labels that have imagery available. Works recursively.
   * @param queryFor Builds the query for a batch from the labels the walk holds so far, so a query that can exclude
   *                 those rows (and, for NoSidewalk, their block faces) does, and every batch is fresh candidates.
   * @param randomize Whether to randomize the label order or not.
   * @param useCrops If true, local static crop of pano around the label also works as well as an API call.
   * @param remaining Number of labels remaining to get.
   * @param offset Number of rows to skip; each batch advances it by the number of rows it read.
   * @param accumulator Labels held so far, the caller's included; the result contains them, and each batch's query
   *                    and selector are given them.
   * @param selectFromBatch Narrows a fetched batch (after any shuffle, before the imagery check) given the labels held
   *                        so far; the NoSidewalk one-per-face rule. Runs before the imagery check so that the labels
   *                        it drops cost no provider lookups.
   * @param tupleConverter Implicit converter to convert the tuple from the db to the appropriate case class.
   */
  private def findValidLabelsForType[A <: BasicLabelMetadata, TupleRep, Tuple](
      queryFor: Seq[A] => Query[TupleRep, Tuple, Seq],
      randomize: Boolean,
      useCrops: Boolean,
      remaining: Int,
      offset: Int = 0,
      accumulator: Seq[A] = Seq.empty,
      selectFromBatch: (Seq[A], Seq[A]) => Seq[A] = (batch: Seq[A], _: Seq[A]) => batch
  )(implicit tupleConverter: TupleConverter[Tuple, A]): Future[Seq[A]] = {
    if (remaining <= 0) {
      Future.successful(accumulator)
    } else {
      val batchSize = remaining * 5 // Get 5x the needed amount, shouldn't need to query again.

      // The query is built against what the walk holds so far, so a caller whose query can exclude those rows never
      // sees them again; the offset still walks past rows an earlier batch read.
      db.run(queryFor(accumulator).drop(offset).take(batchSize).result)
        .map(l => l.map(tupleConverter.fromTuple))
        .flatMap { labels =>
          // Randomize the labels to prevent similar labels in a mission.
          val shuffledLabels: Seq[A] = if (randomize) scala.util.Random.shuffle(labels) else labels
          val selectedLabels: Seq[A] = selectFromBatch(shuffledLabels, accumulator)

          // Check for valid imagery in parallel.
          checkImageryBatch(selectedLabels, useCrops).flatMap { validLabels =>
            // Skip labels an earlier batch took. The validation query orders by a score containing `random()`, which
            // Postgres re-evaluates per execution, so every batch sees a fresh shuffle and can resurface rows an
            // earlier one covered, whatever the offset. A mission holding the same label twice is what that looks
            // like to the user.
            val alreadyFound: Set[Int] = accumulator.map(_.labelId).toSet
            val newValidLabels: Seq[A] = validLabels.filterNot(l => alreadyFound.contains(l.labelId)).take(remaining)

            // A batch that adds nothing new ends the walk: with `random()` in the sort, the next offset is no more
            // likely to, and walking a 48k-label queue fifty rows at a time is the failure mode this guards against.
            if (newValidLabels.isEmpty) {
              Future.successful(accumulator)
            } else {
              // Add the valid labels to the accumulator and recurse.
              findValidLabelsForType(
                queryFor,
                randomize,
                useCrops,
                remaining - newValidLabels.size,
                // Advance by the rows this batch read. `batchSize` shrinks as `remaining` does, so it can't be
                // multiplied out into an offset.
                offset + labels.size,
                accumulator ++ newValidLabels,
                selectFromBatch
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
   * Get the label type to validate. Label types with more work still needing validation have higher priority.
   *
   * The cascade decides both halves of the choice: the first queue in it that can fill a whole mission for some label
   * type is the queue that sets which types are in play and what they are weighted by. So a plain Validate mission is
   * chosen from the types the crowd can still settle, and only falls back to weighing every type equally once no type
   * has a mission's worth of those left (#2929). The mission-length gate is label-based for every type, NoSidewalk
   * included, so a small city with eight faces and forty labels still gets NoSidewalk missions.
   *
   * @param userId            User ID of the current user.
   * @param missionLength     Number of labels for this mission.
   * @param requiredLabelType labelType of the current mission.
   * @param queues            Queues to consider, in order; see `ValidateParams.queueCascade`.
   * @param unvalidatedOnly   Whether the mission is restricted to labels with no decision recorded.
   * @param filter            Expert Validate's filters; only types with labels matching them can be picked.
   */
  def getLabelTypeToValidate(
      userId: String,
      missionLength: Int,
      viewerType: PanoSource,
      requiredLabelType: Option[LabelTypeEnum.Base],
      queues: Seq[ValidationQueue],
      unvalidatedOnly: Boolean,
      filter: ValidationLabelFilter
  ): Future[Option[LabelTypeEnum.Base]] = {
    val counts = labelTable.getAvailableValidationsLabelsByType(userId, viewerType, unvalidatedOnly, queues,
      requiredLabelType, filter)
    db.run(counts.map { availValidations =>
      // NoSidewalk competes like any other type; its weight in the lottery is its count of block faces still needing
      // votes rather than its label count (LabelTypeValidationsLeft.weightFor, #5285).
      val candidates: Seq[LabelTypeValidationsLeft] = availValidations
        .filter(x => requiredLabelType.isEmpty || requiredLabelType.contains(x.labelType))
        .filter(x => LabelTypeEnum.primaryValidateLabelTypes.contains(x.labelType))

      val (queue, typesFiltered) =
        LabelServiceImpl.chooseQueueAndTypes(candidates, queues, missionLength, allowShortMission = !filter.isEmpty)

      if (typesFiltered.length < 2) {
        typesFiltered.map(_.labelType).headOption
      } else {
        // Each label type has at least a 2% chance of being selected. Remaining probability is divvied up
        // proportionally based on how many labels of that type the chosen queue holds.
        val totalWeight: Int                                     = typesFiltered.map(_.weightFor(queue)).sum
        val typeProbabilities: Seq[(LabelTypeEnum.Base, Double)] = typesFiltered.map { t =>
          (t.labelType, 0.02 + (1 - typesFiltered.length * 0.02) * (t.weightFor(queue).toDouble / totalWeight))
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
    getLabelTypeToValidate(user.userId, labelCount, viewerType, validateParams.labelType, validateParams.queueCascade,
      validateParams.unvalidatedOnly, validateParams.labelFilter)
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
              validateParams.queueCascade, validateParams.labelFilter, validateParams.unvalidatedOnly)
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
          validateParams.queueCascade, validateParams.labelFilter, validateParams.unvalidatedOnly, excludedLabelIds)
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
            validateParams.queueCascade, validateParams.unvalidatedOnly, validateParams.labelFilter)
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
              viewerType, nextMissionLabelType, validateParams.queueCascade, validateParams.labelFilter,
              validateParams.unvalidatedOnly)
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
        findValidLabelsForType[LabelMetadataUserDash, LabelMetadataUserDashTupleRep, LabelMetadataUserDashTuple](
          _ => labelTable.getValidatedLabelsForUserQuery(userId, labelType),
          randomize = false,
          useCrops = true,
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
      // An unrated type never carries a severity, whatever the client sent (the DB rejects one).
      clean: Label = label.copy(tags = cleanTags.toList, severity = severityFor(label.labelType, label.severity))
      labelId: Int <- (labelTable.labelsUnfiltered returning labelTable.labelsUnfiltered.map(_.labelId)) += clean

      // Add a corresponding entry to the label_history table.
      _ <- labelHistoryTable.insert(
        LabelHistory(0, labelId, clean.labelType, clean.severity, clean.tags, clean.userId, clean.timeCreated,
          UiSource.Explore, None)
      )
    } yield {
      labelId
    }
  }

}
