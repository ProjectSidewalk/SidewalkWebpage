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
 * The unit spec pins the arithmetic on hand-built clusters; this one pins the empirical claims the NoSidewalk
 * street-condition term exists to satisfy — that a street's penalty reflects its condition rather than how many pins a
 * labeler dropped, that tagged streets separate the way the docs say, and that `sub_scores` explains `score` on every
 * street — on the distribution of clusters, label counts, and tags that real labelers produce.
 */
class AccessScoreTeaneckSnapshotSpec extends AnyFunSuite with Matchers {

  private val noSidewalk = "NoSidewalk"
  private val eps        = 1e-9

  private case class Street(id: Int, auditCount: Int, lengthMeters: Double)

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

  private lazy val streets: Map[Int, Street] = fixtureLines("teaneck-streets.csv.gz").map { line =>
    val f = line.split(",")
    f(0).toInt -> Street(f(0).toInt, f(1).toInt, f(2).toDouble)
  }.toMap

  private lazy val clustersByStreet: Map[Int, Seq[ClusterScoreInput]] =
    fixtureLines("teaneck-cluster-rows.csv.gz")
      .map { line =>
        val f = splitRow(line, 5)
        f(0).toInt -> ClusterScoreInput(
          labelType = f(1),
          severity = Option(f(2)).filter(_.nonEmpty).map(_.toInt),
          labelCount = f(3).toInt,
          tagCounts = Json.parse(f(4)).as[Map[String, Int]]
        )
      }
      .groupMap(_._1)(_._2)

  /** Every audited street with its clusters (possibly none), the population the API scores. */
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
