package service

import models.api.{
  AccessScoreSpotlightForApi,
  RegionAccessScoreForApi,
  RegionSpotlightRowForApi,
  SpotlightCityForApi,
  SpotlightRowForApi,
  SpotlightUnit,
  StreetAccessScoreForApi,
  StreetSpotlightRowForApi
}
import models.label.LabelTable
import models.region.{NamedRegionCompletion, RegionAccessScore, RegionAccessScoreTable, RegionCompletionTable}
import models.street.{StreetAccessScore, StreetAccessScoreTable, StreetSpotlightSnapshot}
import models.utils.MyPostgresProfile
import play.api.Logger
import play.api.i18n.Lang
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import service.ConfigService.{CrossCityFreshFor, CrossCityMaxAge}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Random

/**
 * What one nightly Spotlight snapshot wrote, for the job's run record.
 *
 * @param regions How many region rows were appended.
 * @param streets How many street rows the snapshot was replaced with.
 */
case class SpotlightSnapshotResult(regions: Int, streets: Int)

/**
 * The rules behind the AccessScore Spotlight, with no database or application attached (#5215).
 *
 * Everything here is a pure function of rows: which units are ranked at all, how street edges roll up into the named
 * stretches people actually recognize, and how the two lists are ordered. The DAOs apply the same bars in SQL so a
 * city's own query stays bounded; this object is what the cross-city merge runs, and what the specs pin.
 */
object AccessScoreSpotlight {

  /**
   * The share of a region's street length that must be explored before its score is ranked anywhere.
   *
   * One number, shared: published as `min_region_completion` by `/v3/api/accessScoreConfig`, applied here, and read
   * from that endpoint by the AccessScore tool — so the tool's rank list and the landing page's can never disagree
   * about who is ranked. Completion is `region_completion`'s distance-based rate, the number the landing choropleth
   * colors, not the AccessScore API's street-count `coverage`; the two disagree.
   */
  val MinRegionCompletion: Double = 0.8

  /**
   * How long a stretch of street must be to be ranked.
   *
   * A score describes what is along a street, so a 20 m stub with one bad label is not a street with a bad score —
   * it is one label. The floor is what keeps such a stub out of the "lowest" list.
   */
  val MinStreetLengthMeters: Double = 100.0

  /** How many scored clusters a stretch needs to be ranked, unless it has none at all (see [[streetQualifies]]). */
  val MinStreetClusters: Int = 3

  /** How many rows each list holds when the caller asks for no particular number. */
  val DefaultListSize: Int = 5

  /** The largest list the endpoint will build, so a hand-typed `n` can't ask for the whole city. */
  val MaxListSize: Int = 25

  /**
   * Whether a region is ranked: it has a score, and enough of it has been explored for that score to describe it.
   *
   * Compared on the rounded percent, like `AccessScoreModel`'s own floor, so the rule can never disagree with the
   * "N% explored" the page prints beside it.
   *
   * @param row           The region's snapshot row.
   * @param minCompletion The completion floor, normally [[MinRegionCompletion]].
   * @return              Whether the region belongs in the ranked lists.
   */
  def regionQualifies(row: RegionSpotlightRowForApi, minCompletion: Double = MinRegionCompletion): Boolean =
    row.score.isDefined && math.round(row.completionRate * 100) >= math.round(minCompletion * 100)

  /**
   * Whether a stretch of street is ranked.
   *
   * Three bars: somebody has explored it, it is long enough for a score to be about the street rather than about one
   * label, and it carries either enough labeled evidence or none at all. That last arm is the "somebody walked it
   * and found nothing" case the design asks for — a confirmed absence of problems is a finding, while one or two
   * clusters on a long street is the thin middle that says little either way.
   *
   * @param row The stretch's snapshot row.
   * @return    Whether it belongs in the ranked lists.
   */
  def streetQualifies(row: StreetAccessScore): Boolean =
    row.score.isDefined && row.auditCount > 0 && row.lengthM >= MinStreetLengthMeters &&
      (row.clusterCount >= MinStreetClusters || row.clusterCount == 0)

