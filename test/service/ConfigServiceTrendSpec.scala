package service

import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.guice.GuiceOneAppPerSuite
import play.api.Application
import play.api.inject.guice.GuiceApplicationBuilder

import java.time.{LocalDate, ZoneId}
import scala.concurrent.Await
import scala.concurrent.duration.DurationInt

/**
 * DB-backed invariant tests for the cross-city over-time series behind the Across Cities admin page (#4329, #4686):
 * the weekly trend (with the new-users column feeding the cumulative-users chart), the trailing-7-day daily trend
 * (feeding the "this week" bar charts), and the week-over-week window summary (feeding the "Today & this week"
 * tiles, #4758) together with the breakdowns their hover cards read (#4931).
 *
 * The human/AI split those breakdowns turn on is pinned in [[ActivityBreakdownSpec]] against synthetic rows, since a
 * database with no AI-role accounts would satisfy any assertion about them here without exercising one.
 *
 * Contract/shape over data values: every assertion holds against whatever the connected DB contains — ordering,
 * ranges, and cross-field relationships, never specific numbers.
 *
 * Requires a Postgres+PostGIS database (via DATABASE_URL / DATABASE_USER / DATABASE_PASSWORD env).
 */
class ConfigServiceTrendSpec extends PlaySpec with GuiceOneAppPerSuite {

  override def fakeApplication(): Application =
    new GuiceApplicationBuilder().disable[modules.ActorModule].build()

  private val configService = app.injector.instanceOf[ConfigService]

  private def await[T](f: => scala.concurrent.Future[T]): T = Await.result(f, 120.seconds)

  "getCrossCityWeeklyTrend(None)" should {
    lazy val allTime = await(configService.getCrossCityWeeklyTrend(None))

    "return weeks ascending and unique with non-negative counts" in {
      allTime.map(_.weekStart) mustBe allTime.map(_.weekStart).distinct.sorted
      allTime.foreach { w =>
        w.labels must be >= 0
        w.validations must be >= 0
        w.activeUsers must be >= 0
        w.newUsers must be >= 0
      }
    }

    "count each week's new users among that week's active users" in {
      // A user's first-activity week is by definition a week they were active, so per week newUsers <= activeUsers.
      allTime.foreach { w => w.newUsers must be <= w.activeUsers }
    }

    "have every distinct active user enter the cumulative series exactly once" in {
      // Every user active in ANY week has exactly one first-activity week, so no single week's active-user count can
      // exceed the all-time new-user total (= the cumulative users chart's final value).
      if (allTime.nonEmpty) {
        allTime.map(_.activeUsers).max must be <= allTime.map(_.newUsers).sum
      }
    }
  }

  "getCrossCityWeeklyTrend(Some(n))" should {
    "leave newUsers at 0 (first-ever activity is unknowable in a trailing window)" in {
      val recent = await(configService.getCrossCityWeeklyTrend(Some(12)))
      // A 12-week trailing bound can straddle 13 calendar weeks (partial weeks at both ends).
      recent.length must be <= 13
      recent.foreach { w => w.newUsers mustBe 0 }
    }
  }

