package service

import org.scalatest.funsuite.AnyFunSuite
import org.scalatest.matchers.should.Matchers
import play.api.libs.json.Json
import service.AccessScoreCalculator.ClusterScoreInput

import java.util.zip.GZIPInputStream
import scala.io.Source

/**
 * Scores a real city's worth of clusters with the pure [[AccessScoreCalculator]] and checks what the model does at
 * scale (#5093). No DB, no app boot: the inputs are the Teaneck snapshot under `test/resources/access-score/` (see its
 * README for provenance and how to refresh it).
 *
 * The unit spec pins the arithmetic on hand-built clusters; this one pins the empirical claims the model exists to
 * satisfy — that a street's NoSidewalk penalty reflects its condition rather than how many pins a labeler dropped,
 * that tagged streets separate the way the docs say, that `sub_scores` explains `score` on every street, and that the
 * corner features land on intersections at the measured rates and pool across the streets meeting there (#5095) — on
 * the distribution of clusters, label counts, and tags that real labelers produce.
 */
class AccessScoreTeaneckSnapshotSpec extends AnyFunSuite with Matchers {

  private val noSidewalk = "NoSidewalk"
  private val eps        = 1e-9

  private case class Street(
      id: Int,
      auditCount: Int,
      lengthMeters: Double,
      startIntersectionId: Option[Int],
      endIntersectionId: Option[Int]
  )

  private case class Intersection(id: Int, degree: Int, gradeSeparated: Boolean, auditCount: Int)

  /** A cluster row with the unit it scores: its intersection (#5095) when attributed, else its street. */
  private case class ClusterRow(streetEdgeId: Int, intersectionId: Option[Int], input: ClusterScoreInput)

  /** Lines of a gzipped classpath resource, header excluded. */
  private def fixtureLines(name: String): Seq[String] = {
    val stream = getClass.getResourceAsStream(s"/access-score/$name")
    require(stream != null, s"fixture $name is missing from the test classpath")
    val source = Source.fromInputStream(new GZIPInputStream(stream), "UTF-8")
    try source.getLines().drop(1).toVector
    finally source.close()
  }

  /** Splits a fixture row whose last column is a quoted JSON object (the only column that can contain a comma). */
  private def splitRow(line: String, columns: Int): Array[String] = {
    val fields = line.split(",", columns)
    val last   = fields.last
    fields.updated(
      columns - 1,
      if (last.startsWith("\"")) last.substring(1, last.length - 1).replace("\"\"", "\"") else last
    )
  }

  private def optInt(field: String): Option[Int] = Option(field).filter(_.nonEmpty).map(_.toInt)

  private lazy val streets: Map[Int, Street] = fixtureLines("teaneck-streets.csv.gz").map { line =>
    val f = line.split(",", -1)
    f(0).toInt -> Street(f(0).toInt, f(1).toInt, f(2).toDouble, optInt(f(3)), optInt(f(4)))
  }.toMap

  private lazy val intersections: Map[Int, Intersection] = fixtureLines("teaneck-intersections.csv.gz").map { line =>
    val f = line.split(",", -1)
    f(0).toInt -> Intersection(f(0).toInt, f(1).toInt, f(2) == "t", f(4).toInt)
  }.toMap

  private lazy val clusterRows: Seq[ClusterRow] =
    fixtureLines("teaneck-cluster-rows.csv.gz")
      .map { line =>
        val f = splitRow(line, 6)
        ClusterRow(
          streetEdgeId = f(0).toInt,
          intersectionId = optInt(f(1)),
          input = ClusterScoreInput(
            labelType = f(2),
            severity = optInt(f(3)),
            labelCount = f(4).toInt,
            tagCounts = Json.parse(f(5)).as[Map[String, Int]]
          )
        )
      }
      .filter(r => AccessScoreCalculator.scoredTypeNames.contains(r.input.labelType))

  /** The clusters scoring each street's segment: its own, minus those attributed to an intersection. */
  private lazy val clustersByStreet: Map[Int, Seq[ClusterScoreInput]] =
    clusterRows.filter(_.intersectionId.isEmpty).groupMap(_.streetEdgeId)(_.input)

  /** The clusters pooled on each intersection, from every street meeting there. */
  private lazy val clustersByIntersection: Map[Int, Seq[ClusterScoreInput]] =
    clusterRows.flatMap(r => r.intersectionId.map(_ -> r.input)).groupMap(_._1)(_._2)

