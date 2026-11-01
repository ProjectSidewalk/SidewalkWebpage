package models.report

import models.api.LabelDataForApi
import models.label.{AccessImpact, LabelType, RatingScale}
import models.utils.{NamedEnum, NamedEnumCompanion}

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
 * The street a reader recognizes: every labeled `street_edge` in the region sharing one OSM name, or a single edge when
 * it has no name. Ranking raw edges instead lists one road several times under one name (Houston region 10's ten
 * highest-scoring edges are only six roads), with nothing on the page to tell the rows apart.
 *
 * @param name          The OSM name, or None for an unnamed edge
 * @param streetEdgeIds The edges in this group
 * @param lengthMeters  The geodesic length of those edges, so of the part of the street that has observations
 * @param labels        The counted labels on those edges
 */
case class ReportStreet(name: Option[String], streetEdgeIds: Seq[Int], lengthMeters: Double, labels: Seq[ReportLabel])

/**
 * The published, versioned ranking rule. Pure, so a report's order can be reproduced from the public API, and the
 * page prints this rule beside the list it produces. Bump [[Version]] whenever the arithmetic changes: the version is
 * printed in the report's footer, so two reports only compare if they share it.
 */
object RankingRule {
  val Version: String = "v1"

  val WorstRatingWeight: Int     = 2
  val NextRatingWeight: Int      = 1
  val NoAlternateRouteBonus: Int = 1

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

  /** @return Whether this label sits one step short of the worst end of its type's rating scale. */
  def isOneStepFromWorst(label: ReportLabel): Boolean =
    label.severity.isDefined && label.severity == worstRating(label.labelType.ratingScale).map(_ - 1)

  /** @return Whether the report counts this label: everything except what review marked incorrect. */
  def isCounted(label: ReportLabel): Boolean = !label.correct.contains(false)

  /** @return Whether this is a missing curb ramp whose labeler recorded that there is no way around it. */
  def hasNoAlternateRoute(label: ReportLabel): Boolean =
    label.labelType == LabelType.NoCurbRamp && label.tags.contains(NoAlternateRouteTag)

  /** @return This label's contribution to its street's score. */
  def labelScore(label: ReportLabel): Int = {
    val rating =
      if (isWorst(label)) WorstRatingWeight
      else if (isOneStepFromWorst(label)) NextRatingWeight
      else 0
    rating + (if (hasNoAlternateRoute(label)) NoAlternateRouteBonus else 0)
  }

  /** @return A street's score. Labels are assumed already counted; see [[isCounted]]. */
  def streetScore(labels: Seq[ReportLabel]): Int = labels.map(labelScore).sum

  /**
   * Streets from highest score down. Ties break on label count, then length, then name, and finally the lowest edge
   * id, so the order never changes between two page loads of the same data.
   *
   * @return The streets in rank order, including those scoring zero.
   */
  def rank(streets: Seq[ReportStreet]): Seq[ReportStreet] =
    streets.sortBy { s =>
      (-streetScore(s.labels), -s.labels.size, -s.lengthMeters, s.name.getOrElse(""), s.streetEdgeIds.minOption)
    }

  /**
   * How much a label's photo says about a street's barriers, lower first: the worst-rated, then the next, then an
   * unrated problem such as a missing sidewalk, then a low-rated problem. A well-rated feature or a meta label says
   * nothing about barriers, so it gets no rank and stays out of the strip.
   *
   * @return The rank, or None when the label shouldn't be shown as evidence of a problem.
   */
  private def concernRank(label: ReportLabel): Option[Int] =
    if (isWorst(label)) Some(0)
    else if (isOneStepFromWorst(label)) Some(1)
    else if (label.labelType.accessImpact == AccessImpact.Problem)
      Some(if (label.labelType.ratingScale == RatingScale.Unrated) 2 else 3)
    else None

  // Confirmed before unchecked, and either before one that reviewers lean against.
  private def reviewRank(label: ReportLabel): Int =
    if (label.confirmed) 0 else if (label.humanDisagree == 0) 1 else 2

  /**
   * The labels to show as a street's photos: worst first, confirmed before unchecked. Labels with a crop come first,
   * so a missing crop only shows its "no image" panel when the street hasn't enough photos to fill the strip.
   *
   * @param labels   A street's counted labels
   * @param limit    How many to return
   * @param hasCrop  Whether a label has a crop on disk
   * @return At most `limit` labels, in the order to show them.
   */
  def selectPhotos(labels: Seq[ReportLabel], limit: Int, hasCrop: ReportLabel => Boolean): Seq[ReportLabel] = {
    val ranked = labels
      .flatMap(label => concernRank(label).map(rank => (rank, label)))
      .sortBy { case (rank, l) => (rank, reviewRank(l), -l.humanAgree, l.labelId) }
      .map(_._2)
    val (withCrop, withoutCrop) = ranked.partition(hasCrop)
    (withCrop ++ withoutCrop).take(limit)
  }

