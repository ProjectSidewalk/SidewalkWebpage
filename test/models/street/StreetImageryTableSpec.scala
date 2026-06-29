package models.street

import models.utils.MyPostgresProfile
import models.utils.MyPostgresProfile.api._
import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import slick.dbio.DBIO

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * DB-backed contract test for the street_imagery table (#4348) and its read-only DAO.
 *
 * Booting the app applies evolution 326, which creates street_imagery and backfills it from pano_data (Feeder 1). This
 * spec asserts the table exists and is queryable through StreetImageryTable, and that the backfill's invariants hold for
 * whatever rows the connected DB produced (oldest <= newest, a recognized data_source, a non-negative pano count). It
 * asserts shape/invariants, not data values, so it passes against an empty DB too.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env, as in dev/CI). The
 * eager scheduling actors are disabled so they don't fire background work during the test.
 */
class StreetImageryTableSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val streetImageryTable = app.injector.instanceOf[StreetImageryTable]
  // Keep the DatabaseConfig as a stable val and call .db.run inline; binding .db to its own val would infer a
  // path-dependent existential type that needs -language:existentials.
  private val dbConfig                   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 60.seconds)

  private val validSources = Set("pano_data", "imagery_scan")

  "street_imagery (evolution 326) + StreetImageryTable" should {
    "exist and be countable through the DAO" in {
      run(streetImageryTable.count) must be >= 0
    }

    "hold the backfill invariants for every row" in {
      val rows: Seq[StreetImagery] = run(streetImageryTable.streetImageryRecords.result)
      rows.foreach { row =>
        row.nPanos must be >= 0
        validSources must contain(row.dataSource)
        // Where both endpoints of the capture-date range are known, oldest must not be after newest.
        (row.oldestCapture, row.newestCapture) match {
          case (Some(oldest), Some(newest)) => oldest.isAfter(newest) mustBe false
          case _                            => // a one-sided or absent range has nothing to compare
        }
      }
    }

    "round-trip an existing street through getForStreet" in {
      run(streetImageryTable.streetImageryRecords.result.headOption) match {
        case Some(expected) => run(streetImageryTable.getForStreet(expected.streetEdgeId)) mustBe Some(expected)
        case None           => succeed // No imagery rows in this DB; nothing to round-trip.
      }
    }
  }
}
