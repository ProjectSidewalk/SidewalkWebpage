package models.utils

import models.label.LabelType
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.db.slick.DatabaseConfigProvider
import play.api.inject.guice.GuiceApplicationBuilder
import models.utils.MyPostgresProfile.api.*
import models.api.AggregateStats
import service.{CityScorecard, ConfigService}
import util.SidewalkSpec

import java.time.{LocalDate, ZoneId}
import java.time.temporal.ChronoUnit
import scala.concurrent.Await
import scala.concurrent.duration.*

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
class CityScorecardSpec extends SidewalkSpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    GuiceApplicationBuilder()
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

  // The rest of the cross-city surface runs raw SQL against "#$schema".* and was otherwise untested — the same gap
  // that let the dropped-column bug ship. Smoke-test each against the live current-city schema so a dropped/renamed
  // column or enum-type mismatch fails the build here instead of silently blanking a city on the Across Cities page.
  "ConfigTable cross-city BySchema queries" should {
    "execute getCityMapParamsBySchema" in {
      run(configTable.getCityMapParamsBySchema(schema)) mustBe a[MapParams]
    }
    "execute getCityAggregateDataBySchema" in {
      run(configTable.getCityAggregateDataBySchema(schema)) mustBe a[AggregateStats]
    }
    "execute getContributorUserIdsBySchema" in {
      run(configTable.getContributorUserIdsBySchema(schema)) mustBe a[Seq[?]]
    }
    "report every label type in the scorecard's per-type breakdown, zero counts included" in {
      // The per-type query LEFT JOINs labels onto the full type list so a type with no labels still gets a row.
      run(configTable.getCityScorecardBySchema(schema)).byLabelType.keySet mustBe LabelType.labelTypeNames
    }
    "execute getCityWeeklyTrendBySchema (all-time and windowed)" in {
      run(configTable.getCityWeeklyTrendBySchema(schema, None)) mustBe a[Seq[?]]
      run(configTable.getCityWeeklyTrendBySchema(schema, Some(4))) mustBe a[Seq[?]]
    }
    "execute getCityWindowActivityByUserBySchema" in {
      run(configTable.getCityWindowActivityByUserBySchema(schema)) mustBe a[Seq[?]]
    }
    "execute getCityDailyActivityByUserBySchema" in {
      run(configTable.getCityDailyActivityByUserBySchema(schema, 7)) mustBe a[Seq[?]]
    }
    "execute getCityDailyBaselineBySchema" in {
      run(configTable.getCityDailyBaselineBySchema(schema, 365)) mustBe a[Seq[?]]
    }
    // The baseline's SQL collapses anonymous and AI rows that the bars' query keeps per person, so the only proof the
    // two still count the same things is running both over the same data. A window reaching back to 2010 covers the
    // whole seeded history, and the guard below keeps an empty schema from passing this vacuously.
    "count the baseline on exactly the daily bars' basis" in {
      val today = LocalDate.now(ZoneId.of("US/Pacific"))
      val days  = ChronoUnit.DAYS.between(LocalDate.of(2010, 1, 1), today).toInt
      val bars  = run(configTable.getCityDailyActivityByUserBySchema(schema, days)).map(currentCityId -> _)
      val base  = run(configTable.getCityDailyBaselineBySchema(schema, days)).map(currentCityId -> _)
      bars must not be empty

      val window   = (1 to days).map(i => today.minusDays(i.toLong))
      val byDay    = bars.groupBy(_._2.day)
      val points   = window.map(day => ConfigService.summarizeDay(day, byDay.getOrElse(day, Seq.empty)).point)
      val baseline = ConfigService.summarizeBaseline(today, days, base)
      baseline.labelsPerDay * days mustBe points.map(_.labels).sum.toDouble +- 1e-6
      baseline.validationsPerDay * days mustBe points.map(_.validations).sum.toDouble +- 1e-6
      baseline.contributorsPerDay * days mustBe points.map(_.contributors).sum.toDouble +- 1e-6
    }
    "execute getCityContributorOutputBySchema" in {
      run(configTable.getCityContributorOutputBySchema(schema)) mustBe a[Product] // 7-tuple
    }
    "execute getCityLabelingSpeedBySchema" in {
      run(configTable.getCityLabelingSpeedBySchema(schema)) mustBe a[Product] // (Double, Double)
    }
    "execute getCityDailyLabelStatsBySchema (both quality filters)" in {
      run(configTable.getCityDailyLabelStatsBySchema(schema, filterLowQuality = false)) mustBe a[Seq[?]]
      run(configTable.getCityDailyLabelStatsBySchema(schema, filterLowQuality = true)) mustBe a[Seq[?]]
    }
    "execute getCityDailyValidationStatsBySchema" in {
      run(configTable.getCityDailyValidationStatsBySchema(schema, filterLowQuality = false)) mustBe a[Seq[?]]
    }
  }
}
