package models.report

import models.api.{LabelClusterForApi, LabelDataForApi, StreetAccessScoreForApi}
import models.label.{LabelType, RatingScale}
import models.utils.{LatLngBBox, NamedEnum, NamedEnumCompanion}
import play.api.i18n.Messages
import play.api.libs.json.{JsObject, JsValue, Json}
import service.AccessScoreCalculator.{ClusterScoreInput, Scoring}
import service.{AccessScoreCalculator, AccessScoreSpotlight}

import java.time.{LocalDate, OffsetDateTime}

/**
 * Who a neighborhood report is written for (#5876). A preset changes vocabulary, the headline's sentence, and section
 * order; it never changes a number, so two readers holding different presets can compare them.
 *
 * @param name The `?preset=` value, and the suffix of the preset-specific message keys.
 */
enum ReportPreset(val name: String) extends NamedEnum {
  case Advocate    extends ReportPreset("advocate")
  case Coordinator extends ReportPreset("coordinator")
}

object ReportPreset extends NamedEnumCompanion[ReportPreset] {

  /**
   * @param param The raw `?preset=` value.
   * @return The preset it names, or Advocate: a mistyped link should still show the report rather than an error.
   */
  def fromParam(param: Option[String]): ReportPreset = param.flatMap(withNameOption).getOrElse(Advocate)
}

/**
 * One label as the report reads it: the Raw Labels API's row, narrowed to the fields the report uses, with its votes
 * reduced to human ones. Reviewers in the report are people, so AI votes never reach these counts.
 *
 * @param correct The site's consensus verdict on the label, `Some(false)` when review marked it incorrect
 */
case class ReportLabel(
    labelId: Int,
    labelType: LabelType,
    severity: Option[Int],
    tags: List[String],
    streetEdgeId: Int,
    userId: String,
    panoId: String,
    timeCreated: OffsetDateTime,
    correct: Option[Boolean],
    humanAgree: Int,
    humanDisagree: Int,
    humanUnsure: Int,
    imageCaptureDate: Option[String],
    canvasX: Option[Int],
    canvasY: Option[Int],
    canvasWidth: Option[Int],
    canvasHeight: Option[Int]
) {
  def humanVotes: Int = humanAgree + humanDisagree + humanUnsure

  /** More human reviewers agreed than disagreed: what the report calls confirmed. */
  def confirmed: Boolean = humanAgree > humanDisagree

  /** At least one person agreed and nobody disagreed: strong enough to put in front of someone as a thing to fix. */
  def uncontested: Boolean = humanAgree > 0 && humanDisagree == 0

  /** The year the imagery was captured, when `capture_date` (free text, e.g. "2022-02") starts with one. */
  def imageryYear: Option[Int] =
    imageCaptureDate.map(_.trim).filter(_.matches("""\d{4}($|-.*)""")).map(_.take(4).toInt)
}

object ReportLabel {
  private val HumanValidator = "Human"

  /** @return The report's view of a Raw Labels row. */
  def fromApi(label: LabelDataForApi): ReportLabel = {
    val human = label.validations.filter(_.validatorType == HumanValidator).map(_.validationType)
    ReportLabel(
      labelId = label.labelId,
      labelType = LabelType.withName(label.labelType),
      severity = label.severity,
      tags = label.tags,
      streetEdgeId = label.streetEdgeId,
      userId = label.userId,
      panoId = label.panoId,
      timeCreated = label.timeCreated,
      correct = label.correct,
      humanAgree = human.count(_ == "Agree"),
      humanDisagree = human.count(_ == "Disagree"),
      humanUnsure = human.count(_ == "Unsure"),
      imageCaptureDate = label.imageCaptureDate,
      canvasX = label.canvasX,
      canvasY = label.canvasY,
      canvasWidth = label.canvasWidth,
      canvasHeight = label.canvasHeight
    )
  }
}

/**
 * One location as AccessScore scores it: a label cluster, which is what several people labeling the same feature come
 * to. The report counts these wherever it speaks about a score, and links each to the labels inside it.
 *
 * @param severity       The cluster's median rating, the one its score uses
 * @param intersectionId The intersection it scores, or None when it scores its own street's block
 * @param tagCounts      How many of those labels carry each tag
 */
case class ReportLocation(
    clusterId: Int,
    labelType: LabelType,
    severity: Option[Int],
    streetEdgeId: Int,
    intersectionId: Option[Int],
    labelIds: Seq[Int],
    tagCounts: Map[String, Int],
    latitude: Double,
    longitude: Double
) {

  def scoreInput: ClusterScoreInput = ClusterScoreInput(labelType.name, severity, labelIds.size, tagCounts)

  /** @return Whether this location's rating sits at the worst end of its type's scale. */
  def isWorst: Boolean = severity.isDefined && severity == ReportRules.worstRating(labelType.ratingScale)

  /** @return Whether this is a missing curb ramp whose labelers recorded that there is no way around it. */
  def hasNoAlternateRoute: Boolean =
    labelType == LabelType.NoCurbRamp &&
      AccessScoreCalculator.tagActive(tagCounts.getOrElse(ReportRules.NoAlternateRouteTag, 0), labelIds.size)
}