  /** Every label type the fixture carries, before the scored-type filter above. */
  private lazy val fixtureTypes: Set[String] =
    fixtureLines("teaneck-cluster-rows.csv.gz").map(line => splitRow(line, 6)(2)).toSet

  /** Every audited street with its segment clusters (possibly none), the population the API scores. */
  private lazy val audited: Seq[(Street, Seq[ClusterScoreInput])] =
    streets.values.toSeq.filter(_.auditCount > 0).sortBy(_.id).map(s => s -> clustersByStreet.getOrElse(s.id, Nil))

  private lazy val withNoSidewalk: Seq[(Street, Seq[ClusterScoreInput])] =
    audited.filter { case (_, cs) => cs.exists(_.labelType == noSidewalk) }

  private lazy val withoutNoSidewalk: Seq[(Street, Seq[ClusterScoreInput])] =
    audited.filterNot { case (_, cs) => cs.exists(_.labelType == noSidewalk) }

  private def noSidewalkClusters(cs: Seq[ClusterScoreInput]): Seq[ClusterScoreInput] =
    cs.filter(_.labelType == noSidewalk)

  /** The street's NoSidewalk term on its own. */
  private def noSidewalkTerm(cs: Seq[ClusterScoreInput]): Double =
    AccessScoreCalculator.scoreByType(noSidewalkClusters(cs)).getOrElse(noSidewalk, 0.0)

  /** Share of the street's pooled NoSidewalk labels carrying `tag`, computed from the raw counts. */
  private def pooledShare(cs: Seq[ClusterScoreInput], tag: String): Double = {
    val ns     = noSidewalkClusters(cs)
    val labels = ns.map(_.labelCount).sum
    if (labels == 0) 0.0 else ns.map(_.tagCounts.getOrElse(tag, 0)).sum.toDouble / labels
  }

  private def median(xs: Seq[Double]): Double = {
    val s = xs.sorted
    if (s.size % 2 == 1) s(s.size / 2) else (s(s.size / 2 - 1) + s(s.size / 2)) / 2
  }

  private def share(xs: Seq[Double])(p: Double => Boolean): Double = xs.count(p).toDouble / xs.size

  private def logit(p: Double): Double   = math.log(p / (1.0 - p))
  private def sigmoid(t: Double): Double = 1.0 / (1.0 + math.exp(-t))

  test("the fixture covers exactly the scored types, so a refresh can't silently stop exercising one") {
    // The README's extraction SQL hardcodes this list. If the two drift, the failure belongs here rather than
    // surfacing later as an unrelated assertion about scoreByType's key set.
    withClue("update the WHERE clause in test/resources/access-score/README.md to match scoredTypeNames: ") {
      fixtureTypes shouldBe AccessScoreCalculator.scoredTypeNames
    }
  }

  test("the snapshot is large enough to be meaningful, and exhibits the NoSidewalk density it exists to test") {
    audited.size should be >= 2000
    withNoSidewalk.size should be >= 600
    val clusterCounts = withNoSidewalk.map { case (_, cs) => noSidewalkClusters(cs).size.toDouble }
    // Labelers pin a missing sidewalk repeatedly: half of these streets carry 4+ NoSidewalk clusters, some dozens.
    median(clusterCounts) should be >= 3.0
    clusterCounts.max should be >= 20.0
    info(f"${audited.size} audited streets, ${withNoSidewalk.size} with NoSidewalk (median ${median(clusterCounts)}%.0f clusters, max ${clusterCounts.max}%.0f)")
  }

  test("sub_scores explain score on every audited street: the per-type terms sum to the score's logit") {
    audited.foreach { case (street, cs) =>
      val byType = AccessScoreCalculator.scoreByType(cs)
      val score  = AccessScoreCalculator.scoreStreet(cs)
      withClue(s"street ${street.id}: ") {
        AccessScoreCalculator.scoreFromSubScores(byType) shouldBe (score +- eps)
        logit(score) shouldBe (byType.values.sum +- 1e-9)
        byType.keySet should contain theSameElementsAs cs.map(_.labelType).distinct
      }
    }
  }

