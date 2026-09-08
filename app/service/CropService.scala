package service

import com.google.inject.ImplementedBy
import executors.CpuIntensiveExecutionContext
import models.label.{CropMarker, CropSource, LabelCrop, LabelCropTable, LabelPointTable, LabelTable, LabelTypeEnum}
import models.pano.PanoDataTable
import models.utils.MyPostgresProfile.api._
import models.utils.{ImageUtils, MyPostgresProfile}
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source}
import play.api.db.slick.{DatabaseConfigProvider, HasDatabaseConfigProvider}
import play.api.libs.json.{JsObject, Json}
import play.api.{Configuration, Logger}
import service.CropGeometry.CropBox
import service.CropService._

import java.awt.Image
import java.awt.image.BufferedImage
import java.io.File
import java.nio.file.Files
import java.time.{Duration, Instant, OffsetDateTime}
import java.util.concurrent.atomic.AtomicBoolean
import javax.imageio.ImageReader
import javax.inject.{Inject, Singleton}
import scala.concurrent.{ExecutionContext, Future}
import scala.jdk.CollectionConverters._
import scala.util.Using
import scala.util.control.NonFatal

object CropService {

  /**
   * A label the crop job may cut a crop for.
   *
   * @param panoWidth  The pano's width as `pano_data` records it — the frame `panoX` is expressed in — or None.
   * @param panoHeight The pano's height as `pano_data` records it, or None.
   */
  case class CropCandidate(
      labelId: Int,
      labelType: LabelTypeEnum.Base,
      panoId: String,
      panoX: Int,
      panoY: Int,
      panoWidth: Option[Int],
      panoHeight: Option[Int]
  )

  /**
   * A label whose crop is on disk with no `label_crop` row saying where the label is in it (#2660).
   *
   * @param timeCreated When the label was placed; an Explore-frame crop is uploaded within the same session.
   * @param aiGenerated Whether an AI placed it, in which case no browser ever snapshotted a canvas for it.
   */
  case class ProvenanceCandidate(
      labelId: Int,
      labelType: LabelTypeEnum.Base,
      timeCreated: OffsetDateTime,
      panoId: String,
      panoX: Int,
      panoY: Int,
      canvasX: Int,
      canvasY: Int,
      panoWidth: Option[Int],
      panoHeight: Option[Int],
      aiGenerated: Boolean
  )

  /**
   * What one run did. The disjoint outcomes for a label are: cropped, skipped for a pano with no self-hosted image,
   * skipped on a dimension mismatch, skipped as out of frame, or errored; `shiftedVertically` and `dimsUnverified`
   * annotate crops that were written, the first with the label off-centre and the second without a recorded frame to
   * check the label's position against. `downscaledDeleted` counts copies removed because the pano no longer needs
   * one (the cap was raised past its width, or its native file is gone). The `provenance*` counts are the reconcile
   * pass over crops that had no `label_crop` row: how many it recorded as Explore-frame snapshots, as pano windows,
   * and how many it could not tell apart and left for a later run (#2660).
   */
  case class CropRunResult(
      panosOpened: Int,
      panosWithoutBackup: Int,
      cropsWritten: Int,
      shiftedVertically: Int,
      outOfFrame: Int,
      dimsMismatch: Int,
      dimsUnverified: Int,
      downscaledWritten: Int,
      downscaledDeleted: Int,
      provenanceExplore: Int,
      provenanceWindow: Int,
      provenanceUnresolved: Int,
      errors: Int
  ) {

    /** One-line account of the run, for the log and the admin trigger's response. */
    def summary: String =
      s"Crop generation (rule ${CropSizingRule.Version}): opened $panosOpened panos, wrote $cropsWritten crops " +
        s"($shiftedVertically shifted to stay inside the pano, $dimsUnverified against a pano whose dimensions the " +
        s"database doesn't record) and $downscaledWritten downscaled panos, deleted $downscaledDeleted downscaled " +
        s"panos no longer needed; skipped $panosWithoutBackup panos with no self-hosted image, $dimsMismatch labels " +
        s"on a dimension mismatch and $outOfFrame labels outside the image; recorded provenance for " +
        s"$provenanceExplore Explore-frame and $provenanceWindow pano-window crops, $provenanceUnresolved " +
        s"unresolved; $errors errors."

    /** The counts as stored against the run's `background_job_run` row, shared by the nightly and manual triggers. */
    def runDetails: JsObject = Json.obj(
      "crop_rule_version"     -> CropSizingRule.Version,
      "panos_opened"          -> panosOpened,
      "panos_without_backup"  -> panosWithoutBackup,
      "crops_written"         -> cropsWritten,
      "shifted_vertically"    -> shiftedVertically,
      "out_of_frame"          -> outOfFrame,
      "dims_mismatch"         -> dimsMismatch,
      "dims_unverified"       -> dimsUnverified,
      "downscaled_written"    -> downscaledWritten,
      "downscaled_deleted"    -> downscaledDeleted,
      "provenance_explore"    -> provenanceExplore,
      "provenance_window"     -> provenanceWindow,
      "provenance_unresolved" -> provenanceUnresolved,
      "errors"                -> errors
    )
  }