object ReportLocation {

  def fromApi(cluster: LabelClusterForApi): ReportLocation =
    ReportLocation(
      clusterId = cluster.labelClusterId, labelType = LabelType.withName(cluster.labelType),
      severity = cluster.medianSeverity, streetEdgeId = cluster.streetEdgeId, intersectionId = cluster.intersectionId,
      labelIds = cluster.labelIds, tagCounts = cluster.tagCounts, latitude = cluster.avgLatitude,
      longitude = cluster.avgLongitude
    )
}

/**
 * Locations indexed the way the scoring engine assigns them: to an intersection if the cluster has one, otherwise to
 * its street's block. A crossing's clusters can sit on a street in the neighboring region, so this has to hold every
 * location near the region and not only those whose street is in it.
 */
case class ReportEvidence(locations: Seq[ReportLocation]) {
  private val onBlock: Map[Int, Seq[ReportLocation]] =
    locations.filter(_.intersectionId.isEmpty).groupBy(_.streetEdgeId)
  private val atCrossing: Map[Int, Seq[ReportLocation]] =
    locations.flatMap(l => l.intersectionId.map(_ -> l)).groupMap(_._1)(_._2)

  def block(streetEdgeId: Int): Seq[ReportLocation] = onBlock.getOrElse(streetEdgeId, Seq.empty)

  def crossing(intersectionId: Int): Seq[ReportLocation] = atCrossing.getOrElse(intersectionId, Seq.empty)
}

/**
 * One thing a street's score could be relieved of: a location, or for a type scored as a street's condition, one
 * edge's whole pool of locations, since removing a single pin from a pool usually moves nothing.
 *
 * @param costPoints How far the stretch's score, on its 0-100 scale, would rise without this item
 */
case class ReportItem(locations: Seq[ReportLocation], costPoints: Double) {
  def labelType: LabelType = locations.head.labelType

  /** @return The rating to state for this item: the first location's median, which is also the pool's for an unrated type. */
  def severity: Option[Int] = locations.head.severity

  def labelIds: Seq[Int] = locations.flatMap(_.labelIds)
}

/**
 * One OSM way's explored edges within the region, rolled up the way the AccessScore Spotlight rolls them: the name a
 * reader recognizes, one number per stretch. Only explored edges carry a score here. An unexplored edge's published
 * score comes from the crossings at its ends alone, which says nothing of the block.
 *
 * @param toolEdgeId         The longest explored edge, which the AccessScore tool opens on
 * @param edgeIds            The explored edges, which are what the map highlights and the score describes
 * @param score              Length-weighted mean of the explored edges' published scores
 * @param blockScore         The same mean of their block scores
 * @param crossingScore      The same mean of their crossings' scores, over the edges with a scored crossing
 * @param slopePoints        How many points slope takes off `score`, when sampled and big enough to state
 * @param totalMeters        Length of the whole way in the region, explored or not
 * @param blockLocationCount Locations along the blocks, excluding crossings: what Spotlight's evidence bar counts
 * @param locations          Every location behind the score, blocks and crossings, once each
 * @param items              What costs the stretch the most, costliest first; items that help the score aren't here
 */
case class ReportStretch(
    osmWayId: Long,
    name: Option[String],
    toolEdgeId: Int,
    edgeIds: Seq[Int],
    score: Double,
    blockScore: Option[Double],
    crossingScore: Option[Double],
    slopePoints: Option[Double],
    exploredMeters: Double,
    totalMeters: Double,
    blockLocationCount: Int,
    auditCount: Int,
    locations: Seq[ReportLocation],
    items: Seq[ReportItem]
) {

  def isRanked: Boolean =
    AccessScoreSpotlight.stretchIsRanked(totalMeters, auditCount, blockLocationCount, Some(score))
}

object ReportStretch {

  // Under half a point rounds to nothing on the page, so it isn't worth a sentence saying slope mattered.
  private val MinSlopePoints: Double = 0.5

  /** @return An edge's scored end intersections, as the engine averaged them. */
  private def scoredEnds(edge: StreetAccessScoreForApi): Seq[(Int, Double)] =
    Seq(
      edge.startIntersectionId.zip(edge.startIntersectionScore),
      edge.endIntersectionId.zip(edge.endIntersectionScore)
    ).flatten

