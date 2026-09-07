package service

import actor.ClusteringActor
import executors.CpuIntensiveExecutionContext
import models.api.{RegionAccessScoreForApi, StreetAccessScoreForApi}
import models.cluster.ClusterScoreRow
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
   * Computes v3 AccessScores for every street intersecting the bbox (#3855).
   *
   * Loads the streets and their lengths, streams the lean per-cluster scoring rows, groups them by street, and delegates
   * the weighting to the pure [[AccessScoreCalculator]]. A street's score is exposed only when it has been audited.
   *
   * @param spatialQueryType Whether the bbox filters on street geometry (streets endpoint) or region geometry.
   * @param bbox             The bounding box to score within.
   * @param batchSize        DB fetch size for the cluster stream.
   * @return                 One [[StreetAccessScoreForApi]] per intersecting street.
   */
  def computeStreetScoresV3(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      batchSize: Int
  ): Future[Seq[StreetAccessScoreForApi]] = {
    apiService.selectStreetsIntersecting(spatialQueryType, bbox).flatMap { streets: Seq[StreetEdgeInfo] =>
      val streetIds: Seq[Int] = streets.map(_.street.streetEdgeId)
      val lengthsFuture       = apiService.getStreetLengths(streetIds)

      // Accumulate the streamed cluster rows by street. The sink runs single-threaded, so the mutable map is safe.
      val rowsByStreet: mutable.Map[Int, mutable.Buffer[ClusterScoreRow]] = mutable.Map.empty
      val streamFuture                                                    = apiService
        .getClusterScoreRows(spatialQueryType, bbox, AccessScoreCalculator.scoredTypeNames, batchSize)
        .runWith(Sink.foreach { row => rowsByStreet.getOrElseUpdate(row.streetEdgeId, mutable.Buffer.empty) += row })

      // Join the concurrent length lookup and cluster stream, then do the (CPU-bound) scoring off the default pool.
      lengthsFuture
        .zip(streamFuture)
        .map { case (lengths, _) =>
          streets.map { s =>
            val streetId: Int              = s.street.streetEdgeId
            val rows: Seq[ClusterScoreRow] = rowsByStreet.getOrElse(streetId, mutable.Buffer.empty).toSeq
            buildStreetScore(s, rows, lengths.getOrElse(streetId, 0.0))
          }
        }(cpuEc)
    }
  }

  /**
   * Builds a single street's AccessScore DTO from its cluster rows.
   *
   * @param s            The street (carries geometry, region, and audit count).
   * @param rows         The street's scored cluster rows.
   * @param lengthMeters The street's length in meters.
   * @return             The populated [[StreetAccessScoreForApi]].
   */
  private def buildStreetScore(
      s: StreetEdgeInfo,
      rows: Seq[ClusterScoreRow],
      lengthMeters: Double
  ): StreetAccessScoreForApi = {
    val inputs: Seq[ClusterScoreInput] =
      rows.map(r => ClusterScoreInput(r.labelType, r.severity, r.labelCount, r.tagCounts))
    // The score is squashed from the same per-type terms the API reports, so `sub_scores` always explains `score`.
    val subScores: Map[String, Double]  = AccessScoreCalculator.scoreByType(inputs)
    val rawScore: Double                = AccessScoreCalculator.scoreFromSubScores(subScores)
    val clusterCounts: Map[String, Int] = inputs.groupBy(_.labelType).map { case (lt, cs) => lt -> cs.size }

    StreetAccessScoreForApi(
      streetEdgeId = s.street.streetEdgeId,
      osmWayId = s.osmId,
      regionId = s.regionId,
      score = if (s.auditCount > 0) Some(rawScore) else None,
      auditCount = s.auditCount,
      lengthMeters = lengthMeters,
      labelCount = rows.map(_.labelCount).sum,
      clusterCounts = clusterCounts,
      subScores = subScores,
      severityCounts = AccessScoreCalculator.severityCountsByType(inputs),
      tagAdjustments = AccessScoreCalculator.tagAdjustmentsByType(inputs),
      geometry = s.street.geom
    )
  }

  /**
   * The AccessScore of every street in the city, cached stale-while-revalidate (#3855).
   *
   * A whole-city computation is the request the AccessScore tool and the api-docs preview make, and the only one
   * whose result does not depend on request parameters, so it is the one worth caching: seconds of database work on a
   * large city otherwise repeated per page load. Filtered requests keep the live path. The cache key names the
   * value's shape because [[SwrCache.staleWhileRevalidate]] cannot tell a differently-shaped value under a reused key.
   *
   * @param batchSize DB fetch size for the cluster stream, used only when the value has to be computed.
   * @return          One [[StreetAccessScoreForApi]] per street in the city's configured bounds.
   */
  def getFullCityStreetScores(batchSize: Int): Future[Seq[StreetAccessScoreForApi]] =
    swrCache.staleWhileRevalidate[Seq[StreetAccessScoreForApi]](
      "accessScoreStreets:full-city:v1",
      AccessScoreService.FullCityFreshFor,
      AccessScoreService.FullCityMaxAge
    )(cityBbox.flatMap(bbox => computeStreetScoresV3(SpatialQueryType.Street, bbox, batchSize)))

  /**
   * The AccessScore of every region in the city, rolled up from the cached full-city street scores (#3855).
   *
   * @param batchSize DB fetch size for the cluster stream, used only when the street scores have to be computed.
   * @return          One [[RegionAccessScoreForApi]] per region within the city's configured bounds.
   */
  def getFullCityRegionScores(batchSize: Int): Future[Seq[RegionAccessScoreForApi]] =
    for {
      bbox         <- cityBbox
      regions      <- apiService.getNeighborhoodsWithin(bbox)
      streetScores <- getFullCityStreetScores(batchSize)
    } yield scoreRegions(regions, streetScores)

  /**
   * When the clusters the scores are computed from were last rebuilt: the nightly clustering run's last successful
   * finish. A label added since then is not in any cluster yet, so it cannot have moved a score — which is what a
   * contributor wondering why their labels changed nothing needs to be told.
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
   * that the v2 endpoint lacked. Coverage is the fraction of the region's streets that have been audited.
   *
   * @param bbox      The bounding box to score within.
   * @param batchSize DB fetch size for the cluster stream.
   * @return          One [[RegionAccessScoreForApi]] per region within the bbox.
   */
  def computeRegionScoresV3(bbox: LatLngBBox, batchSize: Int): Future[Seq[RegionAccessScoreForApi]] = {
    for {
      regions: Seq[Region]                       <- apiService.getNeighborhoodsWithin(bbox)
      streetScores: Seq[StreetAccessScoreForApi] <- computeStreetScoresV3(SpatialQueryType.Region, bbox, batchSize)
    } yield scoreRegions(regions, streetScores)
  }

  /**
   * Rolls street scores up into one [[RegionAccessScoreForApi]] per region.
   *
   * @param regions      The regions to score.
   * @param streetScores Street scores whose `regionId` assigns them to the regions; streets of other regions are ignored.
   * @return             One DTO per region, in the regions' order.
   */
  private def scoreRegions(
      regions: Seq[Region],
      streetScores: Seq[StreetAccessScoreForApi]
  ): Seq[RegionAccessScoreForApi] = {
    val streetsByRegion: Map[Int, Seq[StreetAccessScoreForApi]] = streetScores.groupBy(_.regionId)
    regions.map { region =>
      val streetsInRegion: Seq[StreetAccessScoreForApi] = streetsByRegion.getOrElse(region.regionId, Seq.empty)
      val auditedStreets: Seq[StreetAccessScoreForApi]  = streetsInRegion.filter(_.auditCount > 0)

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
        avgClusterCounts = avgClusterCounts, geometry = region.geom
      )
    }
  }
}
