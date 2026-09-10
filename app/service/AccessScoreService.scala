package service

import actor.ClusteringActor
import executors.CpuIntensiveExecutionContext
import models.api.{IntersectionAccessScoreForApi, RegionAccessScoreForApi, StreetAccessScoreForApi}
import models.cluster.ClusterScoreRow
import models.intersection.{IntersectionInfo, IntersectionStreetEnd, StreetEnd}
import models.region.Region
import models.street.StreetEdgeInfo
import models.utils.SpatialQueryType.SpatialQueryType
import models.utils.{LatLngBBox, SpatialQueryType}
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Sink
import service.AccessScoreCalculator.ClusterScoreInput

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.collection.mutable
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.concurrent.{ExecutionContext, Future}

/**
 * The AccessScores of an area, computed in one pass (#5095): the streets the filter selected and the intersections at
 * their ends. Streets need their end intersections' scores for their headline, so the two are never computed apart.
 */
case class AccessScores(streets: Seq[StreetAccessScoreForApi], intersections: Seq[IntersectionAccessScoreForApi])

object AccessScoreService {

  /**
   * Age past which a full-city AccessScore is served stale while a background recompute runs. Clustering — the only
   * thing that changes a score — runs nightly, so a score is at most this much later than the run that produced it.
   */
  val FullCityFreshFor: FiniteDuration = 10.minutes

  /**
   * Age past which a request blocks on recomputing the full-city AccessScore. Far above [[FullCityFreshFor]] because a
   * blocking recompute is seconds of database work per city, and serving yesterday's score is cheaper than that.
   */
  val FullCityMaxAge: FiniteDuration = 24.hours
}

