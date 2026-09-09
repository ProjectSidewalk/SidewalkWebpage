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
 * plus a seeded random spread, so the JS port is exercised on inputs it will meet in the wild. Streets are scored
 * as segments with a length (#5095), so the length normalization is exercised too; intersections are scored from
 * their pooled corner features with no length; and the headline cases pin how a street combines the three.
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

  /** The reference length: the factor is 1, so a street at it scores exactly as the unnormalized sum does. */
  val referenceLength: Double = AccessScoreCalculator.lengthNormalizationPerMeters

  /** The hand-picked edge cases, named so a failure says which behavior diverged. Scored at [[referenceLength]]. */
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

  /** Length cases (#5095): the same problems on streets of different lengths, incl. below the floor. */
  val lengthStreets: Seq[(String, Double, Seq[ClusterScoreInput])] = {
    val problems = Seq(c("Obstacle", Some(3)), c("SurfaceProblem", Some(2)), c("NoSidewalk"), c("CurbRamp", Some(1)))
    Seq(
      ("problems on a 25 m street (the floor)", 25.0, problems),
      ("problems on a 10 m street (below the floor)", 10.0, problems),
      ("problems on a 50 m street", 50.0, problems),
      ("problems on a 300 m street", 300.0, problems),
      ("one obstacle on a long street", 400.0, Seq(c("Obstacle", Some(1))))
    )
  }

  /** A seeded random spread: every scored type, every bucket, tags on and off, plus an unscored type. */
  def randomClusters(rng: scala.util.Random, types: Seq[String]): Seq[ClusterScoreInput] =
    Seq.fill(1 + rng.nextInt(12)) {
      val labelType  = types(rng.nextInt(types.size))
      val severity   = rng.nextInt(6) match { case 0 => None; case 5 => Some(5); case s => Some(s) }
      val labelCount = rng.nextInt(4)
      val tags       = AccessScoreCalculator.tagAdjustments.keysIterator.collect {
        case (lt, tag) if lt == labelType => tag
      }
      val tagCounts = tags.filter(_ => rng.nextBoolean()).map(tag => tag -> rng.nextInt(labelCount + 1)).toMap
      c(labelType, severity, labelCount, tagCounts)
    }

  /** Random streets, each with a random length from below the floor to several hundred meters. */
  def randomStreets(seed: Int, count: Int): Seq[(String, Double, Seq[ClusterScoreInput])] = {
    val rng   = new scala.util.Random(seed)
    val types = AccessScoreCalculator.orderedScoredTypes :+ "Occlusion"
    (1 to count).map { i =>
      val clusters = randomClusters(rng, types)
      val length   = math.round((10.0 + rng.nextDouble() * 390.0) * 10) / 10.0
      (s"random $i", length, clusters)
    }
  }

  /** The hand-picked intersection cases: pooled corner features, scored with no length. */
  val namedIntersections: Seq[(String, Seq[ClusterScoreInput])] = Seq(
    "empty intersection"         -> Seq.empty,
    "four good ramps"            -> Seq.fill(4)(c("CurbRamp", Some(1))),
    "two ramps at a four-way"    -> Seq.fill(2)(c("CurbRamp", Some(1))),
    "missing ramp, no alternate" -> Seq(c("NoCurbRamp", Some(3), tagCounts = Map("no alternate route" -> 1))),
    "signal with APS"            -> Seq(c("Signal", tagCounts = Map("APS" -> 1)), c("Crosswalk", Some(1))),
    "faded crosswalk, bad ramp"  -> Seq(
      c("Crosswalk", Some(2), tagCounts = Map("paint fading" -> 1)),
      c("CurbRamp", Some(3), tagCounts = Map("steep" -> 1))
    ),
    "corner pooled across streets" -> Seq(
      c("CurbRamp", Some(1)),
      c("CurbRamp", Some(2)),
      c("NoCurbRamp", Some(1)),
      c("Crosswalk", Some(1)),
      c("Crosswalk", Some(3)),
      c("Signal")
    )
  )

  /** Random intersections: corner types only, as attribution guarantees. */
  def randomIntersections(seed: Int, count: Int): Seq[(String, Seq[ClusterScoreInput])] = {
    val rng = new scala.util.Random(seed)
    (1 to count).map(i =>
      s"random intersection $i" -> randomClusters(rng, AccessScoreCalculator.orderedIntersectionTypes)
    )
  }

  /** Headline cases: (name, segment score, end intersection scores). */
  val headlineCases: Seq[(String, Option[Double], Seq[Double])] = Seq(
    ("segment and both ends", Some(0.2), Seq(0.5, 0.8)),
    ("segment and one end", Some(0.2), Seq(0.8)),
    ("segment only", Some(0.2), Seq.empty),
    ("unaudited street between scored crossings", None, Seq(0.4, 0.6)),
    ("nothing scored", None, Seq.empty)
  )

  /** Region roll-up cases: (name, (score, length) pairs). */
  val regionCases: Seq[(String, Seq[(Double, Double)])] = Seq(
    "two streets"        -> Seq((0.2, 100.0), (0.8, 300.0)),
    "single street"      -> Seq((0.42, 50.0)),
    "no audited streets" -> Seq.empty,
    "zero total length"  -> Seq((0.5, 0.0)),
    "three streets"      -> Seq((0.1, 10.0), (0.5, 20.0), (0.9, 70.0))
  )

  /**
   * One unit case in the fixture's JSON shape: inputs, engine outputs, and the outputs under each preset. A street
   * carries its `length_meters` and is scored as a segment; an intersection has no length.
   */
  private def unitJson(name: String, clusters: Seq[ClusterScoreInput], lengthMeters: Option[Double]): JsObject = {
    val severityCounts = AccessScoreCalculator.severityCountsByType(clusters)
    val tagAdjustments = AccessScoreCalculator.tagAdjustmentsByType(clusters)
    val subScores      = AccessScoreCalculator.scoreByType(clusters, lengthMeters)
    val reweighted     = AccessScoreCalculator.presetOrder.filterNot(_ == "default").map { id =>
      val weights = AccessScoreCalculator.signedWeights(AccessScoreCalculator.presets(id))
      val terms   = AccessScoreCalculator.subScoresFromCounts(severityCounts, tagAdjustments, weights, lengthMeters)
      Json.obj(
        "preset"     -> id,
        "sub_scores" -> perType(terms, 0.0),
        "score"      -> AccessScoreCalculator.scoreFromSubScores(terms)
      )
    }
    val base = Json.obj(
      "name"            -> name,
      "clusters"        -> clusters.map(clusterJson),
      "cluster_counts"  -> perType(clusters.groupBy(_.labelType).map { case (t, cs) => t -> cs.size }, 0),
      "severity_counts" -> perTypeBucket(severityCounts),
      "tag_adjustments" -> perType(tagAdjustments, 0.0),
      "sub_scores"      -> perType(subScores, 0.0),
      "score"           -> AccessScoreCalculator.scoreFromSubScores(subScores),
      "reweighted"      -> reweighted
    )
    lengthMeters.fold(base)(len => base + ("length_meters" -> Json.toJson(len)))
  }

  /** The whole fixture. */
  def fixture: JsObject = Json.obj(
    "generated_by" -> "sbt \"Test/runMain service.AccessScoreParityFixtureGen\"",
    "tolerance"    -> 1e-9,
    "config"       -> AccessScoreConfigForApi.current.toJson,
    "streets"      -> (namedStreets.map { case (n, cs) => (n, referenceLength, cs) } ++ lengthStreets ++
      randomStreets(seed = 3855, count = 40)).map { case (n, len, cs) => unitJson(n, cs, Some(len)) },
    "intersections" -> (namedIntersections ++ randomIntersections(seed = 5095, count = 20)).map { case (n, cs) =>
      unitJson(n, cs, None)
    },
    "headlines" -> headlineCases.map { case (name, segment, ends) =>
      Json.obj(
        "name"          -> name,
        "segment_score" -> segment.map(Json.toJson(_)).getOrElse[JsValue](JsNull),
        "end_scores"    -> ends,
        "score" -> AccessScoreCalculator.headlineScore(segment, ends).map(Json.toJson(_)).getOrElse[JsValue](JsNull)
      )
    },
    "regions" -> regionCases.map { case (name, streets) =>
      Json.obj(
        "name"    -> name,
        "streets" -> streets.map { case (score, len) => Json.obj("score" -> score, "length_meters" -> len) },
        "score"   -> AccessScoreCalculator.scoreRegion(streets).map(Json.toJson(_)).getOrElse[JsValue](JsNull),
        "intersection_scores" -> streets.map(_._1),
        "intersection_score"  -> AccessScoreCalculator
          .scoreRegionIntersections(streets.map(_._1))
          .map(Json.toJson(_))
          .getOrElse[JsValue](JsNull)
      )
    }
  )

  def main(args: Array[String]): Unit = {
    val path = Paths.get(fixturePath)
    Files.write(path, (Json.prettyPrint(fixture) + "\n").getBytes(StandardCharsets.UTF_8))
    println(
      s"Wrote ${(fixture \ "streets").as[Seq[JsValue]].size} street and " +
        s"${(fixture \ "intersections").as[Seq[JsValue]].size} intersection cases to $path"
    )
  }
}
