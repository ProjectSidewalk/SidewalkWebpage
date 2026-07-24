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
 * the weekly trend (with the new-users column feeding the cumulative-users chart) and the trailing-7-day daily trend
 * (feeding the "this week" bar charts).
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
    "return exactly 7 consecutive Pacific days ending today, zero-filled" in {
      val before = LocalDate.now(ZoneId.of("US/Pacific"))
      val daily  = await(configService.getCrossCityDailyTrend(7))
      val after  = LocalDate.now(ZoneId.of("US/Pacific"))

      daily.length mustBe 7
      daily.zip(daily.tail).foreach { case (a, b) => b.day mustBe a.day.plusDays(1) }
      // The run may legitimately cross midnight Pacific between the call and this assertion.
      Seq(before, after) must contain(daily.last.day)
      daily.foreach { d =>
        d.labels must be >= 0
        d.validations must be >= 0
        d.activeUsers must be >= 0
      }
    }
  }
}
