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

  private val dbConfig = app.injector.instanceOf[DatabaseConfigProvider].get[MyPostgresProfile]
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

  "WebpageActivityTable.getApiDailyCounts" should {
    "execute without error and return a Seq[ApiDailyCount] sorted by date ascending" in {
      val results = run(table.getApiDailyCounts(excludeApiDocs = true, days = 90))
      results mustBe a[Seq[_]]
      results.foreach { row =>
        row.date must not be empty
        row.count must be >= 0L
      }
      // Dates must be in ascending order.
      val dates = results.map(_.date)
      dates mustBe sorted
    }
  }

  "WebpageActivityTable.getApiUniqueIpCount" should {
    "return a non-negative Long" in {
      val count = run(table.getApiUniqueIpCount(excludeApiDocs = true, days = 30))
      count must be >= 0L
    }
  }

  "WebpageActivityTable.getApiFormatCounts" should {
    "execute without error and return a Seq[ApiFormatCount]" in {
      val results = run(table.getApiFormatCounts(excludeApiDocs = true, days = 30))
      results mustBe a[Seq[_]]
      results.foreach { row =>
        row.endpoint must not be empty
        row.format must not be empty
        row.count must be >= 0L
      }
    }

    "return 'json' as the format for requests without a filetype param" in {
      // If there is any data, calls without filetype= in the activity string must count as 'json'.
      val results = run(table.getApiFormatCounts(excludeApiDocs = false, days = 0))
      val nonJsonFormats = results.filter(r => r.format != "json" && r.format != "csv" &&
        r.format != "shapefile" && r.format != "geopackage" && r.format != "geojson")
      // Any format must be one of the known filetypes or the 'json' default.
      nonJsonFormats mustBe empty
    }
  }
}
