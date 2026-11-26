package models.report

import controllers.helper.ControllerUtils
import models.label.LabelType
import models.region.NamedRegionCompletion
import models.utils.CommonUtils
import play.api.i18n.Messages
import play.api.libs.json.{JsObject, JsString, JsValue, Json}
import play.api.mvc.RequestHeader
import service.{AccessScoreCalculator, AccessScoreSpotlight, AccessScores, ReportService}

import java.time.{LocalDate, OffsetDateTime}

/**
 * The data-quality figures beside a neighborhood on the city reports page (#6041), from the same tally its report's
 * coverage folds ([[CoverageTally]]), so a row and the report it opens agree.
 *
 * @param observations      Counted labels in the region
 * @param reviewedPercent   The share of them at least one person voted on, whole percent; None with no labels
 * @param lastObservation   The date of the latest
 * @param medianImageryYear The upper median capture year, as the report states it
 * @param labelers          Distinct people behind them
 * @param observationsPerKm Labels per explored kilometer, not per kilometer of street, so a half-explored region isn't
 *                          read as sparsely labeled; None with nothing explored
 */
case class RegionQuality(
    observations: Int,
    reviewedPercent: Option[Int],
    lastObservation: Option[LocalDate],
    medianImageryYear: Option[Int],
    labelers: Int,
    observationsPerKm: Option[Double]
)

object RegionQuality {

  /**
   * @param tally         The region's counted labels, folded
   * @param auditedMeters How much of its street length has been explored
   * @return Its figures.
   */
  def from(tally: CoverageTally, auditedMeters: Double): RegionQuality = RegionQuality(
    observations = tally.observations,
    reviewedPercent =
      Option.when(tally.observations > 0)(math.round(100.0 * tally.reviewed / tally.observations).toInt),
    lastObservation = tally.lastObservation,
    medianImageryYear = tally.medianImageryYear,
    labelers = tally.labelers.size,
    observationsPerKm = Option.when(auditedMeters > 0)(tally.observations / (auditedMeters / 1000))
  )
}

/**
 * One neighborhood's row on the city reports page.
 *
 * @param score          The neighborhood report's own score: [[NeighborhoodScore.from]] over the region's streets in the
 *                       city's published scores, so the two pages can't print different numbers
 * @param hasStreets     Whether it has any street length; one with none is vacuously "complete", which would otherwise
 *                       read as 100% explored
 * @param completionRate Its explored share of street length, as AccessScore reads it
 * @param contributions  Each scored type's signed mean term per explored street ([[ReportService.contributions]]), the
 *                       numbers behind the AccessScore tool's bars; empty with no explored street, or while the city's
 *                       scores are still being computed
 * @param topTypes       Up to two types whose terms lower the score most, worst first
 * @param helpExplore    Whether to ask for help exploring it: it has streets and, as far as the published scores say, no
 *                       score yet. False while those scores are still being computed, since nobody knows yet
 * @param quality        Its data-quality figures, or None while the city's labels are still being tallied
 */
case class CityReportRow(
    regionId: Int,
    name: String,
    slug: String,
    score: NeighborhoodScore,
    hasStreets: Boolean,
    completionRate: Double,
    auditedMeters: Double,
    totalMeters: Double,
    contributions: Map[String, Double],
    topTypes: Seq[String],
    helpExplore: Boolean,
    quality: Option[RegionQuality]
) {
  def scored: Boolean = score.score.isDefined

  /** Explored but not yet scored: its bar shows what has been found so far, and says it may change. */
  def provisional: Boolean = !scored && contributions.nonEmpty

  /** @return The types that lower the score, each with how much (a positive size), most first. */
  def causes: Seq[(String, Double)] = CityReport.causesOf(contributions)

  /** @return How much more street must be explored before it can be scored; 0 once it can. */
  def metersToFloor: Double = math.max(0.0, AccessScoreSpotlight.MinRegionCompletion * totalMeters - auditedMeters)
}

/**
 * The city reports page (#6041): every neighborhood, how it scores and why, and how much data is behind it. Built as
 * pure code from what [[ReportService.cityReport]] reads.
 *
 * @param rows                 Scored neighborhoods lowest first, then unscored ones most explored first, then those with
 *                             no streets; the table's order before anyone sorts it
 * @param minCompletionPercent The explored share a neighborhood needs before it is scored, whole percent
 * @param scoresReady          False while the city's AccessScores are being computed for the first time since a deploy
 * @param qualityReady         False while the city's labels are being tallied for the first time
 */
case class CityReport(
    rows: Seq[CityReportRow],
    generatedAt: OffsetDateTime,
    minCompletionPercent: Int,
    scoresReady: Boolean,
    qualityReady: Boolean
) {

  /** @return The neighborhood the page opens on: the lowest-scoring one, or the most explored when none is scored. */
  def selected: Option[CityReportRow] = rows.headOption

  def scoredRows: Seq[CityReportRow] = rows.filter(_.scored)

  /**
   * The largest total any row's bar would have, so every bar is drawn on one scale and two rows can be compared by eye.
   *
   * @return The scale, or 0 when no row has a cause.
   */
  def barScale: Double = rows.map(_.causes.map(_._2).sum).maxOption.getOrElse(0.0)
}