  test("streets without NoSidewalk are scored cluster by cluster, with nothing pooled") {
    withoutNoSidewalk.size should be >= 1000
    withoutNoSidewalk.foreach { case (street, cs) =>
      val perCluster = cs.groupMapReduce(_.labelType)(AccessScoreCalculator.scoreCluster)(_ + _)
      withClue(s"street ${street.id}: ") {
        AccessScoreCalculator.scoreByType(cs) shouldBe perCluster
      }
    }
  }

  test("pooling keeps NoSidewalk streets off the floor, where a per-cluster additive weight would leave most of them") {
    val pooled = withNoSidewalk.map { case (_, cs) => AccessScoreCalculator.scoreStreet(cs) }
    // The alternative this model rejects: the same base weight charged for every cluster, no pooling.
    val perCluster = withNoSidewalk.map { case (_, cs) =>
      val others = AccessScoreCalculator.scoreByType(cs).removed(noSidewalk).values.sum
      sigmoid(others + AccessScoreCalculator.typeWeights(noSidewalk).baseWeight * noSidewalkClusters(cs).size)
    }
    share(perCluster)(_ < 0.05) should be >= 0.6
    share(pooled)(_ < 0.05) should be <= 0.3
    median(pooled) should be >= 0.08
    // A missing sidewalk is still a strong penalty: these streets sit well below the neutral 0.5 of an empty street.
    median(pooled) should be <= 0.25
    median(pooled) should be < median(withoutNoSidewalk.map { case (_, cs) => AccessScoreCalculator.scoreStreet(cs) })
    info(
      f"NoSidewalk streets: median ${median(pooled)}%.3f, ${share(pooled)(_ < 0.05) * 100}%.0f%% below 0.05 (per-cluster alternative: median ${median(perCluster)}%.3f, ${share(perCluster)(_ < 0.05) * 100}%.0f%% below 0.05)"
    )
  }

  test("once saturated, the untagged NoSidewalk term is the base weight whether the street has 3 clusters or 60") {
    val untaggedSaturated = withNoSidewalk.filter { case (_, cs) =>
      val ns = noSidewalkClusters(cs)
      ns.size >= AccessScoreCalculator.streetConditionSaturationCount && ns.forall(_.tagCounts.isEmpty)
    }
    untaggedSaturated.size should be >= 100
    val counts = untaggedSaturated.map { case (_, cs) => noSidewalkClusters(cs).size }
    counts.max should be >= 20 // The invariance is tested across a wide range of densities, not a narrow one.
    untaggedSaturated.foreach { case (street, cs) =>
      withClue(s"street ${street.id} (${noSidewalkClusters(cs).size} clusters): ") {
        noSidewalkTerm(cs) shouldBe (AccessScoreCalculator.typeWeights(noSidewalk).baseWeight +- eps)
      }
    }
  }

  test("below saturation the term grows with each cluster, so a stray pin never scores like a whole missing sidewalk") {
    val base     = AccessScoreCalculator.typeWeights(noSidewalk).baseWeight
    val untagged = withNoSidewalk.filter { case (_, cs) => noSidewalkClusters(cs).forall(_.tagCounts.isEmpty) }
    (1 until AccessScoreCalculator.streetConditionSaturationCount).foreach { n =>
      val atN = untagged.filter { case (_, cs) => noSidewalkClusters(cs).size == n }
      atN.size should be >= 20
      atN.foreach { case (_, cs) =>
        noSidewalkTerm(cs) shouldBe (base * n / AccessScoreCalculator.streetConditionSaturationCount +- eps)
      }
    }
  }

  test("real streets separate by their pooled sidewalk tags: no sidewalks < untagged < a sidewalk on the other side") {
    val threshold                                                = AccessScoreCalculator.tagActiveThreshold
    def group(p: Seq[ClusterScoreInput] => Boolean): Seq[Double] =
      withNoSidewalk.collect { case (_, cs) if p(cs) => AccessScoreCalculator.scoreStreet(cs) }

    val noSidewalks = group(cs => pooledShare(cs, "street has no sidewalks") >= threshold)
    val otherSide   = group(cs => pooledShare(cs, "street has a sidewalk") >= threshold)
    val untagged    = group(cs => noSidewalkClusters(cs).forall(_.tagCounts.isEmpty))

    noSidewalks.size should be >= 40
    otherSide.size should be >= 40
    untagged.size should be >= 200
    median(noSidewalks) should be < median(untagged)
    median(untagged) should be < median(otherSide)
    info(f"medians — no sidewalks ${median(noSidewalks)}%.3f (${noSidewalks.size}), untagged ${median(untagged)}%.3f (${untagged.size}), other side has one ${median(otherSide)}%.3f (${otherSide.size})")
  }

