package models.region

import com.google.inject.ImplementedBy
import models.api.RegionSpotlightRowForApi
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import slick.jdbc.GetResult

import java.time.{OffsetDateTime, ZoneOffset}
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

/**
 * One neighborhood's AccessScore as of one nightly clustering run (#5215).
 *
 * Rows accumulate: a region gets one per run, which is a score history for free at a few dozen rows a night. Reads
 * always take the newest `computed_at`.
 *
 * @param regionAccessScoreId Surrogate key.
 * @param regionId            The region scored.
 * @param score               Its AccessScore in [0, 1], None when none of its streets has been explored.
 * @param completionRate      The share of its street length explored, `region_completion`'s distance-based number —
 *                            the one the landing choropleth colors, not the AccessScore API's street-count coverage.
 * @param auditedDistanceM    How many meters of its street length have been explored.
 * @param computedAt          When the run that wrote this row produced it.
 */
case class RegionAccessScore(
    regionAccessScoreId: Int,
    regionId: Int,
    score: Option[Double],
    completionRate: Double,
    auditedDistanceM: Double,
    computedAt: OffsetDateTime
)

class RegionAccessScoreTableDef(tag: Tag) extends Table[RegionAccessScore](tag, "region_access_score") {
  def regionAccessScoreId: Rep[Int] = column[Int]("region_access_score_id", O.PrimaryKey, O.AutoInc)
  def regionId: Rep[Int]            = column[Int]("region_id")
  // CHECK (score BETWEEN 0 AND 1) in the DB (no Slick DSL for CHECK constraints); same for the two below.
  def score: Rep[Option[Double]]      = column[Option[Double]]("score")
  def completionRate: Rep[Double]     = column[Double]("completion_rate")
  def auditedDistanceM: Rep[Double]   = column[Double]("audited_distance_m")
  def computedAt: Rep[OffsetDateTime] = column[OffsetDateTime]("computed_at")

  def * = (regionAccessScoreId, regionId, score, completionRate, auditedDistanceM, computedAt) <> (
    (RegionAccessScore.apply _).tupled,
    RegionAccessScore.unapply
  )

  def region = foreignKey("region_access_score_region_id_fkey", regionId, TableQuery[RegionTableDef])(
    _.regionId,
    onDelete = ForeignKeyAction.Cascade
  )

  def runIdx = index("region_access_score_region_id_computed_at_key", (regionId, computedAt), unique = true)
}

@ImplementedBy(classOf[RegionAccessScoreTable])
trait RegionAccessScoreTableRepository {

  /**
   * Records one nightly run's region scores. Old runs are kept.
   *
   * @param rows One row per region in the city, including the ones with no score yet.
   * @return     How many rows were written.
   */
  def insertSnapshot(rows: Seq[RegionAccessScore]): DBIO[Int]

  /**
   * Every region of the newest recorded run, with its name, for the Spotlight module.
   *
   * Returns the whole snapshot rather than a pre-sliced top/bottom: a city has at most a few hundred regions, and
   * ranking them in Scala is what lets one tested comparator serve both this city and the cross-city merge.
   *
   * @param schema The city schema to read, or None for this deployment's own (resolved by `search_path`).
   * @return       One row per region, in no particular order; empty before the first run.
   */
  def getLatestSnapshot(schema: Option[String] = None): DBIO[Seq[RegionSpotlightRowForApi]]

  /**
   * When the newest recorded run produced its rows, or None before the first run.
   *
   * @param schema The city schema to read, or None for this deployment's own.
   */
  def latestComputedAt(schema: Option[String] = None): DBIO[Option[OffsetDateTime]]
}

/**
 * Reads and writes the nightly per-region AccessScore snapshot behind the Spotlight module (#5215).
 *
 * The read is raw SQL because the Spotlight's `/cities` scope runs the very same query against every other
 * deployment's schema, and a schema name can't be a bind parameter in a Slick lifted query. The schema is spliced
 * in; it comes from `city-params`, never from a request.
 */
@Singleton
class RegionAccessScoreTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit
    ec: ExecutionContext
) extends RegionAccessScoreTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  val regionAccessScores = TableQuery[RegionAccessScoreTableDef]

  implicit private val rowResult: GetResult[RegionSpotlightRowForApi] = GetResult { r =>
    RegionSpotlightRowForApi(
      regionId = r.nextInt(), name = r.nextString(), score = r.nextDoubleOption(), completionRate = r.nextDouble(),
      auditedDistanceM = r.nextDouble()
    )
  }

  def insertSnapshot(rows: Seq[RegionAccessScore]): DBIO[Int] =
    (regionAccessScores ++= rows).map(_.getOrElse(rows.size))

  def getLatestSnapshot(schema: Option[String]): DBIO[Seq[RegionSpotlightRowForApi]] = {
    val scores  = RegionAccessScoreTable.qualified(schema, "region_access_score")
    val regions = RegionAccessScoreTable.qualified(schema, "region")
    // The subquery is a single-row MAX over an indexed column, so it is evaluated once rather than per row.
    sql"""
      SELECT region_access_score.region_id,
             region.name,
             region_access_score.score,
             region_access_score.completion_rate,
             region_access_score.audited_distance_m
      FROM #$scores AS region_access_score
      INNER JOIN #$regions AS region ON region_access_score.region_id = region.region_id
      WHERE region_access_score.computed_at = (SELECT MAX(computed_at) FROM #$scores)
        AND region.deleted = FALSE
    """.as[RegionSpotlightRowForApi]
  }

  def latestComputedAt(schema: Option[String]): DBIO[Option[OffsetDateTime]] = {
    val scores = RegionAccessScoreTable.qualified(schema, "region_access_score")
    sql"SELECT MAX(computed_at) FROM #$scores"
      .as[Option[java.sql.Timestamp]]
      .head
      .map(_.map(_.toInstant.atOffset(ZoneOffset.UTC)))
  }
}

object RegionAccessScoreTable {

  /**
   * Names a table in another city's schema, or in the connection's own when no schema is given.
   *
   * @param schema The schema to read, e.g. "sidewalk_seattle"; None leaves the name bare for `search_path`.
   * @param table  The table name.
   * @return       The name to splice into raw SQL.
   */
  def qualified(schema: Option[String], table: String): String =
    schema.map(s => s""""$s".$table""").getOrElse(table)
}