  /**
   * @param wayEdges Every edge of one way in one region
   * @return The rolled-up stretch, or None when none of the edges has been explored.
   */
  def build(wayEdges: Seq[StreetAccessScoreForApi], evidence: ReportEvidence): Option[ReportStretch] = {
    val edges = wayEdges.filter(e => e.auditCount > 0 && e.score.isDefined)
    AccessScoreSpotlight.stretchScore(edges.flatMap(e => e.score.map(_ -> e.lengthMeters))).map { score =>
      val locations = edges
        .flatMap(e => evidence.block(e.streetEdgeId) ++ scoredEnds(e).flatMap { case (id, _) => evidence.crossing(id) })
        .distinctBy(_.clusterId)
      ReportStretch(
        osmWayId = edges.head.osmWayId,
        name = wayEdges.flatMap(_.streetName).headOption,
        toolEdgeId = edges.maxBy(_.lengthMeters).streetEdgeId,
        edgeIds = edges.map(_.streetEdgeId),
        score = score,
        blockScore = AccessScoreSpotlight.stretchScore(edges.flatMap(e => e.segmentScore.map(_ -> e.lengthMeters))),
        crossingScore = AccessScoreSpotlight.stretchScore(
          edges.flatMap { e =>
            val ends = scoredEnds(e).map(_._2)
            Option.when(ends.nonEmpty)((ends.sum / ends.size, e.lengthMeters))
          }
        ),
        slopePoints = slopePoints(edges),
        exploredMeters = edges.map(e => math.max(0.0, e.lengthMeters)).sum,
        totalMeters = wayEdges.map(e => math.max(0.0, e.lengthMeters)).sum,
        blockLocationCount = edges.map(_.clusterCounts.values.sum).sum,
        auditCount = edges.map(_.auditCount).sum,
        locations = locations,
        items = costlyItems(edges, locations, evidence)
      )
    }
  }

  /** @return How far slope pulls the stretch's score down in points, or None when it isn't worth stating. */
  private def slopePoints(edges: Seq[StreetAccessScoreForApi]): Option[Double] = {
    val lost = edges.flatMap { e =>
      e.score.map { published =>
        val withoutSlope = AccessScoreCalculator.headlineScore(
          Some(AccessScoreCalculator.scoreFromSubScores(e.subScores)),
          scoredEnds(e).map(_._2)
        )
        (withoutSlope.getOrElse(published) - published, e.lengthMeters)
      }
    }
    AccessScoreSpotlight.stretchScore(lost).map(_ * 100).filter(_ >= MinSlopePoints)
  }

  /**
   * Prices every item by rebuilding the stretch's score without it. A crossing's location is priced across every edge
   * meeting there, which is why the rebuild is of the stretch and not of the one edge the location sits on.
   *
   * @return The items that cost the stretch something, costliest first.
   */
  private def costlyItems(
      edges: Seq[StreetAccessScoreForApi],
      locations: Seq[ReportLocation],
      evidence: ReportEvidence
  ): Seq[ReportItem] = {
    def scoreWithout(removed: Set[Int]): Double = {
      def inputs(ls: Seq[ReportLocation]) = ls.filterNot(l => removed(l.clusterId)).map(_.scoreInput)
      val rebuilt                         = edges.map { e =>
        AccessScoreCalculator.headlineFromClusters(
          inputs(evidence.block(e.streetEdgeId)),
          e.lengthMeters,
          e.slopeTerm,
          scoredEnds(e).map { case (id, _) => inputs(evidence.crossing(id)) }
        ) -> e.lengthMeters
      }
      AccessScoreSpotlight.stretchScore(rebuilt).getOrElse(0.0)
    }

    val baseline = scoreWithout(Set.empty)
    groupIntoItems(locations)
      .map(ls => ReportItem(ls, (scoreWithout(ls.map(_.clusterId).toSet) - baseline) * 100))
      .filter(_.costPoints > 0)
      .sortBy(i => (-i.costPoints, i.locations.head.clusterId))
  }

  /** @return The locations grouped into what the score treats as one thing; see [[ReportItem]]. */
  private def groupIntoItems(locations: Seq[ReportLocation]): Seq[Seq[ReportLocation]] = {
    val (pooled, points) = locations.partition { l =>
      AccessScoreCalculator.typeWeights.get(l.labelType.name).exists(_.scoring == Scoring.StreetCondition)
    }
    points.map(Seq(_)) ++ pooled.groupBy(l => (l.labelType, l.streetEdgeId)).values.toSeq
  }
}

/**
 * A street as the page lists it: once per name, at its lowest ranked stretch. Averaging a whole name would bury a bad
 * stretch under a good one (NW 61st St in Seattle's Adams is 5.5 over 404 m, 86.1 over 856 m and 53.5 over 189 m, 59.4
 * as a whole), and would print a number that matches nothing a link to the AccessScore tool lands on.
 *
 * @param worst               The stretch the row's number and evidence describe
 * @param wholeScore          Length-weighted across every explored stretch with this name in the region
 */
case class ReportStreet(worst: ReportStretch, wholeScore: Double, wholeExploredMeters: Double, stretchCount: Int)

object ReportStreet {

  /**
   * Which street an edge or stretch belongs to. Names that differ only in case are one street; an unnamed way has
   * nothing saying it joins any other.
   *
   * @return The key that identifies the street within a region.
   */
  def streetKey(name: Option[String], osmWayId: Long): Either[String, Long] =
    name.map(_.trim.toLowerCase).toLeft(osmWayId)

