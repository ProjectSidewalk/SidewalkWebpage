package service

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

import javax.inject.{Inject, Singleton}
import scala.collection.mutable
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class AccessScoreService @Inject() (
    apiService: ApiService,
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
    val rawScore: Double                            = AccessScoreCalculator.scoreStreet(inputs)
    val byType: Map[String, Seq[ClusterScoreInput]] = inputs.groupBy(_.labelType)
    val clusterCounts: Map[String, Int]             = byType.map { case (lt, cs) => lt -> cs.size }
    val subScores: Map[String, Double]              = byType.map { case (lt, cs) =>
      lt -> cs.map(AccessScoreCalculator.scoreCluster).sum
    }

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
      geometry = s.street.geom
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
    } yield {
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
}
