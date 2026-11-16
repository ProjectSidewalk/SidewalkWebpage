package models.report

import models.api.{LabelClusterForApi, LabelDataForApi, PlaceForApi, StreetAccessScoreForApi}
import models.label.{LabelType, RatingScale, StreetSide}
import models.story.StoryForListing
import models.utils.LatLngBBox
import play.api.i18n.Messages
import play.api.libs.json.{JsObject, JsValue, Json}
import service.AccessScoreCalculator.{ClusterScoreInput, Scoring}
import service.{AccessScoreCalculator, AccessScoreSpotlight, AccessScoreWeights}

import java.time.{LocalDate, OffsetDateTime}

/**
 * One label as the report reads it: the Raw Labels API's row, narrowed to the fields the report uses, with its votes
 * reduced to human ones. Reviewers in the report are people, so AI votes never reach these counts.
 *
 * @param correct    The site's consensus verdict on the label, `Some(false)` when review marked it incorrect
 * @param streetSide Which side of `streetEdgeId` it sits on (#2886), relative to that edge's digitized direction; None
 *                   within a metre of the centerline or with no position
 */
case class ReportLabel(
    labelId: Int,
    labelType: LabelType,
    severity: Option[Int],
    tags: List[String],
    streetEdgeId: Int,
    streetSide: Option[StreetSide],
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
      streetSide = label.streetSide,
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
 * One explored street segment, roughly a block: the unit AccessScore scores and the map colors, so a section shows
 * exactly what its number describes. Built through the same roll-up as a run of edges, so pricing is shared. An
 * unexplored edge's published score comes from the crossings at its ends alone, which says nothing of the block.
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
 * @param rebuiltScore       `score` rebuilt from the report's own evidence, which every item's cost is measured from.
 *                           It equals `score` unless the evidence is missing a cluster the engine scored
 * @param crossStreets       The other streets met at its ends, up to two, which tell a reader which block it is
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
    items: Seq[ReportItem],
    rebuiltScore: Double,
    crossStreets: Seq[String] = Nil
) {

  /** @return Whether the rebuilt score has drifted from the published one by more than float noise. */
  def evidenceDrifts: Boolean = math.abs(rebuiltScore - score) > 1e-9

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
   * @param wayEdges Every edge of one way in one region, scored under `weights`
   * @param weights  Signed base weight per type, which prices each item as the scores were made
   * @return The rolled-up stretch, or None when none of the edges has been explored.
   */
  def build(
      wayEdges: Seq[StreetAccessScoreForApi],
      evidence: ReportEvidence,
      weights: Map[String, Double] = AccessScoreCalculator.baseWeights
  ): Option[ReportStretch] = {
    val edges = wayEdges.filter(e => e.auditCount > 0 && e.score.isDefined)
    AccessScoreSpotlight.stretchScore(edges.flatMap(e => e.score.map(_ -> e.lengthMeters))).map { score =>
      val locations = edges
        .flatMap(e => evidence.block(e.streetEdgeId) ++ scoredEnds(e).flatMap { case (id, _) => evidence.crossing(id) })
        .distinctBy(_.clusterId)
      val (baseline, items) = costlyItems(edges, locations, evidence, weights)
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
        items = items,
        rebuiltScore = baseline
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
   * @return The score rebuilt with every item present, and the items that cost the stretch something, costliest first.
   */
  private def costlyItems(
      edges: Seq[StreetAccessScoreForApi],
      locations: Seq[ReportLocation],
      evidence: ReportEvidence,
      weights: Map[String, Double]
  ): (Double, Seq[ReportItem]) = {
    def scoreWithout(removed: Set[Int]): Double = {
      def inputs(ls: Seq[ReportLocation]) = ls.filterNot(l => removed(l.clusterId)).map(_.scoreInput)
      val rebuilt                         = edges.map { e =>
        AccessScoreCalculator.headlineFromClusters(
          inputs(evidence.block(e.streetEdgeId)),
          e.lengthMeters,
          e.slopeTerm,
          scoredEnds(e).map { case (id, _) => inputs(evidence.crossing(id)) },
          weights,
          // Only a barrier sets a segment to exactly 0; a sigmoid never reaches it.
          segmentBarrier = e.segmentScore.contains(0.0)
        ) -> e.lengthMeters
      }
      AccessScoreSpotlight.stretchScore(rebuilt).getOrElse(0.0)
    }

    val baseline = scoreWithout(Set.empty)
    baseline -> groupIntoItems(locations)
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
 * A ranked segment as the page lists it, with the road it belongs to: one road with three bad blocks is three rows,
 * which is the truth about it, and the road's own figures say how the rest of it fares.
 *
 * @param worst               The segment the row's number and evidence describe
 * @param wholeScore          Length-weighted across every explored segment of the same road in the region
 * @param stretchCount        How many explored segments the road has here
 */
case class ReportStreet(worst: ReportStretch, wholeScore: Double, wholeExploredMeters: Double, stretchCount: Int) {

  def roadKey: Either[String, Long] = ReportStreet.streetKey(worst.name, worst.osmWayId)
}

object ReportStreet {

  /**
   * Which road an edge or segment belongs to. Names that differ only in case are one road; an unnamed way has nothing
   * saying it joins any other.
   *
   * @return The key that identifies the road within a region.
   */
  def streetKey(name: Option[String], osmWayId: Long): Either[String, Long] =
    name.map(_.trim.toLowerCase).toLeft(osmWayId)

  /**
   * @return The ranked segments, lowest score first, each beside its road's figures. Ties go to the longer segment,
   *         then to the name, then to the edge id, so two loads of the same data agree.
   */
  def rank(segments: Seq[ReportStretch]): Seq[ReportStreet] = {
    val roads = segments.groupBy(s => streetKey(s.name, s.osmWayId))
    segments
      .filter(_.isRanked)
      .map { segment =>
        val road = roads(streetKey(segment.name, segment.osmWayId))
        ReportStreet(
          worst = segment,
          wholeScore = AccessScoreSpotlight.stretchScore(road.map(s => s.score -> s.exploredMeters)).get,
          wholeExploredMeters = road.map(_.exploredMeters).sum,
          stretchCount = road.size
        )
      }
      .sortBy(s => (s.worst.score, -s.worst.exploredMeters, s.worst.name.getOrElse(""), s.worst.toolEdgeId))
  }
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

  /**
   * Which side of its street a location is drawn on when a map lines its labels up along the street (#5888): the side
   * most of its counted labels sit on. Only labels on the location's own edge vote, since a side is relative to its
   * edge's digitized direction and says nothing against another street.
   *
   * @param labels Counted labels by id
   * @return The majority side, or None at a crossing, on a tie or with no sided label, which draws the location where
   *         it is.
   */
  def sideOf(location: ReportLocation, labels: Map[Int, ReportLabel]): Option[StreetSide] = {
    val sides = location.labelIds
      .flatMap(labels.get)
      .filter(_.streetEdgeId == location.streetEdgeId)
      .flatMap(_.streetSide)
    val left  = sides.count(_ == StreetSide.Left)
    val right = sides.count(_ == StreetSide.Right)
    if (location.intersectionId.isDefined) None
    else if (left > right) Some(StreetSide.Left)
    else if (right > left) Some(StreetSide.Right)
    else None
  }

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
    withCropFirst(membersAtRating(item, labels).sortBy(l => (reviewRank(l), -l.humanAgree, l.labelId)), hasCrop)

  /**
   * The first label with a crop, else the first: a sort keyed on `hasCrop` would stat files on every comparison, and
   * prod's crops are on spinning disks.
   *
   * @param ordered Labels in preference order, crop aside
   */
  private def withCropFirst(ordered: Seq[ReportLabel], hasCrop: ReportLabel => Boolean): Option[ReportLabel] =
    ordered.find(hasCrop).orElse(ordered.headOption)

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
          .map(ReportCard(location, _, cost, item.fold(1)(_.locations.size), sideOf(location, labels)))
      }
      // By each location's own share, so a street with fifty of one pooled item doesn't open on fifty alike.
      .sortBy(c =>
        (-c.costPoints / c.poolSize, typeOrder.getOrElse(c.location.labelType, Int.MaxValue), c.location.clusterId)
      )
  }

  /**
   * The region's worst problems, for its map: every location whose rating, the median the score uses, sits at the bad
   * end of its type's scale. The same set the headline counts, so the two never state different numbers. A type with no
   * scale has no worst end, so missing sidewalks never appear here.
   *
   * @param locations The region's locations, each once
   * @param labels    Counted labels by id
   * @param knownCrop Whether a label is known to have a crop, without looking: every worst location on every load
   *                  would be a file stat on prod's spinning disks, for a card fetched only on click. Answering from the
   *                  street sections' checks still pictures a location the same way its street's card does.
   * @return One per location, in the canonical type order and then by cluster id, so a reload draws the same map.
   */
  def worstProblems(
      locations: Seq[ReportLocation],
      labels: Map[Int, ReportLabel],
      knownCrop: ReportLabel => Boolean
  ): Seq[WorstProblem] = {
    val typeOrder = LabelType.ordered.zipWithIndex.toMap
    locations
      .filter(_.isWorst)
      .sortBy(l => (typeOrder.getOrElse(l.labelType, Int.MaxValue), l.clusterId))
      .map { l =>
        val pictured = representative(ReportItem(Seq(l), 0.0), labels, knownCrop).map(_.labelId)
        WorstProblem(l, pictured, l.labelIds.filter(labels.contains))
      }
  }

  /**
   * The fixes list, at most one per road, so one long bad road can't fill it. An item qualifies when it costs its stretch at least [[FixMinPoints]], is
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
    val seen  = scala.collection.mutable.Set.empty[Int]
    val roads = scala.collection.mutable.Set.empty[Either[String, Long]]
    ranked.iterator
      .filterNot(street => roads(street.roadKey))
      .flatMap { street =>
        street.worst.items.iterator
          .filter(i => i.costPoints >= FixMinPoints && ratedAsFix(i) && !i.locations.exists(l => seen(l.clusterId)))
          .flatMap { item =>
            withCropFirst(
              membersAtRating(item, labels).filter(_.uncontested).sortBy(l => (-l.humanAgree, l.labelId)),
              hasCrop
            ).map(label => (street, item, label))
          }
          .take(1)
          .tapEach { case (street, item, _) =>
            seen ++= item.locations.map(_.clusterId)
            roads += street.roadKey
          }
      }
      .take(size)
      .toSeq
  }
}

/**
 * The generated headline: a message key, its arguments, and the locations the sentence is
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
 * @param ratings     How the type's labels spread over its ratings, for its histogram; None for a type with no rating
 * @param topTags     The most-used tags, most used first, with their counts
 */
case class InventoryRow(
    labelType: LabelType,
    locations: Option[(Int, Seq[Int])],
    observedIds: Seq[Int],
    worstIds: Option[Seq[Int]],
    confirmedIds: Seq[Int],
    ratings: Option[Seq[RatingBucket]],
    topTags: Seq[(String, Int)]
)

/**
 * One bar of a type's rating histogram.
 *
 * @param rating The rating, 1 to 3; None for the labels left unrated, which a labeler may skip
 * @param ids    The labels at that rating
 */
case class RatingBucket(rating: Option[Int], ids: Seq[Int])

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
          confirmedIds = labels.filter(_.confirmed).map(_.labelId),
          ratings = Option.when(labelType.ratingScale != RatingScale.Unrated)(ratingBuckets(labels)),
          topTags = tagCounts.sortBy { case (tag, count) => (-count, tag) }.take(TopTags)
        )
      }
    }
  }

  /** @return All three ratings, empty ones too so every histogram matches, then the unrated labels if any. */
  private def ratingBuckets(labels: Seq[ReportLabel]): Seq[RatingBucket] = {
    val rated = (1 to 3).map(r => RatingBucket(Some(r), labels.filter(_.severity.contains(r)).map(_.labelId)))
    val none  = labels.filter(_.severity.isEmpty).map(_.labelId)
    if (none.isEmpty) rated else rated :+ RatingBucket(None, none)
  }
}