  /**
   * @return The ranked streets, lowest score first. Ties go to the longer explored stretch, then to the name, then to
   *         the way id, so two loads of the same data agree.
   */
  def rank(stretches: Seq[ReportStretch]): Seq[ReportStreet] =
    stretches
      .groupBy(s => streetKey(s.name, s.osmWayId))
      .values
      .flatMap { group =>
        val ranked = group.filter(_.isRanked)
        ranked.minByOption(s => (s.score, -s.exploredMeters, s.osmWayId)).map { worst =>
          ReportStreet(
            worst = worst,
            wholeScore = AccessScoreSpotlight.stretchScore(group.map(s => s.score -> s.exploredMeters)).get,
            wholeExploredMeters = group.map(_.exploredMeters).sum,
            stretchCount = group.size
          )
        }
      }
      .toSeq
      .sortBy(s => (s.worst.score, -s.worst.exploredMeters, s.worst.name.getOrElse(""), s.worst.osmWayId))
}

/** The rules that decide what the page calls bad and what it puts in front of a reader as a thing to fix. */
object ReportRules {

  // The tag as the database spells it; AccessScoreCalculator weighs the same one.
  val NoAlternateRouteTag: String = "no alternate route"

  /**
   * Which rating is the bad end of a type's scale. Both rated scales currently end badly at 3 (quality: 1 good, 3 bad;
   * severity: 1 low, 3 high), and the match is exhaustive so that a new scale has to answer this question.
   *
   * @return The worst rating, or None for a type that carries no rating.
   */
  def worstRating(scale: RatingScale): Option[Int] = scale match {
    case RatingScale.Quality | RatingScale.Severity => Some(3)
    case RatingScale.Unrated                        => None
  }

  /** @return Whether this label sits at the worst end of its type's rating scale. */
  def isWorst(label: ReportLabel): Boolean =
    label.severity.isDefined && label.severity == worstRating(label.labelType.ratingScale)

  /** @return Whether the report counts this label: everything except what review marked incorrect. */
  def isCounted(label: ReportLabel): Boolean = !label.correct.contains(false)

  /** How many points an item must cost its street to be listed as a fix. */
  val FixMinPoints: Double = 1.0

  /** @return Whether an item's rating is bad enough to name as a fix: at or next to the worst, or a type with no scale. */
  private def ratedAsFix(item: ReportItem): Boolean = worstRating(item.labelType.ratingScale) match {
    case None        => true
    case Some(worst) => item.severity.exists(_ >= worst - 1)
  }

  // Confirmed before unchecked, and either before one that reviewers lean against.
  private def reviewRank(label: ReportLabel): Int =
    if (label.confirmed) 0 else if (label.humanDisagree == 0) 1 else 2

  /** @return The labels behind an item that carry the rating it's scored at, or all of them if none does. */
  private def membersAtRating(item: ReportItem, labels: Map[Int, ReportLabel]): Seq[ReportLabel] = {
    val members = item.locations.flatMap(l => l.labelIds.flatMap(labels.get).map(l -> _))
    val exact   = members.collect { case (l, label) if label.severity == l.severity => label }
    if (exact.nonEmpty) exact else members.map(_._2)
  }

  /**
   * The label to show for an item: one a reader looking at the photo would rate the way the score does, with a crop
   * where one exists, confirmed before unchecked.
   *
   * @return The label, or None when every label behind the item was marked incorrect since clustering.
   */
  def representative(
      item: ReportItem,
      labels: Map[Int, ReportLabel],
      hasCrop: ReportLabel => Boolean
  ): Option[ReportLabel] =
    membersAtRating(item, labels)
      .sortBy(l => (!hasCrop(l), reviewRank(l), -l.humanAgree, l.labelId))
      .headOption

  /**
   * Everything a street's section shows: each location with the label that pictures it, costliest first, then those
   * that cost nothing, which is where its curb ramps and other features sit.
   *
   * @return One card per location, leaving out any whose labels have all been marked incorrect since clustering.
   */
  def cards(
      stretch: ReportStretch,
      labels: Map[Int, ReportLabel],
      hasCrop: ReportLabel => Boolean
  ): Seq[ReportCard] = {
    val itemOf    = stretch.items.flatMap(i => i.locations.map(_.clusterId -> i)).toMap
    val typeOrder = LabelType.ordered.zipWithIndex.toMap
    stretch.locations
      .flatMap { location =>
        val item = itemOf.get(location.clusterId)
        val cost = item.fold(0.0)(_.costPoints)
        representative(ReportItem(Seq(location), cost), labels, hasCrop)
          .map(ReportCard(location, _, cost, item.fold(1)(_.locations.size)))
      }
      // By each location's own share, so a street with fifty of one pooled item doesn't open on fifty alike.
      .sortBy(c =>
        (-c.costPoints / c.poolSize, typeOrder.getOrElse(c.location.labelType, Int.MaxValue), c.location.clusterId)
      )
  }