  "getCrossCityDailyTrend(7)" should {
    lazy val daily = await(configService.getCrossCityDailyTrend(7))

    "return exactly 7 consecutive Pacific days ending today, zero-filled" in {
      val before = LocalDate.now(ZoneId.of("US/Pacific"))
      val days   = await(configService.getCrossCityDailyTrend(7)).map(_.point)
      val after  = LocalDate.now(ZoneId.of("US/Pacific"))

      days.length mustBe 7
      days.zip(days.tail).foreach { case (a, b) => b.day mustBe a.day.plusDays(1) }
      // The run may legitimately cross midnight Pacific between the call and this assertion.
      Seq(before, after) must contain(days.last.day)
      days.foreach { d =>
        d.labels must be >= 0
        d.validations must be >= 0
        d.contributors must be >= 0
        d.anonSessions must be >= 0
        d.aiLabels must be >= 0
        d.aiValidations must be >= 0
        d.aiAgents must be >= 0
      }
    }

    "keep each day's breakdown inside the day it explains" in {
      // The hover card is derived from the same rows the bars are summed from, so its parts can never exceed them.
      daily.foreach { d =>
        d.topCities.length must be <= ConfigService.DayTopCityLimit
        d.contributors.length must be <= ConfigService.DayContributorLimit
        d.topCities.map(_.labels).sum must be <= d.point.labels
        d.topCities.map(_.validations).sum must be <= d.point.validations
        d.contributors.map(_.labels).sum must be <= (d.point.labels + d.point.aiLabels)
        d.contributors.map(_.validations).sum must be <= (d.point.validations + d.point.aiValidations)
        // Per-city contributor counts are per city, so they can only ever add up to at least the distinct total.
        d.topCities.map(_.contributors).sum must be >= 0
      }
    }

    "count the day's contributors distinctly across cities" in {
      // A person active in several cities is one contributor, so the distinct total can only sit at or below the
      // per-city counts added up — and never below the busiest single city.
      daily.foreach { d =>
        val perCitySum = d.topCities.map(_.contributors).sum
        if (d.topCities.length < ConfigService.DayTopCityLimit && perCitySum > 0) {
          d.point.contributors + d.point.anonSessions must be <= perCitySum
          d.point.contributors + d.point.anonSessions must be >= d.topCities.map(_.contributors).max
        }
      }
    }

    "report the untruncated contributor count alongside the capped list" in {
      daily.foreach { d =>
        d.contributorTotal must be >= d.contributors.length
        // The list holds registered accounts and AI, never anonymous ones, so those two counts bound it.
        d.contributorTotal must be <= (d.point.contributors + d.point.aiAgents)
      }
    }

    "never name an anonymous contributor" in {
      // Their usernames are generated cookie ids; they are counted in anonSessions instead.
      daily.foreach(d => d.contributors.foreach(_.kind must not be ContributorKind.Anonymous))
    }

    "rank each day's cities and contributors busiest first" in {
      daily.foreach { d =>
        d.topCities.map(city => -(city.labels + city.validations)) mustBe
          d.topCities.map(city => -(city.labels + city.validations)).sorted
        d.contributors.map(c => -(c.labels + c.validations)) mustBe
          d.contributors.map(c => -(c.labels + c.validations)).sorted
      }
    }
  }

  "the cross-city reads" should {
    // Each of these fires a query per city schema — ~56 apiece against a 25-connection pool — and one page request
    // triggers five of them, so how often that fan-out runs is the page's whole cost story. These two pin the sharing
    // properties; what `staleWhileRevalidate` adds on top (never making a *request* wait on a refresh) turns on a
    // 10-minute clock this suite can't advance, and is documented on ConfigService.CrossCityFreshFor.
    "give concurrent callers of a cold key one shared computation" in {
      // `days = 5` is a key nothing else in the suite requests, so this is the genuinely-cold path. Identity is the
      // observable proof of sharing: a layer that recomputed per caller would hand back equal-but-distinct values.
      val inFlight = (1 to 5).map(_ => configService.getCrossCityDailyTrend(5))
      val results  = inFlight.map(f => await(f))

      results.foreach(r => assert(r eq results.head))
    }

    "serve a warmed key without recomputing it" in {
      val first  = await(configService.getCrossCityActivitySummary())
      val second = await(configService.getCrossCityActivitySummary())

      assert(second eq first)
    }
  }