/**
 * One location as a street's section shows it: an icon on the map, and beside it a Gallery card for one label there.
 *
 * @param label      The label the card pictures
 * @param costPoints What this location costs its stretch's score; 0 for one that costs nothing
 * @param poolSize   How many locations share that cost, for a type the score pools along a block
 * @param side       The side of its street the aligned map view draws it on (`ReportRules.sideOf`); None leaves it put
 */
case class ReportCard(
    location: ReportLocation,
    label: ReportLabel,
    costPoints: Double,
    poolSize: Int,
    side: Option[StreetSide]
)

/**
 * A dot on the worst-problems map.
 *
 * @param labelId    The label its card shows; None when review has rejected all of them since clustering, which still
 *                   leaves it in the score, and so on the map
 * @param countedIds Its labels less any review rejected, which are what its count links to
 */
case class WorstProblem(location: ReportLocation, labelId: Option[Int], countedIds: Seq[Int])

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
  def anchor: String = s"street-${street.worst.toolEdgeId}"
}

object RankedStreetRow {

  /** @return The name a reader sees for a stretch; a way with no OSM name is told apart by the street the tool opens on. */
  def displayName(stretch: ReportStretch)(using messages: Messages): String =
    stretch.name.getOrElse(Messages("report.street.unnamed", stretch.toolEdgeId.toString))