  /**
   * The fixes list, at most one per street. An item qualifies when it costs its stretch at least [[FixMinPoints]], is
   * rated at or next to the worst of its type's scale, and has a label at that rating which a reviewer agreed with and
   * none disagreed with. A crossing can be the pick of two streets meeting there, and is listed for the first.
   *
   * @param ranked  Streets in rank order, whatever their score: a street above the bar for the list can still hold the
   *                neighborhood's clearest fix
   * @return The picks in rank order, each with the label to show. Fewer than `size` when too few streets qualify.
   */
  def fixes(
      ranked: Seq[ReportStreet],
      labels: Map[Int, ReportLabel],
      size: Int,
      hasCrop: ReportLabel => Boolean
  ): Seq[(ReportStreet, ReportItem, ReportLabel)] = {
    val seen = scala.collection.mutable.Set.empty[Int]
    ranked.iterator
      .flatMap { street =>
        street.worst.items.iterator
          .filter(i => i.costPoints >= FixMinPoints && ratedAsFix(i) && !i.locations.exists(l => seen(l.clusterId)))
          .flatMap { item =>
            membersAtRating(item, labels)
              .filter(_.uncontested)
              .sortBy(l => (!hasCrop(l), -l.humanAgree, l.labelId))
              .headOption
              .map(label => (street, item, label))
          }
          .take(1)
          .tapEach { case (_, item, _) => seen ++= item.locations.map(_.clusterId) }
      }
      .take(size)
      .toSeq
  }
}

/**
 * The generated headline: a message key, without its preset suffix, its arguments, and the locations the sentence is
 * about so the page can link to their labels.
 */
case class ReportHeadline(key: String, args: Seq[Int], locationCount: Int, labelIds: Seq[Int])

/**
 * Picks the one sentence at the top of the report. Candidates are tried in order and each states the bar it has to
 * clear, so a sentence is never generated from too few observations to mean anything. All of them speak about the
 * region's distinct locations, not about listed streets, where a shared crossing would be counted once per street.
 */
object HeadlineRule {
  val NoAlternateRouteMinCount: Int    = 5
  val NoAlternateRouteMinShare: Double = 0.1
  val NoSidewalkMinStreets: Int        = 3
  val NoSidewalkMinShare: Double       = 0.25
  val ConcentrationStreets: Int        = 3
  val ConcentrationMinWorst: Int       = 10
  val ConcentrationMinShare: Double    = 0.3

  /**
   * @param streetKey     The street a location's own street edge belongs to, by edge id
   * @param exploredCount How many distinct streets in the region have been explored
   * @return The headline: no-alternate-route when that's substantial, else missing sidewalks when they span enough
   *         streets, else concentration on a few streets, else the count at the worst rating, else a statement that
   *         there are none.
   */
  def select(locations: Seq[ReportLocation], streetKey: Int => Any, exploredCount: Int): ReportHeadline = {
    def headline(key: String, args: Seq[Int], about: Seq[ReportLocation]) =
      ReportHeadline(key, args, about.size, about.flatMap(_.labelIds))

    val missing    = locations.filter(_.labelType == LabelType.NoCurbRamp)
    val noWay      = missing.filter(_.hasNoAlternateRoute)
    val noSidewalk = locations.filter(_.labelType == LabelType.NoSidewalk)
    // Streets, because pins per street say how closely people labeled it, not how much sidewalk is missing.
    val noSidewalkStreets = noSidewalk.map(l => streetKey(l.streetEdgeId)).distinct.size
    val worst             = locations.filter(_.isWorst)
    val byStreet          = worst.groupBy(l => streetKey(l.streetEdgeId)).values.toSeq
    val topWorst = byStreet.sortBy(ls => (-ls.size, ls.map(_.clusterId).min)).take(ConcentrationStreets).flatten

    if (noWay.size >= NoAlternateRouteMinCount && noWay.size.toDouble / missing.size >= NoAlternateRouteMinShare) {
      val oneInN = math.round(missing.size.toDouble / noWay.size).toInt
      headline("report.headline.noalternate", Seq(oneInN, missing.size, noWay.size), noWay)
    } else if (
      noSidewalkStreets >= NoSidewalkMinStreets &&
      exploredCount > 0 && noSidewalkStreets.toDouble / exploredCount >= NoSidewalkMinShare
    ) {
      headline("report.headline.nosidewalk", Seq(noSidewalkStreets, exploredCount), noSidewalk)
    } else if (worst.size >= ConcentrationMinWorst && topWorst.size.toDouble / worst.size >= ConcentrationMinShare) {
      val percent = math.round(100.0 * topWorst.size / worst.size).toInt
      headline("report.headline.concentration", Seq(ConcentrationStreets, percent), topWorst)
    } else if (worst.nonEmpty) {
      headline("report.headline.worst", Seq(worst.size, byStreet.size), worst)
    } else {
      headline("report.headline.none", Seq(locations.size), Seq.empty)
    }
  }
}

/**
 * The neighborhood's own number. Stated only once enough of it has been explored, by the same rule that ranks it on the
 * landing page, so a reader never sees a score AccessScore itself holds back.
 *
 * @param score          The score, when the region clears the bar and has one
 * @param percentExplored Its explored share, whole percent
 * @param percentRequired The share needed before a score is stated
 */
case class NeighborhoodScore(score: Option[Double], percentExplored: Int, percentRequired: Int)

object NeighborhoodScore {

  /** @return The region's score, computed the way `/v3/api/accessScoreRegions` computes it. */
  def from(streets: Seq[StreetAccessScoreForApi], completionRate: Double): NeighborhoodScore = {
    val audited = streets.filter(_.auditCount > 0).flatMap(s => s.score.map(_ -> s.lengthMeters))
    NeighborhoodScore(
      score = AccessScoreCalculator
        .scoreRegion(audited)
        .filter(_ => AccessScoreSpotlight.completionQualifies(completionRate)),
      percentExplored = math.round(completionRate * 100).toInt,
      percentRequired = math.round(AccessScoreSpotlight.MinRegionCompletion * 100).toInt
    )
  }
}

