package models.utils

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import models.utils.MyPostgresProfile.api._
import service.CityScorecard

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Integration test for the Across-Cities scorecard query on ConfigTable.
 *
 * `getCityScorecardBySchema` is a large per-city aggregate assembled as raw SQL against a `"#$schema".*`
 * fan-out. Its street-availability filters must stay in sync with the `street_edge` schema — streets are
 * filtered by the `street_edge_status` enum (`status = 'open'`, #3888), not by any scalar flag. Running the
 * query against the live current-city schema (which has the enum applied) means a dropped or renamed column
 * surfaces as a build failure here rather than as a silently-dropped city on the Owner-only page (where
 * `ConfigService.getCityScorecards` swallows the per-city failure in a `.recover`).
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class CityScorecardSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  private lazy val configTable: ConfigTable = app.injector.instanceOf[ConfigTable]

  private val dbConfig                   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 30.seconds)

  // Resolve the current city's schema the same way ConfigService.getCitySchema does; this schema has all
  // evolutions applied, so it exercises the query against the current street_edge_status schema.
  private val currentCityId = app.configuration.get[String]("city-id")
  private val schema        = app.configuration.get[String](s"city-params.db-schema.$currentCityId")

  "ConfigTable.getCityScorecardBySchema" should {
    "execute against the live schema without referencing a nonexistent column" in {
      // Pre-fix this threw `column "deleted" does not exist` on any schema migrated to the status enum.
      val scorecard = run(configTable.getCityScorecardBySchema(schema))
      scorecard mustBe a[CityScorecard]
    }

    "return internally-consistent street coverage counts" in {
      val sc = run(configTable.getCityScorecardBySchema(schema))
      sc.totalStreets must be >= 0
      sc.auditedStreets must be >= 0
      // The open-only filter on the numerator exists precisely so audited can't exceed total (coverage <= 100%).
      sc.auditedStreets must be <= sc.totalStreets
      sc.totalKm must be >= 0.0
      sc.auditedKm must be >= 0.0
      sc.auditedKm must be <= (sc.totalKm + 0.001) // Float tolerance; audited length can't exceed total length.
      sc.coverage must be >= 0.0
      sc.coverage must be <= 100.0
    }
  }
}
