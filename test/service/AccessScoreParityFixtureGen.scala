package service

import models.api.AccessScoreConfigForApi
import play.api.libs.json.{JsNull, JsObject, JsValue, Json}
import service.AccessScoreCalculator.ClusterScoreInput

import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Paths}

/**
 * Writes the AccessScore parity fixture, `test/fixtures/accessScoreParity.json` (#3855).
 *
 * The fixture is the contract between the Scala engine and the AccessScore tool's client-side reweighting: a set of
 * streets as clusters, the count-based inputs the API publishes for them, and the scores the engine produces — under
 * its own weights and under every preset. `AccessScoreParitySpec` holds the engine to the file; the JS model test
 * holds the client to the same file; both are blocking CI steps. Regenerate it with
 * `sbt "Test/runMain service.AccessScoreParityFixtureGen"` whenever a weight, multiplier, tag adjustment, or preset
 * changes — the spec fails on a stale fixture rather than letting the two sides drift.
 *
 * Cases are hand-picked edges (every bucket incl. null and out-of-range, a Bad curb ramp, a positive tag on a Bad
 * crosswalk, point vs pooled NoSidewalk tags, the tag threshold on both sides, an unscored type, an empty street)
 * plus a seeded random spread, so the JS port is exercised on inputs it will meet in the wild.
 */
object AccessScoreParityFixtureGen {

  val fixturePath: String = "test/fixtures/accessScoreParity.json"

  /** A cluster input in the fixture's JSON shape. */
  private def clusterJson(c: ClusterScoreInput): JsObject = Json.obj(
    "label_type"  -> c.labelType,
    "severity"    -> c.severity.map(Json.toJson(_)).getOrElse[JsValue](JsNull),
    "label_count" -> c.labelCount,
    "tag_counts"  -> c.tagCounts
  )

  /** Dense per-type object in the API's type order, defaulting to `default`. */
  private def perType[T](values: Map[String, T], default: T)(implicit w: play.api.libs.json.Writes[T]): JsObject =
    JsObject(AccessScoreCalculator.orderedScoredTypes.map(t => t -> Json.toJson(values.getOrElse(t, default))))

  /** Dense per-type-per-bucket object in the API's order, defaulting to 0. */
  private def perTypeBucket(values: Map[String, Map[String, Int]]): JsObject =
    JsObject(AccessScoreCalculator.orderedScoredTypes.map { t =>
      val byBucket = values.getOrElse(t, Map.empty[String, Int])
      t -> JsObject(AccessScoreCalculator.severityBuckets.map(b => b -> Json.toJson(byBucket.getOrElse(b, 0))))
    })

  private def c(
      labelType: String,
      severity: Option[Int] = None,
      labelCount: Int = 1,
      tagCounts: Map[String, Int] = Map.empty
  ): ClusterScoreInput = ClusterScoreInput(labelType, severity, labelCount, tagCounts)

  /** The hand-picked edge cases, named so a failure says which behavior diverged. */
  val namedStreets: Seq[(String, Seq[ClusterScoreInput])] = Seq(
    "empty street"                   -> Seq.empty,
    "one good curb ramp"             -> Seq(c("CurbRamp", Some(1))),
    "bad curb ramp flips negative"   -> Seq(c("CurbRamp", Some(3))),
    "null quality is okay"           -> Seq(c("CurbRamp", None)),
    "out-of-range rating is unrated" -> Seq(c("CurbRamp", Some(5)), c("Obstacle", Some(0))),
    "severity ladder"                -> Seq(c("Obstacle", Some(1)), c("Obstacle", Some(2)), c("Obstacle", Some(3))),
    "null severity is low"           -> Seq(c("SurfaceProblem", None)),
    "signal ignores its rating"      -> Seq(c("Signal", Some(3)), c("Signal", None)),
    "tag exactly at threshold"       -> Seq(c("Signal", labelCount = 2, tagCounts = Map("hard to reach buttons" -> 1))),
    "tag below threshold"            -> Seq(c("Signal", labelCount = 3, tagCounts = Map("APS" -> 1))),
    "positive tag on bad crosswalk"  -> Seq(c("Crosswalk", Some(3), tagCounts = Map("level with sidewalk" -> 1))),
    "unmapped tag adds nothing"      -> Seq(c("CurbRamp", Some(1), tagCounts = Map("some unmapped tag" -> 1))),
    "zero label count never divides" -> Seq(c("Signal", labelCount = 0, tagCounts = Map("APS" -> 1))),
    "nosidewalk single pin"          -> Seq(c("NoSidewalk")),
    "nosidewalk saturates"           -> Seq.fill(8)(c("NoSidewalk")),
    "nosidewalk pooled tag active"   -> Seq(
      c("NoSidewalk", labelCount = 3, tagCounts = Map("street has no sidewalks" -> 2)),
      c("NoSidewalk")
    ),
    "nosidewalk pooled tag inactive" -> Seq(
      c("NoSidewalk", labelCount = 3, tagCounts = Map("street has no sidewalks" -> 2)),
      c("NoSidewalk"),
      c("NoSidewalk")
    ),
    "nosidewalk point tag" -> (Seq.fill(7)(c("NoSidewalk")) :+
      c("NoSidewalk", labelCount = 1, tagCounts = Map("ends abruptly" -> 1))),
    "nosidewalk tags cancel" -> Seq(
      c("NoSidewalk", labelCount = 2, tagCounts = Map("street has no sidewalks" -> 2)),
      c("NoSidewalk", labelCount = 2, tagCounts = Map("street has a sidewalk" -> 2))
    ),
    "unscored types ignored" -> Seq(c("Occlusion", Some(3)), c("Other"), c("Signal")),
    "mixed street"           -> Seq(
      c("CurbRamp", Some(1)),
      c("CurbRamp", Some(3)),
      c("NoCurbRamp", Some(2), tagCounts = Map("no alternate route" -> 1)),
      c("Obstacle", Some(2)),
      c("SurfaceProblem", Some(3)),
      c("Crosswalk", Some(2)),
      c("Signal"),
      c("NoSidewalk"),
      c("NoSidewalk")
    )
  )