  /** @return Which block of its road a segment is, from the streets at its ends, when it meets any. */
  def between(stretch: ReportStretch)(using messages: Messages): Option[String] = stretch.crossStreets match {
    case Seq(a, b, _*) => Some(Messages("report.street.between", a, b))
    case Seq(a)        => Some(Messages("report.street.near", a))
    case _             => None
  }
}

/**
 * An item on the fixes list.
 *
 * @param label The label to picture it with
 */
case class ReportFix(street: ReportStreet, item: ReportItem, label: ReportLabel) {

  /**
   * The segment's score once this is fixed, on the 0-100 scale, built from the figures the card prints (each to one
   * decimal) so its "from", "to" and "+N" always add up on the page.
   *
   * @return The raised score, never over 100.
   */
  def raisedScore: Double = {
    def tenth(value: Double) = math.round(value * 10) / 10.0
    math.min(100.0, tenth(street.worst.score * 100) + tenth(item.costPoints))
  }

  /**
   * Why this one is worth fixing: the strongest fact the data holds, in order. No way around first, since that is a
   * barrier rather than a cost; then a corner, which counts against every street meeting there. A type scored as the
   * block's condition (a missing sidewalk) gets none: the card's rise already says what building it would do, and its
   * labels carry no rating to speak of.
   *
   * @return A message key and its arguments, or None.
   */
  def reason(using messages: Messages): Option[(String, Seq[Any])] = {
    val street = RankedStreetRow.displayName(this.street.worst)
    // The pictured label's own tag counts too: its chip is on the card, and the sentence must not contradict it.
    val noWayAround = item.labelType == LabelType.NoCurbRamp && label.tags.contains(ReportRules.NoAlternateRouteTag)
    val pooled      =
      AccessScoreCalculator.typeWeights.get(item.labelType.name).exists(_.scoring == Scoring.StreetCondition)
    item.locations match {
      case ls if noWayAround || ls.exists(_.hasNoAlternateRoute) => Some(("report.fix.why.noalternate", Nil))
      case ls if ls.exists(_.intersectionId.isDefined)           => Some(("report.fix.why.corner", Nil))
      case _ if pooled                                           => None
      case ls if ls.head.isWorst                                 => Some(("report.fix.why.worst", Seq(street)))
      case _                                                     => Some(("report.fix.why.costliest", Seq(street)))
    }
  }
}

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
    name: Option[String],
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
 * @param weights           The weights its scores were computed under: the engine's unless a link asked otherwise
 * @param contributions     Each scored type's mean term per explored street here, under those weights, for the bars
 *                          beside the weight sliders
 * @param places            Important places near its segments
 * @param worst             Every location rated at the worst end of its type's scale, for the worst-problems map
 * @param stories           Community members' stories on labels here (#4054), newest first, up to
 *                          `ReportService.StoriesListSize`; they change no number
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
    edges: Seq[ReportMapEdge],
    weights: AccessScoreWeights = AccessScoreWeights.Default,
    contributions: Map[String, Double] = Map.empty,
    places: Seq[ReportPlace] = Nil,
    worst: Seq[WorstProblem] = Nil,
    stories: Seq[StoryForListing] = Nil
) {

  /**
   * @param labelId      A label in the region
   * @param streetEdgeId The street it was placed on
   * @return The anchor of the section whose score counts the label, else of the one detailing its street, if either
   *         exists. The score comes first because a corner label is pooled onto the streets meeting there, which
   *         needn't include the one it was placed on.
   */
  def sectionFor(labelId: Int, streetEdgeId: Int): Option[String] =
    detailed
      .find(_.street.worst.locations.exists(_.labelIds.contains(labelId)))
      .orElse(detailed.find(_.street.worst.edgeIds.contains(streetEdgeId)))
      .map(_.anchor)

  /** @return The worst problems by type, in the canonical type order, leaving out types that have none. */
  def worstByType: Seq[(LabelType, Seq[WorstProblem])] = {
    val byType = worst.groupBy(_.location.labelType)
    LabelType.ordered.flatMap(t => byType.get(t).map(t -> _))
  }

  /** @return The important places near one segment. */
  def placesNear(streetEdgeId: Int): Seq[ReportPlace] = places.filter(_.streetEdgeId == streetEdgeId)

  /** @return Whether the region is too little explored for its score to be stated, so anything listed is provisional. */
  def isProvisional: Boolean = score.score.isEmpty

  /** @return The segments that get a section of their own: the lowest, up to [[NeighborhoodReport.DetailSize]]. */
  def detailed: Seq[RankedStreetRow] = streets.take(NeighborhoodReport.DetailSize)
}