/**
 * What the report is based on, stated before anything it concludes.
 *
 * @param totalMeters        Length of the region's explorable streets
 * @param auditedMeters      How much of that has been audited
 * @param observationIds     The counted labels
 * @param excludedIds        The labels left out because review marked them incorrect
 * @param unclusteredIds     Counted labels of a scored type in no location, so behind no score
 * @param labelers           Distinct people behind the counted labels
 * @param firstObservation   The date of the earliest counted label
 * @param lastObservation    The date of the latest counted label
 * @param reviewedIds        Counted labels with at least one human vote
 * @param confirmedIds       Counted labels with more human Agrees than Disagrees
 * @param medianImageryYear  The median capture year across counted labels with a usable date
 * @param oldImageryPercent  The share of those labels on imagery over [[Coverage.OldImageryYears]] years old
 */
case class Coverage(
    totalMeters: Double,
    auditedMeters: Double,
    observationIds: Seq[Int],
    excludedIds: Seq[Int],
    unclusteredIds: Seq[Int],
    labelers: Int,
    firstObservation: Option[LocalDate],
    lastObservation: Option[LocalDate],
    reviewedIds: Seq[Int],
    confirmedIds: Seq[Int],
    medianImageryYear: Option[Int],
    oldImageryPercent: Option[Int]
) {

  /** @return The audited share of the explorable length, whole percent; 0 for a region with no length. */
  def percentAudited: Int = if (totalMeters <= 0) 0 else math.round(100 * auditedMeters / totalMeters).toInt
}

object Coverage {
  val OldImageryYears: Int = 5

  /**
   * @param counted       The counted labels
   * @param excluded      The labels review marked incorrect
   * @param locations     Every location near the region
   * @param totalMeters   Length of the region's explorable streets
   * @param auditedMeters How much of that has been audited
   * @param today         The date imagery age is measured from
   * @return The region's coverage.
   */
  def from(
      counted: Seq[ReportLabel],
      excluded: Seq[ReportLabel],
      locations: Seq[ReportLocation],
      totalMeters: Double,
      auditedMeters: Double,
      today: LocalDate
  ): Coverage = {
    val years     = counted.flatMap(_.imageryYear).sorted
    val dates     = counted.map(_.timeCreated.toLocalDate)
    val cutoff    = today.getYear - OldImageryYears
    val clustered = locations.flatMap(_.labelIds).toSet
    Coverage(
      totalMeters = totalMeters,
      auditedMeters = auditedMeters,
      observationIds = counted.map(_.labelId),
      excludedIds = excluded.map(_.labelId),
      unclusteredIds = counted
        .filter(l => AccessScoreCalculator.scoredTypeNames(l.labelType.name) && !clustered(l.labelId))
        .map(_.labelId),
      labelers = counted.map(_.userId).distinct.size,
      firstObservation = dates.minOption,
      lastObservation = dates.maxOption,
      reviewedIds = counted.filter(_.humanVotes > 0).map(_.labelId),
      confirmedIds = counted.filter(_.confirmed).map(_.labelId),
      medianImageryYear = Option.when(years.nonEmpty)(years(years.size / 2)),
      oldImageryPercent = Option.when(years.nonEmpty)(math.round(100.0 * years.count(_ < cutoff) / years.size).toInt)
    )
  }
}

/**
 * One label type's row in the inventory, stated both ways: labels, which is what people did, and locations, which is
 * what the score counts.
 *
 * @param locationIds The labels of the type's locations in the region, and how many locations that is; None for a type
 *                    AccessScore doesn't score
 * @param worstIds    None for a type with no rating, whose "worst" means nothing
 * @param topTags     The most-used tags, most used first, with their counts
 */
case class InventoryRow(
    labelType: LabelType,
    locations: Option[(Int, Seq[Int])],
    observedIds: Seq[Int],
    worstIds: Option[Seq[Int]],
    reviewedIds: Seq[Int],
    confirmedIds: Seq[Int],
    topTags: Seq[(String, Int)]
)

object InventoryRow {
  val TopTags: Int = 3

  /** @return One row per type that has labels, in the canonical type order. */
  def from(counted: Seq[ReportLabel], locations: Seq[ReportLocation]): Seq[InventoryRow] = {
    val byType       = counted.groupBy(_.labelType)
    val placesByType = locations.groupBy(_.labelType)
    LabelType.ordered.flatMap { labelType =>
      byType.get(labelType).map { labels =>
        val tagCounts = labels.flatMap(_.tags).groupMapReduce(identity)(_ => 1)(_ + _).toSeq
        val places    = placesByType.getOrElse(labelType, Seq.empty)
        InventoryRow(
          labelType = labelType,
          locations = Option.when(AccessScoreCalculator.scoredTypeNames(labelType.name))(
            (places.size, places.flatMap(_.labelIds))
          ),
          observedIds = labels.map(_.labelId),
          worstIds = Option.when(labelType.ratingScale != RatingScale.Unrated)(
            labels.filter(ReportRules.isWorst).map(_.labelId)
          ),
          reviewedIds = labels.filter(_.humanVotes > 0).map(_.labelId),
          confirmedIds = labels.filter(_.confirmed).map(_.labelId),
          topTags = tagCounts.sortBy { case (tag, count) => (-count, tag) }.take(TopTags)
        )
      }
    }
  }
}

