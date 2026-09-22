package service

import actor.ClusteringActor
import executors.CpuIntensiveExecutionContext
import models.api.{IntersectionAccessScoreForApi, RegionAccessScoreForApi, StreetAccessScoreForApi}
import models.cluster.ClusterScoreRow
import models.intersection.{IntersectionInfo, IntersectionStreetEnd, StreetEnd}
import models.region.Region
import models.street.{StreetEdgeInfo, StreetGradientConfidence, StreetGradientQuality, StreetGradientStats}
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
   * Where the full-city [[AccessScores]] live in the Play cache. One constant because two writers share it: the
   * request path's stale-while-revalidate refresh and the nightly snapshot's seed
   * ([[AccessScoreService.computeCityWideScores]]). Bump the version whenever the value's shape *or* the engine's
   * numbers change: [[SwrCache]] cannot tell a differently-shaped value under a reused key, and a value cached by the
   * release before is well-formed and wrong, with nothing else to evict it. v4 is grade in the score by default
   * (#5223).
   */
  val FullCityCacheKey: String = "accessScore:full-city:v4"

  /**
   * Age past which a full-city AccessScore is served stale while a background recompute runs. Clustering — the only
   * thing that changes a score — runs nightly, so a score is at most this much later than the run that produced it.
   */
  val FullCityFreshFor: FiniteDuration = 10.minutes

  /**
   * Age past which the cached full-city AccessScore is evicted and a request has to wait on recomputing it.
   *
   * Two nights rather than one, because the value is seeded once a night by the clustering job
   * ([[AccessScoreService.computeCityWideScores]]) and that job's finish time drifts with the night's load: a 24-hour
   * bound could evict minutes before the next seed lands, and one failed run would leave a city cold for a day. The
   * bound is an eviction floor, not a freshness bound — [[FullCityFreshFor]] still forces a background recompute on
   * any stale hit — so a longer one costs nothing in staleness. What it saves is the cold wait, which on a large city
   * (CDMX) is over a minute of database work, longer than the reverse proxy allows a request (#5418).
   */
  val FullCityMaxAge: FiniteDuration = 48.hours

  /**
   * How long a request that finds no cached full-city AccessScore waits for the computation before answering `503`.
   *
   * Under the 60 seconds the production reverse proxy (Apache `ProxyTimeout`) gives a request, with margin for the
   * response to leave the JVM: past the proxy's limit the client gets a `502` and nothing it can act on, while the
   * computation finishes unobserved (#5418). Under this one it gets a `Retry-After` and comes back to a warm cache.
   */
  val FullCityColdWait: FiniteDuration = 45.seconds
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
   * Computes v3 AccessScores for every street intersecting the bbox and every intersection at their ends (#3855,
   * #5095).
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
        val namesFuture         = apiService.getStreetNames(streetIds)
        val gradientsFuture     = apiService.getStreetGradientStats(streetIds)
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
          names         <- namesFuture
          gradients     <- gradientsFuture
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
                names.get(streetId),
                rows,
                lengths.getOrElse(streetId, 0.0),
                gradients.get(streetId),
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
   * @param streetName             The street's OSM name, if its way has one.
   * @param rows                   The cluster rows scoring the street's segment.
   * @param lengthMeters           The street's length in meters.
   * @param gradient               The street's slope statistics, if it has been sampled (#5223).
   * @param startIntersectionId    The intersection at the street's start, if any.
   * @param endIntersectionId      The intersection at the street's end, if any.
   * @param startIntersectionScore Its score, if it has one.
   * @param endIntersectionScore   Its score, if it has one.
   * @return                       The populated [[StreetAccessScoreForApi]].
   */
  private def buildStreetScore(
      s: StreetEdgeInfo,
      streetName: Option[String],
      rows: Seq[ClusterScoreRow],
      lengthMeters: Double,
      gradient: Option[StreetGradientStats],
      startIntersectionId: Option[Int],
      endIntersectionId: Option[Int],
      startIntersectionScore: Option[Double],
      endIntersectionScore: Option[Double]
  ): StreetAccessScoreForApi = {
    val inputs: Seq[ClusterScoreInput] = toInputs(rows)
    // The score is squashed from the same per-type terms the API reports, so `sub_scores` always explains
    // `segment_score`.
    val subScores: Map[String, Double] = AccessScoreCalculator.scoreByType(inputs, Some(lengthMeters))
    // Slope is its own field rather than folded into `sub_scores`, which are per label type (#5223), so that
    // `logit(segment_score) = sum(sub_scores) + grade_term` holds and subtracting it recovers the label-only score.
    val slope: Option[AccessScoreCalculator.SlopeInput] = gradient.map(toSlopeInput)
    val slopeTerm: Double                               =
      AccessScoreCalculator.slopeTerm(slope, lengthMeters, AccessScoreCalculator.defaultSlopeSettings)
    val segmentScore: Option[Double] =
      if (s.auditCount > 0) Some(AccessScoreCalculator.segmentScoreWithSlope(subScores, slope, lengthMeters)) else None

    StreetAccessScoreForApi(
      streetEdgeId = s.street.streetEdgeId,
      osmWayId = s.osmId,
      streetName = streetName,
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
      gradient = gradient,
      slopeTerm = slopeTerm,
      geometry = s.street.geom
    )
  }

  /**
   * A street's stored slope as the engine takes it. `approximate` gathers the two ways a row's grade is an
   * end-to-end line: the coarse-model tier (`low` confidence), and a profile the sampler distrusted (`suspect`).
   */
  private def toSlopeInput(g: StreetGradientStats): AccessScoreCalculator.SlopeInput =
    AccessScoreCalculator.SlopeInput(
      meanGrade = g.meanGrade,
      maxGrade = g.maxGrade,
      netGrade = g.netGrade,
      metersOver5pct = g.metersOver5pctGrade,
      metersOver8pct = g.metersOver8pctGrade,
      approximate = g.confidence == StreetGradientConfidence.Low || g.quality == StreetGradientQuality.Suspect
    )

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
   * whose result does not depend on request parameters, so it is the one worth caching: over a minute of database
   * work on a large city otherwise repeated per page load. Filtered requests keep the live path.
   *
   * A cold cache — after a deploy, or a city nobody has opened in [[AccessScoreService.FullCityMaxAge]] — answers
   * `None` once [[AccessScoreService.FullCityColdWait]] has passed rather than holding the request past the proxy's
   * limit (#5418); the computation keeps running and fills the cache, so the client's retry is served. The nightly
   * snapshot seeds the same key, which is why a cold cache is the exception rather than every morning's first visit.
   *
   * @param batchSize DB fetch size for the cluster stream, used only when the value has to be computed.
   * @return          Every street and intersection in the city's configured bounds, or `None` when nothing was cached
   *                  and the computation is still running.
   */
  def getFullCityScores(batchSize: Int): Future[Option[AccessScores]] =
    swrCache.staleWhileRevalidateWithin[AccessScores](
      AccessScoreService.FullCityCacheKey,
      AccessScoreService.FullCityFreshFor,
      AccessScoreService.FullCityMaxAge,
      AccessScoreService.FullCityColdWait
    )(cityBbox.flatMap(bbox => computeAccessScoresV3(SpatialQueryType.Street, bbox, batchSize)))

  /**
   * The AccessScore of every region in the city, rolled up from the cached full-city scores (#3855).
   *
   * @param batchSize DB fetch size for the cluster stream, used only when the scores have to be computed.
   * @return          One [[RegionAccessScoreForApi]] per region within the city's configured bounds, or `None` when
   *                  the full-city scores are still being computed (see [[getFullCityScores]]).
   */
  def getFullCityRegionScores(batchSize: Int): Future[Option[Seq[RegionAccessScoreForApi]]] =
    for {
      bbox    <- cityBbox
      regions <- apiService.getRegionsFullyInsideBbox(bbox)
      scores  <- getFullCityScores(batchSize)
    } yield scores.map(scoreRegions(regions, _))

  /**
   * The same city-wide street, intersection and region scores, computed fresh rather than served from the cache,
   * and then seeded into it.
   *
   * For the nightly AccessScore Spotlight snapshot (#5215), which runs at the end of the clustering job: the cached
   * copy is whatever the last page load left there, from before tonight's clusters existed, so the one caller that
   * must see the new clusters asks for the computation directly. It goes through the same [[scoreRegions]] roll-up
   * as [[getFullCityRegionScores]], so the tables can't disagree with `/v3/api/accessScoreRegions`.
   *
   * Having paid for the computation, it writes the result to the request cache before returning (#5418): the value
   * is the one a page load would have computed, and seeding it is what keeps the tool loading in a city nobody has
   * opened since the deploy. The write comes before the snapshot's own tables are touched, so a failed insert still
   * leaves the cache warm. It is a plain [[SwrCache.put]], not a coalesced refresh: a request-triggered refresh that
   * started mid-clustering would otherwise hand this caller pre-clustering data. Such a refresh, if one is in flight,
   * cannot overwrite the seed either — [[SwrCache]] keeps the value with the later timestamp — so the first scores
   * served after a clustering run are the run's.
   *
   * @param batchSize DB fetch size for the cluster stream.
   * @return          The region roll-up and the street/intersection scores it was rolled up from.
   */
  def computeCityWideScores(batchSize: Int): Future[(Seq[RegionAccessScoreForApi], AccessScores)] =
    for {
      bbox    <- cityBbox
      regions <- apiService.getRegionsFullyInsideBbox(bbox)
      scores  <- computeAccessScoresV3(SpatialQueryType.Street, bbox, batchSize)
      _       <- swrCache.put(AccessScoreService.FullCityCacheKey, scores, AccessScoreService.FullCityMaxAge)
    } yield (scoreRegions(regions, scores), scores)

  /**
   * When the clusters the scores are computed from were last rebuilt: the nightly clustering run's last successful
   * finish. A label added since then is not in any cluster yet, so it cannot have moved a score — which is what a
   * contributor wondering why their labels changed nothing needs to be told. The intersection rebuild runs inside
   * that same job, so this dates the intersections too.
   *
   * @return The finish time, or None if clustering has never succeeded on this deployment.
   */
  def clustersUpdatedAt: Future[Option[OffsetDateTime]] = apiService.lastSuccessfulJobFinish(ClusteringActor.Name)

  /**
   * The elevation models the city's street gradients came from, as (dem_source, street count), most streets first
   * (#5223). Cached like the full-city scores: `accessScoreConfig` is asked for on every AccessScore tool load and
   * was a constant before it carried this, while the answer only changes when someone imports a gradient CSV.
   */
  def gradientSourceCounts: Future[Seq[(String, Int)]] =
    swrCache.staleWhileRevalidate[Seq[(String, Int)]](
      "accessScore:gradient-sources:v1",
      AccessScoreService.FullCityFreshFor,
      AccessScoreService.FullCityMaxAge
    )(apiService.getStreetGradientSourceCounts)

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
   * Computes v3 AccessScores for every region fully inside the bbox (#3855).
   *
   * Each region's score is the street-length-weighted mean of its audited streets' scores — the paper's normalization
   * that the v2 endpoint lacked — and its intersection score the plain mean of its scored intersections (#5095).
   * Coverage is the fraction of the region's streets that have been audited.
   *
   * @param bbox      The bounding box to score within.
   * @param batchSize DB fetch size for the cluster stream.
   * @return          One [[RegionAccessScoreForApi]] per region fully inside the bbox.
   */
  def computeRegionScoresV3(bbox: LatLngBBox, batchSize: Int): Future[Seq[RegionAccessScoreForApi]] = {
    for {
      regions: Seq[Region] <- apiService.getRegionsFullyInsideBbox(bbox)
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
