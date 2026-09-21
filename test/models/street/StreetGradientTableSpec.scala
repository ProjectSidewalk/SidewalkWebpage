package models.street

import models.utils.MyPostgresProfile.api._
import org.scalatest.OptionValues
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import util.{RolledBackDb, StreetFixtures}

/**
 * Reads `street_gradient` rows back through the Slick model (#5223).
 *
 * The app never writes this table (an offline script does), so nothing else would notice the model drifting from
 * 398.sql: a renamed column, an enum label the Scala side cannot parse, or the `INTEGER[]` profile failing to map.
 * Every case seeds its own rows inside a rolled-back transaction; CI's schema starts with none.
 *
 * Requires a Postgres database (DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD, as in dev/CI).
 */
class StreetGradientTableSpec
    extends PlaySpec
    with GuiceOneAppPerSuite
    with RolledBackDb
    with StreetFixtures
    with OptionValues {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private lazy val table: StreetGradientTable = app.injector.instanceOf[StreetGradientTable]
  private lazy val served                     = app.injector.instanceOf[StreetEdgeTable].streets.map(_.streetEdgeId)

  private val Md5 = "0123456789abcdef0123456789abcdef"

  /** Seeds a `measured` row sampled from a 10 m model, with a three-sample profile. */
  private def insertMeasured(streetEdgeId: Int, demSource: String = "usgs-3dep-10m"): DBIO[Int] =
    sqlu"""INSERT INTO street_gradient (street_edge_id, quality, confidence, net_grade, mean_grade, max_grade,
                                        meters_over_5pct_grade, meters_over_8pct_grade, climb_m, descent_m,
                                        elev_start_m, elev_end_m, profile_cm, dem_source, dem_resolution_m, geom_md5,
                                        max_grade_from_m, max_grade_to_m)
           VALUES ($streetEdgeId, 'measured', 'high', -0.04, 0.06, 0.09, 40, 10, 1.5, 5.5, 104.0, 100.0,
                   ARRAY[10400, 10150, 10000], $demSource, 10, $Md5, 20, 50)"""

  /** Seeds a `structure` row: endpoint elevations and no grade, as 398.sql's CHECK requires. */
  private def insertStructure(streetEdgeId: Int): DBIO[Int] =
    sqlu"""INSERT INTO street_gradient (street_edge_id, quality, confidence, elev_start_m, elev_end_m, dem_source,
                                        dem_resolution_m, geom_md5)
           VALUES ($streetEdgeId, 'structure', 'high', 12.0, 12.5, 'usgs-3dep-10m', 10, $Md5)"""

  "StreetGradientTable.getForStreet" should {
    "map every column of a measured row, the INTEGER[] profile included" in {
      val row = runRolledBack(for {
        id  <- insertStreet()
        _   <- insertMeasured(id)
        row <- table.getForStreet(id)
      } yield row).value

      row.stats.quality mustBe StreetGradientQuality.Measured
      row.stats.confidence mustBe StreetGradientConfidence.High
      row.stats.netGrade.value mustBe -0.04
      row.stats.meanGrade.value mustBe 0.06
      row.stats.maxGrade.value mustBe 0.09
      row.stats.metersOver5pctGrade.value mustBe 40.0
      row.stats.metersOver8pctGrade.value mustBe 10.0
      row.stats.climbM.value mustBe 1.5
      row.stats.descentM.value mustBe 5.5
      row.stats.elevStartM.value mustBe 104.0
      row.stats.elevEndM.value mustBe 100.0
      row.stats.demSource mustBe "usgs-3dep-10m"
      row.stats.demResolutionM mustBe 10.0
      row.profileCm.value mustBe List(10400, 10150, 10000)
      row.maxGradeFromM.value mustBe 20.0
      row.maxGradeToM.value mustBe 50.0
      row.geomMd5 mustBe Md5
    }

    "read a structure's NULL statistics and NULL profile as None" in {
      val row = runRolledBack(for {
        id  <- insertStreet()
        _   <- insertStructure(id)
        row <- table.getForStreet(id)
      } yield row).value

      row.stats.quality mustBe StreetGradientQuality.Structure
      row.stats.meanGrade mustBe None
      row.stats.netGrade mustBe None
      row.stats.elevStartM.value mustBe 12.0
      row.profileCm mustBe None
      row.maxGradeFromM mustBe None
    }

    "return None for a street that has not been sampled" in {
      runRolledBack(insertStreet().flatMap(table.getForStreet)) mustBe None
    }
  }

  "StreetGradientTable.isStale" should {

    /** Seeds a measured row carrying the street's real geometry hash, as the sampler writes it. */
    def insertCurrent(streetEdgeId: Int): DBIO[Int] =
      sqlu"""INSERT INTO street_gradient (street_edge_id, quality, confidence, net_grade, elev_start_m, elev_end_m,
                                          dem_source, dem_resolution_m, geom_md5)
             SELECT $streetEdgeId, 'measured', 'low', 0.01, 10, 11, 'spec-dem', 30, md5(ST_AsBinary(geom))
             FROM street_edge
             WHERE street_edge_id = $streetEdgeId"""

    "be false while the street's geometry is the one that was sampled" in {
      runRolledBack(for {
        id    <- insertStreet()
        _     <- insertCurrent(id)
        stale <- table.isStale(id)
      } yield stale) mustBe Some(false)
    }

    "turn true once the street's geometry is edited" in {
      runRolledBack(for {
        id <- insertStreet()
        _  <- insertCurrent(id)
        _  <- sqlu"""UPDATE street_edge
                        SET geom = ST_SetSRID(ST_MakeLine(ST_MakePoint(0, 0), ST_MakePoint(2, 0)), 4326)
                        WHERE street_edge_id = $id"""
        stale <- table.isStale(id)
      } yield stale) mustBe Some(true)
    }

    "be None for a street that has not been sampled" in {
      runRolledBack(insertStreet().flatMap(table.isStale)) mustBe None
    }
  }

  "StreetGradientTable.getStats" should {
    "key the sampled streets by id and leave an unsampled one out" in {
      val (sampled, unsampled, stats) = runRolledBack(for {
        a     <- insertStreet()
        b     <- insertStreet()
        _     <- insertMeasured(a)
        stats <- table.getStats(Seq(a, b))
      } yield (a, b, stats))

      stats.keySet mustBe Set(sampled)
      stats(sampled).streetEdgeId mustBe sampled
      stats.get(unsampled) mustBe None
    }

    "answer an empty id list without a query" in {
      run(table.getStats(Seq.empty)) mustBe empty
    }
  }

  "StreetGradientTable.sourceCounts" should {
    "count streets per elevation model, the most-used model first" in {
      // Deltas against whatever the connected city already holds, so the case reads the same on a sampled dev DB.
      val (before, after) = runRolledBack(for {
        before <- table.sourceCounts(served)
        a      <- insertStreet()
        b      <- insertStreet()
        c      <- insertStreet()
        hidden <- insertStreet(status = "no_imagery")
        _      <- insertMeasured(a, "spec-dem-major")
        _      <- insertMeasured(b, "spec-dem-major")
        _      <- insertMeasured(c, "spec-dem-minor")
        _      <- insertMeasured(hidden, "spec-dem-minor")
        after  <- table.sourceCounts(served)
      } yield (before.toMap, after))

      before.get("spec-dem-major") mustBe None
      after.toMap.apply("spec-dem-major") mustBe 2
      // The no_imagery street's row is left out: no street API serves that street.
      after.toMap.apply("spec-dem-minor") mustBe 1
      after.map(_._1).indexOf("spec-dem-major") must be < after.map(_._1).indexOf("spec-dem-minor")
      after.map(_._2) mustBe after.map(_._2).sorted.reverse
    }
  }

  "the Postgres enum types behind street_gradient" should {
    def labelsOf(typeName: String): Set[String] = run(
      sql"""SELECT enumlabel
            FROM pg_enum
            JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
            WHERE pg_type.typname = $typeName
                AND pg_type.typnamespace = current_schema()::regnamespace""".as[String]
    ).toSet

    "match StreetGradientQuality exactly" in {
      labelsOf("street_gradient_quality") mustBe StreetGradientQuality.values.map(_.toString)
    }

    "match StreetGradientConfidence exactly" in {
      labelsOf("street_gradient_confidence") mustBe StreetGradientConfidence.values.map(_.toString)
    }
  }
}