  test("'ends abruptly' fires on the one pin marking where the sidewalk stops, and costs exactly its delta") {
    val threshold = AccessScoreCalculator.tagActiveThreshold
    val delta     = AccessScoreCalculator.tagAdjustments((noSidewalk, "ends abruptly"))
    val endsHere  = withNoSidewalk.filter { case (_, cs) =>
      noSidewalkClusters(cs).exists(c =>
        c.labelCount > 0 && c.tagCounts.getOrElse("ends abruptly", 0).toDouble / c.labelCount >= threshold
      )
    }
    // Most such streets carry the tag on a single cluster, which a pooled majority would miss on all but short streets.
    endsHere.size should be >= 100
    endsHere.count { case (_, cs) => pooledShare(cs, "ends abruptly") < threshold } should be >= endsHere.size / 2

    endsHere.foreach { case (street, cs) =>
      val stripped = cs.map(c => c.copy(tagCounts = c.tagCounts.removed("ends abruptly")))
      withClue(s"street ${street.id}: ") {
        noSidewalkTerm(cs) - noSidewalkTerm(stripped) shouldBe (delta +- eps)
      }
    }
  }

  // --- Intersections and length normalization (#5095) ---

  /** Segment score of a street from its own clusters and length, as the API computes it. */
  private def segmentScore(street: Street, cs: Seq[ClusterScoreInput]): Double =
    AccessScoreCalculator.scoreStreet(cs, Some(street.lengthMeters))

  private def intersectionScore(id: Int): Option[Double] =
    intersections.get(id).filter(i => i.auditCount > 0 && !i.gradeSeparated).map { _ =>
      AccessScoreCalculator.scoreStreet(clustersByIntersection.getOrElse(id, Nil))
    }

  test("the corner types land on intersections and the along-length types never do, at the measured rates") {
    val byType = clusterRows.groupBy(_.input.labelType)
    AccessScoreCalculator.intersectionTypeNames.foreach { t =>
      val rows = byType.getOrElse(t, Nil)
      rows.size should be >= 100
      // The 5-11% left are mid-block crosswalks and driveway ramps; they stay with their street.
      withClue(s"$t attached share: ") {
        share(rows.map(r => if (r.intersectionId.isDefined) 1.0 else 0.0))(_ > 0) should be >= 0.85
      }
    }
    AccessScoreCalculator.segmentTypeNames.foreach { t =>
      withClue(s"$t must never be attributed: ") {
        byType.getOrElse(t, Nil).forall(_.intersectionId.isEmpty) shouldBe true
      }
    }
    info(
      AccessScoreCalculator.orderedIntersectionTypes
        .map { t =>
          val rows = byType.getOrElse(t, Nil)
          f"$t ${100.0 * rows.count(_.intersectionId.isDefined) / rows.size}%.0f%% of ${rows.size}"
        }
        .mkString(", ")
    )
  }

  test("the snapshot's intersections look like a street grid: mostly 3- and 4-way, a few grade-separated crossings") {
    intersections.size should be >= 900
    intersections.values.forall(_.degree >= 3) shouldBe true
    val degrees = intersections.values.groupBy(_.degree).view.mapValues(_.size).toMap
    degrees(3) + degrees(4) should be >= (intersections.size * 0.95).toInt
    val separated = intersections.values.count(_.gradeSeparated)
    separated should (be >= 5 and be <= 50)
    // A grade-separated node never holds a cluster: attribution skips it.
    intersections.values.filter(_.gradeSeparated).foreach { i =>
      withClue(s"intersection ${i.id}: ") { clustersByIntersection.get(i.id) shouldBe None }
    }
    info(
      f"${intersections.size} intersections: ${degrees.toSeq.sorted.map { case (d, n) => s"$d-way $n" }.mkString(", ")}; $separated grade-separated"
    )
  }

