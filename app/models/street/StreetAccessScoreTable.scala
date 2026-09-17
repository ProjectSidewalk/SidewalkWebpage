package models.street

import com.google.inject.ImplementedBy
import models.api.StreetSpotlightRowForApi
import models.region.{RegionAccessScoreTable, RegionTableDef}
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

/**
 * One named stretch of street's AccessScore as of one nightly clustering run (#5215).
 *
 * The unit is an OSM way inside one region, not a street edge: an edge is a block of a way, so "Rainier Ave S" is a
 * dozen of them and a dozen identical rows would be a useless list. Unlike [[models.region.RegionAccessScore]] this
 * table is replaced by each run rather than accumulated — a big city has thousands of ways, and a daily history of
 * those is millions of rows a year that nothing reads.
 *
 * @param streetAccessScoreId Surrogate key.
 * @param osmWayId            The OSM way.
 * @param regionId            The region its edges fall in.
 * @param streetEdgeId        The group's longest edge, the one a click opens the AccessScore tool on.
 * @param name                The way's OSM name, None for an unnamed way.
 * @param score               Length-weighted AccessScore of its explored edges, None when none is explored.
 * @param lengthM             The whole stretch's length in meters, explored or not.
 * @param auditCount          Completed audits across its edges.
 * @param clusterCount        Scored label clusters along it.
 * @param validationCount     Validations cast on its labels, the first tie-break among equal scores.
 * @param tieBreak            A per-run random number in [0, 1), the second tie-break — seeded per run so a list of
 *                            streets that all score the same stays in one order for the day.
 * @param computedAt          When the run that wrote this row produced it.
 */
case class StreetAccessScore(
    streetAccessScoreId: Int,
    osmWayId: Long,
    regionId: Int,
    streetEdgeId: Int,
    name: Option[String],
    score: Option[Double],
    lengthM: Double,
    auditCount: Int,
    clusterCount: Int,
    validationCount: Int,
    tieBreak: Double,
    computedAt: OffsetDateTime
)

/**
 * The bounded slice of a street snapshot the Spotlight endpoint needs (#5215).
 *
 * @param qualifying How many stretches cleared every bar.
 * @param total      How many stretches the city has in all.
 * @param computedAt When the run that produced them finished, None before the first run.
 * @param top        The highest-scoring qualifying stretches, best first.
 * @param bottom     The lowest-scoring qualifying stretches, worst first.
 */
case class StreetSpotlightSnapshot(
    qualifying: Int,
    total: Int,
    computedAt: Option[OffsetDateTime],
    top: Seq[StreetSpotlightRowForApi],
    bottom: Seq[StreetSpotlightRowForApi]
)

class StreetAccessScoreTableDef(tag: Tag) extends Table[StreetAccessScore](tag, "street_access_score") {
  def streetAccessScoreId: Rep[Int] = column[Int]("street_access_score_id", O.PrimaryKey, O.AutoInc)
  def osmWayId: Rep[Long]           = column[Long]("osm_way_id")
  def regionId: Rep[Int]            = column[Int]("region_id")
  def streetEdgeId: Rep[Int]        = column[Int]("street_edge_id")
  def name: Rep[Option[String]]     = column[Option[String]]("name")
  // CHECK (score BETWEEN 0 AND 1) in the DB (no Slick DSL for CHECK constraints); the counts and length are
  // CHECKed non-negative and tie_break CHECKed to [0, 1).
  def score: Rep[Option[Double]]      = column[Option[Double]]("score")
  def lengthM: Rep[Double]            = column[Double]("length_m")
  def auditCount: Rep[Int]            = column[Int]("audit_count")
  def clusterCount: Rep[Int]          = column[Int]("cluster_count")
  def validationCount: Rep[Int]       = column[Int]("validation_count")
  def tieBreak: Rep[Double]           = column[Double]("tie_break")
  def computedAt: Rep[OffsetDateTime] = column[OffsetDateTime]("computed_at")

  def * = (streetAccessScoreId, osmWayId, regionId, streetEdgeId, name, score, lengthM, auditCount, clusterCount,
    validationCount, tieBreak, computedAt) <> (
    (StreetAccessScore.apply _).tupled,
    StreetAccessScore.unapply
  )

  def region = foreignKey("street_access_score_region_id_fkey", regionId, TableQuery[RegionTableDef])(
    _.regionId,
    onDelete = ForeignKeyAction.Cascade
  )

  def streetEdge =
    foreignKey("street_access_score_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(
      _.streetEdgeId,
      onDelete = ForeignKeyAction.Cascade
    )

  def runIdx =
    index("street_access_score_osm_way_id_region_id_computed_at_key", (osmWayId, regionId, computedAt), unique = true)
}

@ImplementedBy(classOf[StreetAccessScoreTable])
trait StreetAccessScoreTableRepository {

