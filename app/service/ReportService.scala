package service

import com.google.inject.ImplementedBy
import models.api.{
  IntersectionAccessScoreForApi,
  LabelClusterFiltersForApi,
  RawLabelFiltersForApi,
  StreetAccessScoreForApi
}
import models.label.LabelType
import models.region.NamedRegionCompletion
import models.report.*
import models.utils.LatLngBBox
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Sink

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.concurrent.{ExecutionContext, Future}

/** What asking for a report can come to. */
enum ReportOutcome {
  case Ready(report: NeighborhoodReport)

  /** The region exists, but the city's AccessScores are still being computed for the first time since a deploy. */
  case StillComputing
  case RegionNotFound
}

@ImplementedBy(classOf[ReportServiceImpl])
trait ReportService {

  /**
   * Builds a neighborhood report (#5876): AccessScore's own published numbers, with the labels behind them.
   *
   * @param regionId The region to report on
   * @param weights  The weights to score it under; anything but the engine's re-scores the city's published numbers
   * @return The report, or why there isn't one.
   */
  def neighborhoodReport(regionId: Int, weights: AccessScoreWeights = AccessScoreWeights.Default): Future[ReportOutcome]

  /** @return Each live region's report address, by region id; see [[ReportSlug]]. */
  def regionSlugs: Future[Map[Int, String]]
}

/**
 * The slow part of a report: the rows a request can't afford to read from the database, whether it's the first request
 * or the hundredth. Cached rather than the report itself, since a finished report holds signed photo URLs that expire.
 *
 * @param completion    The region's explored and total distance, when recorded
 * @param labels        Every label in the region, counted or not
 * @param foreignLabels Labels behind the region's crossings that sit on a street outside it
 * @param locations     Every location near the region
 */
case class ReportData(
    completion: Option[NamedRegionCompletion],
    labels: Seq[ReportLabel],
    foreignLabels: Seq[ReportLabel],
    locations: Seq[ReportLocation]
)

object ReportService {
  private val logger: play.api.Logger = play.api.Logger(this.getClass)

  val FixListSize: Int = 6

  // Well past the 25 m a corner-type cluster can be attributed to an intersection from, so that every location the
  // engine pooled on a street's far end is inside the box, including on a street that bends away at a high latitude.
  val EvidencePaddingMeters: Double = 2 * AccessScoreCalculator.attributionRadiusMeters

  // Labels change through the day, so this can't wait for the nightly run the way a score does; clusters don't change
  // between runs, so an hour-old copy is only ever late in saying how many labels there are.
  val DataFreshFor: FiniteDuration = 10.minutes
  val DataMaxAge: FiniteDuration   = 1.hour

  /** @return The smallest box holding them, widened by [[EvidencePaddingMeters]], or None with no streets. */
  def evidenceBox(streets: Seq[StreetAccessScoreForApi]): Option[LatLngBBox] =
    streets
      .map(_.geometry.getEnvelopeInternal)
      .reduceOption { (a, b) =>
        val merged = new org.locationtech.jts.geom.Envelope(a)
        merged.expandToInclude(b)
        merged
      }
      .map { e =>
        LatLngBBox(minLat = e.getMinY, minLng = e.getMinX, maxLat = e.getMaxY, maxLng = e.getMaxX)
          .padded(EvidencePaddingMeters)
      }

  /**
   * The region's distinct locations, as AccessScore's Spotlight counts a region's evidence: those scoring a block on
   * one of its streets, plus those at one of its intersections, wherever their own street is.
   *
   * @param locations     Every location near the region
   * @param intersections The city's scored intersections
   * @return Each location at most once.
   */
  def regionLocations(
      locations: Seq[ReportLocation],
      streets: Seq[StreetAccessScoreForApi],
      intersections: Seq[IntersectionAccessScoreForApi],
      regionId: Int
  ): Seq[ReportLocation] = {
    val edges     = streets.map(_.streetEdgeId).toSet
    val crossings =
      intersections.filter(i => i.regionId.contains(regionId) && !i.gradeSeparated).map(_.intersectionId).toSet
    locations.filter(l => l.intersectionId.fold(edges(l.streetEdgeId))(crossings))
  }

  /**
   * What a report shows.
   *
   * @param ranked The region's ranked segments, lowest first
   * @param cards  Each of them with what its section shows; empty past [[NeighborhoodReport.DetailSize]], which get none
   */
  case class ReportSelection(
      ranked: Seq[ReportStreet],
      cards: Seq[(ReportStreet, Seq[ReportCard])],
      picks: Seq[(ReportStreet, ReportItem, ReportLabel)]
  )

