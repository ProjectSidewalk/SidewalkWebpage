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
 * Every street in `test/fixtures/accessScoreParity.json` is re-scored here from its clusters, and the count-based
 * inputs the API publishes are re-derived and re-scored — under the engine's weights and under each preset. If any
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

  test("the fixture was generated for the configuration this build ships") {
    (fixture \ "config").as[JsObject] shouldBe AccessScoreConfigForApi.current.toJson
    streets.size should be >= 50
  }

  test("every street reproduces from its clusters, through both the cluster path and the count path") {
    streets.foreach { s =>
      val name     = (s \ "name").as[String]
      val clusters = (s \ "clusters").as[Seq[JsValue]].map(cluster)
      withClue(s"street '$name': ") {
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

        val subScores = AccessScoreCalculator.scoreByType(clusters)
        matchDense(subScores, (s \ "sub_scores").as[JsObject])
        AccessScoreCalculator.scoreStreet(clusters) shouldBe ((s \ "score").as[Double] +- tolerance)

        val rebuilt = AccessScoreCalculator.subScoresFromCounts(severityCounts, tagAdjustments)
        matchDense(rebuilt, (s \ "sub_scores").as[JsObject])
        AccessScoreCalculator.scoreFromSubScores(rebuilt) shouldBe ((s \ "score").as[Double] +- tolerance)

        (s \ "reweighted").as[Seq[JsValue]].foreach { r =>
          val id      = (r \ "preset").as[String]
          val weights = AccessScoreCalculator.signedWeights(AccessScoreCalculator.presets(id))
          val terms   = AccessScoreCalculator.subScoresFromCounts(severityCounts, tagAdjustments, weights)
          withClue(s"preset $id: ") {
            matchDense(terms, (r \ "sub_scores").as[JsObject])
            AccessScoreCalculator.scoreFromSubScores(terms) shouldBe ((r \ "score").as[Double] +- tolerance)
          }
        }
      }
    }
  }

  test("every region case reproduces through scoreRegion") {
    (fixture \ "regions").as[Seq[JsValue]].foreach { r =>
      val pairs =
        (r \ "streets").as[Seq[JsValue]].map(j => ((j \ "score").as[Double], (j \ "length_meters").as[Double]))
      withClue(s"region '${(r \ "name").as[String]}': ") {
        (AccessScoreCalculator.scoreRegion(pairs), (r \ "score").asOpt[Double]) match {
          case (Some(live), Some(expected)) => live shouldBe (expected +- tolerance)
          case (live, expected)             => live shouldBe expected
        }
      }
    }
  }
}