/**
 * One location as a street's section shows it: an icon on the map, and beside it a Gallery card for one label there.
 *
 * @param label      The label the card pictures
 * @param costPoints What this location costs its stretch's score; 0 for one that costs nothing
 * @param poolSize   How many locations share that cost, for a type the score pools along a block
 */
case class ReportCard(location: ReportLocation, label: ReportLabel, costPoints: Double, poolSize: Int)

/**
 * One label type's evidence on a street row.
 *
 * @param locations How many locations of this type are behind the row's score
 */
case class TypeEvidence(labelType: LabelType, locations: Int, labelIds: Seq[Int])

/**
 * A ranked street as the page draws it.
 *
 * @param evidence What's behind the worst stretch's score, per type, in the canonical type order
 */
case class RankedStreetRow(rank: Int, street: ReportStreet, evidence: Seq[TypeEvidence], cards: Seq[ReportCard]) {

  /** @return The id of this street's detail section, which stays the same from one day's report to the next. */
  def anchor: String = s"street-${street.worst.osmWayId}"
}

object RankedStreetRow {

  /** @return The name a reader sees for a stretch; a way with no OSM name is told apart by the street the tool opens on. */
  def displayName(stretch: ReportStretch)(using messages: Messages): String =
    stretch.name.getOrElse(Messages("report.street.unnamed", stretch.toolEdgeId.toString))
}

/**
 * An item on the fixes list.
 *
 * @param label The label to picture it with
 */
case class ReportFix(street: ReportStreet, item: ReportItem, label: ReportLabel)

/**
 * One street edge in the region, as the page's maps draw it.
 *
 * @param score       Its published score, when it has one
 * @param explored    Whether anyone has audited it
 * @param coordinates Its line, as `(lng, lat)` pairs
 */
case class ReportMapEdge(
    streetEdgeId: Int,
    osmWayId: Long,
    score: Option[Double],
    explored: Boolean,
    maxGrade: Option[Double],
    coordinates: Seq[(Double, Double)]
)

/**
 * Everything a neighborhood report shows. Assembled by `ReportService` and rendered by `views.html.apps.report`.
 *
 * @param clustersUpdatedAt When the clusters behind its scores were last rebuilt
 * @param streetsRanked     How many streets AccessScore's bars rank here, whatever their score
 * @param evidenceBox       The area its locations were read from, for the data link that reproduces them
 * @param edges             Every street edge in the region, for its maps
 */
case class NeighborhoodReport(
    regionId: Int,
    regionName: String,
    generatedAt: OffsetDateTime,
    clustersUpdatedAt: Option[OffsetDateTime],
    score: NeighborhoodScore,
    coverage: Coverage,
    headline: ReportHeadline,
    streets: Seq[RankedStreetRow],
    streetsRanked: Int,
    fixes: Seq[ReportFix],
    inventory: Seq[InventoryRow],
    evidenceBox: Option[LatLngBBox],
    edges: Seq[ReportMapEdge]
) {

  /** @return Whether the region is too little explored for its score to be stated, so anything listed is provisional. */
  def isProvisional: Boolean = score.score.isEmpty
}

/** The formats the page prints numbers in, one place so that its rows agree with each other. */
object ReportFormat {

  /**
   * @param score A score in [0, 1]
   * @return It on the 0-100 scale, to the one decimal the AccessScore Spotlight prints, in the reader's locale.
   */
  def score(score: Double)(using messages: Messages): String = oneDecimal(score * 100)

  def oneDecimal(value: Double)(using messages: Messages): String = {
    val format = java.text.NumberFormat.getNumberInstance(messages.lang.toLocale)
    format.setMinimumFractionDigits(1)
    format.setMaximumFractionDigits(1)
    format.format(value)
  }
}

/**
 * The URLs behind every number on the page, so "no number without a way to see what's behind it" has one home. A count
 * links to its labels; a score links to the AccessScore tool, the one place its parts can all be seen.
 *
 * A region-wide count of at most [[MaxListedIds]] labels links to exactly those labels through the Gallery's review list
 * (#5444). Over the cap a list would be truncated, so the link falls back to the Gallery's filters, which select the same
 * region, type and verdicts. Those can't express "has a human vote", so over the cap the reviewed and confirmed counts
 * land on the nearest filter rather than an exact list. A street's count has no such fallback, since no filter selects
 * one street: it stays a list, and the Gallery says so on the page if the list went over its cap.
 */
object ReportLinks {

  /** Mirrors `GalleryController.MaxLabelIds`, read from there so the two can't drift. */
  val MaxListedIds: Int = controllers.GalleryController.MaxLabelIds

  // Everything except what review marked incorrect: the labels this report counts. The Gallery's default omits unsure.
  private val CountedValidationOptions = "correct,unsure,unvalidated"

