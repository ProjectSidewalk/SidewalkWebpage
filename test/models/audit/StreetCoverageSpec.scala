package models.audit

import play.api.libs.json.{JsError, JsSuccess, Json}
import util.SidewalkSpec

/**
 * The arithmetic behind free exploration's street credit (#5733), pinned on its own because the client has a copy of
 * it (Task.mergeRanges / isCoveredEnough) and the one-off backfill applies it to old sessions: all three must agree on
 * what a list of ranges means.
 */
class StreetCoverageSpec extends SidewalkSpec {

  "StreetCoverage.merge" should {
    "clip to the street and drop what clipping empties" in {
      StreetCoverage.merge(Seq(CoveredRange(-5d, 12d), CoveredRange(95d, 130d), CoveredRange(140d, 150d)), 100d) mustBe
        Seq(CoveredRange(0d, 12d), CoveredRange(95d, 100d))
    }

    "merge overlapping and touching ranges whatever order they arrive in" in {
      val ranges = Seq(CoveredRange(40d, 60d), CoveredRange(0d, 20d), CoveredRange(20d, 30d), CoveredRange(55d, 70d))
      StreetCoverage.merge(ranges, 100d) mustBe Seq(CoveredRange(0d, 30d), CoveredRange(40d, 70d))
    }

    "round to a decimeter and keep an empty list empty" in {
      StreetCoverage.merge(Seq(CoveredRange(1.23d, 4.56d)), 100d) mustBe Seq(CoveredRange(1.2d, 4.6d))
      StreetCoverage.merge(Seq.empty, 100d) mustBe Seq.empty
      StreetCoverage.merge(Seq(CoveredRange(10d, 10d)), 100d) mustBe Seq.empty
    }
  }

  "StreetCoverage.coveredEnough" should {
    "need something seen, however short the street" in {
      StreetCoverage.coveredEnough(Seq.empty, 10d) mustBe false
      StreetCoverage.coveredEnough(Seq(CoveredRange(0d, 10d)), 10d) mustBe true
    }

    "pass at the cap and fail just past it" in {
      val cap = StreetCoverage.MaxUncoveredM
      StreetCoverage.coveredEnough(Seq(CoveredRange(0d, 100d)), 100d + cap) mustBe true
      StreetCoverage.coveredEnough(Seq(CoveredRange(0d, 100d)), 100d + cap + 0.1d) mustBe false
    }

    "hold a short street to the floor where the cap alone would pass it" in {
      // One pano window at a corner of a 60 m street: 50 m unseen is within the cap, but a sixth of the street is not
      // half of it. The floor and the cap agree exactly at 100 m.
      StreetCoverage.coveredEnough(Seq(CoveredRange(0d, 10d)), 60d) mustBe false
      StreetCoverage.coveredEnough(Seq(CoveredRange(0d, 30d)), 60d) mustBe true
      StreetCoverage.coveredEnough(Seq(CoveredRange(0d, 29.9d)), 60d) mustBe false
      StreetCoverage.coveredEnough(Seq(CoveredRange(0d, 50d)), 100d) mustBe true
    }

    "hold a long street to the same absolute cap, not a share of its length" in {
      // Two pano windows at the ends of a long street: the scenario of arriving at a street's far end having never
      // walked it. 10% of 2 km would be 200 m of slack; the cap allows 50.
      val ends = Seq(CoveredRange(0d, 20d), CoveredRange(1980d, 2000d))
      StreetCoverage.coveredEnough(ends, 2000d) mustBe false
      StreetCoverage.uncoveredM(ends, 2000d) mustBe 1960d
    }
  }

  "CoveredRange's JSON form" should {
    "be a bare [start, end] pair" in {
      Json.toJson(Seq(CoveredRange(0d, 12.5d))) mustBe Json.parse("[[0, 12.5]]")
      Json.parse("[[0, 12.5], [20, 30]]").validate[Seq[CoveredRange]] mustBe
        JsSuccess(Seq(CoveredRange(0d, 12.5d), CoveredRange(20d, 30d)))
    }

    "reject a pair that runs backwards or isn't a pair" in {
      Json.parse("[[30, 20]]").validate[Seq[CoveredRange]] mustBe a[JsError]
      Json.parse("[[1, 2, 3]]").validate[Seq[CoveredRange]] mustBe a[JsError]
      Json.parse("""[{"start_m": 1, "end_m": 2}]""").validate[Seq[CoveredRange]] mustBe a[JsError]
    }

    "read anything unparseable from the database as no coverage" in {
      StreetCoverage.fromJson(None) mustBe Seq.empty
      StreetCoverage.fromJson(Some(Json.parse("[[30, 20]]"))) mustBe Seq.empty
      StreetCoverage.fromJson(Some(Json.parse("[[0, 7]]"))) mustBe Seq(CoveredRange(0d, 7d))
    }
  }
}