object NeighborhoodReport {

  /**
   * How many of the lowest segments get a section, with a map and photos. Every ranked segment is still in the list and
   * on the map; only the detail stops here, so a neighborhood of hundreds of blocks stays one readable page.
   */
  val DetailSize: Int = 20
}

/**
 * A neighborhood's name in its report's address: `/report/neighborhood/benjamin-franklin-middle-school` rather than
 * `/report/neighborhood/14`, so a link says where it goes. Computed from the current names on every lookup, so nothing
 * is stored; a renamed region's old address stops resolving, and its id URL still redirects to the new one.
 */
object ReportSlug {

  /** @return The name lowercased, accents dropped and every run of anything but letters and digits made one hyphen. */
  def of(name: String): String =
    java.text.Normalizer
      .normalize(name, java.text.Normalizer.Form.NFD)
      .replaceAll("\\p{M}", "")
      .toLowerCase(java.util.Locale.ROOT)
      .replaceAll("[^\\p{L}\\p{N}]+", "-")
      .stripPrefix("-")
      .stripSuffix("-")

  /**
   * One address per region. Regions sharing a name all take their id as a suffix, so which came first never decides
   * who gets the bare name. A slug of digits alone would read as an id, so it is suffixed too, as is an empty one. A
   * suffixed slug can still match another region's bare name ("Foo" #9 and "Foo 9"), so bare names are placed first
   * and a suffixed one takes its id again until it is free.
   *
   * @param regions Each live region's id and name
   * @return The slug by region id, unique within the city.
   */
  def assign(regions: Seq[(Int, String)]): Map[Int, String] = {
    val base               = regions.map { case (id, name) => id -> of(name) }
    val shared             = base.groupBy(_._2).collect { case (slug, ids) if ids.size > 1 => slug }.toSet
    def needsId(s: String) = shared(s) || s.isEmpty || s.forall(_.isDigit)
    val (suffixed, bare)   = base.partition { case (_, slug) => needsId(slug) }
    val taken              = scala.collection.mutable.Set.from(bare.map(_._2))
    val placed             = suffixed.sortBy(_._1).map { case (id, slug) =>
      val start = if (slug.isEmpty) s"region-$id" else s"$slug-$id"
      val free  = Iterator.iterate(start)(c => s"$c-$id").find(c => !taken(c)).get
      taken += free
      id -> free
    }
    (bare ++ placed).toMap
  }
}