object CityReport {

  /**
   * @param regions     Every live region, as (id, name)
   * @param slugs       Each region's report address; a region without one is left out, so every row links to a report
   * @param completions Each region's explored and total distance
   * @param scores      The city's published AccessScores, or None while they are still being computed
   * @param tallies     Each region's counted labels, folded, or None while they are still being tallied
   * @return The page.
   */
  def build(
      regions: Seq[(Int, String)],
      slugs: Map[Int, String],
      completions: Seq[NamedRegionCompletion],
      scores: Option[AccessScores],
      tallies: Option[Map[Int, CoverageTally]],
      generatedAt: OffsetDateTime
  ): CityReport = {
    val completionById = completions.map(c => c.regionId -> c).toMap
    // Grouped once rather than filtered per region: a large city has thousands of streets and a hundred regions.
    val streetsByRegion   = scores.fold(Map.empty)(_.streets.groupBy(_.regionId))
    val crossingsByRegion =
      scores.fold(Map.empty)(_.intersections.flatMap(i => i.regionId.map(_ -> i)).groupMap(_._1)(_._2))
    val rows = regions.collect {
      case (id, name) if slugs.contains(id) =>
        val completion    = completionById.get(id)
        val audited       = completion.fold(0.0)(_.auditedDistance)
        val total         = completion.fold(0.0)(_.totalDistance)
        val streets       = streetsByRegion.getOrElse(id, Seq.empty)
        val contributions =
          if (!streets.exists(_.auditCount > 0)) Map.empty[String, Double]
          else ReportService.contributions(streets, crossingsByRegion.getOrElse(id, Seq.empty), id)
        val score = NeighborhoodScore.from(streets, AccessScoreSpotlight.completionRate(completion))
        CityReportRow(
          regionId = id,
          name = name,
          slug = slugs(id),
          score = score,
          hasStreets = total > 0,
          completionRate = AccessScoreSpotlight.completionRate(completion),
          auditedMeters = audited,
          totalMeters = total,
          contributions = contributions,
          topTypes = causesOf(contributions).take(2).map(_._1),
          helpExplore = scores.isDefined && total > 0 && score.score.isEmpty,
          quality = tallies.map(t => RegionQuality.from(t.getOrElse(id, CoverageTally.empty), audited))
        )
    }
    CityReport(
      rows = order(rows),
      generatedAt = generatedAt,
      minCompletionPercent = math.round(AccessScoreSpotlight.MinRegionCompletion * 100).toInt,
      scoresReady = scores.isDefined,
      qualityReady = tallies.isDefined
    )
  }

  /** @return Scored rows lowest first, then unscored ones most explored first, then those with no streets. */
  private def order(rows: Seq[CityReportRow]): Seq[CityReportRow] = {
    val (scored, unscored)     = rows.partition(_.scored)
    val (streeted, streetless) = unscored.partition(_.hasStreets)
    scored.sortBy(r => (r.score.score.getOrElse(0.0), r.name)) ++
      streeted.sortBy(r => (-r.completionRate, r.name)) ++
      streetless.sortBy(_.name)
  }

  /**
   * @param contributions Signed terms by type
   * @return The negative ones as positive sizes, largest first; a tie keeps the canonical type order.
   */
  def causesOf(contributions: Map[String, Double]): Seq[(String, Double)] =
    contributions.toSeq
      .filter(_._2 < 0)
      .sortBy { case (t, v) => (v, AccessScoreCalculator.orderedScoredTypes.indexOf(t)) }
      .map { case (t, v) => t -> -v }
}

/**
 * The words and numbers the city reports page prints, shared by its server-rendered table and the data its panel is
 * redrawn from, so a neighborhood reads the same in both.
 */
object CityReportFormat {

  /** @return A scored type's name as the rest of the site shows it. */
  def typeName(labelType: String)(using messages: Messages): String = messages(LabelType.withName(labelType).nameKey)

  /**
   * The one sentence beside a neighborhood that says why it scores as it does.
   *
   * @param scoresReady Whether the city's scores are known yet
   * @return The sentence.
   */
  def why(row: CityReportRow, scoresReady: Boolean)(using messages: Messages): String = {
    val names = row.topTypes.map(typeName)
    if (!scoresReady) messages("report.city.why.computing")
    else if (!row.hasStreets) messages("report.city.why.nostreets")
    else if (row.contributions.isEmpty) messages("report.city.why.unexplored")
    else if (row.scored) names match {
      case Seq(a, b) => messages("report.city.why.two", a, b)
      case Seq(a)    => messages("report.city.why.one", a)
      case _         => messages("report.city.why.none")
    }
    else
      names match {
        case Seq(a, b) => messages("report.city.why.sofar.two", row.score.percentExplored, a, b)
        case Seq(a)    => messages("report.city.why.sofar.one", row.score.percentExplored, a)
        case _         => messages("report.city.why.sofar.none", row.score.percentExplored)
      }
  }