  /**
   * Scores the region's segments, ranks them and decides what each one shows.
   *
   * @param evidence     Every location near the region
   * @param labels       Counted labels by id, including those on a street outside the region
   * @param weights      What the streets were scored under, which prices each item the same way
   * @param crossStreets The other streets met at a segment's ends, by its edge id
   * @return The selection.
   */
  def select(
      streets: Seq[StreetAccessScoreForApi],
      evidence: ReportEvidence,
      labels: Map[Int, ReportLabel],
      hasCrop: ReportLabel => Boolean,
      weights: AccessScoreWeights = AccessScoreWeights.Default,
      crossStreets: Int => Seq[String] = _ => Nil
  ): ReportSelection = {
    val segments = streets.flatMap { edge =>
      ReportStretch
        .build(Seq(edge), evidence, weights.signed)
        .map(_.copy(crossStreets = crossStreets(edge.streetEdgeId)))
    }
    // A drift means the clusters API dropped something the engine scored, so the page's fix costs would be measured
    // from a different score than the one it prints. Logged rather than hidden, to be traced to its cause.
    val drifting = segments.filter(_.evidenceDrifts)
    if (drifting.nonEmpty)
      ReportService.logger.warn(
        s"Report evidence rebuilds a different score than published on ${drifting.size} segment(s), e.g. edges " +
          drifting.take(5).map(d => f"${d.toolEdgeId} (${d.score}%.4f vs ${d.rebuiltScore}%.4f)").mkString(", ")
      )
    val ranked = ReportStreet.rank(segments)
    ReportSelection(
      ranked = ranked,
      cards = ranked.zipWithIndex.map { case (s, i) =>
        s -> (if (i < NeighborhoodReport.DetailSize) ReportRules.cards(s.worst, labels, hasCrop) else Nil)
      },
      picks = ReportRules.fixes(ranked, labels, FixListSize, hasCrop)
    )
  }

  /**
   * The streets met at each segment's ends, for telling one block of a road from the next. A name the segment itself
   * carries is skipped, as is a repeat: a loop that meets one street at both ends says that street once.
   *
   * @param cityStreets   Every street in the city, for the names of those across a boundary
   * @param intersections Every intersection in the city
   * @return Up to two names by edge id, start end first, each end's alphabetically first if it meets several.
   */
  def crossStreets(
      streets: Seq[StreetAccessScoreForApi],
      cityStreets: Seq[StreetAccessScoreForApi],
      intersections: Seq[IntersectionAccessScoreForApi]
  ): Map[Int, Seq[String]] = {
    val names: Map[Int, Option[String]] = cityStreets.map(s => s.streetEdgeId -> s.streetName).toMap
    val meeting: Map[Int, Seq[Int]]     = intersections.map(i => i.intersectionId -> i.streetEdgeIds).toMap
    streets.map { edge =>
      val own                                  = edge.streetName.map(_.trim.toLowerCase)
      def at(end: Option[Int]): Option[String] =
        end.flatMap(meeting.get).flatMap { edges =>
          edges.flatMap(names.get).flatten.filterNot(n => own.contains(n.trim.toLowerCase)).distinct.sorted.headOption
        }
      edge.streetEdgeId -> Seq(at(edge.startIntersectionId), at(edge.endIntersectionId)).flatten.distinct
    }.toMap
  }

  /**
   * Each scored type's mean term per explored street, the street and crossing terms both, as the AccessScore tool's
   * bars beside its sliders compute them for a neighborhood.
   *
   * @return The mean by type, 0 for a type with no term here.
   */
  def contributions(
      streets: Seq[StreetAccessScoreForApi],
      intersections: Seq[IntersectionAccessScoreForApi],
      regionId: Int
  ): Map[String, Double] = {
    val explored = streets.filter(_.auditCount > 0)
    val crossing = intersections.filter(i => i.regionId.contains(regionId) && i.score.isDefined)
    val terms    = explored.map(_.subScores) ++ crossing.map(_.subScores)
    AccessScoreCalculator.orderedScoredTypes.map { t =>
      t -> (if (explored.isEmpty) 0.0 else terms.map(_.getOrElse(t, 0.0)).sum / explored.size)
    }.toMap
  }

