package models.street

import com.google.inject.ImplementedBy
import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}

import java.time.OffsetDateTime
import javax.inject.{Inject, Singleton}
import scala.concurrent.ExecutionContext

/**
 * How a street's elevation profile was obtained, backing the `street_gradient_quality` Postgres enum type (#5223).
 *
 * `Measured` rows carry sampled statistics; a `Structure` (bridge, tunnel, covered way) carries its two endpoint
 * elevations and no grade; a `Suspect` row's statistics come from a straight line between its ends, or are absent;
 * `NoData` rows carry nothing. docs/street-gradient.md has the rules.
 *
 * NOTE: if changing these values, update the `street_gradient_quality` Postgres enum type as well (see 398.sql).
 */
object StreetGradientQuality extends Enumeration {
  type StreetGradientQuality = Value
  val Measured: Value  = Value("measured")
  val Structure: Value = Value("structure")
  val Suspect: Value   = Value("suspect")
  val NoData: Value    = Value("no_data")
}

/**
 * How far a street's grade can be trusted, a function of the elevation model's grid size, backing the
 * `street_gradient_confidence` Postgres enum type (#5223).
 *
 * NOTE: if changing these values, update the `street_gradient_confidence` Postgres enum type as well (see 398.sql).
 */
object StreetGradientConfidence extends Enumeration {
  type StreetGradientConfidence = Value
  val High: Value   = Value("high")
  val Medium: Value = Value("medium")
  val Low: Value    = Value("low")
}

/**
 * A street's slope statistics without its elevation profile: what a city-wide payload carries per street (#5223).
 *
 * Grades are fractions (0.05 is a 5% grade). Every statistic is optional because a `structure` or `no_data` row has
 * none, and a coarse-model row has `netGrade` alone (the CHECK constraints in 398.sql say which go together).
 *
 * @param streetEdgeId        The street.
 * @param quality             How the profile was obtained.
 * @param confidence          How far the grade can be trusted, from the model's grid size.
 * @param netGrade            End-to-end grade, signed in the street's digitized direction.
 * @param meanGrade           Mean absolute grade over every 10 m baseline.
 * @param maxGrade            Steepest absolute grade over any 30 m baseline (10 m on a street under 30 m).
 * @param metersOver5pctGrade Length of street steeper than 1:20 (5%).
 * @param metersOver8pctGrade Length of street steeper than 1:12 (8.33%; the column is named for the round figure).
 * @param climbM              Summed rise in the digitized direction, in meters.
 * @param descentM            Summed fall in the digitized direction, in meters.
 * @param elevStartM          Elevation at the first vertex, in meters.
 * @param elevEndM            Elevation at the last vertex, in meters.
 * @param demSource           Name of the elevation model, which attribution is keyed on.
 * @param demResolutionM      The model's grid size in meters.
 */
case class StreetGradientStats(
    streetEdgeId: Int,
    quality: StreetGradientQuality.Value,
    confidence: StreetGradientConfidence.Value,
    netGrade: Option[Double],
    meanGrade: Option[Double],
    maxGrade: Option[Double],
    metersOver5pctGrade: Option[Double],
    metersOver8pctGrade: Option[Double],
    climbM: Option[Double],
    descentM: Option[Double],
    elevStartM: Option[Double],
    elevEndM: Option[Double],
    demSource: String,
    demResolutionM: Double
)

object StreetGradientStats {

  /** The ADA / PROWAG running-slope limit for a walking surface, 1:20. `metersOver5pctGrade` is measured against it. */
  val WalkingSurfaceLimit: Double = 0.05

  /** The ADA / PROWAG running-slope limit for a ramp, 1:12 (8.33%). `metersOver8pctGrade` is measured against it. */
  val RampLimit: Double = 1.0 / 12.0

  /**
   * The grades a slope map is classed at, ascending: a street under the first reads as level, one over the last as
   * steeper than any accessible ramp. The two ADA / PROWAG limits sit between 1:48 (2.08%, the most a surface may
   * slope and still count as level) and 1:8 (12.5%, the steepest ramp the ADA tolerates anywhere, and only over a
   * 75 mm rise), so each class boundary is one a reader can look up.
   */
  val MapClassBreaks: Seq[Double] = Seq(1.0 / 48.0, WalkingSurfaceLimit, RampLimit, 1.0 / 8.0)

