package service

/**
 * The crop-sizing rule: how wide a window to cut around a label, from where the label sits on its panorama.
 *
 * Ported from ProjectSidewalk/sidewalk-panorama-tools `CropRunner.py` (sizing rule v2, commit `fef9bca`), which is
 * the reference implementation these numbers were measured for; see that repo's
 * `reports/2026-08-19-crop-sizing-v2.md` for the four-city extent gold and the blind human rounds behind them. After
 * SidewalkWebpage#4865 this port is the canonical display-crop geometry and panorama-tools is the research bench: a
 * converged experiment crosses over as a new rule here, never as a runtime dependency.
 *
 * The rule is kept in one object, apart from the equirectangular mechanics in [[CropGeometry]], because it is the
 * part that changes. Crops are derived data cut by a nightly job, so swapping the rule is: bump [[Version]],
 * regenerate the sizing fixtures under `test/resources/crops/`, delete the crop store, and let the job rebuild it.
 */
object CropSizingRule {

  /** Which rule cut a crop store; recorded on every run so a store cut under two rules is at least identifiable. */
  val Version: String = "v2"

  // The 2013 pano-y -> distance -> size regression (sidewalk-cv-tools#2), and the pano height it was fit on. Its
  // constants only mean anything in that 6656-px reference space, which is why predictCropSize converts into it.
  private val V1RefHeight: Double     = 6656.0
  private val V1DistIntercept: Double = 19.80546390
  private val V1DistSlope: Double     = 0.01523952
  private val V1SizeCoef: Double      = 8725.6
  private val V1SizeExp: Double       = -1.192
  private val V1SizeMin: Double       = 50.0
  private val V1SizeMax: Double       = 1500.0

  /**
   * The regression predicts something close to the feature's own extent, which as a crop reads as too tight, so the
   * window ships scaled. x2.5 is where two independent instruments overlap: absolute judgement puts "too tight"
   * above a fill of 0.49 (needing at least x1.95), and two forced-choice rounds peak at fills of 0.28-0.44 (x2-x3).
   */
  val Scale: Double = 2.5

  /**
   * The scaled window is clamped as an angle rather than in pixels, so a window means the same thing on a 2048-px
   * pano as on a 16384-px one. The floor keeps a far-field crop from collapsing to a postage stamp; the ceiling stops
   * a near-field one from swallowing a quarter of the sphere.
   */
  val MinFovDeg: Double = 8.0
  val MaxFovDeg: Double = 90.0

  /**
   * The regression evaluated in the 6656-px-high space it was fit in.
   *
   * @param refYOffset Pixels above the horizon, expressed on a 6656-px-high pano.
   * @return           Crop size in reference pixels, clamped to [50, 1500].
   */
  private def referenceCropSize(refYOffset: Double): Double = {
    val distance = math.max(0.0, V1DistIntercept + V1DistSlope * refYOffset)
    val size     = if (distance > 0) V1SizeCoef * math.pow(distance, V1SizeExp) else 0.0
    if (size > V1SizeMax || distance == 0) V1SizeMax
    else if (size < V1SizeMin) V1SizeMin
    else size
  }

  /**
   * The size the regression asks for, in this pano's native pixels.
   *
   * The constants were fit on panos 6656 px high, so the label's offset from the horizon is converted into that
   * reference space, the regression (including its clamp, also a reference-space quantity) is evaluated there, and
   * the answer is scaled back. At `panoHeight == 6656` the conversion is the identity.
   *
   * This is the rule on its own, not what gets cut: [[windowWidth]] scales and clamps it.
   *
   * @param panoY      The label's y on the pano, in native pixels.
   * @param panoHeight The pano's height in pixels.
   * @return           Crop size in native pixels.
   */
  def predictCropSize(panoY: Double, panoHeight: Int): Double = {
    val refOffset = (panoHeight / 2.0 - panoY) * (V1RefHeight / panoHeight)
    referenceCropSize(refOffset) * (panoHeight / V1RefHeight)
  }

  /**
   * The window width to cut, in native pixels: [[predictCropSize]] scaled by [[Scale]] and clamped to
   * [[MinFovDeg]]..[[MaxFovDeg]] as an angle.
   *
   * The clamp is computed against the pano's height (`width / height * 180`) because production panos are 2:1, so
   * degrees-per-pixel agree on both axes, and the quantity being clamped is vertical all the way back to the
   * regression's y-offset. Not capped to the pano here: [[CropGeometry.computeCropBox]] owns "a window cannot exceed
   * the image", which is a property of the image rather than of the rule.
   *
   * @param panoY      The label's y on the pano, in native pixels.
   * @param panoHeight The pano's height in pixels.
   * @return           Window width in native pixels; the 3:2 window's height follows from it.
   */
  def windowWidth(panoY: Double, panoHeight: Int): Double = {
    val deg        = predictCropSize(panoY, panoHeight) * Scale / panoHeight * 180.0
    val clampedDeg = math.min(math.max(deg, MinFovDeg), MaxFovDeg)
    clampedDeg / 180.0 * panoHeight
  }
}

