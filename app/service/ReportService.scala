package service

import com.google.inject.ImplementedBy
import models.api.{
  IntersectionAccessScoreForApi,
  LabelClusterFiltersForApi,
  RawLabelFiltersForApi,
  StreetAccessScoreForApi
}
import models.label.{CropMarker, LabelType}
import models.pano.ImageryAttribution
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
   * @return The report, or why there isn't one.
   */
  def neighborhoodReport(regionId: Int): Future[ReportOutcome]
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
  val PhotosPerStreet: Int = 4
  val FixListSize: Int     = 5

  // Well past the 25 m a corner-type cluster can be attributed to an intersection from, so that every location the
  // engine pooled on a street's far end is inside the box, including on a street that bends away at a high latitude.
  val EvidencePaddingMeters: Double = 2 * AccessScoreCalculator.attributionRadiusMeters

  // Labels change through the day, so this can't wait for the nightly run the way a score does; clusters don't change
  // between runs, so an hour-old copy is only ever late in saying how many labels there are.
  val DataFreshFor: FiniteDuration = 10.minutes
  val DataMaxAge: FiniteDuration   = 1.hour

  // The boxed Explore canvas, which is the frame a label's canvas_x/canvas_y refer to when the label doesn't say.
  private val DefaultCanvasWidth: Int  = 720
  private val DefaultCanvasHeight: Int = 480

  // Width:height of `.report-photo__frame`, where the photos are cover-fitted.
  val PhotoFrameAspect: Double = 3.0 / 2.0

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
   * Where a label sits in the report's photo frame, which cover-fits each crop into a [[PhotoFrameAspect]] box. A
   * crop's `label_crop` row says where the label is in the image and the image's shape; without one, as on every other
   * crop surface, the crop is taken to be the Explore frame, where the label is at its canvas fraction. Mirrors
   * `util.misc.labelMarkerFraction`, because this page draws its markers without JavaScript so that they print.
   *
   * @return The marker's position as fractions of the box's width and height, each clamped to the box.
   */
  def markerFraction(label: ReportLabel, marker: Option[CropMarker]): (Double, Double) = {
    def clamp(fraction: Double): Double                      = math.min(1.0, math.max(0.0, fraction))
    def fraction(position: Option[Int], extent: Int): Double =
      position.map(p => clamp(p.toDouble / extent)).getOrElse(0.5)

    val frameWidth  = label.canvasWidth.getOrElse(DefaultCanvasWidth)
    val frameHeight = label.canvasHeight.getOrElse(DefaultCanvasHeight)
    val (x, y)      = marker
      .map(m => (m.x, m.y))
      .getOrElse((fraction(label.canvasX, frameWidth), fraction(label.canvasY, frameHeight)))
    val imageAspect = marker
      .flatMap(m => m.width.zip(m.height))
      .collect { case (w, h) if w > 0 && h > 0 => w.toDouble / h }
      .getOrElse(frameWidth.toDouble / frameHeight)

    // A wider image loses its sides to the box and a taller one its top and bottom, both centered.
    if (imageAspect > PhotoFrameAspect) (clamp((x - 0.5) * (imageAspect / PhotoFrameAspect) + 0.5), clamp(y))
    else (clamp(x), clamp((y - 0.5) * (PhotoFrameAspect / imageAspect) + 0.5))
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
   * What a report shows, decided before anything is fetched for the shown labels alone.
   *
   * @param ranked The region's ranked streets, lowest first
   * @param strips The ranked streets, each with the items and labels to show as its photos
   */
  case class ReportSelection(
      ranked: Seq[ReportStreet],
      strips: Seq[(ReportStreet, Seq[(ReportItem, ReportLabel)])],
      picks: Seq[(ReportStreet, ReportItem, ReportLabel)]
  ) {

    /** @return Every label whose photo appears on the page, once each. */
    def shown: Seq[ReportLabel] =
      (strips.flatMap(_._2.map(_._2)) ++ picks.map(_._3)).distinctBy(_.labelId)
  }

  /**
   * Rolls the region's streets up, ranks them and picks which labels the page will show.
   *
   * @param evidence Every location near the region
   * @param labels   Counted labels by id, including those on a street outside the region
   * @return The selection.
   */
  def select(
      streets: Seq[StreetAccessScoreForApi],
      evidence: ReportEvidence,
      labels: Map[Int, ReportLabel],
      hasCrop: ReportLabel => Boolean
  ): ReportSelection = {
    val stretches = streets.groupBy(_.osmWayId).values.toSeq.flatMap(ReportStretch.build(_, evidence))
    val ranked    = ReportStreet.rank(stretches)
    ReportSelection(
      ranked = ranked,
      strips = ranked.map(s => s -> ReportRules.selectPhotos(s.worst, labels, PhotosPerStreet, hasCrop)),
      picks = ReportRules.fixes(ranked, labels, FixListSize, hasCrop)
    )
  }

  /**
   * Puts the report together once everything it shows is known.
   *
   * @param streetKeys        Which street each location's own street edge belongs to
   * @param selection         The result of [[select]]
   * @param cropUrl           A shown label's signed thumbnail URL, if it has a crop
   * @param markers           Recorded crop markers by label id
   * @param attributions      Attribution by pano id
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
      cropUrl: ReportLabel => Option[String],
      markers: Map[Int, CropMarker],
      attributions: Map[String, ImageryAttribution.Line],
      clustersUpdatedAt: Option[OffsetDateTime],
      now: OffsetDateTime
  ): NeighborhoodReport = {
    def photo(item: ReportItem, label: ReportLabel): ReportPhoto = {
      val (x, y) = markerFraction(label, markers.get(label.labelId))
      ReportPhoto(label, cropUrl(label), x, y, attributions.get(label.panoId), item.costPoints)
    }
    val rows = selection.strips.zipWithIndex.map { case ((street, photos), index) =>
      val byType = street.worst.locations.groupBy(_.labelType)
      RankedStreetRow(
        rank = index + 1,
        street = street,
        evidence =
          LabelType.ordered.flatMap { t => byType.get(t).map(ls => TypeEvidence(t, ls.size, ls.flatMap(_.labelIds))) },
        photos = photos.map { case (item, label) => photo(item, label) }
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
      fixes = selection.picks.map { case (street, item, label) => ReportFix(street, item, photo(item, label)) },
      inventory = InventoryRow.from(counted, regionWide),
      evidenceBox = evidenceBox(streets)
    )
  }
}

@Singleton
class ReportServiceImpl @Inject() (
    accessScoreService: AccessScoreService,
    apiService: ApiService,
    regionService: RegionService,
    panoDataService: PanoDataService,
    cropService: CropService,
    swrCache: SwrCache
)(using ec: ExecutionContext, mat: Materializer)
    extends ReportService {
  import ReportService.*

  private val BatchSize = 5000

  def neighborhoodReport(regionId: Int): Future[ReportOutcome] =
    regionService.getRegion(regionId).flatMap {
      case None         => Future.successful(ReportOutcome.RegionNotFound)
      case Some(region) =>
        // The tool's own cached numbers, filtered to the region: reading them any other way could disagree with it.
        accessScoreService.getFullCityScores(BatchSize).flatMap {
          case None         => Future.successful(ReportOutcome.StillComputing)
          case Some(scores) =>
            val streets = scores.streets.filter(_.regionId == regionId)
            buildReport(regionId, region.name, streets, scores.intersections, scores.streets).map(
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
      cityStreets: Seq[StreetAccessScoreForApi]
  ): Future[NeighborhoodReport] = {
    val hasCrop: ReportLabel => Boolean = l => panoDataService.cropExists(l.labelId, l.labelType)
    for {
      data <- reportData(regionId, streets)
      counted     = (data.labels ++ data.foreignLabels).filter(ReportRules.isCounted).map(l => l.labelId -> l).toMap
      selection   = select(streets, ReportEvidence(data.locations), counted, hasCrop)
      shownIds    = selection.shown.map(_.labelId)
      regionWide  = regionLocations(data.locations, streets, intersections, regionId)
      wantedEdges = regionWide.map(_.streetEdgeId).toSet
      streetKeys  = cityStreets.iterator
        .filter(s => wantedEdges(s.streetEdgeId))
        .map(s => s.streetEdgeId -> ReportStreet.streetKey(s.streetName, s.osmWayId))
        .toMap
      markersF      = cropService.cropMarkers(shownIds)
      attributionsF = panoDataService.getAttributions(selection.shown.map(_.panoId).distinct)
      updatedAtF    = accessScoreService.clustersUpdatedAt
      markers      <- markersF
      attributions <- attributionsF
      updatedAt    <- updatedAtF
    } yield assemble(
      regionId,
      regionName,
      streets,
      regionWide,
      streetKeys,
      data,
      selection,
      l => panoDataService.cropThumbnailUrl(l.labelId, l.labelType),
      markers,
      attributions,
      updatedAt,
      OffsetDateTime.now(ZoneOffset.UTC)
    )
  }
}