  /**
   * Builds one night's region rows: every region in the city, scored or not.
   *
   * The unscored ones are written too, because they are what the module counts as "of M neighborhoods" and lists as
   * "closest to being ranked" — the call to action that most deployments will actually show.
   *
   * @param regionScores The region roll-up from `AccessScoreService`, one entry per region in the city.
   * @param completions  `region_completion` rows, the distance-based explored share per region.
   * @param computedAt   The run's timestamp, shared by every row it writes.
   * @return             One row per region, ready to insert.
   */
  def buildRegionRows(
      regionScores: Seq[RegionAccessScoreForApi],
      completions: Seq[NamedRegionCompletion],
      computedAt: OffsetDateTime
  ): Seq[RegionAccessScore] = {
    val completionByRegion: Map[Int, NamedRegionCompletion] = completions.map(c => c.regionId -> c).toMap
    regionScores.map { region =>
      val completion: Option[NamedRegionCompletion] = completionByRegion.get(region.regionId)
      // A region with no streets is vacuously complete, the same reading `/regions/completionRates` publishes; it
      // has no score either way, so it can never be ranked on the strength of that 1.0.
      val rate: Double = completion match {
        case Some(c) if c.totalDistance > 0 => math.min(1.0, math.max(0.0, c.auditedDistance / c.totalDistance))
        case Some(_)                        => 1.0
        case None                           => 0.0
      }
      RegionAccessScore(
        regionAccessScoreId = 0, // Assigned by the serial on insert.
        regionId = region.regionId,
        score = region.score,
        completionRate = rate,
        auditedDistanceM = completion.map(c => math.max(0.0, c.auditedDistance)).getOrElse(0.0),
        computedAt = computedAt
      )
    }
  }

  /**
   * Rolls the city's street edges up into one night's street rows: one per OSM way per region.
   *
   * A street edge is one block of an OSM way, so ranking edges would print "Rainier Ave S" a dozen times. Grouping
   * by way within a region gives the named stretch a reader recognizes, and keeps the row unambiguous in a city
   * where the same name runs through several neighborhoods. The group's score is the length-weighted mean of its
   * *explored* edges' scores — the unexplored ones are not evidence of anything — while its length is the whole
   * stretch, which is what tells a reader how much sidewalk the score speaks for. Its `street_edge_id` is the
   * longest edge, since that is what a click hands the AccessScore tool to open on.
   *
   * @param streets          Every street in the city, as `AccessScoreService` scored it.
   * @param validationCounts Validations per street edge, the first tie-break among equal scores.
   * @param computedAt       The run's timestamp, shared by every row it writes.
   * @param random           Seeded once per run, so the random half of the tie-break is stable for the day.
   * @return                 One row per (OSM way, region), ready to insert.
   */
  def buildStreetRows(
      streets: Seq[StreetAccessScoreForApi],
      validationCounts: Map[Int, Int],
      computedAt: OffsetDateTime,
      random: Random
  ): Seq[StreetAccessScore] = {
    streets
      .groupBy(street => (street.osmWayId, street.regionId))
      .toSeq
      // Sorted so a run's rows -- and therefore the tie-break numbers drawn for them -- don't depend on the hash
      // order of the map above.
      .sortBy { case ((osmWayId, regionId), _) => (osmWayId, regionId) }
      .map { case ((osmWayId, regionId), edges) =>
        val scored: Seq[(Double, Double)] = edges.flatMap(e => e.score.map(s => (s, math.max(0.0, e.lengthMeters))))
        val weight: Double                = scored.map(_._2).sum
        StreetAccessScore(
          streetAccessScoreId = 0, // Assigned by the serial on insert.
          osmWayId = osmWayId,
          regionId = regionId,
          streetEdgeId = edges.maxBy(_.lengthMeters).streetEdgeId,
          name = edges.flatMap(_.streetName).headOption,
          // Weighted by length where there is any, and a plain mean where every scored edge is zero-length, so a
          // degenerate geometry can't turn a real score into a division by zero.
          score =
            if (scored.isEmpty) None
            else if (weight > 0) Some(scored.map { case (s, l) => s * l }.sum / weight)
            else Some(scored.map(_._1).sum / scored.size),
          lengthM = edges.map(e => math.max(0.0, e.lengthMeters)).sum,
          auditCount = edges.map(_.auditCount).sum,
          clusterCount = edges.map(_.clusterCounts.values.sum).sum,
          validationCount = edges.map(e => validationCounts.getOrElse(e.streetEdgeId, 0)).sum,
          tieBreak = random.nextDouble(),
          computedAt = computedAt
        )
      }
  }