  /**
   * Replaces the whole table with one nightly run's rows.
   *
   * Compose inside a transaction, so a failed run leaves yesterday's snapshot rather than an empty table.
   *
   * @param rows One row per OSM way per region in the city, including the ones nobody has explored.
   * @return     How many rows were written.
   */
  def replaceSnapshot(rows: Seq[StreetAccessScore]): DBIO[Int]

  /**
   * The newest run's highest- and lowest-scoring qualifying stretches, plus what they were drawn from.
   *
   * @param n            How many rows each list holds.
   * @param minLengthM   The length floor a stretch must clear to be ranked.
   * @param minClusters  The cluster floor, which a stretch with no clusters at all also satisfies (see
   *                     `service.AccessScoreSpotlight.streetQualifies`).
   * @param schema       The city schema to read, or None for this deployment's own.
   * @return             The bounded slice; empty lists and zero counts before the first run.
   */
  def getSpotlight(
      n: Int,
      minLengthM: Double,
      minClusters: Int,
      schema: Option[String] = None
  ): DBIO[StreetSpotlightSnapshot]
}

/**
 * Reads and writes the nightly per-street-stretch AccessScore snapshot behind the Spotlight module (#5215).
 *
 * Raw SQL for the same reason as [[models.region.RegionAccessScoreTable]]: the `/cities` scope runs these queries
 * against every other deployment's schema, and a schema name can't be a bind parameter. The schema comes from
 * `city-params`, never from a request.
 */
@Singleton
class StreetAccessScoreTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit
    ec: ExecutionContext
) extends StreetAccessScoreTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val streetAccessScores = TableQuery[StreetAccessScoreTableDef]

  implicit private val rowResult: GetResult[StreetSpotlightRowForApi] = GetResult { r =>
    StreetSpotlightRowForApi(
      osmWayId = r.nextLong(), streetEdgeId = r.nextInt(), regionId = r.nextInt(), regionName = r.nextString(),
      name = r.nextStringOption(), score = r.nextDoubleOption(), lengthM = r.nextDouble(), clusterCount = r.nextInt(),
      validationCount = r.nextInt()
    )
  }

  def replaceSnapshot(rows: Seq[StreetAccessScore]): DBIO[Int] =
    streetAccessScores.delete.andThen(streetAccessScores ++= rows).map(_.getOrElse(rows.size))

  def getSpotlight(
      n: Int,
      minLengthM: Double,
      minClusters: Int,
      schema: Option[String]
  ): DBIO[StreetSpotlightSnapshot] = {
    val scores  = RegionAccessScoreTable.qualified(schema, "street_access_score")
    val regions = RegionAccessScoreTable.qualified(schema, "region")

    // A stretch is ranked once it has been explored, is long enough for a score to describe anything, and either
    // carries enough labeled evidence or carries none at all -- the "somebody walked it and found nothing" case. The
    // same rule in Scala is `service.AccessScoreSpotlight.streetQualifies`, which the cross-city merge reuses.
    val counts = sql"""
      SELECT COUNT(*),
             COUNT(*) FILTER (
               WHERE street_access_score.score IS NOT NULL
                 AND street_access_score.audit_count > 0
                 AND street_access_score.length_m >= $minLengthM
                 AND (street_access_score.cluster_count >= $minClusters OR street_access_score.cluster_count = 0)
             ),
             MAX(street_access_score.computed_at)
      FROM #$scores AS street_access_score
      WHERE street_access_score.computed_at = (SELECT MAX(computed_at) FROM #$scores)
    """.as[(Int, Int, Option[java.sql.Timestamp])].head

    // `direction` is a literal this file supplies, never a request value.
    def ranked(direction: String) = sql"""
      SELECT street_access_score.osm_way_id,
             street_access_score.street_edge_id,
             street_access_score.region_id,
             region.name,
             street_access_score.name,
             street_access_score.score,
             street_access_score.length_m,
             street_access_score.cluster_count,
             street_access_score.validation_count
      FROM #$scores AS street_access_score
      INNER JOIN #$regions AS region ON street_access_score.region_id = region.region_id
      WHERE street_access_score.computed_at = (SELECT MAX(computed_at) FROM #$scores)
        AND region.deleted = FALSE
        AND street_access_score.score IS NOT NULL
        AND street_access_score.audit_count > 0
        AND street_access_score.length_m >= $minLengthM
        AND (street_access_score.cluster_count >= $minClusters OR street_access_score.cluster_count = 0)
      ORDER BY street_access_score.score #$direction,
               street_access_score.validation_count DESC,
               street_access_score.tie_break ASC
      LIMIT $n
    """.as[StreetSpotlightRowForApi]

    for {
      (total, qualifying, computedAt) <- counts
      top                             <- if (qualifying > 0) ranked("DESC") else DBIO.successful(Vector.empty)
      bottom                          <- if (qualifying > 0) ranked("ASC") else DBIO.successful(Vector.empty)
    } yield StreetSpotlightSnapshot(
      qualifying = qualifying, total = total, computedAt = computedAt.map(_.toInstant.atOffset(ZoneOffset.UTC)),
      top = top, bottom = bottom
    )
  }
}
