package service

import org.scalatestplus.play.PlaySpec

import java.time.LocalDate

/**
 * Unit tests for the pure rollups behind the Across Cities "Today & this week" section (#4931): the rolling weekly
 * windows, the per-person merge that makes cross-city headcounts distinct, and the daily breakdown the bar hover cards
 * read.
 *
 * These are the rules that keep AI output from being read as community activity and cookie identities from being read
 * as people, so they are pinned against synthetic rows rather than against whatever the connected database happens to
 * hold — a dev or CI database with no AI-role accounts would pass every AI assertion without exercising one. No DB, no
 * app boot.
 */
class ActivityBreakdownSpec extends PlaySpec {

  private val day = LocalDate.of(2026, 8, 12)

  private def person(id: String, labels7d: Int, validations7d: Int, priorLabels: Int = 0, priorVals: Int = 0) =
    ContributorWindowActivity(
      id,
      s"user-$id",
      ContributorKind.Registered,
      labels7d,
      priorLabels,
      validations7d,
      priorVals
    )

  private def anon(id: String, labels7d: Int, validations7d: Int, priorLabels: Int = 0, priorVals: Int = 0) =
    ContributorWindowActivity(
      id,
      s"cookie-$id",
      ContributorKind.Anonymous,
      labels7d,
      priorLabels,
      validations7d,
      priorVals
    )

  private def agent(id: String, labels7d: Int, validations7d: Int, priorLabels: Int = 0, priorVals: Int = 0) =
    ContributorWindowActivity(id, s"ai-$id", ContributorKind.Ai, labels7d, priorLabels, validations7d, priorVals)

  private def dayRow(
      cityId: String,
      id: String,
      labels: Int,
      validations: Int,
      kind: ContributorKind.Value = ContributorKind.Registered
  ) = {
    val name = kind match {
      case ContributorKind.Ai        => s"ai-$id"
      case ContributorKind.Anonymous => s"cookie-$id"
      case _                         => s"user-$id"
    }
    cityId -> DailyContributorActivity(day, id, name, kind, labels, validations)
  }

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

    "count anonymous work as human volume, because an anonymous visitor's label is still a person's label" in {
      val summary = ActivityWindowSummary.fromContributors(Seq(person("a", 10, 4), anon("c1", 3, 2)))

      summary.labels7d mustBe 13
      summary.validations7d mustBe 6
    }

    "split headcounts three ways: registered people, anonymous sessions, AI agents" in {
      val summary = ActivityWindowSummary.fromContributors(
        Seq(person("a", 10, 0), person("b", 0, 3), anon("c1", 1, 0), anon("c2", 0, 1), agent("bot", 0, 8000))
      )

      summary.contributors7d mustBe 2
      summary.anonSessions7d mustBe 2
      summary.aiAgents7d mustBe 1
    }

    "never count an anonymous session as a contributor" in {
      val summary = ActivityWindowSummary.fromContributors(Seq(anon("c1", 5, 5), anon("c2", 5, 5)))

      summary.contributors7d mustBe 0
      summary.anonSessions7d mustBe 2
    }