  test("intersections pool ramps from every street meeting there, and score them with no length factor") {
    val pooled = clustersByIntersection.filter { case (id, cs) =>
      intersections.get(id).exists(_.auditCount > 0) && cs.size >= 2
    }
    pooled.size should be >= 300
    // Most scored intersections draw clusters from more than one of their streets: that is the point of pooling.
    val multiStreet = pooled.keys.count { id =>
      clusterRows.filter(_.intersectionId.contains(id)).map(_.streetEdgeId).distinct.size >= 2
    }
    multiStreet.toDouble / pooled.size should be >= 0.5
    pooled.foreach { case (id, cs) =>
      val byType = AccessScoreCalculator.scoreByType(cs)
      withClue(s"intersection $id: ") {
        byType.keySet.subsetOf(AccessScoreCalculator.intersectionTypeNames) shouldBe true
        // Compared in score space: a corner with a dozen good ramps sits at sigmoid(17), where the logit is lost.
        intersectionScore(id).get shouldBe (AccessScoreCalculator.scoreFromSubScores(byType) +- eps)
      }
    }
    val scores = pooled.keys.toSeq.flatMap(intersectionScore)
    info(
      f"${pooled.size} intersections with 2+ clusters, ${100.0 * multiStreet / pooled.size}%.0f%% pooling across streets, median score ${median(scores)}%.3f"
    )
  }

  test("length normalization: the same problem density scores alike whatever the street's length") {
    // One Obstacle and nothing else: the term is base × multiplier × factor, a pure function of length.
    val oneObstacle = audited.collect {
      case (s, cs) if cs.size == 1 && cs.head.labelType == "Obstacle" => (s, cs)
    }
    oneObstacle.size should be >= 20
    oneObstacle.foreach { case (s, cs) =>
      val expected = AccessScoreCalculator.scoreCluster(cs.head) * AccessScoreCalculator.lengthFactor(s.lengthMeters)
      logit(segmentScore(s, cs)) shouldBe (expected +- 1e-9)
    }
    val byLength = oneObstacle.groupBy { case (s, _) =>
      if (s.lengthMeters < 50) "<50m" else if (s.lengthMeters < 150) "50-150m" else ">=150m"
    }
    val medians = byLength.view.mapValues(g => median(g.map { case (s, cs) => segmentScore(s, cs) })).toMap
    medians.get("<50m").zip(medians.get(">=150m")).foreach { case (short, long) => short should be < long }
    info(medians.toSeq.sortBy(_._1).map { case (b, m) => f"$b median ${m}%.3f (${byLength(b).size})" }.mkString(", "))
  }

  test("a street's headline is the mean of its segment and its scored ends, and both ends are usually scored") {
    // Teaneck: 58% of audited streets have an intersection at both ends; the rest end at a dead end or a way
    // split (a region boundary, a curve the import kept).
    val withEnds = audited.filter { case (s, _) => s.startIntersectionId.isDefined && s.endIntersectionId.isDefined }
    withEnds.size.toDouble / audited.size should be >= 0.5
    var bothScored = 0
    audited.foreach { case (s, cs) =>
      val segment  = segmentScore(s, cs)
      val ends     = Seq(s.startIntersectionId, s.endIntersectionId).flatten.flatMap(intersectionScore)
      val headline = AccessScoreCalculator.headlineScore(Some(segment), ends).get
      if (ends.size == 2) bothScored += 1
      withClue(s"street ${s.id}: ") { headline shouldBe ((segment +: ends).sum / (ends.size + 1) +- 1e-9) }
    }
    bothScored.toDouble / audited.size should be >= 0.4
    info(
      f"${audited.size} audited streets, ${100.0 * withEnds.size / audited.size}%.0f%% with an intersection at both ends, ${100.0 * bothScored / audited.size}%.0f%% with both scored"
    )
  }

  test("the NoSidewalk term stays within the bounds the weight table implies on every street") {
    val base    = AccessScoreCalculator.typeWeights(noSidewalk).baseWeight
    val deltas  = AccessScoreCalculator.tagAdjustments.collect { case ((`noSidewalk`, _), d) => d }
    val floor   = base + deltas.filter(_ < 0).sum
    val ceiling = base / AccessScoreCalculator.streetConditionSaturationCount + deltas.filter(_ > 0).sum
    withNoSidewalk.foreach { case (street, cs) =>
      withClue(s"street ${street.id}: ") {
        noSidewalkTerm(cs) should (be >= floor - eps and be <= ceiling + eps)
      }
    }
  }
}