  /**
   * The punch list: at most `size` labels, at most one per street, walking down the ranked streets. A label qualifies
   * when it is at the worst end of its scale with at least one human Agree and no human Disagree; a street's pick is
   * its most-agreed qualifying label, preferring one with a crop since the photo leads the row, and between equally
   * agreed labels the one scoring higher, so a missing ramp with no way around it beats a pole.
   *
   * @param ranked  Streets in rank order
   * @param size    How many labels to return
   * @param hasCrop Whether a label has a crop on disk
   * @return The picks with their streets, in rank order. Fewer than `size` when too few streets have a qualifying label.
   */
  def punchList(
      ranked: Seq[ReportStreet],
      size: Int,
      hasCrop: ReportLabel => Boolean
  ): Seq[(ReportStreet, ReportLabel)] =
    ranked.iterator
      .flatMap { street =>
        street.labels
          .filter(l => isWorst(l) && l.humanAgree > 0 && l.humanDisagree == 0)
          .sortBy(l => (!hasCrop(l), -l.humanAgree, -labelScore(l), l.labelId))
          .headOption
          .map(street -> _)
      }
      .take(size)
      .toSeq
}

/**
 * The generated headline: a message key, without its preset suffix, its arguments, and the labels the sentence counts
 * so the page can link to them.
 */
case class ReportHeadline(key: String, args: Seq[Int], labelIds: Seq[Int])

/**
 * Picks the one sentence at the top of the report. Candidates are tried in order and each states the bar it has to
 * clear, so a sentence is never generated from too few observations to mean anything.
 */
object HeadlineRule {
  val NoAlternateRouteMinCount: Int    = 5
  val NoAlternateRouteMinShare: Double = 0.1
  val ConcentrationStreets: Int        = 3
  val ConcentrationMinWorst: Int       = 10
  val ConcentrationMinShare: Double    = 0.3

  /**
   * @param ranked Streets in rank order, holding every counted label in the region
   * @return The headline: no-alternate-route when that's substantial, else concentration on the top streets, else the
   *         count of worst-rated observations, else a statement that there are none.
   */
  def select(ranked: Seq[ReportStreet]): ReportHeadline = {
    val all      = ranked.flatMap(_.labels)
    val worst    = all.filter(RankingRule.isWorst)
    val missing  = all.filter(_.labelType == LabelType.NoCurbRamp)
    val noWay    = missing.filter(RankingRule.hasNoAlternateRoute)
    val topWorst = ranked
      .sortBy(s => -s.labels.count(RankingRule.isWorst))
      .take(ConcentrationStreets)
      .flatMap(_.labels.filter(RankingRule.isWorst))

    if (noWay.size >= NoAlternateRouteMinCount && noWay.size.toDouble / missing.size >= NoAlternateRouteMinShare) {
      val oneInN = math.round(missing.size.toDouble / noWay.size).toInt
      ReportHeadline("report.headline.noalternate", Seq(oneInN, missing.size, noWay.size), noWay.map(_.labelId))
    } else if (worst.size >= ConcentrationMinWorst && topWorst.size.toDouble / worst.size >= ConcentrationMinShare) {
      val percent = math.round(100.0 * topWorst.size / worst.size).toInt
      ReportHeadline("report.headline.concentration", Seq(ConcentrationStreets, percent), topWorst.map(_.labelId))
    } else if (worst.nonEmpty) {
      val streets = ranked.count(_.labels.exists(RankingRule.isWorst))
      ReportHeadline("report.headline.worst", Seq(worst.size, streets), worst.map(_.labelId))
    } else {
      ReportHeadline("report.headline.none", Seq(all.size), Seq.empty)
    }
  }
}

