package service

import com.google.inject.ImplementedBy
import models.api.RawLabelFiltersForApi
import models.label.{CropMarker, LabelType}
import models.pano.ImageryAttribution
import models.region.NamedRegionCompletion
import models.report.*
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Sink

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}

@ImplementedBy(classOf[ReportServiceImpl])
trait ReportService {

  /**
   * Builds a neighborhood report (#5876) from the same queries that back the public API.
   *
   * @param regionId The region to report on
   * @return The report, or None for a region that doesn't exist.
   */
  def neighborhoodReport(regionId: Int): Future[Option[NeighborhoodReport]]
}

object ReportService {
  val TopStreets: Int      = 10
  val PhotosPerStreet: Int = 4
  val PunchListSize: Int   = 5

  // The boxed Explore canvas, which is the frame a label's canvas_x/canvas_y refer to when the label doesn't say.
  private val DefaultCanvasWidth: Int  = 720
  private val DefaultCanvasHeight: Int = 480

  // Width:height of `.report-photo__frame`, where the photos are cover-fitted.
  val PhotoFrameAspect: Double = 3.0 / 2.0

  /**
   * Groups labels into the streets a reader recognizes.
   *
   * @param labels  Counted labels
   * @param names   OSM name by street edge id; an edge with none stays its own street
   * @param lengths Geodesic length by street edge id
   * @return The streets, unordered.
   */
  def groupStreets(
      labels: Seq[ReportLabel],
      names: Map[Int, String],
      lengths: Map[Int, Double]
  ): Seq[ReportStreet] =
    labels
      .groupBy(l => names.get(l.streetEdgeId).map(_.toLowerCase).toLeft(l.streetEdgeId))
      .values
      .map { streetLabels =>
        val edges = streetLabels.map(_.streetEdgeId).distinct.sorted
        ReportStreet(
          name = edges.flatMap(names.get).headOption,
          streetEdgeIds = edges,
          lengthMeters = edges.flatMap(lengths.get).sum,
          labels = streetLabels
        )
      }
      .toSeq

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
   * What a report shows, decided before anything is fetched for the shown labels alone.
   *
   * @param ranked The region's streets in rank order
   * @param strips The top streets, each with the labels to show as its photos
   * @param picks  The punch list, each label with its street
   */
  case class ReportSelection(
      ranked: Seq[ReportStreet],
      strips: Seq[(ReportStreet, Seq[ReportLabel])],
      picks: Seq[(ReportStreet, ReportLabel)]
  ) {

    /** @return Every label whose photo appears on the page, once each. */
    def shown: Seq[ReportLabel] = (strips.flatMap(_._2) ++ picks.map(_._2)).distinctBy(_.labelId)
  }

  /**
   * Ranks the region's streets and picks which labels the page will show.
   *
   * @param counted Counted labels
   * @param names   OSM name by street edge id
   * @param lengths Geodesic length by street edge id
   * @param hasCrop Whether a label has a crop on disk
   * @return The selection.
   */
  def select(
      counted: Seq[ReportLabel],
      names: Map[Int, String],
      lengths: Map[Int, Double],
      hasCrop: ReportLabel => Boolean
  ): ReportSelection = {
    val ranked = RankingRule.rank(groupStreets(counted, names, lengths))
    ReportSelection(
      ranked = ranked,
      strips = ranked.take(TopStreets).map(s => s -> RankingRule.selectPhotos(s.labels, PhotosPerStreet, hasCrop)),
      picks = RankingRule.punchList(ranked, PunchListSize, hasCrop)
    )
  }