  /**
   * Orders ranked rows the way the module lists them and takes the first `n`.
   *
   * Score first; then, among equal scores, the most-validated row, since a well-checked street is the one worth
   * pointing at; then a stable key so two rows that are equal on both never swap between requests. A row with no
   * score never reaches here — [[regionQualifies]] and [[streetQualifies]] have already dropped it — so its score
   * sorts last defensively rather than meaningfully.
   *
   * @param rows       The qualifying rows.
   * @param descending Whether the highest score comes first ("Highest scores") or the lowest does.
   * @param n          How many rows to keep.
   * @return           The first `n` rows in that order.
   */
  def rank(rows: Seq[SpotlightRowForApi], descending: Boolean, n: Int): Seq[SpotlightRowForApi] = {
    val ordered =
      if (descending) rows.sortBy(row => (-row.score.getOrElse(Double.MinValue), -tieBreakVotes(row), stableKey(row)))
      else rows.sortBy(row => (row.score.getOrElse(Double.MaxValue), -tieBreakVotes(row), stableKey(row)))
    ordered.take(n)
  }

  /**
   * The regions closest to the completion floor, which is the module's "closest to being ranked" call to action.
   *
   * @param rows          Every region row of the snapshot.
   * @param minCompletion The completion floor.
   * @param n             How many to list.
   * @return              The non-qualifying regions, best-explored first.
   */
  def nearest(rows: Seq[RegionSpotlightRowForApi], minCompletion: Double, n: Int): Seq[RegionSpotlightRowForApi] =
    rows
      .filterNot(row => regionQualifies(row, minCompletion))
      .sortBy(row => (-row.completionRate, row.name, row.regionId))
      .take(n)

  /** Votes cast on a row's labels, the first tie-break; a region has no such count, so ties there fall to the key. */
  private def tieBreakVotes(row: SpotlightRowForApi): Int = row match {
    case street: StreetSpotlightRowForApi => street.validationCount
    case _                                => 0
  }

  /** A row's identity, so an order that is otherwise a tie is at least the same one on every request. */
  private def stableKey(row: SpotlightRowForApi): String = {
    val city = row.city.map(_.cityId).getOrElse("")
    row match {
      case region: RegionSpotlightRowForApi => s"$city:r:${region.regionId}"
      case street: StreetSpotlightRowForApi => s"$city:s:${street.osmWayId}:${street.regionId}"
    }
  }
}

/**
 * The AccessScore Spotlight's nightly snapshot and the feed the two pages read from it (#5215).
 *
 * The snapshot runs at the end of the clustering job, the only thing that moves a score, and writes
 * `region_access_score` and `street_access_score`. Everything a page asks for afterwards is a bounded read of those
 * tables — a landing page must never set a whole city's AccessScore recomputing — and the `/cities` scope is the
 * same read fanned out over every public deployment's schema, cached the way the other cross-city fan-outs are.
 */