@Singleton
class AccessScoreService @Inject() (
    apiService: ApiService,
    configService: ConfigService,
    swrCache: SwrCache,
    implicit val ec: ExecutionContext,
    cpuEc: CpuIntensiveExecutionContext
)(implicit mat: Materializer) {

  /**
   * Computes v3 AccessScores for every street intersecting the bbox and every intersection at their ends (#3855, #5095).
   *
   * Loads the streets, their lengths, their end intersections and links, and streams the lean per-cluster scoring
   * rows, splitting each by whether it is attributed to an intersection (which it then scores) or not (it scores its
   * street's segment). Intersections are scored first, since a street's headline needs its ends' scores. All of the
   * weighting is delegated to the pure [[AccessScoreCalculator]]. A unit's score is exposed only when it has been
   * audited: a street directly, an intersection through any of its streets.
   *
   * @param spatialQueryType Whether the bbox filters on street geometry (streets endpoint) or region geometry.
   * @param bbox             The bounding box to score within.
   * @param batchSize        DB fetch size for the cluster stream.
   * @return                 The scored streets and intersections.
   */
  def computeAccessScoresV3(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      batchSize: Int
  ): Future[AccessScores] = {
    apiService
      .selectStreetsIntersecting(spatialQueryType, bbox)
      .flatMap { streets: Seq[StreetEdgeInfo] =>
        val streetIds: Seq[Int] = streets.map(_.street.streetEdgeId)
        val lengthsFuture       = apiService.getStreetLengths(streetIds)
        val intersectionsFuture = apiService.getIntersectionsForStreets(spatialQueryType, bbox)
        val streetEndsFuture    = apiService.getStreetEnds(spatialQueryType, bbox)

        // Accumulate the streamed cluster rows by the unit they score. The sink runs single-threaded, so the mutable
        // maps are safe.
        val rowsByStreet: mutable.Map[Int, mutable.Buffer[ClusterScoreRow]]       = mutable.Map.empty
        val rowsByIntersection: mutable.Map[Int, mutable.Buffer[ClusterScoreRow]] = mutable.Map.empty
        val streamFuture                                                          = apiService
          .getClusterScoreRows(spatialQueryType, bbox, AccessScoreCalculator.scoredTypeNames, batchSize)
          .runWith(Sink.foreach { row =>
            row.intersectionId match {
              case Some(id) => rowsByIntersection.getOrElseUpdate(id, mutable.Buffer.empty) += row
              case None     => rowsByStreet.getOrElseUpdate(row.streetEdgeId, mutable.Buffer.empty) += row
            }
          })

        // Join the concurrent lookups and the cluster stream, then do the (CPU-bound) scoring off the default pool.
        for {
          lengths       <- lengthsFuture
          intersections <- intersectionsFuture
          streetEnds    <- streetEndsFuture
          _             <- streamFuture
        } yield {
          Future {
            // A cluster attributed to an intersection none of the selected streets touches (its own street ends at a
            // way split beside that intersection) scores nothing here: the intersection is real, just outside the ask.
            val intersectionScores: Seq[IntersectionAccessScoreForApi] = intersections.map { i =>
              buildIntersectionScore(i, rowsByIntersection.getOrElse(i.intersectionId, mutable.Buffer.empty).toSeq)
            }
            val scoreByIntersection: Map[Int, Option[Double]] =
              intersectionScores.map(i => i.intersectionId -> i.score).toMap
            val intersectionByStreetEnd: Map[(Int, String), Int] =
              streetEnds.map { e: IntersectionStreetEnd => (e.streetEdgeId, e.streetEnd) -> e.intersectionId }.toMap

            val streetScores: Seq[StreetAccessScoreForApi] = streets.map { s =>
              val streetId: Int              = s.street.streetEdgeId
              val rows: Seq[ClusterScoreRow] = rowsByStreet.getOrElse(streetId, mutable.Buffer.empty).toSeq
              val startId: Option[Int]       = intersectionByStreetEnd.get((streetId, StreetEnd.Start))
              val endId: Option[Int]         = intersectionByStreetEnd.get((streetId, StreetEnd.End))
              buildStreetScore(
                s,
                rows,
                lengths.getOrElse(streetId, 0.0),
                startId,
                endId,
                startId.flatMap(scoreByIntersection.get).flatten,
                endId.flatMap(scoreByIntersection.get).flatten
              )
            }
            AccessScores(streetScores, intersectionScores)
          }(cpuEc)
        }
      }
      .flatten
  }

  /**
   * Builds a single street's AccessScore DTO from its segment's cluster rows and its ends' scores.
   *
   * @param s                      The street (carries geometry, region, and audit count).
   * @param rows                   The cluster rows scoring the street's segment.
   * @param lengthMeters           The street's length in meters.
   * @param startIntersectionId    The intersection at the street's start, if any.
   * @param endIntersectionId      The intersection at the street's end, if any.
   * @param startIntersectionScore Its score, if it has one.
   * @param endIntersectionScore   Its score, if it has one.
   * @return                       The populated [[StreetAccessScoreForApi]].
   */
  private def buildStreetScore(
      s: StreetEdgeInfo,
      rows: Seq[ClusterScoreRow],
      lengthMeters: Double,
      startIntersectionId: Option[Int],
      endIntersectionId: Option[Int],
      startIntersectionScore: Option[Double],
      endIntersectionScore: Option[Double]
  ): StreetAccessScoreForApi = {
    val inputs: Seq[ClusterScoreInput] = toInputs(rows)
    // The score is squashed from the same per-type terms the API reports, so `sub_scores` always explains
    // `segment_score`.
    val subScores: Map[String, Double] = AccessScoreCalculator.scoreByType(inputs, Some(lengthMeters))
    val segmentScore: Option[Double]   =
      if (s.auditCount > 0) Some(AccessScoreCalculator.scoreFromSubScores(subScores)) else None

    StreetAccessScoreForApi(
      streetEdgeId = s.street.streetEdgeId,
      osmWayId = s.osmId,
      regionId = s.regionId,
      score =
        AccessScoreCalculator.headlineScore(segmentScore, Seq(startIntersectionScore, endIntersectionScore).flatten),
      segmentScore = segmentScore,
      startIntersectionId = startIntersectionId,
      endIntersectionId = endIntersectionId,
      startIntersectionScore = startIntersectionScore,
      endIntersectionScore = endIntersectionScore,
      auditCount = s.auditCount,
      lengthMeters = lengthMeters,
      labelCount = rows.map(_.labelCount).sum,
      clusterCounts = clusterCounts(inputs),
      subScores = subScores,
      severityCounts = AccessScoreCalculator.severityCountsByType(inputs),
      tagAdjustments = AccessScoreCalculator.tagAdjustmentsByType(inputs),
      geometry = s.street.geom
    )
  }

  /**
   * Builds a single intersection's AccessScore DTO from the cluster rows attributed to it.
   *
   * @param i    The intersection (carries geometry, degree, grade separation, region, streets, and audit count).
   * @param rows The cluster rows attributed to it (none for a grade-separated node, by construction).
   * @return     The populated [[IntersectionAccessScoreForApi]].
   */
  private def buildIntersectionScore(i: IntersectionInfo, rows: Seq[ClusterScoreRow]): IntersectionAccessScoreForApi = {
    val inputs: Seq[ClusterScoreInput] = toInputs(rows)
    val subScores: Map[String, Double] = AccessScoreCalculator.scoreByType(inputs)
    val score: Option[Double]          =
      if (i.auditCount > 0 && !i.gradeSeparated) Some(AccessScoreCalculator.scoreFromSubScores(subScores)) else None

    IntersectionAccessScoreForApi(
      intersectionId = i.intersectionId,
      regionId = i.regionId,
      degree = i.degree,
      gradeSeparated = i.gradeSeparated,
      streetEdgeIds = i.streetEdgeIds,
      auditCount = i.auditCount,
      score = score,
      labelCount = rows.map(_.labelCount).sum,
      clusterCounts = clusterCounts(inputs),
      subScores = subScores,
      severityCounts = AccessScoreCalculator.severityCountsByType(inputs),
      tagAdjustments = AccessScoreCalculator.tagAdjustmentsByType(inputs),
      geometry = i.geom
    )
  }

  private def toInputs(rows: Seq[ClusterScoreRow]): Seq[ClusterScoreInput] =
    rows.map(r => ClusterScoreInput(r.labelType, r.severity, r.labelCount, r.tagCounts))

  private def clusterCounts(inputs: Seq[ClusterScoreInput]): Map[String, Int] =
    inputs.groupBy(_.labelType).map { case (lt, cs) => lt -> cs.size }

  /**
   * The AccessScores of every street and intersection in the city, cached stale-while-revalidate (#3855).
   *
   * A whole-city computation is the request the AccessScore tool and the api-docs previews make, and the only one
   * whose result does not depend on request parameters, so it is the one worth caching: seconds of database work on a
   * large city otherwise repeated per page load. Filtered requests keep the live path. The cache key names the
   * value's shape because [[SwrCache.staleWhileRevalidate]] cannot tell a differently-shaped value under a reused key.
   *
   * @param batchSize DB fetch size for the cluster stream, used only when the value has to be computed.
   * @return          Every street and intersection in the city's configured bounds.
   */
  def getFullCityScores(batchSize: Int): Future[AccessScores] =
    swrCache.staleWhileRevalidate[AccessScores](
      "accessScore:full-city:v2",
      AccessScoreService.FullCityFreshFor,
      AccessScoreService.FullCityMaxAge
    )(cityBbox.flatMap(bbox => computeAccessScoresV3(SpatialQueryType.Street, bbox, batchSize)))

  /**
   * The AccessScore of every region in the city, rolled up from the cached full-city scores (#3855).
   *
   * @param batchSize DB fetch size for the cluster stream, used only when the scores have to be computed.
   * @return          One [[RegionAccessScoreForApi]] per region within the city's configured bounds.
   */
  def getFullCityRegionScores(batchSize: Int): Future[Seq[RegionAccessScoreForApi]] =
    for {
      bbox    <- cityBbox
      regions <- apiService.getNeighborhoodsWithin(bbox)
      scores  <- getFullCityScores(batchSize)
    } yield scoreRegions(regions, scores)

  /**
   * When the clusters the scores are computed from were last rebuilt: the nightly clustering run's last successful
   * finish. A label added since then is not in any cluster yet, so it cannot have moved a score — which is what a
   * contributor wondering why their labels changed nothing needs to be told. The intersection rebuild runs inside
   * that same job, so this dates the intersections too.
   *
   * @return The finish time, or None if clustering has never succeeded on this deployment.
   */
  def clustersUpdatedAt: Future[Option[OffsetDateTime]] = apiService.lastSuccessfulJobFinish(ClusteringActor.Name)

  /** The city's configured map bounds, the area every unfiltered v3 request is resolved to. */
  private def cityBbox: Future[LatLngBBox] =
    configService.getCityMapParams.map { p =>
      LatLngBBox(
        minLat = math.min(p.lat1, p.lat2),
        minLng = math.min(p.lng1, p.lng2),
        maxLat = math.max(p.lat1, p.lat2),
        maxLng = math.max(p.lng1, p.lng2)
      )
    }

  /**
   * Computes v3 AccessScores for every region (neighborhood) within the bbox (#3855).
   *
   * Each region's score is the street-length-weighted mean of its audited streets' scores — the paper's normalization
   * that the v2 endpoint lacked — and its intersection score the plain mean of its scored intersections (#5095).
   * Coverage is the fraction of the region's streets that have been audited.
   *
   * @param bbox      The bounding box to score within.
   * @param batchSize DB fetch size for the cluster stream.
   * @return          One [[RegionAccessScoreForApi]] per region within the bbox.
   */
  def computeRegionScoresV3(bbox: LatLngBBox, batchSize: Int): Future[Seq[RegionAccessScoreForApi]] = {
    for {
      regions: Seq[Region] <- apiService.getNeighborhoodsWithin(bbox)
      scores: AccessScores <- computeAccessScoresV3(SpatialQueryType.Region, bbox, batchSize)
    } yield scoreRegions(regions, scores)
  }

  /**
   * Rolls street and intersection scores up into one [[RegionAccessScoreForApi]] per region.
   *
   * @param regions The regions to score.
   * @param scores  Street and intersection scores whose `regionId` assigns them to the regions; those of other
   *                regions are ignored.
   * @return        One DTO per region, in the regions' order.
   */
  private def scoreRegions(regions: Seq[Region], scores: AccessScores): Seq[RegionAccessScoreForApi] = {
    val streetsByRegion: Map[Int, Seq[StreetAccessScoreForApi]] = scores.streets.groupBy(_.regionId)
    // A grade-separated crossing is not a place to cross, so it is neither counted nor scored.
    val intersectionsByRegion: Map[Int, Seq[IntersectionAccessScoreForApi]] =
      scores.intersections.filterNot(_.gradeSeparated).groupBy(_.regionId).collect { case (Some(id), is) => id -> is }

    regions.map { region =>
      val streetsInRegion: Seq[StreetAccessScoreForApi] = streetsByRegion.getOrElse(region.regionId, Seq.empty)
      val auditedStreets: Seq[StreetAccessScoreForApi]  = streetsInRegion.filter(_.auditCount > 0)
      val intersectionsInRegion: Seq[IntersectionAccessScoreForApi] =
        intersectionsByRegion.getOrElse(region.regionId, Seq.empty)
      val scoredIntersections: Seq[Double] = intersectionsInRegion.flatMap(_.score)

      val score: Option[Double] =
        AccessScoreCalculator.scoreRegion(auditedStreets.flatMap(s => s.score.map(sc => (sc, s.lengthMeters))))
      val coverage: Double =
        if (streetsInRegion.nonEmpty) auditedStreets.size.toDouble / streetsInRegion.size else 0.0

      // Mean cluster count per audited street, per label type (parity with v2's avg_attribute_count).
      val avgClusterCounts: Map[String, Double] =
        if (auditedStreets.isEmpty) Map.empty
        else
          AccessScoreCalculator.orderedScoredTypes.map { t =>
            t -> auditedStreets.map(_.clusterCounts.getOrElse(t, 0)).sum.toDouble / auditedStreets.size
          }.toMap

      RegionAccessScoreForApi(
        regionId = region.regionId, name = region.name, score = score, coverage = coverage,
        auditedStreetCount = auditedStreets.size, totalStreetCount = streetsInRegion.size,
        intersectionScore = AccessScoreCalculator.scoreRegionIntersections(scoredIntersections),
        intersectionCount = intersectionsInRegion.size, scoredIntersectionCount = scoredIntersections.size,
        avgClusterCounts = avgClusterCounts, geometry = region.geom
      )
    }
  }
}