  /**
   * Puts the report together.
   *
   * @param streetKeys        Which street each location's own street edge belongs to
   * @param selection         The result of [[select]]
   * @param clustersUpdatedAt When the clusters were last rebuilt
   * @return The report.
   */
  def assemble(
      regionId: Int,
      regionName: String,
      streets: Seq[StreetAccessScoreForApi],
      regionWide: Seq[ReportLocation],
      streetKeys: Map[Int, Either[String, Long]],
      data: ReportData,
      selection: ReportSelection,
      clustersUpdatedAt: Option[OffsetDateTime],
      now: OffsetDateTime,
      weights: AccessScoreWeights = AccessScoreWeights.Default,
      contributions: Map[String, Double] = Map.empty,
      places: Seq[ReportPlace] = Nil
  ): NeighborhoodReport = {
    val rows = selection.cards.zipWithIndex.map { case ((street, cards), index) =>
      val byType = street.worst.locations.groupBy(_.labelType)
      RankedStreetRow(
        rank = index + 1,
        street = street,
        evidence =
          LabelType.ordered.flatMap { t => byType.get(t).map(ls => TypeEvidence(t, ls.size, ls.flatMap(_.labelIds))) },
        cards = cards
      )
    }
    val (counted, excluded) = data.labels.partition(ReportRules.isCounted)
    val exploredStreets = streets.filter(_.auditCount > 0).map(s => ReportStreet.streetKey(s.streetName, s.osmWayId))
    NeighborhoodReport(
      regionId = regionId,
      regionName = regionName,
      generatedAt = now,
      clustersUpdatedAt = clustersUpdatedAt,
      score = NeighborhoodScore.from(streets, AccessScoreSpotlight.completionRate(data.completion)),
      coverage = Coverage.from(
        counted,
        excluded,
        data.locations,
        data.completion.map(_.totalDistance).getOrElse(0.0),
        data.completion.map(_.auditedDistance).getOrElse(0.0),
        now.toLocalDate
      ),
      headline = HeadlineRule.select(
        regionWide,
        edgeId => streetKeys.getOrElse(edgeId, Right(edgeId.toLong)),
        exploredStreets.distinct.size
      ),
      streets = rows,
      streetsRanked = selection.ranked.size,
      fixes = selection.picks.map { case (street, item, label) => ReportFix(street, item, label) },
      inventory = InventoryRow.from(counted, regionWide),
      evidenceBox = evidenceBox(streets),
      edges = streets.map { s =>
        ReportMapEdge(
          s.streetEdgeId,
          s.osmWayId,
          s.score,
          s.auditCount > 0,
          s.gradient.flatMap(_.maxGrade),
          s.geometry.getCoordinates.toSeq.map(c => (c.x, c.y))
        )
      },
      weights = weights,
      contributions = contributions,
      places = places
    )
  }
}