@Singleton
class AccessScoreSpotlightService @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    accessScoreService: AccessScoreService,
    configService: ConfigService,
    labelTable: LabelTable,
    regionCompletionTable: RegionCompletionTable,
    regionAccessScoreTable: RegionAccessScoreTable,
    streetAccessScoreTable: StreetAccessScoreTable,
    swrCache: SwrCache
)(implicit ec: ExecutionContext)
    extends HasDatabaseConfigProvider[MyPostgresProfile] {
  import profile.api._

  private val logger = Logger(this.getClass)

  /**
   * Recomputes both snapshot tables from the clusters the run just built.
   *
   * Written in one transaction, so a failure leaves last night's snapshot standing rather than an empty table on a
   * live page. The scores come from the same roll-up `/v3/api/accessScoreRegions` publishes, computed fresh rather
   * than read from the request cache, which still holds the pre-clustering numbers at this point in the night.
   *
   * @return What was written, for the job's run record.
   */
  def recordSnapshot(): Future[SpotlightSnapshotResult] = {
    val computedAt = OffsetDateTime.now()
    for {
      (regionScores, scores) <- accessScoreService.computeCityWideScores(AccessScoreSpotlightService.BatchSize)
      completions            <- db.run(regionCompletionTable.getRegionCompletions(Seq.empty))
      validationCounts       <- db.run(labelTable.validationCountsByStreet)
      regionRows = AccessScoreSpotlight.buildRegionRows(regionScores, completions, computedAt)
      streetRows = AccessScoreSpotlight.buildStreetRows(
        scores.streets,
        validationCounts,
        computedAt,
        // Seeded from the run's own timestamp: the tie-break has to be one draw per run (stable all day, different
        // tomorrow), and nothing else about a run is both unique to it and reproducible from its rows.
        new Random(computedAt.toInstant.toEpochMilli)
      )
      written <- db.run(
        regionAccessScoreTable
          .insertSnapshot(regionRows)
          .zip(streetAccessScoreTable.replaceSnapshot(streetRows))
          .transactionally
      )
    } yield {
      logger.info(s"AccessScore Spotlight snapshot: ${written._1} region rows, ${written._2} street rows")
      SpotlightSnapshotResult(regions = written._1, streets = written._2)
    }
  }

  /**
   * The Spotlight feed for this deployment.
   *
   * @param unit Which unit to rank, one of [[models.api.SpotlightUnit]].
   * @param n    How many rows each list holds.
   * @return     The response the endpoint publishes.
   */
  def getSpotlight(unit: String, n: Int): Future[AccessScoreSpotlightForApi] =
    if (unit == SpotlightUnit.Streets) streetSpotlight(n, None, None).map(_._1) else regionSpotlight(n)

  /**
   * The Spotlight feed across every public deployment, cached like the other cross-city fan-outs.
   *
   * Each city is queried in parallel and a city whose query fails is dropped with a warning rather than sinking the
   * page, the same bargain `getCityScorecards` makes. `computed_at` comes back as the *oldest* contributing run, so
   * "updated nightly, last at …" is true of every row rather than only the freshest city's.
   *
   * @param unit Which unit to rank.
   * @param n    How many rows each list holds.
   * @param lang The language the city names are wanted in.
   * @return     The response the endpoint publishes; `nearest` is always empty here.
   */
  def getCrossCitySpotlight(unit: String, n: Int, lang: Lang): Future[AccessScoreSpotlightForApi] = {
    swrCache.staleWhileRevalidate[AccessScoreSpotlightForApi](
      s"accessScoreSpotlight:cities:${unit}_${n}_${lang.code}",
      CrossCityFreshFor,
      CrossCityMaxAge
    ) {
      configService.getAccessScoreSpotlightScope(lang).flatMap { cities =>
        val perCity: Seq[Future[Option[(Seq[SpotlightRowForApi], Int, Int, Option[OffsetDateTime])]]] = cities.map {
          case (city, schema) =>
            val spotlightCity = SpotlightCityForApi(city.cityId, city.cityNameShort, city.URL)
            val rows: Future[(Seq[SpotlightRowForApi], Int, Int, Option[OffsetDateTime])] =
              if (unit == SpotlightUnit.Streets) {
                streetSpotlight(n, Some(schema), Some(spotlightCity)).map { case (response, _) =>
                  (response.top ++ response.bottom, response.qualifying, response.total, response.computedAt)
                }
              } else {
                db.run(regionAccessScoreTable.getLatestSnapshot(Some(schema)))
                  .zip(
                    db.run(regionAccessScoreTable.latestComputedAt(Some(schema)))
                  )
                  .map { case (snapshot, computedAt) =>
                    val withCity   = snapshot.map(_.copy(city = Some(spotlightCity)))
                    val qualifying = withCity.filter(row => AccessScoreSpotlight.regionQualifies(row))
                    (qualifying, qualifying.size, withCity.size, computedAt)
                  }
              }
            rows.map(Some(_)).recover { case e: Exception =>
              logger.warn(s"AccessScore Spotlight skipped city ${city.cityId} (schema $schema): ${e.getMessage}")
              None
            }
        }

        Future.sequence(perCity).map { results =>
          val contributing = results.flatten
          val candidates   = contributing.flatMap(_._1)
          AccessScoreSpotlightForApi(
            unit = unit,
            minCompletion = AccessScoreSpotlight.MinRegionCompletion,
            qualifying = contributing.map(_._2).sum,
            total = contributing.map(_._3).sum,
            computedAt = contributing.flatMap(_._4).sortBy(_.toInstant).headOption,
            top = AccessScoreSpotlight.rank(candidates, descending = true, n),
            bottom = AccessScoreSpotlight.rank(candidates, descending = false, n),
            nearest = Seq.empty
          )
        }
      }
    }
  }

  /** This deployment's region feed: the whole latest snapshot, ranked and sliced in one place. */
  private def regionSpotlight(n: Int): Future[AccessScoreSpotlightForApi] = {
    for {
      snapshot   <- db.run(regionAccessScoreTable.getLatestSnapshot(None))
      computedAt <- db.run(regionAccessScoreTable.latestComputedAt(None))
    } yield {
      val qualifying = snapshot.filter(row => AccessScoreSpotlight.regionQualifies(row))
      AccessScoreSpotlightForApi(
        unit = SpotlightUnit.Regions,
        minCompletion = AccessScoreSpotlight.MinRegionCompletion,
        qualifying = qualifying.size,
        total = snapshot.size,
        computedAt = computedAt,
        top = AccessScoreSpotlight.rank(qualifying, descending = true, n),
        bottom = AccessScoreSpotlight.rank(qualifying, descending = false, n),
        // Only when the ranked lists can't be filled: otherwise the module has a top and a bottom to show and the
        // "help the next one across the line" ask has nowhere to go.
        nearest =
          if (qualifying.size >= n) Seq.empty
          else AccessScoreSpotlight.nearest(snapshot, AccessScoreSpotlight.MinRegionCompletion, n)
      )
    }
  }

  /**
   * A street feed, for this schema or another city's.
   *
   * @param n      How many rows each list holds.
   * @param schema The city schema to read, None for this deployment's own.
   * @param city   The deployment to stamp on each row, under the cross-city scope.
   * @return       The response, and the raw snapshot slice behind it.
   */
  private def streetSpotlight(
      n: Int,
      schema: Option[String],
      city: Option[SpotlightCityForApi]
  ): Future[(AccessScoreSpotlightForApi, StreetSpotlightSnapshot)] = {
    db.run(
      streetAccessScoreTable.getSpotlight(
        n,
        AccessScoreSpotlight.MinStreetLengthMeters,
        AccessScoreSpotlight.MinStreetClusters,
        schema
      )
    ).map { snapshot =>
      val stamp: Seq[StreetSpotlightRowForApi] => Seq[SpotlightRowForApi] =
        rows => city.fold[Seq[SpotlightRowForApi]](rows)(c => rows.map(_.copy(city = Some(c))))
      val response = AccessScoreSpotlightForApi(
        unit = SpotlightUnit.Streets, minCompletion = AccessScoreSpotlight.MinRegionCompletion,
        qualifying = snapshot.qualifying, total = snapshot.total, computedAt = snapshot.computedAt,
        top = stamp(snapshot.top), bottom = stamp(snapshot.bottom),
        // A street has no "closest to being ranked" call to action: the ask is always "explore this neighborhood",
        // which is what the regions unit already offers.
        nearest = Seq.empty
      )
      (response, snapshot)
    }
  }
}

object AccessScoreSpotlightService {

  /**
   * The job name the nightly snapshot records its run under.
   *
   * Its own record rather than part of clustering's, for the same reason the intersection rebuild has one: the
   * snapshot is deliberately recovered rather than propagated, so a clustering run that reports success would
   * otherwise say nothing about whether the tables the landing page reads were actually rewritten.
   */
  val JobName: String = "access-score-snapshot"

  /** DB fetch size for the cluster stream the snapshot is computed from, matching the API's own default. */
  val BatchSize: Int = 25000

  /** How stale this deployment's own feed may be before a request triggers a background recompute. */
  val FreshFor: FiniteDuration = 10.minutes
}