  /** @return A distance in the reader's units, to a tenth, with its unit. */
  def distance(meters: Double)(using request: RequestHeader, messages: Messages): String = {
    val value = if (ControllerUtils.isMetric) meters / 1000 else meters * CommonUtils.METERS_TO_MILES
    s"${ReportFormat.oneDecimal(value)} ${ControllerUtils.distanceUnitWords.abbr}"
  }

  /** @return Observations per explored kilometer or mile, as the reader's units have it. */
  def density(quality: RegionQuality)(using request: RequestHeader, messages: Messages): Option[Double] =
    quality.observationsPerKm.map { perKm =>
      if (ControllerUtils.isMetric) perKm else perKm / (1000 * CommonUtils.METERS_TO_MILES)
    }

  /** @return A month and year, as the report dates an observation. */
  def month(date: LocalDate)(using messages: Messages): String =
    date.format(java.time.format.DateTimeFormatter.ofPattern("MMM yyyy", messages.lang.toLocale))

  /** @return The explored share, whole percent, as the score's floor compares it. */
  def explored(row: CityReportRow)(using messages: Messages): String =
    messages("report.city.percent", row.score.percentExplored)
}

/** What the city reports page's map, table and panel are drawn from in the browser. */
object CityReportClientData {

  /**
   * @param basemap The city's tile archive and glyphs, as [[controllers.BasemapController.pageData]] gives them
   * @return The page's `#reports-data`: each row's raw values, to sort and color by, and its words, to redraw the panel
   *         with, plus each scored type's name and the scale every bar is drawn on.
   */
  def toJson(report: CityReport, basemap: JsObject)(using request: RequestHeader, messages: Messages): JsValue = {
    val scale = report.barScale
    Json.obj(
      "basemap"       -> basemap,
      "scoresReady"   -> report.scoresReady,
      "qualityReady"  -> report.qualityReady,
      "minCompletion" -> report.minCompletionPercent / 100.0,
      "selected"      -> report.selected.map(_.regionId),
      "typeNames"     -> JsObject(
        AccessScoreCalculator.orderedScoredTypes.map(t => t -> JsString(CityReportFormat.typeName(t)))
      ),
      "rows" -> report.rows.map { row =>
        val quality = row.quality
        Json.obj(
          "id"          -> row.regionId,
          "name"        -> row.name,
          "report"      -> ReportLinks.report(row.slug),
          "explore"     -> Option.when(row.helpExplore)(ReportLinks.explore(row.regionId)),
          "scored"      -> row.scored,
          "provisional" -> row.provisional,
          "hasStreets"  -> row.hasStreets,
          "score"       -> row.score.score,
          "completion"  -> row.completionRate,
          "topType"     -> row.topTypes.headOption,
          "causes"      -> row.causes.map { case (t, v) =>
            Json.obj("type" -> t, "share" -> (if (scale > 0) v / scale else 0.0))
          },
          "reviewed" -> quality.flatMap(_.reviewedPercent),
          "latest"   -> quality.flatMap(_.lastObservation).map(_.toString),
          "imagery"  -> quality.flatMap(_.medianImageryYear),
          "labelers" -> quality.map(_.labelers),
          "density"  -> quality.flatMap(CityReportFormat.density),
          "text"     -> Json.obj(
            "score"    -> row.score.score.map(ReportFormat.score),
            "why"      -> CityReportFormat.why(row, report.scoresReady),
            "explored" -> Option.when(row.hasStreets)(CityReportFormat.explored(row)),
            "toGo"     -> Option.when(row.hasStreets && !row.scored && row.metersToFloor > 0)(
              messages("report.city.togo", CityReportFormat.distance(row.metersToFloor))
            ),
            "reviewed" -> quality.flatMap(_.reviewedPercent).map(p => messages("report.city.reviewed.value", p)),
            "latest"   -> quality.flatMap(_.lastObservation).map(CityReportFormat.month),
            "imagery"  -> quality.flatMap(_.medianImageryYear).map(_.toString),
            "labelers" -> quality.map(_.labelers.toString),
            "density"  -> quality
              .flatMap(CityReportFormat.density)
              .map(d =>
                messages(
                  "report.city.density.value",
                  ReportFormat.oneDecimal(d),
                  ControllerUtils.distanceUnitWords.abbr
                )
              ),
            "streets" -> Option.when(row.hasStreets)(CityReportFormat.distance(row.totalMeters))
          )
        )
      }
    )
  }
}