@Singleton
class ReportServiceImpl @Inject() (
    accessScoreService: AccessScoreService,
    apiService: ApiService,
    regionService: RegionService,
    panoDataService: PanoDataService,
    placesService: PlacesService,
    swrCache: SwrCache
)(using ec: ExecutionContext, mat: Materializer)
    extends ReportService {
  import ReportService.*

  private val BatchSize = 5000

  // Names change rarely and a lookup is every request's first step, so a few minutes' staleness is the right trade.
  def regionSlugs: Future[Map[Int, String]] =
    swrCache.staleWhileRevalidate[Map[Int, String]]("report:region-slugs:v1", DataFreshFor, DataMaxAge) {
      regionService.getAllRegions.map(rs => ReportSlug.assign(rs.filterNot(_.deleted).map(r => r.regionId -> r.name)))
    }

  def neighborhoodReport(regionId: Int, weights: AccessScoreWeights): Future[ReportOutcome] =
    regionService.getRegion(regionId).flatMap {
      case None         => Future.successful(ReportOutcome.RegionNotFound)
      case Some(region) =>
        // The tool's own cached numbers, filtered to the region: reading them any other way could disagree with it.
        accessScoreService.getFullCityScores(BatchSize).flatMap {
          case None            => Future.successful(ReportOutcome.StillComputing)
          case Some(published) =>
            // Only the region's streets and the crossings they or the region use are rescored, not the whole city:
            // a street's score reads just its own end crossings, and the rest of the city is kept for names alone.
            val regionStreets = published.streets.filter(_.regionId == regionId)
            val endIds        = regionStreets.flatMap(s => s.startIntersectionId ++ s.endIntersectionId).toSet
            val used = published.intersections.filter(i => i.regionId.contains(regionId) || endIds(i.intersectionId))
            val rescored      = AccessScoreWeights.reweight(AccessScores(regionStreets, used), weights)
            val byId          = rescored.intersections.map(i => i.intersectionId -> i).toMap
            val intersections = published.intersections.map(i => byId.getOrElse(i.intersectionId, i))
            buildReport(regionId, region.name, rescored.streets, intersections, published.streets, weights).map(
              ReportOutcome.Ready(_)
            )
        }
    }

  /** Reads the region's rows, fresh from the cache if a recent report already did. */
  private def reportData(regionId: Int, streets: Seq[StreetAccessScoreForApi]): Future[ReportData] =
    swrCache.staleWhileRevalidate[ReportData](s"report:neighborhood:v1:$regionId", DataFreshFor, DataMaxAge) {
      val completionF = regionService.getRegionCompletions(Seq(regionId))
      val labelsF     = apiService
        .getRawLabels(RawLabelFiltersForApi(regionId = Some(regionId)), BatchSize)
        .map(ReportLabel.fromApi)
        .runWith(Sink.seq)
      val locationsF = evidenceBox(streets).fold(Future.successful(Seq.empty[ReportLocation])) { box =>
        val filters = LabelClusterFiltersForApi(
          bbox = Some(box),
          labelTypes = Some(AccessScoreCalculator.orderedScoredTypes)
        )
        apiService.getLabelClusters(filters, BatchSize).map(ReportLocation.fromApi).runWith(Sink.seq)
      }
      for {
        completion <- completionF
        labels     <- labelsF
        locations  <- locationsF
        foreign    <- foreignLabels(locations, labels)
      } yield ReportData(completion.headOption, labels, foreign, locations)
    }

  /**
   * Reads the labels behind the region's crossings that sit on a neighboring street. Only those, and only near the
   * locations needing them: the box hugs them and the types are theirs, so this stays small beside the region's own read.
   */
  private def foreignLabels(locations: Seq[ReportLocation], labels: Seq[ReportLabel]): Future[Seq[ReportLabel]] = {
    val known   = labels.map(_.labelId).toSet
    val needing = locations.filter(l => l.intersectionId.isDefined && l.labelIds.exists(id => !known(id)))
    val wanted  = needing.flatMap(_.labelIds).toSet -- known
    if (needing.isEmpty) Future.successful(Seq.empty)
    else {
      val box = LatLngBBox(
        minLat = needing.map(_.latitude).min,
        minLng = needing.map(_.longitude).min,
        maxLat = needing.map(_.latitude).max,
        maxLng = needing.map(_.longitude).max
      ).padded(EvidencePaddingMeters)
      val filters = RawLabelFiltersForApi(bbox = Some(box), labelTypes = Some(needing.map(_.labelType.name).distinct))
      apiService
        .getRawLabels(filters, BatchSize)
        .filter(l => wanted(l.labelId))
        .map(ReportLabel.fromApi)
        .runWith(Sink.seq)
    }
  }

  private def buildReport(
      regionId: Int,
      regionName: String,
      streets: Seq[StreetAccessScoreForApi],
      intersections: Seq[IntersectionAccessScoreForApi],
      cityStreets: Seq[StreetAccessScoreForApi],
      weights: AccessScoreWeights
  ): Future[NeighborhoodReport] = {
    // One stat per label per request: a label can be a card on two segments sharing a crossing and a fix candidate.
    val cropChecked                     = scala.collection.concurrent.TrieMap.empty[Int, Boolean]
    val hasCrop: ReportLabel => Boolean =
      l => cropChecked.getOrElseUpdate(l.labelId, panoDataService.cropExists(l.labelId, l.labelType))
    for {
      data <- reportData(regionId, streets)
      counted   = (data.labels ++ data.foreignLabels).filter(ReportRules.isCounted).map(l => l.labelId -> l).toMap
      cross     = crossStreets(streets, cityStreets, intersections)
      selection = select(
        streets,
        ReportEvidence(data.locations),
        counted,
        hasCrop,
        weights,
        id => cross.getOrElse(id, Nil)
      )
      regionWide  = regionLocations(data.locations, streets, intersections, regionId)
      wantedEdges = regionWide.map(_.streetEdgeId).toSet
      streetKeys  = cityStreets.iterator
        .filter(s => wantedEdges(s.streetEdgeId))
        .map(s => s.streetEdgeId -> ReportStreet.streetKey(s.streetName, s.osmWayId))
        .toMap
      updatedAt <- accessScoreService.clustersUpdatedAt
      // The city's places are cached on their own; a report still reads without them if they can't be had.
      cityPlaces <- placesService.getFullCityPlaces(BatchSize).recover { case _ => Seq.empty }
    } yield assemble(
      regionId,
      regionName,
      streets,
      regionWide,
      streetKeys,
      data,
      selection,
      updatedAt,
      OffsetDateTime.now(ZoneOffset.UTC),
      weights,
      contributions(streets, intersections, regionId),
      ReportPlace.near(cityPlaces, streets.map(_.streetEdgeId).toSet)
    )
  }
}