    "split the prior window on the same rules as the current one" in {
      val summary = ActivityWindowSummary.fromContributors(
        Seq(
          person("a", 2, 2, priorLabels = 7, priorVals = 3),
          anon("c1", 0, 0, priorLabels = 1, priorVals = 1),
          agent("bot", 1, 1, priorLabels = 40, priorVals = 60)
        )
      )

      summary.labelsPrior7d mustBe 8
      summary.validationsPrior7d mustBe 4
      summary.aiLabelsPrior7d mustBe 40
      summary.aiValidationsPrior7d mustBe 60
      summary.contributorsPrior7d mustBe 1
      summary.anonSessionsPrior7d mustBe 1
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

  "ConfigService.mergeByContributor" should {
    "collapse one person's cities into a single row with their volumes added up" in {
      val merged = ConfigService.mergeByContributor(Seq(person("a", 5, 1, 2, 0), person("a", 7, 2, 3, 4)))

      merged.map(_.userId) mustBe Seq("a")
      merged.head.labels7d mustBe 12
      merged.head.validations7d mustBe 3
      merged.head.labelsPrior7d mustBe 5
      merged.head.validationsPrior7d mustBe 4
    }

    "preserve each contributor's kind through the merge" in {
      val merged = ConfigService.mergeByContributor(Seq(agent("bot", 1, 1), agent("bot", 2, 2), person("a", 1, 1)))

      merged.find(_.userId == "bot").map(_.kind) mustBe Some(ContributorKind.Ai)
      merged.find(_.userId == "a").map(_.kind) mustBe Some(ContributorKind.Registered)
    }

    "order busiest first" in {
      val merged = ConfigService.mergeByContributor(Seq(person("small", 1, 0), person("big", 90, 5)))

      merged.map(_.userId) mustBe Seq("big", "small")
    }

    "break ties on user id, so a truncated list is reproducible across cache refreshes" in {
      // Same total for every contributor: without an explicit tiebreak the order would follow HashMap iteration and
      // could hand a different set to `.take` on each refresh, with no change in the underlying data.
      val rows   = (1 to 40).map(i => person(f"u$i%02d", 5, 5))
      val first  = ConfigService.mergeByContributor(rows).map(_.userId)
      val second = ConfigService.mergeByContributor(rows.reverse).map(_.userId)

      first mustBe second
      first.take(3) mustBe Seq("u01", "u02", "u03")
    }

    "make the cross-city total's headcount distinct people rather than per-city slots" in {
      // What getCrossCityActivitySummary composes: someone who mapped in three cities is one contributor, and summing
      // three per-city summaries instead would have called them three.
      val everyCitysRows = Seq(person("a", 4, 0), person("a", 4, 0), person("a", 4, 0), person("b", 1, 0))
      val total          = ActivityWindowSummary.fromContributors(ConfigService.mergeByContributor(everyCitysRows))

      total.contributors7d mustBe 2
      total.labels7d mustBe 13
    }

    "count one AI account working in many cities as one agent" in {
      val rows  = Seq(agent("bot", 100, 200), agent("bot", 300, 400), agent("bot", 5, 6))
      val total = ActivityWindowSummary.fromContributors(ConfigService.mergeByContributor(rows))

      total.aiAgents7d mustBe 1
      total.aiLabels7d mustBe 405
      total.aiValidations7d mustBe 606
    }
  }

  "ConfigService.summarizeDay" should {
    "report the day's human volumes and its AI output separately" in {
      val summary = ConfigService.summarizeDay(
        day,
        Seq(dayRow("seattle-wa", "a", 12, 3), dayRow("seattle-wa", "bot", 0, 4000, ContributorKind.Ai))
      )

      summary.point.labels mustBe 12
      summary.point.validations mustBe 3
      summary.point.contributors mustBe 1
      summary.point.aiValidations mustBe 4000
      summary.point.aiAgents mustBe 1
    }

    "count a person active in two cities once" in {
      val summary =
        ConfigService.summarizeDay(day, Seq(dayRow("seattle-wa", "a", 5, 0), dayRow("chicago-il", "a", 7, 0)))

      summary.point.contributors mustBe 1
      summary.point.labels mustBe 12
    }

    "keep the contributor count and the contributor list on one basis" in {
      // The count and the list are derived from the same merged rows, so a card can't say "4 contributors" over two
      // names. Two people, each working two cities.
      val summary = ConfigService.summarizeDay(
        day,
        Seq(
          dayRow("seattle-wa", "a", 5, 1),
          dayRow("chicago-il", "a", 7, 2),
          dayRow("seattle-wa", "b", 1, 1),
          dayRow("chicago-il", "b", 2, 2)
        )
      )

      summary.point.contributors mustBe 2
      summary.contributors.length mustBe 2
      summary.contributorTotal mustBe 2
    }

    "merge that same person into one contributor line with their cities added up" in {
      val summary =
        ConfigService.summarizeDay(day, Seq(dayRow("seattle-wa", "a", 5, 1), dayRow("chicago-il", "a", 7, 2)))

      summary.contributors.map(_.username) mustBe Seq("user-a")
      summary.contributors.head.labels mustBe 12
      summary.contributors.head.validations mustBe 3
    }

    "count anonymous visitors as sessions and keep their volume in the human totals" in {
      val summary = ConfigService.summarizeDay(
        day,
        Seq(dayRow("seattle-wa", "a", 4, 0), dayRow("seattle-wa", "c1", 3, 2, ContributorKind.Anonymous))
      )

      summary.point.contributors mustBe 1
      summary.point.anonSessions mustBe 1
      summary.point.labels mustBe 7
      summary.point.validations mustBe 2
    }

    "leave anonymous visitors out of the named list, since their usernames are generated cookie ids" in {
      val summary = ConfigService.summarizeDay(
        day,
        Seq(
          dayRow("seattle-wa", "c1", 900, 0, ContributorKind.Anonymous),
          dayRow("seattle-wa", "c2", 800, 0, ContributorKind.Anonymous),
          dayRow("seattle-wa", "a", 1, 0)
        )
      )

      // The anonymous pair out-produce the person, so a list that named them would be all hex and no names.
      summary.contributors.map(_.username) mustBe Seq("user-a")
      summary.contributorTotal mustBe 1
      summary.point.anonSessions mustBe 2
    }

    "rank cities by what people did there, leaving AI output out of the ordering" in {
      val summary = ConfigService.summarizeDay(
        day,
        Seq(
          dayRow("quiet-city", "bot", 9000, 0, ContributorKind.Ai),
          dayRow("quiet-city", "a", 1, 0),
          dayRow("busy-city", "b", 40, 5)
        )
      )

      summary.topCities.map(_.cityId) mustBe Seq("busy-city", "quiet-city")
      summary.topCities.head.contributors mustBe 1
    }

    "count a city's contributors distinctly even when one person has several rows there" in {
      val summary = ConfigService.summarizeDay(
        day,
        Seq(dayRow("seattle-wa", "a", 1, 0), dayRow("seattle-wa", "a", 2, 0), dayRow("seattle-wa", "b", 1, 0))
      )

      summary.topCities.head.contributors mustBe 2
    }

    "break city ties on city id, so the truncated list is reproducible" in {
      val rows   = (1 to 9).map(i => dayRow(f"city-$i%02d", s"u$i", 10, 0))
      val first  = ConfigService.summarizeDay(day, rows).topCities.map(_.cityId)
      val second = ConfigService.summarizeDay(day, rows.reverse).topCities.map(_.cityId)

      first mustBe second
      first mustBe Seq("city-01", "city-02", "city-03")
    }

    "keep AI accounts in the contributor list but marked, so a busy-looking day says who made it busy" in {
      val summary = ConfigService.summarizeDay(
        day,
        Seq(dayRow("seattle-wa", "bot", 0, 900, ContributorKind.Ai), dayRow("x", "a", 2, 0))
      )

      summary.contributors.map(c => (c.username, c.kind)) mustBe
        Seq(("ai-bot", ContributorKind.Ai), ("user-a", ContributorKind.Registered))
    }

    "cap the lists it ships to the page" in {
      val cities  = (1 to 9).map(i => dayRow(s"city-$i", s"u$i", i, 0))
      val summary = ConfigService.summarizeDay(day, cities)

      summary.topCities.length mustBe ConfigService.DayTopCityLimit
      summary.contributors.length mustBe ConfigService.DayContributorLimit
      // Capping keeps the busiest, so the biggest city can never be the one dropped.
      summary.topCities.head.cityId mustBe "city-9"
    }

    "report the untruncated contributor count alongside the capped list" in {
      // What the card's "+N more" is computed from. Deriving it from the capped list instead would bound it at
      // DayContributorLimit and understate a busy day without limit.
      val rows    = (1 to 40).map(i => dayRow("seattle-wa", f"u$i%02d", i, 0))
      val summary = ConfigService.summarizeDay(day, rows)

      summary.contributors.length mustBe ConfigService.DayContributorLimit
      summary.contributorTotal mustBe 40
      summary.point.contributors mustBe 40
    }

    "zero-fill a day nobody was active" in {
      val summary = ConfigService.summarizeDay(day, Seq.empty)

      summary.point mustBe DailyPoint(day, 0, 0, 0, 0, 0, 0, 0)
      summary.topCities mustBe empty
      summary.contributors mustBe empty
      summary.contributorTotal mustBe 0
    }

    "describe an AI-only day as active, so the day's card is never the quiet one" in {
      // The bars all read zero on such a day, so the card is the only place the pipeline's work shows up.
      val summary = ConfigService.summarizeDay(day, Seq(dayRow("seattle-wa", "bot", 0, 6420, ContributorKind.Ai)))

      summary.point.labels mustBe 0
      summary.point.validations mustBe 0
      summary.point.contributors mustBe 0
      summary.point.aiValidations mustBe 6420
      summary.point.aiAgents mustBe 1
      summary.contributors.map(_.username) mustBe Seq("ai-bot")
    }
  }
}