  /** JPEG quality for downscaled panos: they exist to be looked at in a pano viewer, not to be cut from. */
  val DownscaledJpegQuality: Float = 0.85f

  /** The most source rows one downscaling strip holds at once (a 16384-wide strip this tall is ~67 MB as RGB). */
  val MaxStripRows: Int = 1024

  /**
   * The size `POST /saveImage` stores the Explore-canvas snapshot at (2x the 720x480 canvas, for retina density). The
   * same 1440 as [[CropGeometry.MaxStoredWidth]], which is why a wide pano window is not told from a snapshot by size.
   */
  val ExploreFrameCropWidth: Int  = 1440
  val ExploreFrameCropHeight: Int = 960

  /**
   * An Explore-frame crop is uploaded in the labeler's session, so a crop written later than this was cut by the job.
   *
   * Read off mtime, a property of the filesystem rather than of the crop: a store restored from backup, `cp`'d, or
   * `rsync`'d without `-t`/`-a` carries the copy's time and every snapshot then looks job-cut, so moving a store is
   * a decision about `label_crop` too (`docs/deployment-and-stages.md`).
   */
  val ExploreUploadWindow: Duration = Duration.ofDays(1)

  /**
   * Cuts a window out of the panorama behind `reader`, keeping only the window's own pixels and stitching the two
   * runs of a window that crosses the equirectangular seam.
   *
   * What a region read saves is memory, not decoding: ImageIO walks the compressed stream from the start every time
   * ([[ImageUtils.readRegion]]), so a pano costs one pass per window plus one per downscaling strip. Bounding the
   * peak raster is the whole point — cutting a second window is cheap in memory and is not free in CPU.
   *
   * @param reader    A reader from [[ImageUtils.withReader]].
   * @param box       The window, per [[CropGeometry.computeCropBox]].
   * @param panoWidth The pano's width, which decides where the seam is.
   * @return          The window, `box.width` x `box.height`, opaque RGB.
   */
  def cutWindow(reader: ImageReader, box: CropBox, panoWidth: Int): BufferedImage = {
    val out = new BufferedImage(box.width, box.height, BufferedImage.TYPE_INT_RGB)
    val g   = out.createGraphics()
    try {
      CropGeometry.segments(box, panoWidth).foreach { segment =>
        val run = ImageUtils.readRegion(reader, segment.srcX, box.top, segment.width, box.height)
        val _   = g.drawImage(run, segment.dstX, 0, null)
      }
    } finally g.dispose()
    out
  }

  /**
   * The stored form of a cut window: at most [[CropGeometry.MaxStoredWidth]] wide, never upscaled. A 3:2 window's
   * long edge is its width, so the shared longest-edge cap is exactly the width cap.
   */
  def storedCrop(window: BufferedImage): BufferedImage =
    ImageUtils.scaleToMaxEdge(window, CropGeometry.MaxStoredWidth)

  /**
   * The size [[storedCrop]] writes a window of `box`'s size at, without cutting it: the width cap applied, the
   * height rounded as `ImageUtils.scaleToMaxEdge` rounds it.
   */
  def storedSize(box: CropBox): (Int, Int) = {
    val scale = math.min(1.0, CropGeometry.MaxStoredWidth.toDouble / math.max(box.width, box.height))
    (math.max(1, math.round(box.width * scale).toInt), math.max(1, math.round(box.height * scale).toInt))
  }

  /** The window the crop job cuts for a label, and the label's `(x, y)` in it as fractions. */
  def windowFor(panoX: Int, panoY: Int, panoWidth: Int, panoHeight: Int): (CropBox, (Double, Double)) = {
    val window = CropSizingRule.windowWidth(panoY.toDouble, panoWidth, panoHeight)
    val box    = CropGeometry.computeCropBox(panoX.toDouble, panoY.toDouble, window, panoWidth, panoHeight)
    (box, CropGeometry.labelFractionInCrop(panoX.toDouble, panoY.toDouble, box, panoWidth))
  }