/**
 * Equirectangular crop mechanics: where a window of a given width lands on a panorama, and which pixel runs to read
 * to fill it. Settled topology facts (debugged in sidewalk-panorama-tools #47/#77), independent of the sizing rule.
 *
 * Every value is an integer. Python's `round()` — which the reference implementation and the golden fixtures use —
 * rounds half to even, so this uses `Math.rint` and never `Math.round` (`round(-151.5)` differs between the two), and
 * `Math.floorMod` for Python's always-non-negative `%`.
 */
object CropGeometry {

  /**
   * Windows are cut 3:2 by width. Curb-ramp aprons run ~3:1 in equirectangular pixels, so a square window spends its
   * extra height on sky and road; 3:2 is also what the rest of the stack assumes (1440x960 crops and share images,
   * the 720x480 label canvas).
   */
  val AspectWidthOverHeight: Double = 1.5

  /**
   * Crops are stored at most this wide. A ceiling, not a target: a narrower window is written at its own size and
   * never upscaled, because the feature carries a fixed number of source pixels and stretching them adds bytes and
   * blur, not detail. 1440 is 2x the 720-px label canvas, for retina density.
   */
  val MaxStoredWidth: Int = 1440

  /**
   * A crop window on a panorama.
   *
   * @param left    Leftmost column, `0 <= left < panoWidth`; the window may run past the right edge (see [[segments]]).
   * @param top     Topmost row, `0 <= top <= panoHeight - height`.
   * @param width   Window width in pixels.
   * @param height  Window height in pixels, `width / 1.5` rounded.
   * @param shifted Whether the window moved vertically to stay inside the pano, so the label is off-centre in it.
   *                Reported here, off the same rounding that produced `top`, so a caller can't re-derive it and drift.
   */
  case class CropBox(left: Int, top: Int, width: Int, height: Int, shifted: Boolean)

  /**
   * One horizontal run of source pixels that fills part of a crop.
   *
   * @param srcX  First source column to read.
   * @param width Columns to read.
   * @param dstX  Column in the crop the run lands at.
   */
  case class Segment(srcX: Int, width: Int, dstX: Int)

  /**
   * The integer 3:2 window centred on a label: x wraps at the seam, y clamps by shifting.
   *
   * Column 0 and column `panoWidth` are the same place in the world, so a window near either edge reaches across the
   * seam ([[segments]] splits it in two). The poles are not adjacent, so the window shifts vertically to stay inside
   * rather than wrapping or zero-padding: no crop ever contains synthetic black, at the price of the label sitting
   * off-centre when it is within `height / 2` of the top or bottom edge.
   *
   * The width is capped at `panoWidth` and at `panoHeight * 1.5`, which keeps the derived height inside the image
   * without changing the aspect. The width term is load-bearing: a window wider than the pano would send the second
   * seam segment past the far edge.
   *
   * Does not validate `panoY`: an out-of-frame y clamps to a pole and yields a window the label is not inside, which
   * the caller rejects up front. `panoX` needs no such check; the modulo reads any finite x correctly.
   *
   * @param panoX      The label's x on the pano.
   * @param panoY      The label's y on the pano.
   * @param cropWidth  Requested window width in native pixels, per [[CropSizingRule.windowWidth]].
   * @param panoWidth  The pano's width in pixels.
   * @param panoHeight The pano's height in pixels.
   * @return           The window to cut.
   */
  def computeCropBox(panoX: Double, panoY: Double, cropWidth: Double, panoWidth: Int, panoHeight: Int): CropBox = {
    val width    = rint(math.min(math.min(cropWidth, panoWidth.toDouble), panoHeight * AspectWidthOverHeight))
    val height   = rint(width / AspectWidthOverHeight)
    val left     = Math.floorMod(rint(panoX - width / 2.0), panoWidth)
    val idealTop = rint(panoY - height / 2.0)
    val top      = math.max(0, math.min(idealTop, panoHeight - height))
    CropBox(left, top, width, height, shifted = top != idealTop)
  }

  /**
   * The source runs that fill a window: one, or two when the window crosses the seam.
   *
   * @param box       The window.
   * @param panoWidth The pano's width in pixels.
   * @return          Runs in crop order, left to right.
   */
  def segments(box: CropBox, panoWidth: Int): Seq[Segment] = {
    if (box.left + box.width <= panoWidth) {
      Seq(Segment(box.left, box.width, 0))
    } else {
      val first = panoWidth - box.left
      Seq(Segment(box.left, first, 0), Segment(0, box.width - first, first))
    }
  }

  /** Python's `int(round(x))`: half to even. */
  private def rint(x: Double): Int = Math.rint(x).toInt
}
