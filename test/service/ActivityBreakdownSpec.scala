package service

import org.scalatestplus.play.PlaySpec

import java.time.LocalDate

/**
 * Unit tests for the two pure rollups behind the Across Cities "Today & this week" section (#4931): the rolling
 * weekly windows and the daily breakdown the bar hover cards read.
 *
 * These are the rules that keep AI output from being read as community activity, so they are pinned against
 * synthetic rows rather than against whatever the connected database happens to hold — a dev or CI database with no
 * AI-role accounts would pass every AI assertion without exercising one. No DB, no app boot.
 */
class ActivityBreakdownSpec extends PlaySpec {

  private val day = LocalDate.of(2026, 8, 12)

  private def person(id: String, labels7d: Int, validations7d: Int, priorLabels: Int = 0, priorVals: Int = 0) =
    ContributorWindowActivity(id, s"user-$id", isAi = false, labels7d, priorLabels, validations7d, priorVals)

  private def agent(id: String, labels7d: Int, validations7d: Int, priorLabels: Int = 0, priorVals: Int = 0) =
    ContributorWindowActivity(id, s"ai-$id", isAi = true, labels7d, priorLabels, validations7d, priorVals)

  private def dayRow(cityId: String, id: String, labels: Int, validations: Int, isAi: Boolean = false) =
    cityId -> DailyContributorActivity(day, id, if (isAi) s"ai-$id" else s"user-$id", isAi, labels, validations)

  "ActivityWindowSummary.fromContributors" should {
    "keep AI output out of the label and validation counts" in {
      val summary = ActivityWindowSummary.fromContributors(
        Seq(person("a", 10, 4), person("b", 5, 1), agent("bot", 900, 8000))
      )

      summary.labels7d mustBe 15
      summary.validations7d mustBe 5
      summary.aiLabels7d mustBe 900
      summary.aiValidations7d mustBe 8000
    }

    "count people as contributors and AI accounts as agents" in {
      val summary = ActivityWindowSummary.fromContributors(
        Seq(person("a", 10, 0), person("b", 0, 3), agent("bot", 0, 8000))
      )

      summary.contributors7d mustBe 2
      summary.aiAgents7d mustBe 1
    }

    "split the prior window on the same rule as the current one" in {
      val summary = ActivityWindowSummary.fromContributors(
        Seq(person("a", 2, 2, priorLabels = 7, priorVals = 3), agent("bot", 1, 1, priorLabels = 40, priorVals = 60))
      )

      summary.labelsPrior7d mustBe 7
      summary.validationsPrior7d mustBe 3
      summary.aiLabelsPrior7d mustBe 40
      summary.aiValidationsPrior7d mustBe 60
      summary.contributorsPrior7d mustBe 1
    }

    "leave someone active only in the prior window out of the current window's contributors" in {
      val summary = ActivityWindowSummary.fromContributors(Seq(person("gone", 0, 0, priorLabels = 12)))

      summary.contributors7d mustBe 0
      summary.contributorsPrior7d mustBe 1
    }

    "return an empty window for a city with no activity" in {
      ActivityWindowSummary.fromContributors(Seq.empty) mustBe ActivityWindowSummary.empty
    }
  }

  "ActivityWindowSummary.add" should {
    "sum every field, so per-city windows roll up into the cross-city total" in {
      val a     = ActivityWindowSummary.fromContributors(Seq(person("a", 3, 4, 1, 2), agent("bot", 5, 6, 7, 8)))
      val b     = ActivityWindowSummary.fromContributors(Seq(person("b", 30, 40, 10, 20)))
      val total = ActivityWindowSummary.add(a, b)

      total.labels7d mustBe 33
      total.validations7d mustBe 44
      total.labelsPrior7d mustBe 11
      total.validationsPrior7d mustBe 22
      total.aiLabels7d mustBe 5
      total.aiValidationsPrior7d mustBe 8
      total.contributors7d mustBe 2
      total.aiAgents7d mustBe 1
    }
  }

  "ConfigService.summarizeDay" should {
    "report the day's human volumes and its AI output separately" in {
      val summary = ConfigService.summarizeDay(
        day,
        Seq(dayRow("seattle-wa", "a", 12, 3), dayRow("seattle-wa", "bot", 0, 4000, isAi = true))
      )

      summary.point.labels mustBe 12
      summary.point.validations mustBe 3
      summary.point.activeUsers mustBe 1
      summary.point.aiValidations mustBe 4000
      summary.point.aiAgents mustBe 1
    }

    "count a person active in two cities once per city, matching the bar's counting basis" in {
      val summary =
        ConfigService.summarizeDay(day, Seq(dayRow("seattle-wa", "a", 5, 0), dayRow("chicago-il", "a", 7, 0)))

      summary.point.activeUsers mustBe 2
      summary.point.labels mustBe 12
    }

    "merge that same person into one contributor line with their cities added up" in {
      val summary =
        ConfigService.summarizeDay(day, Seq(dayRow("seattle-wa", "a", 5, 1), dayRow("chicago-il", "a", 7, 2)))

      summary.contributors.map(_.username) mustBe Seq("user-a")
      summary.contributors.head.labels mustBe 12
      summary.contributors.head.validations mustBe 3
    }

    "rank cities by what people did there, leaving AI output out of the ordering" in {
      val summary = ConfigService.summarizeDay(
        day,
        Seq(
          dayRow("quiet-city", "bot", 9000, 0, isAi = true),
          dayRow("quiet-city", "a", 1, 0),
          dayRow("busy-city", "b", 40, 5)
        )
      )

      summary.topCities.map(_.cityId) mustBe Seq("busy-city", "quiet-city")
      summary.topCities.head.contributors mustBe 1
    }

    "keep AI accounts in the contributor list but marked, so a busy-looking day says who made it busy" in {
      val summary =
        ConfigService.summarizeDay(day, Seq(dayRow("seattle-wa", "bot", 0, 900, isAi = true), dayRow("x", "a", 2, 0)))

      summary.contributors.map(c => (c.username, c.isAi)) mustBe Seq(("ai-bot", true), ("user-a", false))
    }

    "cap the lists it ships to the page" in {
      val cities  = (1 to 9).map(i => dayRow(s"city-$i", s"u$i", i, 0))
      val summary = ConfigService.summarizeDay(day, cities)

      summary.topCities.length mustBe ConfigService.DayTopCityLimit
      summary.contributors.length mustBe ConfigService.DayContributorLimit
      // Capping keeps the busiest, so the biggest city can never be the one dropped.
      summary.topCities.head.cityId mustBe "city-9"
    }

    "zero-fill a day nobody was active" in {
      val summary = ConfigService.summarizeDay(day, Seq.empty)

      summary.point mustBe DailyPoint(day, 0, 0, 0, 0, 0, 0)
      summary.topCities mustBe empty
      summary.contributors mustBe empty
    }
  }
}
