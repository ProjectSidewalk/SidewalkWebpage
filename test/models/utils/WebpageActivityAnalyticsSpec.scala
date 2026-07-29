package models.utils

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder
import play.api.db.slick.DatabaseConfigProvider
import models.utils.MyPostgresProfile.api._

import scala.concurrent.Await
import scala.concurrent.duration._

/**
 * Integration tests for the v3 API analytics query methods on WebpageActivityTable.
 *
 * These tests run the SQL against the live Postgres+PostGIS database (empty or seeded) and verify
 * that the queries execute without error and return the correct types. The dev DB may have no matching
 * rows in webpage_activity for v3 API paths, so we accept empty sequences — the goal is to exercise
 * the query code paths and confirm SPLIT_PART / REGEXP_MATCH syntax is accepted by the DB.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class WebpageActivityAnalyticsSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder()
      .disable[modules.ActorModule]
      .build()

  private lazy val table: WebpageActivityTable = app.injector.instanceOf[WebpageActivityTable]

  private val dbConfig                   = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
  private def run[T](action: DBIO[T]): T = Await.result(dbConfig.db.run(action), 10.seconds)

  "WebpageActivityTable.getApiEndpointCounts" should {
    "execute without error and return a Seq[ApiEndpointCount] when excluding apiDocs (last 30 days)" in {
      val results = run(table.getApiEndpointCounts(excludeApiDocs = true, days = 30))
      results mustBe a[Seq[_]]
      // All entries must have non-empty endpoint strings and non-negative counts.
      results.foreach { row =>
        row.endpoint must not be empty
        row.count must be >= 0L
      }
    }

    "execute without error when including apiDocs traffic (all time)" in {
      val results = run(table.getApiEndpointCounts(excludeApiDocs = false, days = 0))
      results mustBe a[Seq[_]]
    }
  }

  "WebpageActivityTable.getApiUniqueIpCount" should {
    "return a non-negative Long" in {
      val count = run(table.getApiUniqueIpCount(excludeApiDocs = true, days = 30))
      count must be >= 0L
    }
  }

  // The source-split queries power the redesigned admin API Analytics page; every row's source must be one of the two
  // known tags so the dashboard can pivot it into external/apiDocs columns.
  private val validSources = Set("external", "apiDocs")

  "WebpageActivityTable.getApiEndpointCountsBySource" should {
    "execute and tag every row with a known source and non-negative count" in {
      val results = run(table.getApiEndpointCountsBySource(days = 0))
      results mustBe a[Seq[_]]
      results.foreach { row =>
        row.endpoint must not be empty
        validSources must contain(row.source)
        row.count must be >= 0L
      }
    }
  }

  "WebpageActivityTable.getApiDailyCountsBySource" should {
    "execute, tag every row with a known source, and return dates in ascending order" in {
      val results = run(table.getApiDailyCountsBySource(days = 90))
      results mustBe a[Seq[_]]
      results.foreach(row => validSources must contain(row.source))
      val dates = results.map(_.date)
      dates mustBe dates.sorted
    }
  }

  "WebpageActivityTable.getApiFormatCountsBySource" should {
    "execute and tag every row with a known source" in {
      val results = run(table.getApiFormatCountsBySource(days = 30))
      results mustBe a[Seq[_]]
      results.foreach { row =>
        row.format must not be empty
        validSources must contain(row.source)
      }
    }
  }

  "WebpageActivityTable.getApiUniqueIpCountsBySource" should {
    "execute, return at most one row per source, with non-negative distinct counts" in {
      val results = run(table.getApiUniqueIpCountsBySource(days = 0))
      results mustBe a[Seq[_]]
      results.foreach { row =>
        validSources must contain(row.source)
        row.uniqueIps must be >= 0L
      }
      results.map(_.source).distinct.size mustBe results.size // No duplicate source rows.
    }
  }
}