/**
 * What the report is based on, stated before anything it concludes.
 *
 * @param totalMeters        Length of the region's explorable streets
 * @param auditedMeters      How much of that has been audited
 * @param observationIds     The counted labels
 * @param excludedIds        The labels left out because review marked them incorrect
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
   * @param totalMeters   Length of the region's explorable streets
   * @param auditedMeters How much of that has been audited
   * @param today         The date imagery age is measured from
   * @return The region's coverage.
   */
  def from(
      counted: Seq[ReportLabel],
      excluded: Seq[ReportLabel],
      totalMeters: Double,
      auditedMeters: Double,
      today: LocalDate
  ): Coverage = {
    val years  = counted.flatMap(_.imageryYear).sorted
    val dates  = counted.map(_.timeCreated.toLocalDate)
    val cutoff = today.getYear - OldImageryYears
    Coverage(
      totalMeters = totalMeters,
      auditedMeters = auditedMeters,
      observationIds = counted.map(_.labelId),
      excludedIds = excluded.map(_.labelId),
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
 * One label type's row in the barrier inventory.
 *
 * @param worstIds None for a type with no rating, whose "worst" means nothing
 * @param topTags  The most-used tags, most used first, with their counts
 */
case class InventoryRow(
    labelType: LabelType,
    observedIds: Seq[Int],
    worstIds: Option[Seq[Int]],
    reviewedIds: Seq[Int],
    confirmedIds: Seq[Int],
    topTags: Seq[(String, Int)]
)

object InventoryRow {
  val TopTags: Int = 3

  /**
   * @param counted The counted labels
   * @return One row per type that has labels, in the canonical type order.
   */
  def from(counted: Seq[ReportLabel]): Seq[InventoryRow] = {
    val byType = counted.groupBy(_.labelType)
    LabelType.ordered.flatMap { labelType =>
      byType.get(labelType).map { labels =>
        val tagCounts = labels.flatMap(_.tags).groupMapReduce(identity)(_ => 1)(_ + _).toSeq
        InventoryRow(
          labelType = labelType,
          observedIds = labels.map(_.labelId),
          worstIds = Option.when(labelType.ratingScale != RatingScale.Unrated)(
            labels.filter(RankingRule.isWorst).map(_.labelId)
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
 * A label's photo as the page draws it. `markerX`/`markerY` are fractions of the crop, already resolved.
 *
 * @param cropUrl     The signed URL of the crop's thumbnail, or None to draw the "no image" panel
 * @param attribution The attribution line the imagery requires, when there is one
 */
case class ReportPhoto(
    label: ReportLabel,
    cropUrl: Option[String],
    markerX: Double,
    markerY: Double,
    attribution: Option[models.pano.ImageryAttribution.Line]
)

/**
 * A ranked street as the page draws it.
 *
 * @param typeIds Counted label ids per type, in the canonical type order, for the row's linked counts
 */
case class RankedStreetRow(
    rank: Int,
    street: ReportStreet,
    score: Int,
    typeIds: Seq[(LabelType, Seq[Int])],
    photos: Seq[ReportPhoto]
)

/**
 * Everything a neighborhood report shows. Assembled by `ReportService` and rendered by `views.html.apps.report`.
 *
 * @param regionId     The region
 * @param regionName   The region's name
 * @param generatedAt  When this report was computed
 * @param coverage     What the report is based on
 * @param headline     The generated sentence
 * @param streets      The top ranked streets, with photos
 * @param streetsRanked How many streets had counted labels, so the page can say the list is a top N of them
 * @param punchList    The labels most worth fixing, each with its street's display name
 * @param inventory    The per-type table
 */
case class NeighborhoodReport(
    regionId: Int,
    regionName: String,
    generatedAt: OffsetDateTime,
    coverage: Coverage,
    headline: ReportHeadline,
    streets: Seq[RankedStreetRow],
    streetsRanked: Int,
    punchList: Seq[(ReportStreet, ReportPhoto)],
    inventory: Seq[InventoryRow]
)

/**
 * The URLs behind every count on the page, so "no number without a way to see the labels it counts" has one home.
 *
 * A count of at most [[MaxListedIds]] labels links to exactly those labels through the Gallery's review list (#5444).
 * Over the cap a list would be truncated, so the link falls back to the Gallery's filters, which select the same
 * region, type and verdicts. Those can't express "has a human vote", so over the cap the reviewed and confirmed counts
 * land on the nearest filter rather than an exact list.
 */
object ReportLinks {

  /** Mirrors `GalleryController.MaxLabelIds`, read from there so the two can't drift. */
  val MaxListedIds: Int = controllers.GalleryController.MaxLabelIds

  // Everything except what review marked incorrect: the labels this report counts. The Gallery's default omits unsure.
  private val CountedValidationOptions = "correct,unsure,unvalidated"

  /** @return The Gallery's review list for exactly these labels; only safe within [[MaxListedIds]]. */
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
      severities = LabelType.ordered.flatMap(t => RankingRule.worstRating(t.ratingScale)).distinct
    )

  /** @return The Gallery showing what this report counts in this region. */
  def gallery(regionId: Int): String = galleryFilter(regionId)

  /** @return AccessScore focused on this region. */
  def accessScore(regionId: Int): String = s"/accessScore?focus=$regionId"

  /** @return Explore started in this region. */
  def explore(regionId: Int): String = s"/explore?regionId=$regionId"

  /** @return The Raw Labels API's CSV for this region, the data this report is built from. */
  def csv(regionId: Int): String = s"/v3/api/rawLabels?regionId=$regionId&filetype=csv"

  /** @return The label's own card, with its full panorama. */
  def label(labelId: Int): String = s"/label/$labelId"
}