  /**
   * A grade as the percentage a page states it by, to two decimals with no trailing zeros: 0.05 is "5%", 1/12 is
   * "8.33%". For the pages that quote these constants, so each reads them off the engine and formats them one way.
   */
  def percentLabel(grade: Double): String = {
    val text = f"${grade * 100}%.2f"
    (if (text.contains('.')) text.reverse.dropWhile(_ == '0').dropWhile(_ == '.').reverse else text) + "%"
  }
}

/**
 * A full `street_gradient` row: the statistics plus the elevation profile and the sampling bookkeeping.
 *
 * @param stats     The statistics, as the city-wide payload carries them.
 * @param profileCm Elevations in whole centimeters at even spacing from the first vertex to the last, so the spacing
 *                  is the street's length over one less than the list's length. None wherever `meanGrade` is.
 * @param geomMd5   `md5(ST_AsBinary(geom))` of the street when it was sampled, for the staleness test.
 * @param sampledAt When the row was sampled.
 * @param maxGradeFromM Where the baseline that set `maxGrade` starts, in meters from the first vertex. It is read off
 *                      the full-resolution samples, which `profileCm` is too coarse to reproduce. None where no
 *                      stretch set `maxGrade` (a suspect row's straight line, a maximum floored at the mean).
 * @param maxGradeToM   Where that baseline ends; None exactly when `maxGradeFromM` is, and never before it (a CHECK
 *                      in 398.sql holds both, and holds them to rows that have a `maxGrade`).
 */
case class StreetGradient(
    stats: StreetGradientStats,
    profileCm: Option[List[Int]],
    geomMd5: String,
    sampledAt: OffsetDateTime,
    maxGradeFromM: Option[Double] = None,
    maxGradeToM: Option[Double] = None
)

class StreetGradientTableDef(tag: Tag) extends Table[StreetGradient](tag, "street_gradient") {
  def streetEdgeId: Rep[Int]                          = column[Int]("street_edge_id", O.PrimaryKey)
  def quality: Rep[StreetGradientQuality.Value]       = column[StreetGradientQuality.Value]("quality")
  def confidence: Rep[StreetGradientConfidence.Value] = column[StreetGradientConfidence.Value]("confidence")
  def netGrade: Rep[Option[Double]]                   = column[Option[Double]]("net_grade")
  def meanGrade: Rep[Option[Double]]                  = column[Option[Double]]("mean_grade")
  def maxGrade: Rep[Option[Double]]                   = column[Option[Double]]("max_grade")
  def metersOver5pctGrade: Rep[Option[Double]]        = column[Option[Double]]("meters_over_5pct_grade")
  def metersOver8pctGrade: Rep[Option[Double]]        = column[Option[Double]]("meters_over_8pct_grade")
  def climbM: Rep[Option[Double]]                     = column[Option[Double]]("climb_m")
  def descentM: Rep[Option[Double]]                   = column[Option[Double]]("descent_m")
  def elevStartM: Rep[Option[Double]]                 = column[Option[Double]]("elev_start_m")
  def elevEndM: Rep[Option[Double]]                   = column[Option[Double]]("elev_end_m")
  def profileCm: Rep[Option[List[Int]]]               = column[Option[List[Int]]]("profile_cm")
  def demSource: Rep[String]                          = column[String]("dem_source")
  def demResolutionM: Rep[Double]                     = column[Double]("dem_resolution_m")
  def geomMd5: Rep[String]                            = column[String]("geom_md5")
  def sampledAt: Rep[OffsetDateTime]                  = column[OffsetDateTime]("sampled_at")
  def maxGradeFromM: Rep[Option[Double]]              = column[Option[Double]]("max_grade_from_m")
  def maxGradeToM: Rep[Option[Double]]                = column[Option[Double]]("max_grade_to_m")