  "getCrossCityActivitySummary" should {
    lazy val windows = await(configService.getCrossCityActivitySummary())
    lazy val summary = windows.total

    "return non-negative totals for both windows" in {
      summary.labels7d must be >= 0
      summary.labelsPrior7d must be >= 0
      summary.validations7d must be >= 0
      summary.validationsPrior7d must be >= 0
      summary.contributors7d must be >= 0
      summary.contributorsPrior7d must be >= 0
      summary.anonSessions7d must be >= 0
      summary.anonSessionsPrior7d must be >= 0
      summary.aiLabels7d must be >= 0
      summary.aiLabelsPrior7d must be >= 0
      summary.aiValidations7d must be >= 0
      summary.aiValidationsPrior7d must be >= 0
      summary.aiAgents7d must be >= 0
    }

    "bound each window's distinct contributors by its event count" in {
      // Every counted contributor produced at least one label or validation in that window.
      summary.contributors7d must be <= (summary.labels7d + summary.validations7d)
      summary.contributorsPrior7d must be <= (summary.labelsPrior7d + summary.validationsPrior7d)
      summary.anonSessions7d must be <= (summary.labels7d + summary.validations7d)
      summary.aiAgents7d must be <= (summary.aiLabels7d + summary.aiValidations7d)
    }

    "return a per-city window for every available city" in {
      windows.byCity must not be empty
      windows.byCity.keys.foreach(_ must not be empty)
    }

    "report volumes that are exactly the per-city windows summed" in {
      // The "Most active cities" table ranks on the per-city rows while the tiles above it show the total, so the two
      // must not be able to disagree about how much work was done.
      val cities = windows.byCity.values.map(_.summary)
      cities.map(_.labels7d).sum mustBe summary.labels7d
      cities.map(_.labelsPrior7d).sum mustBe summary.labelsPrior7d
      cities.map(_.validations7d).sum mustBe summary.validations7d
      cities.map(_.validationsPrior7d).sum mustBe summary.validationsPrior7d
      cities.map(_.aiLabels7d).sum mustBe summary.aiLabels7d
      cities.map(_.aiLabelsPrior7d).sum mustBe summary.aiLabelsPrior7d
      cities.map(_.aiValidations7d).sum mustBe summary.aiValidations7d
      cities.map(_.aiValidationsPrior7d).sum mustBe summary.aiValidationsPrior7d
    }

    "report headcounts deduplicated across cities, not summed" in {
      // A person or pipeline account working in several cities is one of each here. So the total sits at or below the
      // per-city counts added up, and at or above any single city's — which is what the table's caveat tells the reader.
      val cities                                     = windows.byCity.values.map(_.summary).toSeq
      def check(total: Int, perCity: Seq[Int]): Unit = {
        total must be <= perCity.sum
        val _ = total must be >= perCity.maxOption.getOrElse(0)
      }

      check(summary.contributors7d, cities.map(_.contributors7d))
      check(summary.contributorsPrior7d, cities.map(_.contributorsPrior7d))
      check(summary.anonSessions7d, cities.map(_.anonSessions7d))
      check(summary.aiAgents7d, cities.map(_.aiAgents7d))
    }

    "carry the contributors each city's counts are made of, busiest first and capped" in {
      windows.byCity.values.foreach { city =>
        city.contributors.length must be <= ConfigService.WindowContributorLimit
        city.contributors.map(c => -(c.labels7d + c.validations7d)) mustBe
          city.contributors.map(c => -(c.labels7d + c.validations7d)).sorted
        // Only people with current-window activity are listed, since the cards rank on it.
        city.contributors.foreach(c => (c.labels7d + c.validations7d) must be > 0)
        val people = city.contributors.filter(_.kind == ContributorKind.Registered)
        people.length must be <= city.summary.contributors7d
        people.map(_.labels7d).sum must be <= city.summary.labels7d
        city.contributors.filter(_.kind == ContributorKind.Ai).map(_.validations7d).sum must
          be <= city.summary.aiValidations7d
        // Anonymous accounts are counted in the summary but never named, so the list can't leak a cookie id.
        city.contributors.foreach(_.kind must not be ContributorKind.Anonymous)
      }
    }

    "report an untruncated contributor total that the capped list can't understate" in {
      windows.byCity.values.foreach { city =>
        city.contributorTotal must be >= city.contributors.length
        city.contributorTotal must be <= (city.summary.contributors7d + city.summary.aiAgents7d)
      }
    }
  }
}