  /**
   * Where a label is in its Explore-frame crop: the canvas click as a fraction of the 720x480 canvas. Clamped, because
   * a few historic rows carry a canvas position outside the frame (a click recorded mid-pan), and a marker pinned to
   * the nearest edge is the same thing those rows have always drawn.
   */
  def exploreFrameMarker(canvasX: Int, canvasY: Int): CropMarker = CropMarker(
    clampFraction(canvasX.toDouble / LabelPointTable.canvasWidth),
    clampFraction(canvasY.toDouble / LabelPointTable.canvasHeight)
  )

  private def clampFraction(f: Double): Double = math.min(1.0, math.max(0.0, f))

  /**
   * How many source rows each downscaling strip covers, chosen so that every strip boundary lands on a whole output
   * row. With `unit = srcHeight / gcd(srcHeight, targetHeight)`, a strip of `k * unit` source rows maps to exactly
   * `k * targetHeight / gcd` output rows, so each output row is averaged from exactly the source rows it covers
   * whichever strip they arrive in, and there are no seams. The strip is the largest multiple of `unit` under
   * `maxStripRows`, or `unit` itself when even one is taller (a pano whose heights share no factor is then read as a
   * single strip).
   *
   * @param maxStripRows The most source rows a strip may hold; [[MaxStripRows]] in production, smaller in a test that
   *                     wants several strips out of a small fixture.
   * @return             Source rows per strip.
   */
  def stripRows(srcHeight: Int, targetHeight: Int, maxStripRows: Int = MaxStripRows): Int = {
    val unit = srcHeight / gcd(srcHeight, targetHeight)
    if (unit >= maxStripRows) unit else (maxStripRows / unit) * unit
  }

  /**
   * The downscaled raster of a panorama: the same image, `targetWidth` wide.
   *
   * Reads the source in horizontal strips ([[stripRows]]) and area-averages each into its rows of the output, so
   * memory is bounded by the output plus one strip rather than by the native pano. Area averaging accumulates in
   * `float`, so a strip's rows can differ from a whole-image scale by a unit where that scale's sums have outgrown the
   * mantissa; the strip is the more exact of the two, never the less.
   *
   * @param reader       A reader from [[ImageUtils.withReader]].
   * @param srcWidth     The pano's width.
   * @param srcHeight    The pano's height.
   * @param targetWidth  Width to produce; the height follows from the pano's aspect.
   * @param maxStripRows The most source rows a strip may hold; see [[stripRows]].
   * @return             The downscaled image, opaque RGB.
   */
  def downscale(
      reader: ImageReader,
      srcWidth: Int,
      srcHeight: Int,
      targetWidth: Int,
      maxStripRows: Int = MaxStripRows
  ): BufferedImage = {
    val targetHeight = math.max(1, Math.rint(srcHeight.toDouble * targetWidth / srcWidth).toInt)
    val out          = new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_RGB)
    val g            = out.createGraphics()
    try {
      val rows = stripRows(srcHeight, targetHeight, maxStripRows)
      var top  = 0
      while (top < srcHeight) {
        val height    = math.min(rows, srcHeight - top)
        val strip     = ImageUtils.readRegion(reader, 0, top, srcWidth, height)
        val dstTop    = (top.toLong * targetHeight / srcHeight).toInt
        val dstBottom = ((top + height).toLong * targetHeight / srcHeight).toInt
        val scaled    = strip.getScaledInstance(targetWidth, dstBottom - dstTop, Image.SCALE_AREA_AVERAGING)
        val _         = g.drawImage(scaled, 0, dstTop, null)
        top += height
      }
    } finally g.dispose()
    out
  }

  /**
   * Writes the downscaled copy of a panorama ([[downscale]]) as a JPEG.
   *
   * @param file Where to write it; parent directories are created.
   */
  def writeDownscaled(reader: ImageReader, srcWidth: Int, srcHeight: Int, targetWidth: Int, file: File): Unit = {
    val out = downscale(reader, srcWidth, srcHeight, targetWidth)
    val _   = file.getParentFile.mkdirs()
    ImageUtils.writeJpeg(out, file, DownscaledJpegQuality)
  }

  private def gcd(a: Int, b: Int): Int = if (b == 0) a else gcd(b, a % b)
}

/**
 * Derived imagery cut from the self-hosted panorama store: per-label crop images and per-pano downscaled copies
 * (#4865), and the record of where each crop's label is in it (#2660).
 *
 * Both are derived data, regenerated by a nightly reconciliation job rather than written inline with any submission:
 * generation is idempotent and order-independent, so a label can't be stranded by arriving before its pano's pixels,
 * and a change to the crop geometry is a matter of deleting the store and letting the job rebuild it.
 */
@ImplementedBy(classOf[CropServiceImpl])
trait CropService {