  /**
   * Puts the report together once everything it shows is known.
   *
   * @param regionId     The region
   * @param regionName   The region's name
   * @param completion   The region's audited and total distance, when recorded
   * @param counted      Counted labels
   * @param excluded     Labels review marked incorrect
   * @param selection    The result of [[select]]
   * @param cropUrl      A shown label's signed thumbnail URL, if it has a crop
   * @param markers      Recorded crop markers by label id
   * @param attributions Attribution by pano id
   * @param now          When this report is being computed
   * @return The report.
   */
  def assemble(
      regionId: Int,
      regionName: String,
      completion: Option[NamedRegionCompletion],
      counted: Seq[ReportLabel],
      excluded: Seq[ReportLabel],
      selection: ReportSelection,
      cropUrl: ReportLabel => Option[String],
      markers: Map[Int, CropMarker],
      attributions: Map[String, ImageryAttribution.Line],
      now: OffsetDateTime
  ): NeighborhoodReport = {
    def photo(label: ReportLabel): ReportPhoto = {
      val (x, y) = markerFraction(label, markers.get(label.labelId))
      ReportPhoto(label, cropUrl(label), x, y, attributions.get(label.panoId))
    }
    val rows = selection.strips.zipWithIndex.map { case ((street, photos), index) =>
      val byType = street.labels.groupBy(_.labelType)
      RankedStreetRow(
        rank = index + 1,
        street = street,
        score = RankingRule.streetScore(street.labels),
        typeIds = LabelType.ordered.flatMap(t => byType.get(t).map(ls => t -> ls.map(_.labelId))),
        photos = photos.map(photo)
      )
    }
    NeighborhoodReport(
      regionId = regionId,
      regionName = regionName,
      generatedAt = now,
      coverage = Coverage.from(
        counted,
        excluded,
        completion.map(_.totalDistance).getOrElse(0.0),
        completion.map(_.auditedDistance).getOrElse(0.0),
        now.toLocalDate
      ),
      headline = HeadlineRule.select(selection.ranked),
      streets = rows,
      streetsRanked = selection.ranked.size,
      punchList = selection.picks.map { case (street, label) => street -> photo(label) },
      inventory = InventoryRow.from(counted)
    )
  }
}

@Singleton
class ReportServiceImpl @Inject() (
    apiService: ApiService,
    regionService: RegionService,
    panoDataService: PanoDataService,
    cropService: CropService
)(using ec: ExecutionContext, mat: Materializer)
    extends ReportService {
  import ReportService.*

  private val LabelBatchSize = 5000

  def neighborhoodReport(regionId: Int): Future[Option[NeighborhoodReport]] =
    regionService.getRegion(regionId).flatMap {
      case None         => Future.successful(None)
      case Some(region) =>
        val completionF = regionService.getRegionCompletions(Seq(regionId))
        val labelsF     = apiService
          .getRawLabels(RawLabelFiltersForApi(regionId = Some(regionId)), LabelBatchSize)
          .map(ReportLabel.fromApi)
          .runWith(Sink.seq)
        for {
          completion <- completionF
          labels     <- labelsF
          report     <- buildReport(regionId, region.name, completion.headOption, labels)
        } yield Some(report)
    }

  /** Fetches what the ranking needs (names, lengths), ranks, then fetches what the shown photos need. */
  private def buildReport(
      regionId: Int,
      regionName: String,
      completion: Option[NamedRegionCompletion],
      labels: Seq[ReportLabel]
  ): Future[NeighborhoodReport] = {
    val (counted, excluded)             = labels.partition(RankingRule.isCounted)
    val edgeIds                         = counted.map(_.streetEdgeId).distinct
    val hasCrop: ReportLabel => Boolean = l => panoDataService.cropExists(l.labelId, l.labelType)
    val namesF                          = apiService.getStreetNames(edgeIds)
    val lengthsF                        = apiService.getStreetLengths(edgeIds)
    for {
      names   <- namesF
      lengths <- lengthsF
      selection = select(counted, names, lengths, hasCrop)
      shownIds  = selection.shown.map(_.labelId)
      markers      <- cropService.cropMarkers(shownIds)
      attributions <- panoDataService.getAttributions(selection.shown.map(_.panoId).distinct)
    } yield assemble(
      regionId,
      regionName,
      completion,
      counted,
      excluded,
      selection,
      l => panoDataService.cropThumbnailUrl(l.labelId, l.labelType),
      markers,
      attributions,
      OffsetDateTime.now(ZoneOffset.UTC)
    )
  }
}