  /** @return The Gallery's review list for exactly these labels; truncated by it, with a notice, over [[MaxListedIds]]. */
  def labelList(ids: Seq[Int]): String = s"/gallery?labelIds=${ids.mkString(",")}"

  /**
   * @param regionId    The region
   * @param labelType   The type to filter to, or None for all
   * @param severities  Ratings to filter to (empty for all)
   * @param validations The Gallery validation options to select
   * @return The Gallery's filtered view.
   */
  def galleryFilter(
      regionId: Int,
      labelType: Option[LabelType] = None,
      severities: Seq[Int] = Seq.empty,
      validations: String = CountedValidationOptions
  ): String = {
    val params = Seq(s"regions=$regionId") ++ labelType.map(t => s"labelType=${t.name}") ++
      Option.when(severities.nonEmpty)(s"severities=${severities.mkString(",")}") ++
      Seq(s"validationOptions=$validations")
    s"/gallery?${params.mkString("&")}"
  }

  /**
   * @param ids      The labels a count counts
   * @param fallback The filtered view to use if they're too many to list
   * @return The URL that count should link to.
   */
  def count(ids: Seq[Int], fallback: => String): String = if (ids.size <= MaxListedIds) labelList(ids) else fallback

  /** @return LabelMap opened on this region. */
  def labelMap(regionId: Int): String = s"/labelMap?regions=$regionId"

  /** @return The Gallery showing the region's counted labels at the worst end of any rated type's scale. */
  def worstFilter(regionId: Int): String =
    galleryFilter(
      regionId,
      severities = LabelType.ordered.flatMap(t => ReportRules.worstRating(t.ratingScale)).distinct
    )

  /** @return The Gallery showing what this report counts in this region. */
  def gallery(regionId: Int): String = galleryFilter(regionId)

  /** @return AccessScore focused on this region. */
  def accessScore(regionId: Int): String = s"/accessScore?focus=$regionId"

  def accessScoreStreet(streetEdgeId: Int): String = s"/accessScore?unit=streets&sel=$streetEdgeId"

  val scoreDocs: String = "/v3/api-docs/accessScoreStreets"

  /** @return Explore started in this region. */
  def explore(regionId: Int): String = s"/explore?regionId=$regionId"

  /** @return The Raw Labels API's CSV for this region: the labels this report counts. */
  def csv(regionId: Int): String = s"/v3/api/rawLabels?regionId=$regionId&filetype=csv"

  def streetsCsv(regionId: Int): String = s"/v3/api/accessScoreStreets?regionId=$regionId&filetype=csv"

  /**
   * @param box The area the report read locations from. A region filter wouldn't do: a crossing at its edge pools
   *            clusters from the streets just outside it.
   */
  def clustersCsv(box: LatLngBBox): String =
    s"/v3/api/labelClusters?bbox=${box.minLng},${box.minLat},${box.maxLng},${box.maxLat}&filetype=csv"

  /** @return The label's own card, with its full panorama. */
  def label(labelId: Int): String = s"/label/$labelId"
}

/** What the page's scripts need from a report, written into it as JSON: the maps and cards are drawn in the browser. */
object ReportClientData {

  // Five decimal places of a degree is about a meter, and a region's lines are most of this payload's weight.
  private def rounded(value: Double): Double = BigDecimal(value).setScale(5, BigDecimal.RoundingMode.HALF_UP).toDouble

  private def cardJson(card: ReportCard): JsObject =
    Json.obj(
      "clusterId"  -> card.location.clusterId,
      "labelId"    -> card.label.labelId,
      "labelType"  -> card.location.labelType.name,
      "severity"   -> card.location.severity,
      "lat"        -> card.location.latitude,
      "lng"        -> card.location.longitude,
      "labelIds"   -> card.location.labelIds,
      "atCrossing" -> card.location.intersectionId.isDefined,
      "costPoints" -> card.costPoints,
      "poolSize"   -> card.poolSize
    )

  /**
   * @param report  The computed report
   * @param basemap The tile and glyph URLs, from `BasemapController.pageData`
   * @param cityId  The deployment's id, which qualifies each label id on the page
   * @return The JSON to embed.
   */
  def toJson(report: NeighborhoodReport, basemap: JsObject, cityId: String): JsValue =
    Json.obj(
      "regionId" -> report.regionId,
      "cityId"   -> cityId,
      "basemap"  -> basemap,
      "edges"    -> report.edges.map { e =>
        Json.obj(
          "id"          -> e.streetEdgeId,
          "wayId"       -> e.osmWayId,
          "score"       -> e.score,
          "explored"    -> e.explored,
          "grade"       -> e.maxGrade,
          "coordinates" -> e.coordinates.map { case (lng, lat) => Json.arr(rounded(lng), rounded(lat)) }
        )
      },
      "streets" -> report.streets.map { row =>
        Json.obj(
          "wayId"   -> row.street.worst.osmWayId,
          "score"   -> row.street.worst.score,
          "edgeIds" -> row.street.worst.edgeIds,
          "cards"   -> row.cards.map(cardJson)
        )
      }
    )
}