  /**
   * Cuts a crop for every live label that has none and whose pano has a self-hosted image, and a downscaled copy
   * for every self-hosted pano wider than the viewer can render; first records the provenance of every crop on disk
   * that has none. At most one run at a time: a second call while one is in flight fails with
   * [[IllegalStateException]].
   */
  def generateMissingCrops(): Future[CropRunResult]

  /** Whether a run is in flight. */
  def isRunning: Boolean

  /** Where a pano's downscaled copy is, or would be, stored. */
  def downscaledImageFile(panoId: String): File

  /** The pano's downscaled copy, when one has been written. */
  def existingDownscaledImage(panoId: String): Option[File]

  /**
   * Records that a label's crop is the browser's snapshot of the Explore canvas (`POST /saveImage`), so the label is
   * at its canvas fraction in it. A label with no `label_point` row yet is logged and skipped: the reconcile pass
   * records it on the next run.
   */
  def recordExploreFrameCrop(labelId: Int, width: Int, height: Int): Future[Unit]

  /** Where the label is in its crop, or `None` when nothing has recorded it yet. */
  def cropMarker(labelId: Int): Future[Option[CropMarker]]

  /** [[cropMarker]] for many labels at once, keyed by label id; a label with no row is absent. */
  def cropMarkers(labelIds: Seq[Int]): Future[Map[Int, CropMarker]]
}

