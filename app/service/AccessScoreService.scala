package service

import executors.CpuIntensiveExecutionContext
import models.api.{RegionAccessScoreForApi, StreetAccessScoreForApi}
import models.cluster.ClusterScoreRow
import models.computation.{RegionScore, StreetLabelCounter, StreetScore}
import models.label.LabelTypeEnum
import models.region.Region
import models.street.StreetEdgeInfo
import models.utils.SpatialQueryType.SpatialQueryType
import models.utils.{LatLngBBox, SpatialQueryType}
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.Sink
import service.AccessScoreCalculator.ClusterScoreInput

import java.time.{Instant, OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.collection.mutable
import scala.concurrent.{ExecutionContext, Future}

@Singleton
class AccessScoreService @Inject() (
    apiService: ApiService,
    implicit val ec: ExecutionContext,
    cpuEc: CpuIntensiveExecutionContext
)(implicit mat: Materializer) {

  // Define the label types relevant for scoring and their order.
  // This ensures consistency when accessing them and pairing with the significance array.
  private def scoreRelevantLabelTypes: Seq[LabelTypeEnum.Base] =
    Seq(LabelTypeEnum.CurbRamp, LabelTypeEnum.NoCurbRamp, LabelTypeEnum.Obstacle, LabelTypeEnum.SurfaceProblem)

  /**
   * Computes access scores for regions within a given bounding box.
   *
   * The method performs the following steps:
   * 1. Retrieves the neighborhoods within the specified bounding box using `apiService.getNeighborhoodsWithin`.
   * 2. Computes access scores for streets within the bounding box using `computeStreetScore`.
   * 3. Filters the streets to include only those that have been audited.
   * 4. For each neighborhood:
   * - Identifies the audited streets intersecting with the neighborhood.
   * - Computes the coverage as the ratio of audited streets to total streets in the neighborhood.
   * - Computes the average street features and the access score using the provided significance weights.
   * - Calculates the average image capture date and label date if applicable.
   * - Asserts that the coverage does not exceed 1.0.
   * 5. Returns a sequence of `AccessScoreNeighborhood` objects populated with the computed metrics.
   *
   * Notes:
   * - Default values are set to 0 or `None` for metrics when no audited streets intersect the neighborhood.
   * - The `significance` array is used as weights for computing the access score.
   * - The method ensures that null values are handled gracefully by initializing default values.
   *
   * @param bbox The bounding box defining the geographical area to compute access scores for.
   * @param batchSize The size of each batch of data to fetch.
   * @return A Future containing a sequence of `AccessScoreNeighborhood` objects, each representing
   * a neighborhood with its computed access score and related metrics.
   */
  def computeRegionScore(bbox: LatLngBBox, batchSize: Int): Future[Seq[RegionScore]] = {
    // Significance array corresponds to the order in scoreRelevantLabelTypes.
    val significance: Array[Double] = Array(0.75, -1.0, -1.0, -1.0)
    for {
      neighborhoods: Seq[Region]           <- apiService.getNeighborhoodsWithin(bbox)
      streetAccessScores: Seq[StreetScore] <- computeStreetScore(SpatialQueryType.Region, bbox, batchSize)
    } yield {
      val auditedStreets: Seq[StreetScore] = streetAccessScores.filter(_.auditCount > 0)

      // Populate every object in the list.
      val neighborhoodList: Seq[RegionScore] = neighborhoods.map { n =>
        val auditedStreetsIntersecting: Seq[StreetScore] = auditedStreets.filter(_.regionId == n.regionId)

        // Set default values for everything to 0, so null values will be 0 as well.
        var coverage: Double    = 0.0
        var accessScore: Double = 0.0
        // Adjusted to 4 elements to match scoreRelevantLabelTypes and significance array length.
        var averagedStreetFeatures: Array[Double]       = Array(0.0, 0.0, 0.0, 0.0)
        var avgImageCaptureDate: Option[OffsetDateTime] = None
        var avgLabelDate: Option[OffsetDateTime]        = None

        if (auditedStreetsIntersecting.nonEmpty) {
          averagedStreetFeatures = auditedStreetsIntersecting
            .map(_.clusters) // clusters from AccessScoreStreet (Array[Int] of 4 elements).
            .transpose
            .map(_.sum.toDouble / auditedStreetsIntersecting.size)
            .toArray
          accessScore = computeAccessScore(averagedStreetFeatures, significance)
          val streetsIntersecting: Seq[StreetScore] = streetAccessScores.filter(_.regionId == n.regionId)

          if (streetsIntersecting.nonEmpty) { // Avoid division by zero for coverage.
            coverage = auditedStreetsIntersecting.size.toDouble / streetsIntersecting.size
          } else {
            coverage = 0.0 // Or handle as an error/special case if streetsIntersecting should never be empty here.
          }

          // Compute average image & label age if there are any labels on the streets.
          val nImages: Int = auditedStreetsIntersecting.map(s => s.imageCount).sum
          val nLabels: Int = auditedStreetsIntersecting.map(s => s.labelCount).sum
          val (avgImageAge, avgLabelAge): (Option[Long], Option[Long]) =
            if (nImages > 0 && nLabels > 0) {
              (
                Some(
                  auditedStreetsIntersecting
                    .flatMap(s => s.avgImageCaptureDate.map(_.toInstant.toEpochMilli * s.imageCount))
                    .sum / nImages
                ),
                Some(
                  auditedStreetsIntersecting
                    .flatMap(s => s.avgLabelDate.map(_.toInstant.toEpochMilli * s.labelCount))
                    .sum / nLabels
                )
              )
            } else {
              (None, None)
            }
          avgImageCaptureDate = avgImageAge.map(age => Instant.ofEpochMilli(age).atOffset(ZoneOffset.UTC))
          avgLabelDate = avgLabelAge.map(age => Instant.ofEpochMilli(age).atOffset(ZoneOffset.UTC))

          assert(coverage <= 1.0, s"Coverage cannot be greater than 1.0. Was: $coverage for neighborhood ${n.regionId}")
        }
        RegionScore(name = n.name, geom = n.geom, regionId = n.regionId, coverage = coverage, score = accessScore,
          clusterScores = averagedStreetFeatures, significanceScores = significance,
          avgImageCaptureDate = avgImageCaptureDate, avgLabelDate = avgLabelDate)
      }
      neighborhoodList
    }
  }

  /**
   * Computes access scores for streets within a specified bounding box.
   *
   * The method performs the following steps:
   * 1. Retrieves streets intersecting the bounding box from the database.
   * 2. Initializes a counter for each street to track attributes such as label counts and image counts.
   * 3. Fetches clusters for the streets in batches and updates the counters based on the attributes.
   * 4. Computes the access score and other statistics for each street in parallel.
   *
   * The access score is computed using a weighted significance array and the counts of specific attributes
   * corresponding to `scoreRelevantLabelTypes`.
   *
   * The resulting `AccessScoreStreet` objects include:
   * - Street information (e.g., street edge, OSM ID, region ID).
   * - Computed access score.
   * - Audit count and cluster counts.
   * - Average image capture date and label date (if available).
   * - Total number of images and labels.
   *
   * @param spatialQueryType The type of spatial query to use for retrieving streets.
   * @param bbox The bounding box defining the geographic area to consider.
   * @param batchSize The size of each batch of data to fetch.
   * @return A Future containing a sequence of `AccessScoreStreet` objects, each representing
   * a street with its computed access score and related statistics.
   */
  def computeStreetScore(
      spatialQueryType: SpatialQueryType,
      bbox: LatLngBBox,
      batchSize: Int
  ): Future[Seq[StreetScore]] = {
    // Significance array corresponds to the order in scoreRelevantLabelTypes.
    val significance: Array[Double] = Array(0.75, -1.0, -1.0, -1.0)

    // Get streets from db and set up cluster counter for the streets.
    apiService
      .selectStreetsIntersecting(spatialQueryType, bbox)
      .flatMap { streets: Seq[StreetEdgeInfo] =>
        val streetAttCounts: mutable.Seq[(StreetEdgeInfo, StreetLabelCounter)] =
          streets
            .map { s =>
              (
                s,
                StreetLabelCounter(
                  streetEdgeId = s.street.streetEdgeId,
                  nLabels = 0,
                  nImages = 0,
                  labelAgeSum = 0L,
                  imageAgeSum = 0L,
                  labelCounter = mutable.Map(scoreRelevantLabelTypes.map(lt => lt.name -> 0): _*)
                )
              )
            }
            .to(mutable.Seq)

        // Get clusters for the streets in batches and increment the counters based on those clusters.
        apiService
          .getClustersInBoundingBox(spatialQueryType, bbox, None, batchSize)
          .runWith(Sink.foreach { cluster =>
            // Find the street counter safely.
            val streetOpt: Option[StreetLabelCounter] = streetAttCounts
              .find(_._2.streetEdgeId == cluster.streetEdgeId)
              .map(_._2)

            streetOpt.foreach { street =>
              street.nLabels += cluster.labelCount
              street.nImages += cluster.imageCount

              // Safely update age sums.
              if (cluster.avgLabelDate != null) {
                street.labelAgeSum += cluster.avgLabelDate.toInstant.toEpochMilli * cluster.labelCount
              }
              if (cluster.avgImageCaptureDate != null) {
                street.imageAgeSum += cluster.avgImageCaptureDate.toInstant.toEpochMilli * cluster.imageCount
              }

              // Increment count for the specific label type if it's one we're tracking.
              if (street.labelCounter.contains(cluster.labelType)) {
                street.labelCounter(cluster.labelType) += 1
              }
            }
          })
          .map { _ =>
            // Compute the access score and other stats for each street in parallel.
            val streetAccessScores: Seq[StreetScore] =
              streetAttCounts.toSeq.map { case (s, cnt) =>
                val (avgImageCaptureDate, avgLabelDate): (Option[OffsetDateTime], Option[OffsetDateTime]) =
                  if (cnt.nImages > 0 && cnt.nLabels > 0) {
                    // Ensure sums are only divided if counts are positive to avoid division by zero.
                    val imageAvgMillis = if (cnt.nImages > 0) Some(cnt.imageAgeSum / cnt.nImages) else None
                    val labelAvgMillis = if (cnt.nLabels > 0) Some(cnt.labelAgeSum / cnt.nLabels) else None
                    (
                      imageAvgMillis.map(millis => Instant.ofEpochMilli(millis).atOffset(ZoneOffset.UTC)),
                      labelAvgMillis.map(millis => Instant.ofEpochMilli(millis).atOffset(ZoneOffset.UTC))
                    )
                  } else if (cnt.nImages > 0) { // Only images present.
                    val imageAvgMillis = Some(cnt.imageAgeSum / cnt.nImages)
                    (imageAvgMillis.map(millis => Instant.ofEpochMilli(millis).atOffset(ZoneOffset.UTC)), None)
                  } else if (cnt.nLabels > 0) { // Only labels present.
                    val labelAvgMillis = Some(cnt.labelAgeSum / cnt.nLabels)
                    (None, labelAvgMillis.map(millis => Instant.ofEpochMilli(millis).atOffset(ZoneOffset.UTC)))
                  } else { // No images or no labels.
                    (None, None)
                  }

                // Compute access score using the predefined order from scoreRelevantLabelTypes.
                val clusters: Array[Int] = scoreRelevantLabelTypes
                  .map(lt => cnt.labelCounter.getOrElse(lt.name, 0))
                  .toArray

                val score: Double = computeAccessScore(clusters.map(_.toDouble), significance)

                StreetScore(
                  streetEdge = s.street, osmId = s.osmId, regionId = s.regionId, score = score,
                  auditCount = s.auditCount, clusters = clusters, significance = significance,
                  avgImageCaptureDate = avgImageCaptureDate, avgLabelDate = avgLabelDate, imageCount = cnt.nImages,
                  labelCount = cnt.nLabels
                )
              }
            streetAccessScores
          }
      }(cpuEc)
  }

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
      val streetIds: Seq[Int]     = streets.map(_.street.streetEdgeId)
      val lengthsFuture           = apiService.getStreetLengths(streetIds)

      // Accumulate the streamed cluster rows by street. The sink runs single-threaded, so the mutable map is safe.
      val rowsByStreet: mutable.Map[Int, mutable.Buffer[ClusterScoreRow]] = mutable.Map.empty
      val streamFuture = apiService
        .getClusterScoreRows(spatialQueryType, bbox, AccessScoreCalculator.scoredTypeNames, batchSize)
        .runWith(Sink.foreach { row =>
          rowsByStreet.getOrElseUpdate(row.streetEdgeId, mutable.Buffer.empty) += row
        })

      // Join the concurrent length lookup and cluster stream, then do the (CPU-bound) scoring off the default pool.
      lengthsFuture.zip(streamFuture).map { case (lengths, _) =>
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
    val rawScore: Double               = AccessScoreCalculator.scoreStreet(inputs)
    val byType: Map[String, Seq[ClusterScoreInput]] = inputs.groupBy(_.labelType)
    val clusterCounts: Map[String, Int]    = byType.map { case (lt, cs) => lt -> cs.size }
    val subScores: Map[String, Double]     = byType.map { case (lt, cs) => lt -> cs.map(AccessScoreCalculator.scoreCluster).sum }

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

  /**
   * Computes the access score based on the given clusters and their significance weights.
   *
   * The method performs the following steps:
   * 1. Calculates the dot product of the `clusters` and `significance` arrays.
   * 2. Applies the sigmoid function to the result of the dot product to normalize the score to a value between 0 and 1.
   *
   * @param clusters An array of feature values representing the clusters.
   * @param significance An array of weights representing the significance of each cluster. Must have the same length
   *                     as `clusters`.
   * @return A normalized access score as a `Double` in the range [0, 1].
   */
  def computeAccessScore(clusters: Array[Double], significance: Array[Double]): Double = {
    // Ensure clusters and significance have the same length before zipping; expecting them to be 4 elements each.
    val t: Double = (clusters.take(significance.length) zip significance).map { case (f, s) => f * s }.sum // dot product.
    val s: Double = 1 / (1 + math.exp(-t)) // sigmoid function.
    s
  }
}