  /** A seeded random spread: every scored type, every bucket, tags on and off, plus an unscored type. */
  def randomStreets(seed: Int, count: Int): Seq[(String, Seq[ClusterScoreInput])] = {
    val rng   = new scala.util.Random(seed)
    val types = AccessScoreCalculator.orderedScoredTypes :+ "Occlusion"
    (1 to count).map { i =>
      val clusters = Seq.fill(1 + rng.nextInt(12)) {
        val labelType  = types(rng.nextInt(types.size))
        val severity   = rng.nextInt(6) match { case 0 => None; case 5 => Some(5); case s => Some(s) }
        val labelCount = rng.nextInt(4)
        val tags       = AccessScoreCalculator.tagAdjustments.keysIterator.collect {
          case (lt, tag) if lt == labelType => tag
        }
        val tagCounts = tags.filter(_ => rng.nextBoolean()).map(tag => tag -> rng.nextInt(labelCount + 1)).toMap
        c(labelType, severity, labelCount, tagCounts)
      }
      s"random $i" -> clusters
    }
  }

  /** Region roll-up cases: (name, (score, length) pairs). */
  val regionCases: Seq[(String, Seq[(Double, Double)])] = Seq(
    "two streets"        -> Seq((0.2, 100.0), (0.8, 300.0)),
    "single street"      -> Seq((0.42, 50.0)),
    "no audited streets" -> Seq.empty,
    "zero total length"  -> Seq((0.5, 0.0)),
    "three streets"      -> Seq((0.1, 10.0), (0.5, 20.0), (0.9, 70.0))
  )

  /** One street case in the fixture's JSON shape: inputs, engine outputs, and the outputs under each preset. */
  private def streetJson(name: String, clusters: Seq[ClusterScoreInput]): JsObject = {
    val severityCounts = AccessScoreCalculator.severityCountsByType(clusters)
    val tagAdjustments = AccessScoreCalculator.tagAdjustmentsByType(clusters)
    val subScores      = AccessScoreCalculator.scoreByType(clusters)
    val reweighted     = AccessScoreCalculator.presetOrder.filterNot(_ == "default").map { id =>
      val weights = AccessScoreCalculator.signedWeights(AccessScoreCalculator.presets(id))
      val terms   = AccessScoreCalculator.subScoresFromCounts(severityCounts, tagAdjustments, weights)
      Json.obj(
        "preset"     -> id,
        "sub_scores" -> perType(terms, 0.0),
        "score"      -> AccessScoreCalculator.scoreFromSubScores(terms)
      )
    }
    Json.obj(
      "name"            -> name,
      "clusters"        -> clusters.map(clusterJson),
      "cluster_counts"  -> perType(clusters.groupBy(_.labelType).map { case (t, cs) => t -> cs.size }, 0),
      "severity_counts" -> perTypeBucket(severityCounts),
      "tag_adjustments" -> perType(tagAdjustments, 0.0),
      "sub_scores"      -> perType(subScores, 0.0),
      "score"           -> AccessScoreCalculator.scoreFromSubScores(subScores),
      "reweighted"      -> reweighted
    )
  }

  /** The whole fixture. */
  def fixture: JsObject = Json.obj(
    "generated_by" -> "sbt \"Test/runMain service.AccessScoreParityFixtureGen\"",
    "tolerance"    -> 1e-9,
    "config"       -> AccessScoreConfigForApi.current.toJson,
    "streets" -> (namedStreets ++ randomStreets(seed = 3855, count = 40)).map { case (n, cs) => streetJson(n, cs) },
    "regions" -> regionCases.map { case (name, streets) =>
      Json.obj(
        "name"    -> name,
        "streets" -> streets.map { case (score, len) => Json.obj("score" -> score, "length_meters" -> len) },
        "score"   -> AccessScoreCalculator.scoreRegion(streets).map(Json.toJson(_)).getOrElse[JsValue](JsNull)
      )
    }
  )

  def main(args: Array[String]): Unit = {
    val path = Paths.get(fixturePath)
    Files.write(path, (Json.prettyPrint(fixture) + "\n").getBytes(StandardCharsets.UTF_8))
    println(s"Wrote ${(fixture \ "streets").as[Seq[JsValue]].size} street cases to $path")
  }
}
