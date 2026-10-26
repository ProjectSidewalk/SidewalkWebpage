package service

import util.SidewalkSpec

/** Pure tests for the Across Cities contributor counts (#5828): who counts once, who counts as multi-city. */
class CrossCityContributorCountsSpec extends SidewalkSpec {

  "ConfigService.contributorCounts" should {
    "count a two-city contributor once overall and once as multi-city" in {
      ConfigService.contributorCounts(Seq(Seq("a", "b"), Seq("a")), Set.empty) mustBe CrossCityContributorCounts(2, 1)
    }

    "not count a contributor repeated within one city as multi-city" in {
      ConfigService.contributorCounts(Seq(Seq("a", "a"), Seq("b")), Set.empty) mustBe CrossCityContributorCounts(2, 0)
    }

    "drop AI accounts from both counts" in {
      ConfigService.contributorCounts(Seq(Seq("ai", "a"), Seq("ai"), Seq("ai")), Set("ai")) mustBe
        CrossCityContributorCounts(1, 0)
    }

    "be zero for no cities" in {
      ConfigService.contributorCounts(Seq.empty, Set.empty) mustBe CrossCityContributorCounts(0, 0)
    }
  }
}
