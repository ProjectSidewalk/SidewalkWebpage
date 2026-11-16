package service

import util.SidewalkSpec

/** Pure tests for the public aggregate stats' contributor counts (#5914): AI accounts and unreadable cities. */
class AggregateContributorCountsSpec extends SidewalkSpec {

  "ConfigService.aggregateContributorCounts" should {
    "count a two-city contributor once overall and once in each city" in {
      ConfigService.aggregateContributorCounts(Seq("a" -> Some(Set("x", "y")), "b" -> Some(Set("x"))), Set.empty) mustBe
        AggregateContributorCounts(2, Map("a" -> 2, "b" -> 1))
    }

    "drop an AI voter from the total and from every city" in {
      ConfigService.aggregateContributorCounts(
        Seq("a" -> Some(Set("ai", "x")), "b" -> Some(Set("ai"))),
        Set("ai")
      ) mustBe
        AggregateContributorCounts(1, Map("a" -> 1, "b" -> 0))
    }

    "leave a city whose contributors couldn't be read out of both counts" in {
      ConfigService.aggregateContributorCounts(Seq("a" -> Some(Set("x")), "b" -> None), Set.empty) mustBe
        AggregateContributorCounts(1, Map("a" -> 1))
    }

    "be zero for no cities" in {
      ConfigService.aggregateContributorCounts(Seq.empty, Set.empty) mustBe AggregateContributorCounts(0, Map.empty)
    }
  }
}