/**
 * An important place (#5311) near a segment: who needs that block, which a score alone doesn't say. It changes no
 * number; it is told beside the segment, on its map, and on a fix there.
 *
 * @param streetEdgeId   The segment the place is nearest to, whose score its map marker wears, as on AccessScore
 * @param distanceMeters How far it is from that segment
 */
case class ReportPlace(
    name: Option[String],
    category: String,
    streetEdgeId: Int,
    latitude: Double,
    longitude: Double,
    distanceMeters: Double = 0.0
) {

  /** @return Its name, or what it is when OSM gives it none. */
  def label(using messages: Messages): String = name.getOrElse(Messages(s"report.place.$category"))
}

object ReportPlace {

  /**
   * Past this, a place's nearest street is too far off to call the place near it. The places sit at their buildings'
   * or grounds' centers, so a school campus is often 100 m from its street (Laurens Schools: 106 m).
   */
  val NearMeters: Double = 120.0

  /** @return The places nearest one of these segments and close enough to it, in the catalog's order. */
  def near(places: Seq[PlaceForApi], edgeIds: Set[Int]): Seq[ReportPlace] =
    places.flatMap { p =>
      for {
        id       <- p.nearestStreetEdgeId if edgeIds(id)
        distance <- p.nearestStreetDistanceM if distance <= NearMeters
      } yield ReportPlace(p.name, p.category, id, p.geometry.getY, p.geometry.getX, distance)
    }
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
 * A region-wide count of at most [[MaxListedIds]] labels links to exactly those labels through Gallery's review list
 * (#5444). Over the cap a list would be truncated, so the link falls back to Gallery's filters, which select the same
 * region, type and verdicts. Those can't express "has a human vote", so over the cap the reviewed and confirmed counts
 * land on the nearest filter rather than an exact list. A street's count has no such fallback, since no filter selects
 * one street: it stays a list, and Gallery says so on the page if the list went over its cap.
 */
object ReportLinks {

  /** Mirrors `GalleryController.MaxLabelIds`, read from there so the two can't drift. */
  val MaxListedIds: Int = controllers.GalleryController.MaxLabelIds

  // Everything except what review marked incorrect: the labels this report counts. Gallery's default omits unsure.
  private val CountedValidationOptions = "correct,unsure,unvalidated"

  /** @return Gallery's review list for exactly these labels; truncated by it, with a notice, over [[MaxListedIds]]. */
  def labelList(ids: Seq[Int]): String =
    // Past the cap only its first ids are sent, with the total, so a pooled item of thousands still fits in a URL.
    if (ids.size <= MaxListedIds) s"/gallery?labelIds=${ids.mkString(",")}"
    else s"/gallery?labelIds=${ids.take(MaxListedIds).mkString(",")}&labelIdsTotal=${ids.size}"

  /**
   * @param regionId    The region
   * @param labelType   The type to filter to, or None for all
   * @param severities  Ratings to filter to (empty for all)
   * @param validations The Gallery validation options to select
   * @return Gallery's filtered view.
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

  /** @return Gallery showing the region's counted labels at the worst end of any rated type's scale. */
  def worstFilter(regionId: Int): String =
    galleryFilter(
      regionId,
      severities = LabelType.ordered.flatMap(t => ReportRules.worstRating(t.ratingScale)).distinct
    )

  /** @return Gallery showing what this report counts in this region. */
  def gallery(regionId: Int): String = galleryFilter(regionId)

  /**
   * The link parameters for a reader's weights, in the AccessScore tool's format, so a score followed to the tool lands
   * on the number the report printed.
   *
   * @return `&w=…&gs=…`, or nothing for the engine's own weights.
   */
  def weightParams(weights: AccessScoreWeights): String =
    if (weights.isDefault) ""
    else {
      def number(v: Double) =
        BigDecimal(v).setScale(2, BigDecimal.RoundingMode.HALF_UP).bigDecimal.stripTrailingZeros.toPlainString
      val types =
        AccessScoreCalculator.orderedScoredTypes.map(t => s"$t:${number(weights.magnitudes(t))}").mkString(",")
      s"&w=$types" + Option(weights.slopeParam).filter(_.nonEmpty).fold("")(gs => s"&gs=$gs")
    }

  def report(slug: String, weights: AccessScoreWeights = AccessScoreWeights.Default): String =
    s"/report/neighborhood/${java.net.URLEncoder.encode(slug, "UTF-8")}" + weightParams(weights).replaceFirst("&", "?")

  def accessScore(regionId: Int, weights: AccessScoreWeights = AccessScoreWeights.Default): String =
    s"/accessScore?focus=$regionId${weightParams(weights)}"

  def accessScoreStreet(streetEdgeId: Int, weights: AccessScoreWeights = AccessScoreWeights.Default): String =
    s"/accessScore?unit=streets&sel=$streetEdgeId${weightParams(weights)}"

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

  /** @return The label's card scrolled to one of its stories, as a story's share link opens it (#4722). */
  def story(labelId: Int, storyId: Int): String = s"/label/$labelId?storyId=$storyId"

  /** The city's community stories page. */
  val stories: String = "/stories"
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
      "listIds"    -> card.location.labelIds.take(ReportLinks.MaxListedIds),
      "atCrossing" -> card.location.intersectionId.isDefined,
      // For the aligned view (#5888): the edge whose line the card is drawn beside, and which side of it.
      "edgeId"     -> card.location.streetEdgeId,
      "side"       -> card.side.map(_.name),
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
      "weights"  -> Json.obj(
        "types"  -> report.weights.magnitudes,
        "grade"  -> report.weights.slopeWeight,
        "custom" -> !report.weights.isDefault
      ),
      "contributions" -> report.contributions,
      "places"        -> report.places.map { p =>
        Json.obj(
          "name"     -> p.name,
          "category" -> p.category,
          "lat"      -> p.latitude,
          "lng"      -> p.longitude,
          "edgeId"   -> p.streetEdgeId,
          "distance" -> math.round(p.distanceMeters)
        )
      },
      "edges" -> report.edges.map { e =>
        Json.obj(
          "id"          -> e.streetEdgeId,
          "name"        -> e.name,
          "score"       -> e.score,
          "explored"    -> e.explored,
          "grade"       -> e.maxGrade,
          "coordinates" -> e.coordinates.map { case (lng, lat) => Json.arr(rounded(lng), rounded(lat)) }
        )
      },
      // The worst-problems map's dots; a dot's card is fetched only when it's opened.
      "worst" -> report.worst.map { dot =>
        Json.obj(
          "clusterId" -> dot.location.clusterId,
          "labelId"   -> dot.labelId,
          "labelType" -> dot.location.labelType.name,
          "lat"       -> rounded(dot.location.latitude),
          "lng"       -> rounded(dot.location.longitude)
        )
      },
      // A fix's still map is drawn in the browser, from its spot and its street.
      "fixes" -> report.fixes.map { fix =>
        Json.obj(
          "labelId"   -> fix.label.labelId,
          "streetId"  -> fix.street.worst.toolEdgeId,
          "edgeIds"   -> fix.street.worst.edgeIds,
          "locations" -> fix.item.locations.map { l =>
            Json.obj(
              "clusterId" -> l.clusterId,
              "labelType" -> l.labelType.name,
              "lat"       -> l.latitude,
              "lng"       -> l.longitude
            )
          }
        )
      },
      "streets" -> report.detailed.map { row =>
        Json.obj(
          "id"      -> row.street.worst.toolEdgeId,
          "score"   -> row.street.worst.score,
          "edgeIds" -> row.street.worst.edgeIds,
          "cards"   -> row.cards.map(cardJson)
        )
      }
    )
}