  /** The statistics alone, so a city-wide read never pulls every street's profile array across the wire. */
  def stats = (
    streetEdgeId, quality, confidence, netGrade, meanGrade, maxGrade, metersOver5pctGrade, metersOver8pctGrade, climbM,
    descentM, elevStartM, elevEndM, demSource, demResolutionM
  ) <> ((StreetGradientStats.apply _).tupled, StreetGradientStats.unapply)

  def * = (stats, profileCm, geomMd5, sampledAt, maxGradeFromM, maxGradeToM) <> (
    (StreetGradient.apply _).tupled,
    StreetGradient.unapply
  )

  def streetEdge =
    foreignKey("street_gradient_street_edge_id_fkey", streetEdgeId, TableQuery[StreetEdgeTableDef])(_.streetEdgeId)
}

@ImplementedBy(classOf[StreetGradientTable]) trait StreetGradientTableRepository {}

/**
 * Read-only DAO for the street_gradient table (#5223).
 *
 * The app never writes this table: its elevations come from rasters the database never sees, so an offline script
 * (scripts/street_gradient.py) samples them and db/scripts/import-street-gradient.sh upserts the result.
 */
@Singleton
class StreetGradientTable @Inject() (protected val dbConfigProvider: DatabaseConfigProvider)(implicit
    ec: ExecutionContext
) extends StreetGradientTableRepository
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  import profile.api._
  val streetGradients = TableQuery[StreetGradientTableDef]

  /**
   * Slope statistics for each of the given streets, without their profiles.
   *
   * `inSet` inlines the ids rather than binding them: the AccessScore API passes a whole city's streets, and pgjdbc
   * caps a statement at 65,535 parameters, as `StreetEdgeTable.getStreetLengths` already works around. For that
   * whole-city call the id list filters nothing out, and an unfiltered read would be cheaper; it is kept because the
   * same method serves a bbox of a few streets, where reading a city's rows to keep a dozen would not be, and the
   * whole-city result is cached for ten minutes anyway.
   *
   * @param streetEdgeIds The streets to look up.
   * @return Map from street_edge_id to its statistics; a street that has not been sampled is absent.
   */
  def getStats(streetEdgeIds: Seq[Int]): DBIO[Map[Int, StreetGradientStats]] = {
    if (streetEdgeIds.isEmpty) DBIO.successful(Map.empty[Int, StreetGradientStats])
    else
      streetGradients
        .filter(_.streetEdgeId inSet streetEdgeIds)
        .map(_.stats)
        .result
        .map(_.map(s => s.streetEdgeId -> s).toMap)
  }

  /**
   * One street's full row, profile included.
   *
   * @param streetEdgeId The street to look up.
   * @return The row, or None if the street has not been sampled.
   */
  def getForStreet(streetEdgeId: Int): DBIO[Option[StreetGradient]] =
    streetGradients.filter(_.streetEdgeId === streetEdgeId).result.headOption

  /**
   * Whether a street's geometry has changed since it was sampled, by the same `geom_md5` comparison the export
   * script tops the table up with. A stale row still describes a real profile, of the line the street used to
   * follow: its samples no longer sit at even spacing along the current one. Asked a street at a time, since the
   * hash is computed per row.
   *
   * @param streetEdgeId The street to check.
   * @return Some(true) if the street has moved since, Some(false) if not, None if it has no gradient row.
   */
  def isStale(streetEdgeId: Int): DBIO[Option[Boolean]] =
    sql"""SELECT street_gradient.geom_md5 <> md5(ST_AsBinary(street_edge.geom))
          FROM street_gradient
          JOIN street_edge ON street_edge.street_edge_id = street_gradient.street_edge_id
          WHERE street_gradient.street_edge_id = $streetEdgeId""".as[Boolean].headOption

  /**
   * The elevation models this city's rows were sampled from, with how many streets each covers.
   *
   * @return (dem_source, street count) pairs, most streets first, so the city's main source leads a credit line.
   */
  def sourceCounts: DBIO[Seq[(String, Int)]] =
    streetGradients.groupBy(_.demSource).map { case (source, rows) => (source, rows.length) }.result.map {
      _.sortBy { case (source, count) => (-count, source) }
    }
}
