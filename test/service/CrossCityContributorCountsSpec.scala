package service

import util.SidewalkSpec

/** Pure tests for the Across Cities contributor counts (#5828): who counts once, who counts as multi-city. */
class CrossCityContributorCountsSpec extends SidewalkSpec {

  "ConfigService.contributorCounts" should {
    "count a two-city contributor once overall and once as multi-city" in {
      ConfigService.contributorCounts(Seq(Seq("a", "b"), Seq("a"))) mustBe CrossCityContributorCounts(2, 1)
    }

    "not count a contributor repeated within one city as multi-city" in {
      ConfigService.contributorCounts(Seq(Seq("a", "a"), Seq("b"))) mustBe CrossCityContributorCounts(2, 0)
    }

    "be zero for no cities" in {
      ConfigService.contributorCounts(Seq.empty) mustBe CrossCityContributorCounts(0, 0)
    }
  }
}
