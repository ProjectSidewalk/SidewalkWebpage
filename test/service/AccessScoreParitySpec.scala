package service

import models.api.AccessScoreConfigForApi
import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.{JsObject, JsValue, Json}
import service.AccessScoreCalculator.ClusterScoreInput

import scala.io.Source

/**
 * Holds the AccessScore engine to the committed parity fixture (#3855), the same file the AccessScore tool's
 * client-side model is tested against, so the two implementations can only ever disagree by failing CI.
 *
 * Every street and intersection in `test/fixtures/accessScoreParity.json` is re-scored here from its clusters (and,
 * for a street, its length), and the count-based inputs the API publishes are re-derived and re-scored — under the
 * engine's weights and under each preset. If any
 * weight, multiplier, tag adjustment, or preset changes, the fixture goes stale and this fails; regenerate it with
 * `sbt "Test/runMain service.AccessScoreParityFixtureGen"` and commit the result.
 */
class AccessScoreParitySpec extends AnyFunSuite with Matchers {

  private lazy val fixture: JsValue = {
    val source = Source.fromFile(AccessScoreParityFixtureGen.fixturePath, "UTF-8")
    try Json.parse(source.mkString)
    finally source.close()
  }
  private lazy val tolerance: Double     = (fixture \ "tolerance").as[Double]
  private lazy val streets: Seq[JsValue] = (fixture \ "streets").as[Seq[JsValue]]

  private def cluster(j: JsValue): ClusterScoreInput = ClusterScoreInput(
    (j \ "label_type").as[String],
    (j \ "severity").asOpt[Int],
    (j \ "label_count").as[Int],
    (j \ "tag_counts").as[Map[String, Int]]
  )

  /** Compares a live (possibly sparse) per-type map with the fixture's dense object, zero meaning absent. */
  private def matchDense(live: Map[String, Double], dense: JsObject): Unit =
    AccessScoreCalculator.orderedScoredTypes.foreach { t =>
      live.getOrElse(t, 0.0) shouldBe ((dense \ t).as[Double] +- tolerance)
    }

  private lazy val intersections: Seq[JsValue] = (fixture \ "intersections").as[Seq[JsValue]]

  test("the fixture was generated for the configuration this build ships") {
    (fixture \ "config").as[JsObject] shouldBe AccessScoreConfigForApi.current.toJson
    streets.size should be >= 50
    intersections.size should be >= 20
  }

  /** Checks one unit case (a street with its length, or an intersection without) through both scoring paths. */
  private def checkUnit(kind: String, s: JsValue, lengthMeters: Option[Double]): Unit = {
    val name     = (s \ "name").as[String]
    val clusters = (s \ "clusters").as[Seq[JsValue]].map(cluster)
    withClue(s"$kind '$name': ") {
      val severityCounts = AccessScoreCalculator.severityCountsByType(clusters)
      val tagAdjustments = AccessScoreCalculator.tagAdjustmentsByType(clusters)
      AccessScoreCalculator.orderedScoredTypes.foreach { t =>
        val byBucket = severityCounts.getOrElse(t, Map.empty[String, Int])
        AccessScoreCalculator.severityBuckets.foreach { b =>
          byBucket.getOrElse(b, 0) shouldBe (s \ "severity_counts" \ t \ b).as[Int]
        }
        clusters.count(_.labelType == t) shouldBe (s \ "cluster_counts" \ t).as[Int]
      }
      matchDense(tagAdjustments, (s \ "tag_adjustments").as[JsObject])

      val subScores = AccessScoreCalculator.scoreByType(clusters, lengthMeters)
      matchDense(subScores, (s \ "sub_scores").as[JsObject])
      AccessScoreCalculator.scoreStreet(clusters, lengthMeters) shouldBe ((s \ "score").as[Double] +- tolerance)

      val rebuilt =
        AccessScoreCalculator.subScoresFromCounts(severityCounts, tagAdjustments, lengthMeters = lengthMeters)
      matchDense(rebuilt, (s \ "sub_scores").as[JsObject])
      AccessScoreCalculator.scoreFromSubScores(rebuilt) shouldBe ((s \ "score").as[Double] +- tolerance)

      (s \ "reweighted").as[Seq[JsValue]].foreach { r =>
        val id      = (r \ "preset").as[String]
        val weights = AccessScoreCalculator.signedWeights(AccessScoreCalculator.presets(id))
        val terms   = AccessScoreCalculator.subScoresFromCounts(severityCounts, tagAdjustments, weights, lengthMeters)
        withClue(s"preset $id: ") {
          matchDense(terms, (r \ "sub_scores").as[JsObject])
          AccessScoreCalculator.scoreFromSubScores(terms) shouldBe ((r \ "score").as[Double] +- tolerance)
        }
      }
    }
  }

  test("every street reproduces from its clusters and length, through both the cluster path and the count path") {
    streets.foreach(s => checkUnit("street", s, Some((s \ "length_meters").as[Double])))
  }

  test("every intersection reproduces from its pooled corner features, with no length") {
    intersections.foreach { i =>
      // Attribution only ever hands an intersection corner-type clusters; the fixture holds to that.
      (i \ "clusters").as[Seq[JsValue]].map(cluster).foreach { c =>
        AccessScoreCalculator.intersectionTypeNames should contain(c.labelType)
      }
      checkUnit("intersection", i, None)
    }
  }