@Singleton
class CropServiceImpl @Inject() (
    protected val dbConfigProvider: DatabaseConfigProvider,
    config: Configuration,
    panoDataService: PanoDataService,
    labelTable: LabelTable,
    labelPointTable: LabelPointTable,
    labelCropTable: LabelCropTable,
    panoDataTable: PanoDataTable,
    shareImageCache: ShareImageCache,
    cpuEc: CpuIntensiveExecutionContext
)(implicit ec: ExecutionContext, mat: Materializer)
    extends CropService
    with HasDatabaseConfigProvider[MyPostgresProfile] {

  private val logger = Logger(this.getClass)

  private val downscaledMaxWidth: Int = config.get[Int]("pano.downscaled.max-width")
  private val cropsDir: File          = new File(panoDataService.getCropDirectory)

  // Beside the crops rather than in a store of its own: same nightly job, same disposability, so one derived-imagery
  // directory covers both and a deployment has one fewer path to provision. Never inside pano.images.directory —
  // localBackupImageFile scans that store by extension, so a downscaled copy beside a native file would be picked
  // up as the native file, served as the archive and cut from at the wrong scale.
  private val downscaledDir: File = new File(cropsDir, "pano-downscaled")

  private val running = new AtomicBoolean(false)

  /** Mutable tallies for one run; `result` freezes them. The crop pass also collects the rows it has to write. */
  private class Counts {
    var panosOpened, panosWithoutBackup, cropsWritten, shiftedVertically, outOfFrame, dimsMismatch, dimsUnverified,
        downscaledWritten, downscaledDeleted, provenanceExplore, provenanceWindow, provenanceUnresolved, errors = 0

    val provenance = Seq.newBuilder[LabelCrop]

    def result: CropRunResult = CropRunResult(
      panosOpened, panosWithoutBackup, cropsWritten, shiftedVertically, outOfFrame, dimsMismatch, dimsUnverified,
      downscaledWritten, downscaledDeleted, provenanceExplore, provenanceWindow, provenanceUnresolved, errors
    )
  }

  def isRunning: Boolean = running.get()

  def downscaledImageFile(panoId: String): File = new File(new File(downscaledDir, panoId.take(2)), s"$panoId.jpg")

  def existingDownscaledImage(panoId: String): Option[File] = Some(downscaledImageFile(panoId)).filter(_.isFile)

  def generateMissingCrops(): Future[CropRunResult] = {
    if (!running.compareAndSet(false, true)) {
      Future.failed(new IllegalStateException("A crop generation run is already in progress."))
    } else {
      val counts = new Counts
      // Future.delegate so that a synchronous throw (an unreadable crop store, say) still releases the guard.
      Future
        .delegate {
          for {
            existing   <- Future(existingCropIds())(cpuEc)
            _          <- reconcileProvenance(existing, counts)
            candidates <- cropCandidates(existing)
            backed     <- Future(cutCrops(candidates, counts))(cpuEc)
            _          <- writeProvenance(counts.provenance.result())
            _          <- markHasBackup(backed)
            wide       <- db.run(panoDataTable.getWideBackupPanos(downscaledMaxWidth))
            _          <- Future {
              writeMissingDownscaled(wide, counts)
              pruneStaleDownscaled(wide.toSet, counts)
            }(cpuEc)
          } yield counts.result
        }
        .andThen { case _ => running.set(false) }
    }
  }

  def recordExploreFrameCrop(labelId: Int, width: Int, height: Int): Future[Unit] = {
    db.run(labelPointTable.labelPoints.filter(_.labelId === labelId).map(p => (p.canvasX, p.canvasY)).result.headOption)
      .flatMap {
        case Some((canvasX, canvasY)) =>
          val marker = exploreFrameMarker(canvasX, canvasY)
          val row    = LabelCrop(
            labelId, CropSource.ExploreFrame, marker.x, marker.y, width, height, None, OffsetDateTime.now
          )
          db.run(labelCropTable.upsert(row)).map(_ => ())
        case None =>
          logger.warn(s"Label $labelId has a crop but no label_point row yet; its provenance waits for the crop job.")
          Future.unit
      }
  }

  def cropMarker(labelId: Int): Future[Option[CropMarker]] = db.run(labelCropTable.get(labelId)).map(_.map(_.marker))

  def cropMarkers(labelIds: Seq[Int]): Future[Map[Int, CropMarker]] =
    db.run(labelCropTable.getMany(labelIds)).map(_.view.mapValues(_.marker).toMap)

  private val CropFileName = """crop_(\d+)\.png""".r

  /** The labels that already have a crop, by listing each type's directory once rather than stat-ing per label. */
  private def existingCropIds(): Map[LabelTypeEnum.Base, Set[Int]] = {
    LabelTypeEnum.values.iterator.map { labelType =>
      val dir = new File(cropsDir, labelType.name)
      val ids =
        if (!dir.isDirectory) Set.empty[Int]
        else
          Using.resource(Files.list(dir.toPath)) { paths =>
            paths.iterator().asScala.map(_.getFileName.toString).collect { case CropFileName(id) => id.toInt }.toSet
          }
      labelType -> ids
    }.toMap
  }

  /** Every live label without a crop, streamed from the whole label table and filtered as rows arrive. */
  private def cropCandidates(existing: Map[LabelTypeEnum.Base, Set[Int]]): Future[Seq[CropCandidate]] = {
    Source
      .fromPublisher(
        db.stream(labelTable.getCropCandidates.transactionally.withStatementParameters(fetchSize = 1000))
      )
      .map { case (labelId, labelType, panoId, panoX, panoY, width, height) =>
        CropCandidate(labelId, labelType, panoId, panoX, panoY, width, height)
      }
      .filterNot(c => existing.getOrElse(c.labelType, Set.empty).contains(c.labelId))
      .runWith(Sink.seq)
  }

  /**
   * Records the provenance of every crop on disk with no `label_crop` row (#2660), a batch at a time: the first run
   * over a large city visits every crop it has, so nothing here holds the whole store in memory.
   */
  private def reconcileProvenance(existing: Map[LabelTypeEnum.Base, Set[Int]], counts: Counts): Future[Unit] = {
    Source
      .fromPublisher(
        db.stream(labelTable.getLabelsWithoutCropProvenance.transactionally.withStatementParameters(fetchSize = 1000))
      )
      .map { case (labelId, labelType, timeCreated, panoId, panoX, panoY, canvasX, canvasY, width, height, ai) =>
        ProvenanceCandidate(labelId, labelType, timeCreated, panoId, panoX, panoY, canvasX, canvasY, width, height, ai)
      }
      .filter(c => existing.getOrElse(c.labelType, Set.empty).contains(c.labelId))
      .grouped(labelCropTable.UpsertBatchSize)
      .mapAsync(parallelism = 1) { batch =>
        Future(batch.flatMap(classifyProvenance(_, counts)))(cpuEc).flatMap(writeProvenance)
      }
      .runWith(Sink.ignore)
      .map(_ => ())
  }

  /**
   * Decides which writer produced a crop with no row, and where its label is (#2660).
   *
   * Two writers share the path. The browser's snapshot is always [[ExploreFrameCropWidth]] x
   * [[ExploreFrameCropHeight]]; the job's window is stored at the size [[storedSize]] gives its box — which is the
   * same 1440x960 whenever the window was at least that wide, so size settles most cases and not all. Where it
   * cannot, the file's age does: an Explore upload lands within [[ExploreUploadWindow]] of the label, and an AI label
   * never had a browser to upload one. A pano whose frame is recorded nowhere — not in `pano_data`, not in the store —
   * leaves the window uncomputable, so the crop is counted unresolved and left for a run that can read it.
   *
   * No branch calls a crop a snapshot on size alone: the window is recomputed from `pano_data` and the store *as they
   * are now*, so a re-scrape, a replaced file or a later rule can make a real job window disagree on size. The two
   * errors are not symmetric — an unresolved crop costs a warning a night, while a wrongly resolved one writes the
   * canvas fraction this table exists to end and then stops the pass ever looking again.
   *
   * @return The row to write, or `None` when the crop could not be classified.
   */
  private def classifyProvenance(c: ProvenanceCandidate, counts: Counts): Option[LabelCrop] = {
    val file = panoDataService.cropFile(c.labelId, c.labelType.name)
    try {
      val (fileW, fileH) = ImageUtils.withReader(file)((_, w, h) => (w, h))
      val isExploreSize  = (fileW, fileH) == ((ExploreFrameCropWidth, ExploreFrameCropHeight))
      val panoDims       = (c.panoWidth, c.panoHeight) match {
        case (Some(w), Some(h)) => Some((w, h))
        case _                  => storedPanoDims(c.panoId)
      }
      // `cutCrop` refuses a y outside the pano, so the job cannot have produced this file and no window registers it.
      val frame               = panoDims.filter { case (_, ph) => c.panoY >= 0 && c.panoY < ph }
      val window              = frame.map { case (pw, ph) => windowFor(c.panoX, c.panoY, pw, ph) }
      val windowSizeMatch     = window.exists { case (box, _) => sizesAgree(storedSize(box), (fileW, fileH)) }
      val writtenAfterSession =
        Duration
          .between(c.timeCreated.toInstant, Instant.ofEpochMilli(file.lastModified()))
          .compareTo(ExploreUploadWindow) > 0

      def explore: Option[LabelCrop] = {
        counts.provenanceExplore += 1
        val m = exploreFrameMarker(c.canvasX, c.canvasY)
        Some(LabelCrop(c.labelId, CropSource.ExploreFrame, m.x, m.y, fileW, fileH, None, OffsetDateTime.now))
      }
      def panoWindow: Option[LabelCrop] = window.flatMap { case (_, (fx, fy)) =>
        // A fraction outside the image fails `label_crop`'s CHECK, and one rejected row fails its whole batch.
        if (!isFraction(fx) || !isFraction(fy)) unresolved(f"its window does not contain it ($fx%.3f, $fy%.3f)")
        else {
          counts.provenanceWindow += 1
          shareImageCache.invalidate(c.labelId) // Composited with the marker at the canvas fraction.
          Some(
            LabelCrop(
              c.labelId, CropSource.PanoWindow, fx, fy, fileW, fileH, Some(CropSizingRule.Version), OffsetDateTime.now
            )
          )
        }
      }
      def unresolved(reason: String): Option[LabelCrop] = {
        counts.provenanceUnresolved += 1
        logger.warn(s"Label ${c.labelId}: cannot tell what wrote its ${fileW}x$fileH crop ($reason); leaving it.")
        None
      }

      val couldBeSnapshot = isExploreSize && !c.aiGenerated && !writtenAfterSession
      if (window.isEmpty) {
        if (couldBeSnapshot) explore
        else if (frame.isEmpty && panoDims.nonEmpty)
          unresolved(s"pano_y ${c.panoY} is outside the pano, so neither writer's window can be recomputed")
        else unresolved("no pano frame to recompute the window from")
      } else if (windowSizeMatch && !isExploreSize) panoWindow
      else if (!windowSizeMatch && isExploreSize) {
        if (couldBeSnapshot) explore
        else unresolved("snapshot-sized, but the job's window disagrees and nothing says a browser wrote it")
      } else if (windowSizeMatch) { // Both writers would have produced this size; the same three signals decide.
        if (couldBeSnapshot) explore else panoWindow
      } else unresolved("neither writer produces this size")
    } catch {
      case NonFatal(e) =>
        counts.errors += 1
        logger.warn(s"Label ${c.labelId}: cannot read its crop ${file.getPath}: $e")
        None
    }
  }

  /** What `label_crop`'s marker CHECK constraints accept. */
  private def isFraction(f: Double): Boolean = f >= 0.0 && f <= 1.0

  /** The stored file's height is rounded by the resampler, so a unit of slack; the width cap is exact. */
  private def sizesAgree(expected: (Int, Int), actual: (Int, Int)): Boolean =
    expected._1 == actual._1 && math.abs(expected._2 - actual._2) <= 1

  /** The pano's frame from its header in the store, for a `pano_data` row that records none. */
  private def storedPanoDims(panoId: String): Option[(Int, Int)] =
    panoDataService.localBackupImageFile(panoId).flatMap { file =>
      try Some(ImageUtils.withReader(file)((_, w, h) => (w, h)))
      catch { case NonFatal(_) => None }
    }

  private def writeProvenance(rows: Seq[LabelCrop]): Future[Unit] =
    if (rows.isEmpty) Future.unit
    else
      db.run(labelCropTable.upsertAll(rows)).map(_ => ()).recover { case NonFatal(e) =>
        logger.warn(s"Failed to record crop provenance for ${rows.size} labels: ${e.getMessage}")
      }

  /**
   * Cuts the candidates' crops, one pano at a time so each file is opened once and never held whole in memory.
   *
   * @return The panos that turned out to be in the store, for [[markHasBackup]].
   */
  private def cutCrops(candidates: Seq[CropCandidate], counts: Counts): Seq[String] = {
    val backed = Seq.newBuilder[String]
    candidates.groupBy(_.panoId).foreach { case (panoId, labels) =>
      panoDataService.localBackupImageFile(panoId) match {
        case None       => counts.panosWithoutBackup += 1
        case Some(file) =>
          backed += panoId
          try {
            ImageUtils.withReader(file) { (reader, width, height) =>
              counts.panosOpened += 1
              // The label positions are in the frame pano_data recorded, so an image of another size would put
              // every crop in the wrong place: skip loudly rather than mis-centre.
              val recorded = labels.head
              if (recorded.panoWidth.exists(_ != width) || recorded.panoHeight.exists(_ != height)) {
                counts.dimsMismatch += labels.size
                logger.warn(
                  s"Pano $panoId: pano_data says ${recorded.panoWidth}x${recorded.panoHeight} but the stored image " +
                    s"is ${width}x$height; skipping its ${labels.size} labels rather than mis-centring their crops."
                )
              } else {
                // A row that records no dimensions gives that check nothing to fail on, so the crop is cut against
                // the stored image on the assumption the label was placed on the same frame. Usually true — the
                // scraper stores what the client saw — but nothing here confirms it, so the run says how often it
                // had to assume rather than passing the case off as verified.
                if (recorded.panoWidth.isEmpty || recorded.panoHeight.isEmpty) {
                  counts.dimsUnverified += labels.size
                  logger.warn(
                    s"Pano $panoId: pano_data records no dimensions, so nothing confirms its ${labels.size} labels " +
                      s"were placed on a ${width}x$height frame; cropping against the stored image anyway."
                  )
                }
                labels.foreach(label => cutCrop(reader, width, height, label, counts))
              }
              writeDownscaledIfWide(panoId, reader, width, height, counts)
            }
          } catch {
            case NonFatal(e) =>
              counts.errors += labels.size
              logger.warn(s"Pano $panoId: cannot read ${file.getPath}, skipping its ${labels.size} labels: $e")
          }
      }
    }
    backed.result()
  }

  private def cutCrop(reader: ImageReader, width: Int, height: Int, label: CropCandidate, counts: Counts): Unit = {
    // The poles are not adjacent, so a y outside the image would clamp to one and yield clean imagery of a place the
    // label is not in. x needs no such check: column 0 and column `width` are the same place, so any x wraps correctly.
    if (label.panoY < 0 || label.panoY >= height) {
      counts.outOfFrame += 1
      logger.warn(s"Label ${label.labelId} on pano ${label.panoId}: pano_y ${label.panoY} is outside the image.")
    } else {
      try {
        val (box, (fx, fy)) = windowFor(label.panoX, label.panoY, width, height)
        val crop            = storedCrop(cutWindow(reader, box, width))
        val target          = panoDataService.cropFile(label.labelId, label.labelType.name)
        val _               = target.getParentFile.mkdirs()
        ImageUtils.writePng(crop, target)
        // A share preview built before the crop existed would otherwise be served forever (#4726).
        shareImageCache.invalidate(label.labelId)
        // The row is written after the pass, in one batch; a run that dies in between leaves a crop the reconcile
        // pass classifies next time.
        counts.provenance += LabelCrop(
          label.labelId, CropSource.PanoWindow, fx, fy, crop.getWidth, crop.getHeight, Some(CropSizingRule.Version),
          OffsetDateTime.now
        )
        counts.cropsWritten += 1
        if (box.shifted) counts.shiftedVertically += 1
      } catch {
        case NonFatal(e) =>
          counts.errors += 1
          logger.warn(s"Failed to crop label ${label.labelId} on pano ${label.panoId}: $e")
      }
    }
  }

  /**
   * Whether the downscaled copy on disk is the one the current configuration asks for.
   *
   * Checked rather than assumed because a `pano.downscaled.max-width` change is otherwise invisible: the file exists, so
   * nothing recuts it, and `/backupImage` goes on serving the old width in place of the native pano — the one thing
   * lowering the cap was meant to stop. A file that won't open reads as out of date too, so a truncated copy heals
   * on the next run.
   */
  private def downscaledIsCurrent(panoId: String): Boolean = {
    val file = downscaledImageFile(panoId)
    file.isFile && {
      try ImageUtils.withReader(file)((_, width, _) => width == downscaledMaxWidth)
      catch { case NonFatal(_) => false }
    }
  }

  private def writeDownscaledIfWide(
      panoId: String,
      reader: ImageReader,
      width: Int,
      height: Int,
      counts: Counts
  ): Unit =
    if (width > downscaledMaxWidth && !downscaledIsCurrent(panoId)) {
      writeDownscaledCounting(panoId, reader, width, height, counts)
    }

  private def writeDownscaledCounting(
      panoId: String,
      reader: ImageReader,
      width: Int,
      height: Int,
      counts: Counts
  ): Unit =
    try {
      writeDownscaled(reader, width, height, downscaledMaxWidth, downscaledImageFile(panoId))
      counts.downscaledWritten += 1
    } catch {
      case NonFatal(e) =>
        counts.errors += 1
        logger.warn(s"Failed to write the downscaled copy of pano $panoId: $e")
    }

  /**
   * Downscaled copies for backed-up panos the crop pass had no reason to open (every label already cropped). The
   * copy's own header is what decides whether a pano needs visiting, so the native file — the expensive one to open —
   * is only touched for a pano whose copy is missing or at the wrong width.
   */
  private def writeMissingDownscaled(panoIds: Seq[String], counts: Counts): Unit = {
    panoIds.filterNot(downscaledIsCurrent).foreach { panoId =>
      panoDataService.localBackupImageFile(panoId).foreach { file =>
        try {
          ImageUtils.withReader(file) { (reader, width, height) =>
            counts.panosOpened += 1
            if (width > downscaledMaxWidth) writeDownscaledCounting(panoId, reader, width, height, counts)
          }
        } catch {
          case NonFatal(e) =>
            counts.errors += 1
            logger.warn(s"Pano $panoId: cannot read ${file.getPath} to downscale it: $e")
        }
      }
    }
  }

  private val DownscaledFileName = """(.+)\.jpg""".r

  /**
   * Deletes the downscaled copies of panos that no longer need one, so that a raised `pano.downscaled.max-width`
   * reaches the store the way a lowered one does through [[downscaledIsCurrent]].
   *
   * A pano that the cap now lets through natively drops out of `getWideBackupPanos`, so nothing above revisits it,
   * yet `/backupImage` would go on preferring its old, smaller copy to the native file. The copies on disk are the
   * candidates; those the database still calls wide are kept unread, and the rest are judged by the native file's
   * own header — the frame the writer measured — rather than by `pano_data`, so a row whose recorded width disagrees
   * with the file (the crop pass's dimension mismatch) doesn't have its copy deleted tonight and rewritten tomorrow.
   * A copy whose native file is gone is deleted too: the route only serves a copy beside a native file.
   *
   * @param wide The panos `getWideBackupPanos` returned for the current cap.
   */
  private def pruneStaleDownscaled(wide: Set[String], counts: Counts): Unit = {
    existingDownscaledIds().filterNot(wide).foreach { panoId =>
      val stillNeeded = panoDataService.localBackupImageFile(panoId).exists { file =>
        try ImageUtils.withReader(file)((_, width, _) => width > downscaledMaxWidth)
        catch { case NonFatal(_) => true } // An unreadable native file is not evidence; leave the copy alone.
      }
      if (!stillNeeded && downscaledImageFile(panoId).delete()) counts.downscaledDeleted += 1
    }
  }

  /** Every pano with a downscaled copy on disk, by listing the store once. */
  private def existingDownscaledIds(): Seq[String] = {
    if (!downscaledDir.isDirectory) Seq.empty
    else
      Using.resource(Files.walk(downscaledDir.toPath, 2)) { paths =>
        paths
          .iterator()
          .asScala
          .filter(Files.isRegularFile(_))
          .map(_.getFileName.toString)
          .collect { case DownscaledFileName(panoId) => panoId }
          .toSeq
      }
  }

  /**
   * Records what the store turned out to hold: the disk is the truth about which panos are backed up and the row is
   * a cache of it (#4865). One statement rather than a round trip per pano — the crop pass is a single thread of the
   * CPU-intensive pool, and awaiting a network hop per pano would spend that thread on latency.
   */
  private def markHasBackup(panoIds: Seq[String]): Future[Unit] = {
    db.run(panoDataTable.markHasBackup(panoIds))
      .map(_ => ())
      .recover { case NonFatal(e) =>
        logger.warn(s"Failed to update has_backup for ${panoIds.size} panos: ${e.getMessage}")
      }
  }
}
