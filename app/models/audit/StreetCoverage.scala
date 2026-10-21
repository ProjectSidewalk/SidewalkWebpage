package models.audit

import play.api.libs.json.*

/**
 * One stretch of a street a labeler has seen, in meters along the street's stored geometry.
 *
 * @param startM Where the stretch begins, measured from the street's first coordinate.
 * @param endM   Where it ends; never less than `startM`.
 */
case class CoveredRange(startM: Double, endM: Double)

object CoveredRange {
  // A bare `[start, end]` pair rather than an object: the list rides on every Explore submission and sits on every
  // free-exploration audit_task row, so the keys would be dead weight.
  given format: Format[CoveredRange] = Format(
    Reads {
      case JsArray(pair) if pair.length == 2 =>
        (pair(0), pair(1)) match {
          case (JsNumber(s), JsNumber(e)) if s <= e => JsSuccess(CoveredRange(s.toDouble, e.toDouble))
          case _ => JsError("expected a [start_m, end_m] pair of numbers with start <= end")
        }
      case _ => JsError("expected a [start_m, end_m] pair")
    },
    Writes(range => Json.arr(range.startM, range.endM))
  )
}

/**
 * When a free-exploration session has seen enough of a street for it to count as audited (#5733).
 *
 * Free exploration has no direction and no fixed start: people arrive mid-street, leave, and come back from the
 * other end. So each task keeps the stretches of the street its panos covered, and the street is done when what is
 * left unseen is at most half the street and at most 50 m. Both limits were fitted to the pano trails of regular
 * audits fleet-wide: an end-to-end walk leaves up to 30 m unseen at its ends, so a 90% floor fails 40% of real
 * walks, and under 100 m the cap alone would let one pano at a corner earn the street.
 *
 * The client builds the ranges; this object owns the numbers and the arithmetic, so the page reads them from
 * `asJson` and the one-off backfill of older sessions applies the same rule.
 */
object StreetCoverage {

  /**
   * Most of a street that may stay unseen; the limit that matters above 100 m. Also how near the end a regular
   * mission's imagery may run out and still count the street walked (StreetSweep).
   */
  val MaxUncoveredM: Double = 50d

  /** Least share of a street that must have been seen; the limit that matters under 100 m. */
  val MinCoveredFrac: Double = 0.5d

  /**
   * How far either side of a pano counts as seen: roughly GSV's pano spacing, and about as far as a curb ramp or
   * surface problem can still be judged well enough to label.
   */
  val PanoWindowM: Double = 10d

  /** Longest step between consecutive on-street panos whose in-between stretch counts as walked. */
  val MaxHopM: Double = 50d

  /** The rule's numbers for the Explore page, so the client's copy of the arithmetic can never drift from this one. */
  val asJson: JsObject = Json.obj(
    "max_uncovered_m"  -> MaxUncoveredM,
    "min_covered_frac" -> MinCoveredFrac,
    "pano_window_m"    -> PanoWindowM,
    "max_hop_m"        -> MaxHopM
  )

  /**
   * @param ranges        Any mix of stored and freshly posted ranges, in any order.
   * @param streetLengthM The street's geodesic length.
   * @return              The same coverage clipped to the street, sorted and disjoint, to a decimeter.
   */
  def merge(ranges: Seq[CoveredRange], streetLengthM: Double): Seq[CoveredRange] = {
    val clipped = ranges
      .map(r => CoveredRange(clip(roundDm(r.startM), streetLengthM), clip(roundDm(r.endM), streetLengthM)))
      .filter(r => r.endM > r.startM)
      .sortBy(r => (r.startM, r.endM))
    clipped
      .foldLeft(List.empty[CoveredRange]) {
        case (last :: rest, next) if next.startM <= last.endM =>
          CoveredRange(last.startM, last.endM.max(next.endM)) :: rest
        case (merged, next) => next :: merged
      }
      .reverse
  }

  /** @return Total meters covered; only meaningful for a merged list, where the ranges don't overlap. */
  def coveredM(merged: Seq[CoveredRange]): Double = merged.map(r => r.endM - r.startM).sum

  /** @return Meters of the street not covered by a merged list, never negative. */
  def uncoveredM(merged: Seq[CoveredRange], streetLengthM: Double): Double =
    (streetLengthM - coveredM(merged)).max(0d)

  /** @return Whether a merged list earns the street. Nothing seen earns nothing, however short the street. */
  def coveredEnough(merged: Seq[CoveredRange], streetLengthM: Double): Boolean =
    merged.nonEmpty && uncoveredM(merged, streetLengthM) <= MaxUncoveredM &&
      coveredM(merged) >= MinCoveredFrac * streetLengthM

  /** @return A stored list read back; anything unparsable reads as no coverage rather than failing the submission. */
  def fromJson(json: Option[JsValue]): Seq[CoveredRange] =
    json.flatMap(_.asOpt[Seq[CoveredRange]]).getOrElse(Seq.empty)

  /** @return The list as stored on the row and sent to the page. */
  def toJson(merged: Seq[CoveredRange]): JsValue = Json.toJson(merged)

  private def roundDm(m: Double): Double = Math.round(m * 10d) / 10d

  // Rounded first, then clipped: rounding after could push an end a few centimeters past the street.
  private def clip(m: Double, streetLengthM: Double): Double = m.max(0d).min(streetLengthM)
}