  test("every headline case reproduces through headlineScore") {
    (fixture \ "headlines").as[Seq[JsValue]].foreach { h =>
      val live =
        AccessScoreCalculator.headlineScore((h \ "segment_score").asOpt[Double], (h \ "end_scores").as[Seq[Double]])
      withClue(s"headline '${(h \ "name").as[String]}': ") {
        (live, (h \ "score").asOpt[Double]) match {
          case (Some(l), Some(expected)) => l shouldBe (expected +- tolerance)
          case (l, expected)             => l shouldBe expected
        }
      }
    }
  }

  test("every slope case reproduces from the fixture's own slope and settings (#5223)") {
    val statisticByName =
      AccessScoreCalculator.slopeStatistics.map(st => AccessScoreCalculator.slopeStatisticName(st) -> st).toMap
    val streetByName = streets.map(st => (st \ "name").as[String] -> st).toMap
    val cases        = (fixture \ "slope_cases").as[Seq[JsValue]]
    cases.size should be >= 20

    cases.foreach { c =>
      // Read back from the JSON, not from the generator's case list: the JS side only ever sees the JSON, so this
      // is what proves the file alone carries the case.
      val settings = AccessScoreCalculator.SlopeSettings(
        weight = (c \ "settings" \ "weight").as[Double],
        statistic = statisticByName((c \ "settings" \ "statistic").as[String]),
        lowThreshold = (c \ "settings" \ "low_threshold").as[Double],
        highThreshold = (c \ "settings" \ "high_threshold").as[Double],
        barrierEnabled = (c \ "settings" \ "barrier_enabled").as[Boolean],
        barrierThreshold = (c \ "settings" \ "barrier_threshold").as[Double],
        includeApproximate = (c \ "settings" \ "include_approximate").as[Boolean]
      )
      val slope = (c \ "slope").asOpt[JsObject].map { g =>
        AccessScoreCalculator.SlopeInput(
          (g \ "mean_grade").asOpt[Double],
          (g \ "max_grade").asOpt[Double],
          (g \ "net_grade").asOpt[Double],
          (g \ "meters_over_5pct").asOpt[Double],
          (g \ "meters_over_8pct").asOpt[Double],
          approximate = (g \ "grade_confidence").as[String] == "low" || (g \ "grade_quality").as[String] == "suspect"
        )
      }
      val street    = streetByName((c \ "street").as[String])
      val length    = (street \ "length_meters").as[Double]
      val subScores =
        AccessScoreCalculator.scoreByType((street \ "clusters").as[Seq[JsValue]].map(cluster), Some(length))

      withClue(s"slope case '${(c \ "name").as[String]}': ") {
        AccessScoreCalculator.slopeUnits(slope, length, settings) shouldBe ((c \ "units").as[Double] +- tolerance)
        AccessScoreCalculator.slopeTerm(slope, length, settings) shouldBe ((c \ "slope_term").as[Double] +- tolerance)
        AccessScoreCalculator.slopeIsBarrier(slope, settings) shouldBe (c \ "barrier").as[Boolean]
        AccessScoreCalculator.segmentScoreWithSlope(subScores, slope, length, settings) shouldBe
          ((c \ "segment_score").as[Double] +- tolerance)
      }
    }
  }

  test("at the engine's own slope settings a slope changes no score") {
    // The promise #5223's phase 3 makes: the headline the API serves is the label-only one until the weight moves.
    AccessScoreCalculator.defaultSlopeSettings.weight shouldBe 0.0
    AccessScoreCalculator.defaultSlopeSettings.barrierEnabled shouldBe false
    val steep = Some(AccessScoreCalculator.SlopeInput(Some(0.2), Some(0.3), Some(0.2), Some(500), Some(500), false))
    streets.foreach { s =>
      val length    = (s \ "length_meters").as[Double]
      val subScores = AccessScoreCalculator.scoreByType((s \ "clusters").as[Seq[JsValue]].map(cluster), Some(length))
      AccessScoreCalculator.segmentScoreWithSlope(subScores, steep, length) shouldBe
        AccessScoreCalculator.scoreFromSubScores(subScores)
    }
  }

  test("every region case reproduces through scoreRegion and scoreRegionIntersections") {
    (fixture \ "regions").as[Seq[JsValue]].foreach { r =>
      val pairs =
        (r \ "streets").as[Seq[JsValue]].map(j => ((j \ "score").as[Double], (j \ "length_meters").as[Double]))
      withClue(s"region '${(r \ "name").as[String]}': ") {
        (AccessScoreCalculator.scoreRegion(pairs), (r \ "score").asOpt[Double]) match {
          case (Some(live), Some(expected)) => live shouldBe (expected +- tolerance)
          case (live, expected)             => live shouldBe expected
        }
        val intersectionScores = (r \ "intersection_scores").as[Seq[Double]]
        (
          AccessScoreCalculator.scoreRegionIntersections(intersectionScores),
          (r \ "intersection_score").asOpt[Double]
        ) match {
          case (Some(live), Some(expected)) => live shouldBe (expected +- tolerance)
          case (live, expected)             => live shouldBe expected
        }
      }
    }
  }
}
